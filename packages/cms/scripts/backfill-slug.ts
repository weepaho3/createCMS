/**
 * cms-05 backfill — seed the VERSIONED draft slug for existing content.
 *
 * Under cms-05 a root's slug is versioned: the draft slug rides the root block
 * version's reserved `__slug` property and is materialized into `roots.slug` only
 * on publish (see `core/blocks/reconstruct-snapshot.ts` and
 * `core/routes/publications.ts`). Content created BEFORE cms-05 has a populated
 * `roots.slug` but no `__slug` on its head root version, so the editor (which now
 * reads the draft slug from `getBlockTree`'s root node) would show an empty slug.
 *
 * This one-time backfill copies each root's current `roots.slug` into its DEFAULT
 * branch's head root-version `__slug`, so existing content has a draft slug that
 * matches what is already live. It is IDEMPOTENT (rows that already carry the same
 * `__slug` are skipped) and safe to re-run.
 *
 * The `__slug` metadata is written in place on the head root version's JSONB
 * `properties`. Because that key is namespaced and stripped from every public
 * render path, adding it to older commits that share the same block-version row is
 * harmless — it never reaches rendered output, search, variables, or links.
 *
 * Usage (programmatic — pass your own Drizzle instance):
 *
 *   import { backfillDraftSlugs } from '@createcms/cms/scripts/backfill-slug';
 *   const { updated } = await backfillDraftSlugs(db);
 *   console.log(`Seeded __slug on ${updated} root(s)`);
 *
 * Dev/examples that re-seed their content on every boot don't need this — a fresh
 * `createRoot` already seeds `__slug`.
 */
import { sql } from 'drizzle-orm';

import type { DrizzleInstance } from '../src/core/types/drizzle';

import { ROOT_SLUG_PROP } from '../src/core/blocks/reconstruct-snapshot';
import { DEFAULT_BRANCH_NAME } from '../src/core/branch-policy';

export type BackfillOptions = {
  /**
   * The identity/default branch whose head root version receives the seeded
   * `__slug`. Defaults to the core default (`main`); pass your configured
   * `branchPolicy.defaultBranchName` if you changed it.
   */
  defaultBranchName?: string;
};

/**
 * Copies `roots.slug` → the default branch's head root-version `__slug` for every
 * root whose slug is non-null and whose head root version does not already carry
 * the same `__slug`. Returns the number of root versions updated.
 */
export async function backfillDraftSlugs(
  db: DrizzleInstance,
  options: BackfillOptions = {},
): Promise<{ updated: number }> {
  const defaultBranchName = options.defaultBranchName ?? DEFAULT_BRANCH_NAME;

  const result = await db.execute(sql`
    UPDATE cms.block_versions bv
    SET properties = jsonb_set(
      COALESCE(bv.properties, '{}'::jsonb),
      ${sql.raw(`'{${ROOT_SLUG_PROP}}'`)},
      to_jsonb(r.slug::text),
      true
    )
    FROM cms.roots r
    JOIN cms.branches b
      ON b.root_id = r.id
     AND b.name = ${defaultBranchName}
    JOIN cms.commit_snapshots cs
      ON cs.commit_id = b.head_commit_id
     AND cs.block_id = r.id
    WHERE bv.id = cs.block_version_id
      AND r.slug IS NOT NULL
      AND (bv.properties->>${ROOT_SLUG_PROP}) IS DISTINCT FROM r.slug
    RETURNING bv.id
  `);

  return { updated: result.rows.length };
}
