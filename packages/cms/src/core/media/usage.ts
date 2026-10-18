import {
  type AnyColumn,
  and,
  eq,
  inArray,
  isNull,
  type SQL,
  sql,
} from 'drizzle-orm';

import type { DrizzleInstance } from '../types/drizzle';

import {
  assets,
  branches,
  commitSnapshots,
  contentUsages,
  publications,
  roots,
} from '../db/schema.generated';
import { rootScopeConditions } from '../scope';

/**
 * True when any block version, in any branch or commit, holds a string that
 * contains the asset id without being exactly the id: an `<img src>` in rich
 * text HTML, a stringified JSON document, a URL. The `content_usages` index
 * matches whole-string ids only, so such references are invisible to it.
 *
 * Ids with characters outside `[A-Za-z0-9_-]` never match, since the id is
 * spliced into a jsonpath literal. `scopeColumns` limits the search to roots
 * in scope (cross-scope columns, as for the live-usage guard).
 */
export function richTextReferenceExists(
  assetId: AnyColumn | SQL,
  scopeColumns?: Record<string, unknown>,
): SQL {
  const scoped = rootScopeConditions(scopeColumns);
  return sql`EXISTS (
    SELECT 1 FROM cms.block_versions bv
    ${scoped.length > 0 ? sql`JOIN cms.roots ON cms.roots.id = bv.root_id` : sql``}
    WHERE bv.properties::text LIKE '%' || ${assetId} || '%'
      AND CASE WHEN ${assetId} ~ '^[A-Za-z0-9_-]+$'
        THEN jsonb_path_exists(
          bv.properties,
          ('$.** ? (@.type() == "string" && @ like_regex "' || ${assetId} ||
            '" && @ != "' || ${assetId} || '")')::jsonpath
        )
        ELSE false END
      ${scoped.length > 0 ? sql`AND ${and(...scoped)}` : sql``}
  )`;
}

/**
 * The subset of `assetIds` that {@link richTextReferenceExists} flags.
 */
export async function assetsSuspectedInRichText(
  db: DrizzleInstance,
  assetIds: string[],
  scopeColumns?: Record<string, unknown>,
): Promise<Set<string>> {
  if (assetIds.length === 0) return new Set();
  const rows = await db
    .select({ id: assets.id })
    .from(assets)
    .where(
      and(
        inArray(assets.id, assetIds),
        richTextReferenceExists(assets.id, scopeColumns),
      ),
    );
  return new Set(rows.map((r) => r.id));
}

/**
 * Where an asset usage counts. `live`: in the head of any branch;
 * `published`: in the head of a published branch (what the published site
 * serves); `history`: in any commit; `{ branchId }`: in that branch's head.
 */
export type UsageScope =
  | 'published'
  | 'live'
  | 'history'
  | { branchId: string };

export type UsageFilter = {
  /** The indexed targets: asset ids, or referenced root ids with `kind: 'reference'`. */
  assetIds?: string[];
  /** @default 'asset' */
  kind?: 'asset' | 'reference';
  scope: UsageScope;
  /** The caller's cross-scope columns (see `rootScopeConditions`). */
  scopeColumns?: Record<string, unknown>;
  /** A root predicate of the caller's scope (`scope.roots.where`). */
  rootsWhere?: SQL;
  /** Count roots in the trash (they return on restore). */
  includeArchivedRoots?: boolean;
  /** Only image usages without alt text. */
  missingAlt?: boolean;
  /** One root only. */
  rootId?: string;
  /** With `published`: leave out this publication (the one being unpublished). */
  excludePublication?: { rootId: string; branchId: string };
};

function usageConditions(filter: UsageFilter): SQL[] {
  const conditions: SQL[] = [
    eq(contentUsages.targetKind, filter.kind ?? 'asset'),
  ];
  if (filter.assetIds)
    conditions.push(inArray(contentUsages.targetKey, filter.assetIds));
  if (filter.rootId) conditions.push(eq(contentUsages.rootId, filter.rootId));
  if (!filter.includeArchivedRoots) conditions.push(isNull(roots.archivedAt));
  if (filter.missingAlt) conditions.push(eq(contentUsages.altState, 'missing'));
  conditions.push(...rootScopeConditions(filter.scopeColumns));
  if (filter.rootsWhere) conditions.push(filter.rootsWhere);
  return conditions;
}

