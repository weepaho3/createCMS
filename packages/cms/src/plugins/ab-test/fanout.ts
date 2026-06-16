import { sql } from 'drizzle-orm';

import type {
  AbTestResolver,
  RunningAbTest,
} from '../../core/types/definitions';
import type { DrizzleInstance } from '../../core/types/drizzle';

import { rootScopeConditions } from '../../core/scope';

/**
 * The ab-test plugin's implementation of the core {@link AbTestResolver} seam
 * (Seam F): given a set of already render-resolved root ids, report which have a
 * RUNNING test, with that test's variant branches. The read path uses this to
 * fan a varying block's published branches out to the client (AB_FANOUT F2).
 *
 * Stateless — one instance is registered once via a scope factory in the
 * plugin's `init`. Raw SQL (like {@link assertNoCoRenderConflictOnPublish}'s
 * helper) because `cms.ab_tests` is plugin-owned and not in core's Drizzle
 * schema. The `AB_TEST_DUPLICATE_RUNNING` guard ensures at most one running test
 * per root, so grouping by root id is unambiguous.
 */
export function buildAbTestResolver(): AbTestResolver {
  return {
    async runningTests(db: DrizzleInstance, scopeColumns, rootIds) {
      const out = new Map<string, RunningAbTest>();
      if (rootIds.length === 0) return out;

      // Scope the lookup to the active tenant (same predicate every other read
      // applies): JOIN roots so rootScopeConditions can filter by the scope
      // columns. The passed rootIds are already render-resolved, so this is
      // defense-in-depth — it must never report a test on an out-of-scope root.
      const scopeConds = rootScopeConditions(scopeColumns);
      const result = (await db.execute(sql`
        SELECT t.id AS test_id, t.root_id, t.traffic_percentage,
               v.branch_id, v.is_control
        FROM cms.ab_tests t
        JOIN cms.roots ON cms.roots.id = t.root_id
        JOIN cms.ab_test_variants v ON v.test_id = t.id
        WHERE t.status = 'running'
          AND t.root_id IN (${sql.join(
            rootIds.map((r) => sql`${r}`),
            sql`, `,
          )})
          ${
            scopeConds.length
              ? sql`AND ${sql.join(scopeConds, sql` AND `)}`
              : sql``
          }
      `)) as {
        rows: Array<{
          test_id: string;
          root_id: string;
          traffic_percentage: number;
          branch_id: string;
          is_control: boolean;
        }>;
      };

      for (const row of result.rows) {
        let test = out.get(row.root_id);
        if (!test) {
          test = {
            testId: row.test_id,
            trafficPercentage: row.traffic_percentage,
            variants: [],
          };
          out.set(row.root_id, test);
        }
        // Defensive: a root has at most one running test (guarded), so ignore
        // rows from any other test id rather than mixing variants.
        if (test.testId !== row.test_id) continue;
        test.variants.push({
          branchId: row.branch_id,
          isControl: row.is_control,
        });
      }

      return out;
    },
  };
}
