import { sql } from 'drizzle-orm';

import type { DrizzleInstance } from '../types/drizzle';

/**
 * Fills `path` and `depth` of every folder whose values are missing or
 * stale, from the `parent_id` chain. A no-op once all folders carry them.
 */
export async function backfillFolderPaths(
  db: DrizzleInstance,
): Promise<number> {
  const result = await db.execute(sql`
    WITH RECURSIVE tree AS (
      SELECT id, '/' || id || '/' AS path, 0 AS depth
        FROM cms.asset_folders WHERE parent_id IS NULL
      UNION ALL
      SELECT f.id, t.path || f.id || '/', t.depth + 1
        FROM cms.asset_folders f JOIN tree t ON f.parent_id = t.id
    )
    UPDATE cms.asset_folders af
       SET path = tree.path, depth = tree.depth
      FROM tree
     WHERE af.id = tree.id
       AND (af.path IS DISTINCT FROM tree.path
            OR af.depth IS DISTINCT FROM tree.depth)
  `);
  return (result as { affectedRows?: number }).affectedRows ?? 0;
}