/**
 * The scope of `filter` as one condition on a `content_usages` row. Branch
 * scopes probe the head snapshot of the root's branches by its primary key
 * (`commitId`, `blockId`) plus the version, so a usage counts only while its
 * exact block version is in a head; tombstones are never indexed, so no
 * version check is needed. `history` asks whether any commit holds the
 * version.
 */
function scopeCondition(filter: UsageFilter): SQL {
  if (filter.scope === 'history') {
    return sql`EXISTS (SELECT 1 FROM ${commitSnapshots} WHERE ${commitSnapshots.blockVersionId} = ${contentUsages.blockVersionId})`;
  }
  const extra: SQL[] = [];
  let publicationJoin = sql``;
  if (filter.scope === 'published') {
    publicationJoin = sql`JOIN ${publications} ON ${publications.branchId} = ${branches.id}`;
    if (filter.excludePublication) {
      extra.push(
        sql`NOT (${publications.rootId} = ${filter.excludePublication.rootId} AND ${publications.branchId} = ${filter.excludePublication.branchId})`,
      );
    }
  } else if (typeof filter.scope === 'object') {
    extra.push(sql`${branches.id} = ${filter.scope.branchId}`);
  }
  return sql`EXISTS (
    SELECT 1 FROM ${branches}
    JOIN ${commitSnapshots}
      ON ${commitSnapshots.commitId} = ${branches.headCommitId}
     AND ${commitSnapshots.blockId} = ${contentUsages.blockId}
     AND ${commitSnapshots.blockVersionId} = ${contentUsages.blockVersionId}
    ${publicationJoin}
    WHERE ${branches.rootId} = ${contentUsages.rootId}
    ${extra.length > 0 ? sql`AND ${and(...extra)}` : sql``}
  )`;
}

/** Every condition of `filter` on `content_usages` joined to `roots`. */
function usageWhere(filter: UsageFilter): SQL {
  return and(...usageConditions(filter), scopeCondition(filter))!;
}

/** The asset ids among `filter.assetIds` that have a usage in `filter.scope`. */
export async function assetsUsedIn(
  db: DrizzleInstance,
  filter: UsageFilter & { assetIds: string[] },
): Promise<Set<string>> {
  if (filter.assetIds.length === 0) return new Set();
  const rows = await db
    .selectDistinct({ assetId: contentUsages.targetKey })
    .from(contentUsages)
    .innerJoin(roots, eq(roots.id, contentUsages.rootId))
    .where(usageWhere(filter));
  return new Set(rows.map((r) => r.assetId));
}

/** The assets in use by live content, in scope; see {@link assetsUsedIn}. */
export function assetsReferencedByLiveContent(
  db: DrizzleInstance,
  assetIds: string[],
  scopeColumns?: Record<string, unknown>,
): Promise<Set<string>> {
  return assetsUsedIn(db, { assetIds, scope: 'live', scopeColumns });
}

/** One usage of an asset in `filter.scope`, with its root and branch. */
export type ScopedUsage = {
  assetId: string;
  rootId: string;
  collection: string;
  slug: string | null;
  branchId: string | null;
  branchName: string | null;
  blockId: string;
  propertyKey: string;
  path: string;
  matchedBy: string;
  altState: string | null;
  revisionId: string | null;
};

/**
 * Every usage in `filter`, ordered by collection, root, branch and path.
 * Branch scopes list a usage once per branch whose head holds it; `history`
 * lists it once, without a branch.
 */
