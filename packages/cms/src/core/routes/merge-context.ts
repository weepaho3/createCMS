import { and, eq, sql, type SQL } from 'drizzle-orm';

import type { DrizzleInstance } from '../types/drizzle';

import {
  loadBlocksAtCommit,
  type ReconstructionResult,
} from '../blocks/reconstruct-snapshot';
import { branches, mergeRequests, roots } from '../db/schema.generated';
import { CMSError } from '../errors';

/**
 * Shared loaders for the repeated "merge preamble" that several merge handlers
 * ran verbatim (resolve branches / merge request, find the common ancestor,
 * load the three-way snapshots).
 *
 * Every loader takes the active executor (`db` OR a transaction `tx`) so it
 * joins the caller's transaction — it must never capture an outer `db`, or
 * transactional reads would lose their row locks / snapshot isolation.
 *
 * Returns concrete Drizzle `$inferSelect` types (never `any`/`unknown`) so
 * autocomplete on `.headCommitId` / `.rootId` / `.createdBy` / `.name` is
 * preserved at every call site.
 */

type AncestorRow = { id: string; depth: number };

/**
 * Walks both commit chains (following parent and merge-source edges) and
 * returns the nearest common ancestor with how far each side is ahead, or
 * `null` when the histories never meet.
 */
export async function findCommonAncestor(
  db: DrizzleInstance,
  sourceHeadCommitId: string,
  targetHeadCommitId: string,
): Promise<{
  commonAncestorCommitId: string;
  sourceAhead: number;
  targetAhead: number;
} | null> {
  if (sourceHeadCommitId === targetHeadCommitId) {
    return {
      commonAncestorCommitId: sourceHeadCommitId,
      sourceAhead: 0,
      targetAhead: 0,
    };
  }

  const chainFor = (id: string) =>
    db.execute(sql`
      WITH RECURSIVE chain AS (
        SELECT id, parent_commit_id, merge_source_commit_id, 0 AS depth
        FROM cms.commits WHERE id = ${id}
        UNION ALL
        SELECT c.id, c.parent_commit_id, c.merge_source_commit_id, chain.depth + 1
        FROM cms.commits c JOIN chain ON c.id = chain.parent_commit_id
           OR c.id = chain.merge_source_commit_id
        WHERE chain.depth < 10000
      )
      SELECT DISTINCT id, MIN(depth) AS depth FROM chain GROUP BY id ORDER BY depth
    `);

  const [sourceResult, targetResult] = await Promise.all([
    chainFor(sourceHeadCommitId),
    chainFor(targetHeadCommitId),
  ]);
  const sourceChain = sourceResult.rows as AncestorRow[];
  const targetChain = targetResult.rows as AncestorRow[];

  const targetSet = new Map<string, number>();
  for (const row of targetChain) {
    targetSet.set(row.id, row.depth);
  }

  for (const row of sourceChain) {
    if (targetSet.has(row.id)) {
      return {
        commonAncestorCommitId: row.id,
        sourceAhead: row.depth,
        targetAhead: targetSet.get(row.id)!,
      };
    }
  }

  return null;
}

/**
 * Resolve a source/target branch pair scoped to the collection (and plugin
 * scope), returning full branch rows. Throws `BRANCH_NOT_FOUND` (source checked
 * first) and `BRANCHES_NOT_SAME_ROOT`.
 *
 * Used by the branch-pair handlers (getDiff, checkConflicts, createMergeRequest)
 * that resolve branches by id. The scope guard is applied here on purpose — it
 * is the IDOR boundary for those endpoints. executeMerge / createMergeBlockVersion
 * deliberately load branches WITHOUT this guard (they trust the already
 * scope-checked merge request) and must NOT route through this helper.
 */
