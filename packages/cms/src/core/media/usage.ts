import { and, eq, inArray, isNull } from 'drizzle-orm';

import type { VersionToIndex } from '../content-index';
import type { DrizzleInstance } from '../types/drizzle';

import { newId } from '../../utils/nanoid';
import {
  assets,
  blockVersions,
  branches,
  commitSnapshots,
  contentUsages,
  roots,
} from '../db/schema.generated';
import { rootScopeConditions } from '../scope';

// Asset ids are nanoids like `ast_<20 chars>`; the generic id shape is matched
// then validated against the assets table (assetId is a real FK), so other ids
// that happen to match are never inserted.
const ASSET_ID_PATTERN = /^[a-z]{2,5}_[0-9a-z]{20}$/;

/**
 * Recursively collects candidate asset-id strings from a property value,
 * descending into nested objects/arrays (galleries, rich-text reference nodes).
 */
function collectAssetIdCandidates(value: unknown, out: Set<string>): void {
  if (typeof value === 'string') {
    if (ASSET_ID_PATTERN.test(value)) out.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectAssetIdCandidates(item, out);
    return;
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) {
      collectAssetIdCandidates(v, out);
    }
  }
}

/**
 * Flat, deduplicated list of every asset-id candidate found anywhere in a
 * block's properties (descending into nested objects/arrays). Used wherever
 * only the set of referenced ids matters (publish-status sync, discovery).
 */
export function collectAssetIdsFromProperties(
  properties: Record<string, unknown>,
): string[] {
  const found = new Set<string>();
  collectAssetIdCandidates(properties, found);
  return [...found];
}

/**
 * Maps each top-level property key to the asset-id candidates found anywhere
 * within its (possibly nested) value.
 */
export function extractAssetIdsFromProperties(
  properties: Record<string, unknown>,
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const [propKey, value] of Object.entries(properties)) {
    const found = new Set<string>();
    collectAssetIdCandidates(value, found);
    if (found.size > 0) result.set(propKey, [...found]);
  }
  return result;
}

/**
 * Inserts content_usages asset rows for newly-created block versions, within the same
 * transaction that created them. Insert-only: there is no delete-then-reinsert
 * (the branch-blind anti-pattern). MUST be called at EVERY block-version insert
 * site (commit-writer's writeCommit + createInitialCommit, and merges'
 * createMergeBlockVersion) — a version that references an asset but skips this
 * call would be invisible to the GC, which could then delete a live asset.
 *
 * Candidates are validated against the assets table because assetId is an FK.
 */
export async function insertAssetReferencesForVersions(
  tx: DrizzleInstance,
  rootId: string,
  versions: VersionToIndex[],
): Promise<void> {
  const pending: {
    blockVersionId: string;
    blockId: string;
    propertyKey: string;
    assetId: string;
  }[] = [];
  const candidateIds = new Set<string>();

  for (const version of versions) {
    const extracted = extractAssetIdsFromProperties(version.properties);
    for (const [propertyKey, ids] of extracted) {
      for (const id of ids) {
        pending.push({
          blockVersionId: version.blockVersionId,
          blockId: version.blockId,
          propertyKey,
          assetId: id,
        });
        candidateIds.add(id);
      }
    }
  }
  if (pending.length === 0) return;

  const realAssetIds = new Set(
    (
      await tx
        .select({ id: assets.id })
        .from(assets)
        .where(inArray(assets.id, [...candidateIds]))
    ).map((r) => r.id),
  );
  if (realAssetIds.size === 0) return;

  const rows = pending
    .filter((p) => realAssetIds.has(p.assetId))
    .map((p) => ({
      id: newId('contentUsage'),
      targetKind: 'asset' as const,
      targetKey: p.assetId,
      blockVersionId: p.blockVersionId,
      rootId,
      blockId: p.blockId,
      propertyKey: p.propertyKey,
    }));

  if (rows.length > 0) {
    await tx.insert(contentUsages).values(rows).onConflictDoNothing();
  }
}

