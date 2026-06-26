import { and, eq, inArray, isNull } from 'drizzle-orm';

import type { VersionToIndex } from './assets';
import type { CollectionWithName } from './types';
import type { ReferenceResolver } from './types/definitions';
import type { DrizzleInstance } from './types/drizzle';

import { newId } from '../utils/nanoid';
import {
  blockVersions,
  branches,
  commitSnapshots,
  contentUsages,
  roots,
} from './db/schema.generated';
import { rootScopeConditions } from './scope';

/**
 * Maps each `reference`-type property of a block (root or child) to the NAME of
 * the collection it targets, by reading the collection definition. Shared by the
 * read-time resolver (`resolveTreeReferences`, publications.ts) AND the write-time
 * usage indexer below, so both agree on exactly which properties are references
 * and where they point — a single source of truth.
 */
export function getReferencePropertyNames(
  collectionDef: CollectionWithName,
  blockType: string,
): Map<string, string> {
  const refProps = new Map<string, string>();

  if (blockType === collectionDef.name || blockType === 'root') {
    for (const [key, spec] of Object.entries(collectionDef.root.properties)) {
      if (spec.type === 'reference') {
        refProps.set(key, (spec as { collection: string }).collection);
      }
    }
    return refProps;
  }

  const blockDef = collectionDef.blocks?.[blockType];
  if (!blockDef) return refProps;

  for (const [key, spec] of Object.entries(blockDef.properties)) {
    if (spec.type === 'reference') {
      refProps.set(key, (spec as { collection: string }).collection);
    }
  }
  return refProps;
}

/**
 * The NAMES of a block's `link`-type properties (root or child). Single source of
 * truth shared by the read-time link resolver and the write-time usage indexer,
 * mirroring {@link getReferencePropertyNames}. A link carries no fixed target
 * collection (it is a discriminated union and may be external), so this returns a
 * plain Set of property keys.
 */
export function getLinkPropertyNames(
  collectionDef: CollectionWithName,
  blockType: string,
): Set<string> {
  const linkProps = new Set<string>();
  const props =
    blockType === collectionDef.name || blockType === 'root'
      ? collectionDef.root.properties
      : collectionDef.blocks?.[blockType]?.properties;
  if (!props) return linkProps;
  for (const [key, spec] of Object.entries(props)) {
    if (spec.type === 'link') linkProps.add(key);
  }
  return linkProps;
}

/**
 * Inserts content_usages `reference` rows for newly-created block versions, within
 * the same transaction that created them — the third sibling of the asset and
 * variable indexers (see core/content-index.ts). A reference is a top-level
 * block property of type `reference` (per the collection def); its stored VALUE
 * is the raw reference string (a `rot_` rootId, or under i18n a `tgr_`
 * translationKey), recorded verbatim as `targetKey` so the reverse "who embeds
 * me" query (RB2+) can match the anchor rootId directly.
 *
 * INSERT-only and keyed by the immutable blockVersionId, like its siblings. The
 * `collectionDef` is REQUIRED (no default) so every version-insert site must
 * thread it — a missed site would silently under-index, which is load-bearing for
 * the reusable-block delete guard (RB4). Ships dark in RB1: rows populate, nothing
 * reads them yet.
 */
export async function insertReferenceUsagesForVersions(
  tx: DrizzleInstance,
  rootId: string,
  versions: VersionToIndex[],
  collectionDef: CollectionWithName,
): Promise<void> {
  const rows: {
    id: string;
    targetKind: 'reference' | 'link';
    targetKey: string;
    blockVersionId: string;
    rootId: string;
    blockId: string;
    propertyKey: string;
  }[] = [];

  for (const version of versions) {
    const refProps = getReferencePropertyNames(collectionDef, version.type);
    for (const [propKey] of refProps) {
      const value = version.properties[propKey];
      if (typeof value !== 'string' || !value) continue;
      rows.push({
        id: newId('contentUsage'),
        targetKind: 'reference',
        targetKey: value,
        blockVersionId: version.blockVersionId,
        rootId,
        blockId: version.blockId,
        propertyKey: propKey,
      });
    }

    // INTERNAL links index their target rootId too (targetKind 'link') — for the
    // usage UI / soft delete-warning. External/email/phone links are not tracked.
    const linkProps = getLinkPropertyNames(collectionDef, version.type);
    for (const propKey of linkProps) {
      const value = version.properties[propKey] as
        | { kind?: string; rootId?: unknown }
        | undefined;
      if (!value || value.kind !== 'internal') continue;
      if (typeof value.rootId !== 'string' || !value.rootId) continue;
      rows.push({
        id: newId('contentUsage'),
        targetKind: 'link',
        targetKey: value.rootId,
        blockVersionId: version.blockVersionId,
        rootId,
        blockId: version.blockId,
        propertyKey: propKey,
      });
    }
  }

  if (rows.length > 0) {
    await tx.insert(contentUsages).values(rows).onConflictDoNothing();
  }
}

