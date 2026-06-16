import { APIError } from 'better-call';
import { sql } from 'drizzle-orm';

import type { ResolvedScope } from '../../core/types/definitions';
import type { DrizzleInstance } from '../../core/types/drizzle';

import { requireRootInScope } from '../../core/blocks/guards';
import { CMSError } from '../../core/errors';
import { coreReferenceResolver } from '../../core/references';
import { crossScopeColumns } from '../../core/scope';
import { collectCoRenderRoots, collectEmbeddedRoots } from './co-render';
import { $ERROR_CODES } from './errors';

/** Root ids (of the given candidates) that currently have a running A/B test. */
async function runningTestRoots(
  db: DrizzleInstance,
  rootIds: string[],
): Promise<Set<string>> {
  if (rootIds.length === 0) return new Set();
  const rows = (await db.execute(sql`
    SELECT DISTINCT root_id FROM cms.ab_tests
    WHERE status = 'running'
      AND root_id IN (${sql.join(
        rootIds.map((r) => sql`${r}`),
        sql`, `,
      )})
  `)) as { rows: Array<{ root_id: string }> };
  return new Set(rows.rows.map((r) => r.root_id));
}

/**
 * publishBranch TOCTOU backstop for the A/B XOR rule (AB_FANOUT_DESIGN §2.2).
 * The start-time guard keeps any co-render closure at <=1 running test AT START,
 * but a later publish can introduce an embed that makes two already-running
 * tests co-render — which the start-time guard never saw.
 *
 * On publish of `rootId`, reject if publishing would create a render where >=2
 * roots VARY. Precisely, a 2-axis render arises through `rootId` iff either:
 *   (1) rootId's OWN render subtree (its group + transitive embeds) contains >=2
 *       running tests; or
 *   (2) a host that transcludes rootId varies AND rootId's subtree also varies
 *       (the host's render then shows two varying axes through rootId).
 * Two INDEPENDENT hosts of an untested shared block both running is NOT a
 * conflict (they never co-render with each other) — so a flat closure count is
 * wrong; we separate the subtree (down) from the hosts (up).
 *
 * Runs as an (unscoped) before-hook, so it verifies ownership FIRST via the same
 * predicate the core handler trusts — never reading another tenant's/language's
 * content; an out-of-scope root no-ops out (the core handler then rejects).
 */
export async function assertNoCoRenderConflictOnPublish(opts: {
  db: DrizzleInstance;
  collectionName: string;
  rootId: string;
  scope?: ResolvedScope;
}): Promise<void> {
  const { db, collectionName, rootId, scope } = opts;
  // Cross-scope columns (the plugin's cross-scope columns — e.g. language —
  // removed): the co-render walk must span them (a host in any sibling scope
  // co-renders), so they must not filter the walk's queries.
  const scopeColumns = crossScopeColumns(scope?.roots);
  const resolver = scope?.referenceResolver ?? coreReferenceResolver;

  try {
    await requireRootInScope(db, rootId, collectionName, scope?.roots);
  } catch (err) {
    if (err instanceof CMSError) return; // out of scope → core rejects
    throw err;
  }

  const ownGroup = await resolver.expandGroup(db, scopeColumns, [rootId]);
  const subtree = await collectEmbeddedRoots(
    db,
    rootId,
    resolver,
    scopeColumns,
  ); // down only
  const full = await collectCoRenderRoots(db, rootId, resolver, scopeColumns); // up + down

  // up = full \ down (the hosts above rootId).
  const up = new Set<string>();
  for (const r of full) if (!subtree.has(r)) up.add(r);

  const running = await runningTestRoots(db, [...ownGroup, ...full]);

  // rootId's own render subtree (group + transitive embeds).
  let subtreeRunning = 0;
  for (const r of ownGroup) if (running.has(r)) subtreeRunning++;
  for (const r of subtree) if (running.has(r)) subtreeRunning++;

  let upRunning = 0;
  for (const r of up) if (running.has(r)) upRunning++;

  // (1) the published tree itself varies on >=2 axes, OR (2) a host above varies
  // AND something in the published tree varies (they co-render through rootId).
  if (subtreeRunning >= 2 || (subtreeRunning >= 1 && upRunning >= 1)) {
    throw new APIError($ERROR_CODES.AB_TEST_CROSS_EMBED_CONFLICT.status, {
      message: $ERROR_CODES.AB_TEST_CROSS_EMBED_CONFLICT.message,
      code: 'AB_TEST_CROSS_EMBED_CONFLICT',
    });
  }
}