export async function scopedUsages(
  db: DrizzleInstance,
  filter: UsageFilter,
): Promise<ScopedUsage[]> {
  const fields = {
    assetId: contentUsages.targetKey,
    rootId: contentUsages.rootId,
    collection: roots.collection,
    slug: roots.slug,
    blockId: contentUsages.blockId,
    propertyKey: contentUsages.propertyKey,
    path: contentUsages.path,
    matchedBy: contentUsages.matchedBy,
    altState: contentUsages.altState,
    revisionId: contentUsages.revisionId,
  };
  let rows: ScopedUsage[];
  if (filter.scope === 'history') {
    rows = (
      await db
        .select(fields)
        .from(contentUsages)
        .innerJoin(roots, eq(roots.id, contentUsages.rootId))
        .where(usageWhere(filter))
    ).map((row) => ({ ...row, branchId: null, branchName: null }));
  } else {
    // One row per branch whose head holds the usage; `scopeCondition`
    // already restricted the usage, this join names the branches.
    const branchConditions: SQL[] = [
      eq(branches.rootId, contentUsages.rootId),
      sql`EXISTS (SELECT 1 FROM ${commitSnapshots} WHERE ${commitSnapshots.commitId} = ${branches.headCommitId} AND ${commitSnapshots.blockId} = ${contentUsages.blockId} AND ${commitSnapshots.blockVersionId} = ${contentUsages.blockVersionId})`,
    ];
    if (typeof filter.scope === 'object') {
      branchConditions.push(eq(branches.id, filter.scope.branchId));
    }
    if (filter.scope === 'published') {
      branchConditions.push(
        sql`EXISTS (SELECT 1 FROM ${publications} WHERE ${publications.branchId} = ${branches.id})`,
      );
    }
    rows = await db
      .select({ ...fields, branchId: branches.id, branchName: branches.name })
      .from(contentUsages)
      .innerJoin(roots, eq(roots.id, contentUsages.rootId))
      .innerJoin(branches, and(...branchConditions))
      .where(usageWhere(filter));
  }
  return rows.sort(
    (a, b) =>
      a.collection.localeCompare(b.collection) ||
      a.rootId.localeCompare(b.rootId) ||
      (a.branchName ?? '').localeCompare(b.branchName ?? '') ||
      a.path.localeCompare(b.path),
  );
}

/**
 * Per asset, the number of roots using it in `scope` and of published roots
 * using it. Read from the index on every call: never cache it for a
 * protection decision.
 */
export async function assetUsageCounts(
  db: DrizzleInstance,
  assetIds: string[],
  scope: UsageScope,
  scopeColumns?: Record<string, unknown>,
): Promise<Record<string, { roots: number; published: number }>> {
  const counts: Record<string, { roots: number; published: number }> = {};
  for (const id of assetIds) counts[id] = { roots: 0, published: 0 };
  if (assetIds.length === 0) return counts;
  const count = (filter: UsageFilter) =>
    db
      .select({
        assetId: contentUsages.targetKey,
        roots: sql<number>`count(DISTINCT ${contentUsages.rootId})::int`,
      })
      .from(contentUsages)
      .innerJoin(roots, eq(roots.id, contentUsages.rootId))
      .where(usageWhere(filter))
      .groupBy(contentUsages.targetKey);
  const [inScope, published] = await Promise.all([
    count({ assetIds, scope, scopeColumns }),
    count({ assetIds, scope: 'published', scopeColumns }),
  ]);
  for (const row of inScope) counts[row.assetId].roots = row.roots;
  for (const row of published) counts[row.assetId].published = row.roots;
  return counts;
}

/** How many distinct roots use any of `filter.assetIds` in `filter.scope`. */
export async function rootsUsingAssets(
  db: DrizzleInstance,
  filter: UsageFilter & { assetIds: string[] },
): Promise<number> {
  if (filter.assetIds.length === 0) return 0;
  const [row] = await db
    .select({
      roots: sql<number>`count(DISTINCT ${contentUsages.rootId})::int`,
    })
    .from(contentUsages)
    .innerJoin(roots, eq(roots.id, contentUsages.rootId))
    .where(usageWhere(filter));
  return row?.roots ?? 0;
}

/** The asset ids indexed for the blocks of `rootId` at `commitId`. */
export async function assetsAtCommit(
  db: DrizzleInstance,
  commitId: string,
  rootId: string,
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ assetId: contentUsages.targetKey })
    .from(contentUsages)
    .innerJoin(
      commitSnapshots,
      and(
        eq(commitSnapshots.commitId, commitId),
        eq(commitSnapshots.blockId, contentUsages.blockId),
        eq(commitSnapshots.blockVersionId, contentUsages.blockVersionId),
      ),
    )
    .where(
      and(
        eq(contentUsages.targetKind, 'asset'),
        eq(contentUsages.rootId, rootId),
      ),
    );
  return rows.map((r) => r.assetId);
}

/**
 * A condition on `assetId` (a column of the outer query): the asset has a
 * usage matching `filter` (assets of `filter.assetIds` are ignored here).
 */
export function assetHasUsage(
  assetId: AnyColumn,
  filter: Omit<UsageFilter, 'assetIds' | 'kind'>,
): SQL {
  return sql`EXISTS (
    SELECT 1 FROM ${contentUsages}
    JOIN ${roots} ON ${roots.id} = ${contentUsages.rootId}
    WHERE ${contentUsages.targetKey} = ${assetId}
      AND ${usageWhere(filter)}
  )`;
}