/**
 * Authoritative liveness check for DESTRUCTIVE paths (pruning GC reclaim,
 * archiveAssets guard) AND the media-library UI — a single source of truth.
 * True if a non-deleted block version that references the asset sits in the
 * HEAD snapshot of any branch of any non-archived root.
 *
 * Because references are keyed by the immutable blockVersionId and inserted at
 * every version-creation site, the index cannot drift or under-report across
 * branches/merges (the reason the old blockId-keyed index could not be trusted
 * for a destructive op). The commit_snapshots ⋈ branches(headCommitId) join
 * restricts to live content; deleted=false drops tombstones.
 *
 * `scopeColumns` are the active CROSS-SCOPE columns (the caller already removed a
 * scoping plugin's cross-scope columns via `crossScopeColumns`), so a host in any
 * such sibling scope still counts while a host OUTSIDE the scope (e.g. another
 * tenant) can NEVER block the owner's archiveAssets — asset ids are
 * author-controlled raw strings in block properties. Symmetric with
 * loadPublishedRoots and isReferencedByLiveContent (core/references.ts);
 * undefined / single-scope → unscoped, unchanged.
 */
export async function isAssetReferencedByLiveContent(
  db: DrizzleInstance,
  assetId: string,
  scopeColumns?: Record<string, unknown>,
): Promise<boolean> {
  const hit = await db
    .select({ id: contentUsages.id })
    .from(contentUsages)
    .innerJoin(
      commitSnapshots,
      eq(commitSnapshots.blockVersionId, contentUsages.blockVersionId),
    )
    .innerJoin(branches, eq(branches.headCommitId, commitSnapshots.commitId))
    .innerJoin(roots, eq(roots.id, branches.rootId))
    .innerJoin(
      blockVersions,
      eq(blockVersions.id, contentUsages.blockVersionId),
    )
    .where(
      and(
        eq(contentUsages.targetKind, 'asset'),
        eq(contentUsages.targetKey, assetId),
        isNull(roots.archivedAt),
        eq(blockVersions.deleted, false),
        ...rootScopeConditions(scopeColumns),
      ),
    )
    .limit(1);
  return hit.length > 0;
}

/**
 * Page-centric usage for the media library — "this image is used on these N
 * pages". Returns each distinct live (non-archived) page that references the
 * asset, with its per-block occurrences. A page counts once even when the asset
 * appears in several of its blocks or branches.
 *
 * `scopeColumns` are the active CROSS-SCOPE columns (a scoping plugin's
 * cross-scope columns already removed by the caller), so a host outside the scope
 * (e.g. another tenant) never appears in the usage list — symmetric with the
 * archiveAssets guard and the read path. Undefined → unscoped.
 */
export async function getAssetUsageDetails(
  db: DrizzleInstance,
  assetId: string,
  scopeColumns?: Record<string, unknown>,
): Promise<{
  pageCount: number;
  pages: {
    rootId: string;
    collection: string;
    slug: string | null;
    occurrences: { branchId: string; blockId: string; propertyKey: string }[];
  }[];
}> {
  const rows = await db
    .select({
      rootId: roots.id,
      collection: roots.collection,
      slug: roots.slug,
      branchId: branches.id,
      blockId: contentUsages.blockId,
      propertyKey: contentUsages.propertyKey,
    })
    .from(contentUsages)
    .innerJoin(
      commitSnapshots,
      eq(commitSnapshots.blockVersionId, contentUsages.blockVersionId),
    )
    .innerJoin(branches, eq(branches.headCommitId, commitSnapshots.commitId))
    .innerJoin(roots, eq(roots.id, branches.rootId))
    .innerJoin(
      blockVersions,
      eq(blockVersions.id, contentUsages.blockVersionId),
    )
    .where(
      and(
        eq(contentUsages.targetKind, 'asset'),
        eq(contentUsages.targetKey, assetId),
        isNull(roots.archivedAt),
        eq(blockVersions.deleted, false),
        ...rootScopeConditions(scopeColumns),
      ),
    );

  const pageMap = new Map<string, (typeof pages)[number]>();
  const pages: {
    rootId: string;
    collection: string;
    slug: string | null;
    occurrences: { branchId: string; blockId: string; propertyKey: string }[];
  }[] = [];

  for (const row of rows) {
    let page = pageMap.get(row.rootId);
    if (!page) {
      page = {
        rootId: row.rootId,
        collection: row.collection,
        slug: row.slug ?? null,
        occurrences: [],
      };
      pageMap.set(row.rootId, page);
      pages.push(page);
    }
    page.occurrences.push({
      branchId: row.branchId,
      blockId: row.blockId,
      propertyKey: row.propertyKey,
    });
  }

  return { pageCount: pages.length, pages };
}
