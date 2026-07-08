import { inArray, sql } from 'drizzle-orm';

import type { ResolvedSlugConfig } from '../types/definitions';
import type { DrizzleInstance } from '../types/drizzle';

import { DEFAULT_BRANCH_NAME } from '../branch-policy';
import {
  blockVersions,
  branches,
  commitSnapshots,
  mergeRequests,
  publications,
  roots,
} from '../db/schema.generated';
import { buildFullPath } from '../slug';

export type RootEnrichment = {
  rootId: string;
  slug: string | null;
  parentRootId: string | null;
  sortOrder: number;
  properties: Record<string, unknown>;
  hasPublications: boolean;
};

/**
 * Batch-fetches root data (slug, properties, publication status) for a set of
 * root IDs. Uses the same JOIN chain as `listRoots`:
 *   roots -> branches (main) -> commit_snapshots -> block_versions
 *
 * Returns a Map keyed by rootId for O(1) lookup when enriching result sets.
 * Any endpoint can use this to add root context to its response.
 */
export async function batchFetchRoots(
  db: DrizzleInstance,
  rootIds: string[],
  defaultBranchName: string = DEFAULT_BRANCH_NAME,
): Promise<Map<string, RootEnrichment>> {
  if (rootIds.length === 0) return new Map();

  const result = await db.execute(sql`
    SELECT
      ${roots.id} AS root_id,
      ${roots.slug} AS slug,
      ${roots.parentRootId} AS parent_root_id,
      ${roots.sortOrder} AS sort_order,
      ${blockVersions.properties} AS properties,
      COUNT(${publications.rootId})::int AS publication_count
    FROM ${roots}
    JOIN ${branches}
      ON ${branches.rootId} = ${roots.id}
     AND ${branches.name} = ${defaultBranchName}
    JOIN ${commitSnapshots}
      ON ${commitSnapshots.commitId} = ${branches.headCommitId}
     AND ${commitSnapshots.blockId} = ${roots.id}
    JOIN ${blockVersions}
      ON ${blockVersions.id} = ${commitSnapshots.blockVersionId}
    LEFT JOIN ${publications}
      ON ${publications.rootId} = ${roots.id}
    WHERE ${inArray(roots.id, rootIds)}
    GROUP BY ${roots.id}, ${roots.slug}, ${roots.parentRootId},
             ${roots.sortOrder}, ${blockVersions.properties}
  `);

  const map = new Map<string, RootEnrichment>();
  for (const row of result.rows as Array<Record<string, unknown>>) {
    map.set(row.root_id as string, {
      rootId: row.root_id as string,
      slug: (row.slug as string) ?? null,
      parentRootId: (row.parent_root_id as string) ?? null,
      sortOrder: row.sort_order as number,
      properties: (row.properties ?? {}) as Record<string, unknown>,
      hasPublications: parseInt(String(row.publication_count), 10) > 0,
    });
  }

  return map;
}

/** The full `listRoots` row shape (untyped `properties`), returned by
 *  `batchFetchRootListItems`. The route casts `properties` to the collection's
 *  inferred `RootListItem<TRootProps>`. */
export type RootListItemRow = {
  rootId: string;
  createdAt: Date;
  createdBy?: string;
  parentRootId?: string;
  slug?: string;
  path?: string;
  sortOrder: number;
  properties: Record<string, unknown>;
  hasPublications: boolean;
  publicationCount: number;
  branchCount: number;
  openMergeRequestCount: number;
};

/**
 * Batch-fetches the FULL `RootListItem` shape (counts, timestamps, and the
 * ancestor-resolved path) for a set of root ids. Unlike `batchFetchRoots` (the
 * lean `RootSummary` used only for `withRoot` list enrichment), this is what
 * `getRoot`/`getRootBySlug` return, so a single lookup carries exactly the
 * fields a `listRoots` row does. Uses the same JOIN + count subqueries + path
 * CTE as `listRoots`.
 */
