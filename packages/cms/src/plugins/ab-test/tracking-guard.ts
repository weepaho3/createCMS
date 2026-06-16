import { APIError } from 'better-call';
import { sql } from 'drizzle-orm';

import type {
  CollectionWithName,
  ResolvedScope,
} from '../../core/types/definitions';
import type { DrizzleInstance } from '../../core/types/drizzle';

import { requireRootInScope } from '../../core/blocks/guards';
import { CMSError } from '../../core/errors';
import { $ERROR_CODES } from './errors';

type TrackingErrorCode =
  | 'AB_TEST_TRACKING_ID_MISSING'
  | 'AB_TEST_TRACKING_ID_DUPLICATE'
  | 'AB_TEST_TRACKING_ID_DRIFT';

function trackingError(code: TrackingErrorCode, message?: string): never {
  throw new APIError($ERROR_CODES[code].status, {
    message: message ?? $ERROR_CODES[code].message,
    code,
  });
}

type FunctionalInstance = {
  blockId: string;
  type: string;
  trackingId: string | null;
};

/**
 * Confirms the root is within the caller's scope BEFORE any block read, using
 * the SAME authoritative predicate the core publishBranch handler trusts
 * (`scope.roots.where` — tenant AND i18n language AND not-archived, via
 * {@link requireRootInScope}). Returns false when the root is out of scope — the
 * guard then no-ops and the core handler rejects with ROOT_NOT_FOUND. This keeps
 * the unscoped before-hook from reading another scope's (tenant OR language)
 * blocks. With no scope predicate (single-tenant, no i18n) every root is in
 * scope, so the existence check just confirms the root exists.
 */
async function rootIsInScope(
  db: DrizzleInstance,
  rootId: string,
  collectionName: string,
  scope: ResolvedScope | undefined,
): Promise<boolean> {
  try {
    await requireRootInScope(db, rootId, collectionName, scope?.roots);
    return true;
  } catch (err) {
    if (err instanceof CMSError) return false; // out of scope → guard no-ops
    throw err;
  }
}

/** Live (non-deleted) instances of the given block types at a branch's head. */
async function readFunctionalInstances(
  db: DrizzleInstance,
  rootId: string,
  branchId: string,
  functionalTypes: string[],
): Promise<FunctionalInstance[]> {
  if (functionalTypes.length === 0) return [];
  const result = (await db.execute(sql`
    SELECT bv.block_id AS block_id,
           bv.type AS type,
           bv.properties ->> 'trackingId' AS tracking_id
    FROM cms.branches b
    JOIN cms.commit_snapshots cs ON cs.commit_id = b.head_commit_id
    JOIN cms.block_versions bv ON bv.id = cs.block_version_id
    WHERE b.id = ${branchId}
      AND b.root_id = ${rootId}
      AND bv.deleted = false
      AND bv.type IN (${sql.join(
        functionalTypes.map((t) => sql`${t}`),
        sql`, `,
      )})
  `)) as {
    rows: Array<{ block_id: string; type: string; tracking_id: string | null }>;
  };
  return result.rows.map((r) => ({
    blockId: r.block_id,
    type: r.type,
    trackingId: r.tracking_id,
  }));
}

/**
 * Sibling variant branches that share a RUNNING test with `branchId` on this
 * root. Scoped to the SAME test(s) the branch participates in (not every test
 * on the root) and to `running` status only — so drift is enforced exactly
 * where it renders, and editing variant branches of draft/paused/completed
 * tests is never blocked.
 */
async function getRunningSiblingBranchIds(
  db: DrizzleInstance,
  rootId: string,
  branchId: string,
): Promise<string[]> {
  const result = (await db.execute(sql`
    SELECT DISTINCT v2.branch_id AS branch_id
    FROM cms.ab_test_variants v1
    JOIN cms.ab_test_variants v2 ON v2.test_id = v1.test_id
    JOIN cms.ab_tests t ON t.id = v1.test_id
    WHERE v1.branch_id = ${branchId}
      AND t.root_id = ${rootId}
      AND t.status = 'running'
      AND v2.branch_id <> ${branchId}
  `)) as { rows: Array<{ branch_id: string }> };
  return result.rows.map((r) => r.branch_id);
}