export async function loadBranchPair(
  exec: DrizzleInstance,
  opts: {
    sourceBranchId: string;
    targetBranchId: string;
    collectionName: string;
    scopeWhere: SQL | undefined;
  },
): Promise<{
  sourceBranch: typeof branches.$inferSelect;
  targetBranch: typeof branches.$inferSelect;
}> {
  const selectBranch = (branchId: string) =>
    exec
      .select()
      .from(branches)
      .innerJoin(roots, eq(roots.id, branches.rootId))
      .where(
        and(
          eq(branches.id, branchId),
          eq(roots.collection, opts.collectionName),
          opts.scopeWhere,
        ),
      )
      .then((rows) => rows.map((r) => r.branches));

  const [[sourceBranch], [targetBranch]] = await Promise.all([
    selectBranch(opts.sourceBranchId),
    selectBranch(opts.targetBranchId),
  ]);

  if (!sourceBranch) throw new CMSError('BRANCH_NOT_FOUND');
  if (!targetBranch) throw new CMSError('BRANCH_NOT_FOUND');
  if (sourceBranch.rootId !== targetBranch.rootId) {
    throw new CMSError('BRANCHES_NOT_SAME_ROOT');
  }

  return { sourceBranch, targetBranch };
}

/**
 * Find the common ancestor of a resolved branch pair and load the three-way
 * snapshots (base = ancestor, plus each side's head). Throws
 * `NO_COMMON_ANCESTOR`.
 *
 * The heads are passed explicitly (not read off the branch rows) so callers can
 * supply a *live* head — e.g. executeMerge after locking the source branch.
 * Each snapshot is loaded under its own side's rootId, exactly as before.
 */
export async function loadMergeSnapshots(
  exec: DrizzleInstance,
  source: { rootId: string; headCommitId: string },
  target: { rootId: string; headCommitId: string },
): Promise<{
  ancestor: {
    commonAncestorCommitId: string;
    sourceAhead: number;
    targetAhead: number;
  };
  baseSnapshot: ReconstructionResult;
  sourceSnapshot: ReconstructionResult;
  targetSnapshot: ReconstructionResult;
}> {
  const ancestor = await findCommonAncestor(
    exec,
    source.headCommitId,
    target.headCommitId,
  );
  if (!ancestor) throw new CMSError('NO_COMMON_ANCESTOR');

  const [baseSnapshot, sourceSnapshot, targetSnapshot] = await Promise.all([
    loadBlocksAtCommit(exec, ancestor.commonAncestorCommitId, source.rootId),
    loadBlocksAtCommit(exec, source.headCommitId, source.rootId),
    loadBlocksAtCommit(exec, target.headCommitId, target.rootId),
  ]);

  return { ancestor, baseSnapshot, sourceSnapshot, targetSnapshot };
}

/**
 * Load a merge request by id, scoped to the collection (and plugin scope).
 * Throws `MERGE_REQUEST_NOT_FOUND`, and `MERGE_REQUEST_NOT_OPEN` unless
 * `requireOpen` is `false`. Returns the full merge-request row.
 */
export async function loadOpenMergeRequest(
  exec: DrizzleInstance,
  opts: {
    mergeRequestId: string;
    collectionName: string;
    scopeWhere: SQL | undefined;
    requireOpen?: boolean;
  },
): Promise<typeof mergeRequests.$inferSelect> {
  const [mr] = await exec
    .select({ mr: mergeRequests })
    .from(mergeRequests)
    .innerJoin(roots, eq(roots.id, mergeRequests.rootId))
    .where(
      and(
        eq(mergeRequests.id, opts.mergeRequestId),
        eq(roots.collection, opts.collectionName),
        opts.scopeWhere,
      ),
    )
    .then((rows) => rows.map((r) => r.mr));

  if (!mr) throw new CMSError('MERGE_REQUEST_NOT_FOUND');
  if (opts.requireOpen !== false && mr.status !== 'open') {
    throw new CMSError('MERGE_REQUEST_NOT_OPEN');
  }

  return mr;
}