/**
 * ANCHOR-only liveness check for the delete guard (RB4): true if `rootId` is the
 * DIRECTLY-stored `referencedRootId` of any LIVE reference (a non-deleted
 * referencing version in some branch HEAD snapshot of a non-archived root).
 * Matches exactly the stored value — it does NOT expand to the translation group,
 * so deleting a translation SIBLING (reached only via read-time auto-upgrade) is
 * allowed and degrades gracefully to the anchor. Mirrors
 * isAssetReferencedByLiveContent (core/assets.ts).
 *
 * `scopeColumns` are the active CROSS-SCOPE columns (the caller already removed a
 * scoping plugin's cross-scope columns via `crossScopeColumns`), so a host in any
 * such sibling scope still counts while a host OUTSIDE the scope (e.g. another
 * tenant) can NEVER block the owner's delete — reference values are
 * author-controlled raw strings. Symmetric with loadPublishedRoots; undefined /
 * single-scope → unscoped, unchanged.
 */
export async function isReferencedByLiveContent(
  db: DrizzleInstance,
  rootId: string,
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
        eq(contentUsages.targetKind, 'reference'),
        eq(contentUsages.targetKey, rootId),
        isNull(roots.archivedAt),
        eq(blockVersions.deleted, false),
        ...rootScopeConditions(scopeColumns),
      ),
    )
    .limit(1);
  return hit.length > 0;
}

/**
 * Page-centric usage for the reusable-block library — "this block is embedded on
 * these N pages". Takes the SET of rootIds that represent one logical block: a
 * single rootId without i18n, or ALL translation-group siblings under i18n (the
 * caller expands the group at query time — see the getReferenceUsages endpoint),
 * so a translated sibling reports the true GROUP-LEVEL usage instead of a
 * misleading 0. Each distinct live (non-archived) HOST root counts once even when
 * it embeds the block in several blocks or branches. Mirrors getAssetUsageDetails.
 *
 * `scopeColumns` are the active CROSS-SCOPE columns (a scoping plugin's
 * cross-scope columns already removed by the caller), so a host outside the scope
 * (e.g. another tenant) never appears in the usage list — symmetric with the
 * delete guard and the read path. Undefined → unscoped.
 */
export async function getReferenceUsageDetails(
  db: DrizzleInstance,
  rootIds: string[],
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
  if (rootIds.length === 0) return { pageCount: 0, pages: [] };

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
        eq(contentUsages.targetKind, 'reference'),
        inArray(contentUsages.targetKey, rootIds),
        isNull(roots.archivedAt),
        eq(blockVersions.deleted, false),
        ...rootScopeConditions(scopeColumns),
      ),
    );

  const pages: {
    rootId: string;
    collection: string;
    slug: string | null;
    occurrences: { branchId: string; blockId: string; propertyKey: string }[];
  }[] = [];
  const pageMap = new Map<string, (typeof pages)[number]>();

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

// ============================================================================
// Reference-resolution seam — core's identity default (Seam B)
// ============================================================================

/**
 * Core's identity `ReferenceResolver` — the no-resolver-plugin behaviour (a
 * stored value renders as itself; no grouping), byte-for-byte. Used wherever
 * `scope.referenceResolver` is absent.
 *   - resolveRenderTargets: every stored value renders as itself
 *     (loadPublishedRoots then drops unpublished / out-of-scope ones).
 *   - resolveConflictTargets: the existing, non-archived roots among the keys
 *     (by id), scoped to the given (cross-scope) columns.
 *   - expandGroup: identity (no groups without a resolver plugin).
 *   - groupKeysFor: [] (no group keys without a resolver plugin).
 *
 * Stateless singleton: `db` and `scopeColumns` are per-call args (so a caller
 * inside a transaction resolves on its own tx, and tenant scoping uses the
 * merged columns the caller holds).
 */
export const coreReferenceResolver: ReferenceResolver = {
  async resolveRenderTargets(_db, _scopeColumns, _collection, storedValues) {
    return new Map(storedValues.map((v) => [v, v]));
  },
  async resolveConflictTargets(db, scopeColumns, storedKeys) {
    if (storedKeys.length === 0) return [];
    const rows = await db
      .select({ id: roots.id })
      .from(roots)
      .where(
        and(
          inArray(roots.id, storedKeys),
          isNull(roots.archivedAt),
          ...rootScopeConditions(scopeColumns),
        ),
      );
    return rows.map((r) => r.id);
  },
  async expandGroup(_db, _scopeColumns, rootIds) {
    return rootIds;
  },
  async groupKeysFor() {
    return [];
  },
};

// ============================================================================
// Reference edges — the generic live-head graph primitive (exposed for plugins)
// ============================================================================

/**
 * Live-head reference edges in one direction. `embeds` filters on the host
 * `rootId` and returns what those hosts embed (the `targetKey`s); `embeddedBy`
 * filters on `targetKey` and returns the hosts (`rootId`s). Restricted to
 * non-archived roots' non-deleted branch-HEAD content, scope-filtered (the
 * caller passes cross-scope columns — like the read path / delete guard).
 */
export async function referenceEdges(
  db: DrizzleInstance,
  ids: string[],
  direction: 'embeds' | 'embeddedBy',
  scopeColumns?: Record<string, unknown>,
): Promise<string[]> {
  if (ids.length === 0) return [];
  const filterCol =
    direction === 'embeds' ? contentUsages.rootId : contentUsages.targetKey;
  const selectCol =
    direction === 'embeds' ? contentUsages.targetKey : contentUsages.rootId;
  const rows = await db
    .selectDistinct({ id: selectCol })
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
        eq(contentUsages.targetKind, 'reference'),
        inArray(filterCol, ids),
        isNull(roots.archivedAt),
        eq(blockVersions.deleted, false),
        ...rootScopeConditions(scopeColumns),
      ),
    );
  return rows.map((r) => r.id);
}