/**
 * Publish-time tracking-id guard for functional blocks. Runs as a `publishBranch`
 * before-hook (so it aborts before any write), after confirming tenant ownership:
 *  - MISSING:   every functional-block instance must have a non-empty trackingId.
 *  - DUPLICATE: trackingIds must be unique within the branch.
 *  - DRIFT:     when the branch shares a RUNNING test with sibling variant
 *               branches, the SET of functional trackingIds must equal each
 *               sibling's set — so a goal chosen in the UI exists in every arm
 *               (set-equality policy; positional matching intentionally not
 *               required).
 */
export async function assertTrackingIntegrity(opts: {
  db: DrizzleInstance;
  collections: Record<string, CollectionWithName>;
  collectionName: string;
  rootId: string;
  branchId: string;
  scope?: ResolvedScope;
}): Promise<void> {
  const { db, collections, collectionName, rootId, branchId, scope } = opts;

  const blocks = collections[collectionName]?.blocks;
  if (!blocks) return;

  const functionalTypes = Object.entries(blocks)
    .filter(([, def]) => def.events && Object.keys(def.events).length > 0)
    .map(([type]) => type);
  if (functionalTypes.length === 0) return;

  // Scope ownership FIRST — never read another scope's blocks (tenant OR i18n
  // language) from this unscoped before-hook.
  if (!(await rootIsInScope(db, rootId, collectionName, scope))) return;

  const instances = await readFunctionalInstances(
    db,
    rootId,
    branchId,
    functionalTypes,
  );

  // 1. missing
  for (const inst of instances) {
    if (!inst.trackingId || inst.trackingId.length === 0) {
      trackingError(
        'AB_TEST_TRACKING_ID_MISSING',
        `Functional block "${inst.blockId}" (${inst.type}) is missing its trackingId`,
      );
    }
  }

  // 2. duplicate within the branch
  const seen = new Map<string, string>();
  for (const inst of instances) {
    const tid = inst.trackingId as string;
    const prev = seen.get(tid);
    if (prev) {
      trackingError(
        'AB_TEST_TRACKING_ID_DUPLICATE',
        `trackingId "${tid}" is used by both "${prev}" and "${inst.blockId}"`,
      );
    }
    seen.set(tid, inst.blockId);
  }

  // 3. drift across the SAME running test's sibling variant branches.
  const siblingBranchIds = await getRunningSiblingBranchIds(
    db,
    rootId,
    branchId,
  );
  if (siblingBranchIds.length === 0) return;

  const thisSet = new Set(instances.map((i) => i.trackingId as string));
  for (const siblingId of siblingBranchIds) {
    const sibling = await readFunctionalInstances(
      db,
      rootId,
      siblingId,
      functionalTypes,
    );
    const siblingTracking = sibling.map((i) => i.trackingId);
    const siblingClean = siblingTracking.filter((t): t is string => !!t);
    const siblingSet = new Set(siblingClean);
    // A sibling arm must itself be cleanly anchored — no missing/empty and no
    // intra-arm duplicate trackingId — else the count won't match its clean
    // set. (A null/dup is only reachable from a sibling's live head ahead of its
    // publish snapshot; treating it as drift fails closed.)
    const siblingMisanchored =
      siblingClean.length !== siblingTracking.length ||
      siblingSet.size !== siblingClean.length;
    const sameSize = thisSet.size === siblingSet.size;
    const subset = [...thisSet].every((t) => siblingSet.has(t));
    if (siblingMisanchored || !sameSize || !subset) {
      trackingError(
        'AB_TEST_TRACKING_ID_DRIFT',
        `trackingId set differs across A/B variant arms of a running test (branch "${siblingId}")`,
      );
    }
  }
}