export async function batchFetchRootListItems(
  db: DrizzleInstance,
  rootIds: string[],
  opts: {
    collectionName: string;
    defaultBranchName?: string;
    slugConfig?: ResolvedSlugConfig;
  },
): Promise<Map<string, RootListItemRow>> {
  if (rootIds.length === 0) return new Map();
  const defaultBranchName = opts.defaultBranchName ?? DEFAULT_BRANCH_NAME;

  const result = await db.execute(sql`
    SELECT
      ${roots.id} AS root_id,
      ${roots.createdAt} AS created_at,
      ${roots.createdBy} AS created_by,
      ${roots.parentRootId} AS parent_root_id,
      ${roots.slug} AS slug,
      ${roots.sortOrder} AS sort_order,
      ${blockVersions.properties} AS properties,
      COUNT(${publications.rootId})::int AS publication_count,
      (SELECT COUNT(*)::int FROM ${branches} AS b WHERE b.root_id = ${roots.id}) AS branch_count,
      (SELECT COUNT(*)::int FROM ${mergeRequests} AS mr WHERE mr.root_id = ${roots.id} AND mr.status = 'open') AS open_mr_count
    FROM ${roots}
    JOIN ${branches}
      ON ${branches.rootId} = ${roots.id}
     AND ${branches.name} = ${defaultBranchName}
    JOIN ${commitSnapshots}
      ON ${commitSnapshots.commitId} = ${branches.headCommitId}
     AND ${commitSnapshots.blockId} = ${roots.id}
    JOIN ${blockVersions}
      ON ${blockVersions.id} = ${commitSnapshots.blockVersionId}
    LEFT JOIN ${publications}
      ON ${publications.rootId} = ${roots.id}
    WHERE ${inArray(roots.id, rootIds)}
    GROUP BY ${roots.id}, ${roots.createdAt}, ${roots.createdBy},
             ${roots.parentRootId}, ${roots.slug}, ${roots.sortOrder},
             ${blockVersions.properties}
  `);

  const map = new Map<string, RootListItemRow>();
  for (const row of result.rows as Array<Record<string, unknown>>) {
    map.set(row.root_id as string, {
      rootId: row.root_id as string,
      createdAt: new Date(row.created_at as string),
      createdBy: (row.created_by as string | null) ?? undefined,
      parentRootId: (row.parent_root_id as string | null) ?? undefined,
      slug: (row.slug as string | null) ?? undefined,
      sortOrder: row.sort_order as number,
      properties: (row.properties ?? {}) as Record<string, unknown>,
      hasPublications: parseInt(String(row.publication_count), 10) > 0,
      publicationCount: parseInt(String(row.publication_count), 10),
      branchCount: parseInt(String(row.branch_count), 10),
      openMergeRequestCount: parseInt(String(row.open_mr_count), 10),
    });
  }

  // Full URL path per root: same anchored recursive CTE as `listRoots`.
  const slugCfg = opts.slugConfig;
  if (slugCfg?.enabled && map.size > 0) {
    const ids = [...map.keys()];
    const pathRes = await db.execute(sql`
      WITH RECURSIVE ancestry AS (
        SELECT ${roots.id} AS leaf_id, ${roots.id} AS id,
               ${roots.parentRootId} AS parent_root_id,
               ${roots.slug} AS slug, 0 AS depth
        FROM ${roots}
        WHERE ${inArray(roots.id, ids)}
        UNION ALL
        SELECT a.leaf_id, r.id, r.parent_root_id, r.slug, a.depth + 1
        FROM ${roots} r
        JOIN ancestry a ON r.id = a.parent_root_id
        WHERE r.collection = ${opts.collectionName}
      )
      SELECT leaf_id, array_agg(slug ORDER BY depth DESC) AS segs
      FROM ancestry
      GROUP BY leaf_id
    `);
    for (const row of pathRes.rows as Array<{
      leaf_id: string;
      segs: (string | null)[];
    }>) {
      const segs = (row.segs ?? []).filter((s): s is string => Boolean(s));
      const item = map.get(row.leaf_id);
      if (item) item.path = buildFullPath(slugCfg, segs);
    }
    for (const item of map.values()) {
      if (item.path === undefined) item.path = '/';
    }
  }

  return map;
}
