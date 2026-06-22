import { inArray, sql } from 'drizzle-orm';

import type { DrizzleInstance } from '../types/drizzle';

import { DEFAULT_BRANCH_NAME } from '../branch-policy';
import {
  blockVersions,
  branches,
  commitSnapshots,
  publications,
  roots,
} from '../db/schema.generated';

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
