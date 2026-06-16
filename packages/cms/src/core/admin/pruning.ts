import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  or,
  sql,
} from 'drizzle-orm';

import type { CMSProcedureCtx, MediaConfig } from '../types';
import type { DataRetentionConfig } from '../types/definitions';
import type { DrizzleInstance } from '../types/drizzle';
import type {
  CMSCoreRootPruningPlan,
  CMSPlugin,
  CMSPluginPruningMetrics,
  CMSPluginRootPruningPlan,
} from '../types/plugin';

import {
  approvals,
  assets,
  blockVersions,
  branches,
  commentMessages,
  commentThreads,
  commitSnapshots,
  commits,
  contentUsages,
  mergeConflicts,
  mergeRequests,
  publications,
  roots,
  searchIndex,
} from '../db/schema.generated';
import { createS3Client } from '../storage/s3/client';
import { deleteObject } from '../storage/s3/utils';

export type PruningResult = {
  deletedCommits: number;
  deletedBlockVersions: number;
  deletedSnapshots: number;
  deletedMergeRequests: number;
  deletedApprovals: number;
  prunedRoots: string[];
  plugins: Record<string, CMSPluginPruningMetrics>;
};

export type RootPruningPlan = CMSCoreRootPruningPlan;

type PluginPruningExecutionPlan = {
  pluginId: string;
  plugin: CMSPlugin;
  plan: CMSPluginRootPruningPlan;
};

export type RootPruningExecutionPlan = {
  core: RootPruningPlan;
  plugins: PluginPruningExecutionPlan[];
};

export function createEmptyPruningResult(): PruningResult {
  return {
    deletedCommits: 0,
    deletedBlockVersions: 0,
    deletedSnapshots: 0,
    deletedMergeRequests: 0,
    deletedApprovals: 0,
    prunedRoots: [],
    plugins: {},
  };
}

export function addPluginMetrics(
  result: PruningResult,
  pluginId: string,
  metrics?: CMSPluginPruningMetrics,
) {
  if (!metrics) return;

  const target = (result.plugins[pluginId] ??= {});
  for (const [key, value] of Object.entries(metrics)) {
    target[key] = (target[key] ?? 0) + value;
  }
}

export function addExecutionPlanTotals(
  result: PruningResult,
  executionPlan: RootPruningExecutionPlan,
) {
  addCorePlanTotals(result, executionPlan.core);

  for (const pluginPlan of executionPlan.plugins) {
    addPluginMetrics(result, pluginPlan.pluginId, pluginPlan.plan.metrics);
  }
}

export function addCorePlanTotals(
  result: PruningResult,
  corePlan: RootPruningPlan,
) {
  result.deletedCommits += corePlan.deletableCommitIds.length;
  result.deletedBlockVersions += corePlan.deletableBlockVersionIds.length;
  result.deletedSnapshots += corePlan.deletableSnapshotCount;
  result.deletedMergeRequests += corePlan.deletableMergeRequestIds.length;
  result.deletedApprovals += corePlan.deletableApprovalIds.length;
  result.prunedRoots.push(corePlan.rootId);
}

function normalizePluginPlan(
  pluginId: string,
  rootPlan: RootPruningPlan,
  pluginPlan: CMSPluginRootPruningPlan,
): CMSPluginRootPruningPlan {
  if (pluginPlan.rootId !== rootPlan.rootId) {
    throw new Error(
      `Plugin "${pluginId}" returned a pruning plan for root "${pluginPlan.rootId}", expected "${rootPlan.rootId}".`,
    );
  }

  return pluginPlan;
}

async function collectPluginPruningPlans(
  db: DrizzleInstance,
  cmsCtx: CMSProcedureCtx,
  dataRetention: DataRetentionConfig,
  plugins: CMSPlugin[],
  rootPlan: RootPruningPlan,
): Promise<PluginPruningExecutionPlan[]> {
  const planned: PluginPruningExecutionPlan[] = [];

  for (const plugin of plugins) {
    if (!plugin.pruning) continue;

    const pluginPlan = await plugin.pruning.plan({
      ...cmsCtx,
      db,
      dataRetention,
      rootPlan,
    });
    if (!pluginPlan) continue;

    planned.push({
      pluginId: plugin.id,
      plugin,
      plan: normalizePluginPlan(plugin.id, rootPlan, pluginPlan),
    });
  }

  return planned;
}

export async function collectRootExecutionPlans(
  db: DrizzleInstance,
  cmsCtx: CMSProcedureCtx,
  dataRetention: DataRetentionConfig,
  plugins: CMSPlugin[],
): Promise<Map<string, RootPruningExecutionPlan>> {
  const allRoots = await db.select({ id: roots.id }).from(roots);
  const plans = new Map<string, RootPruningExecutionPlan>();

  for (const root of allRoots) {
    const corePlan = await planRootPruning(db, root.id, dataRetention);
    if (!corePlan) continue;

    const pluginPlans = await collectPluginPruningPlans(
      db,
      cmsCtx,
      dataRetention,
      plugins,
      corePlan,
    );

    plans.set(root.id, {
      core: corePlan,
      plugins: pluginPlans,
    });
  }

  return plans;
}

async function planRootPruning(
  db: DrizzleInstance,
  rootId: string,
  config: DataRetentionConfig,
): Promise<RootPruningPlan | null> {
  const cutoff = new Date(Date.now() - config.keepDays * 24 * 60 * 60 * 1000);

  const branchRows = await db
    .select({ id: branches.id, commitId: branches.headCommitId })
    .from(branches)
    .where(eq(branches.rootId, rootId));

  const branchHeadIds = new Set(branchRows.map((branch) => branch.commitId));
  const branchHeadMap = new Map(
    branchRows.map((branch) => [branch.id, branch.commitId]),
  );

  const publishedIds = new Set(
    (
      await db
        .select({ headCommitId: branches.headCommitId })
        .from(publications)
        .innerJoin(branches, eq(branches.id, publications.branchId))
        .where(eq(publications.rootId, rootId))
    ).map((publication) => publication.headCommitId),
  );

  const openMRs = await db
    .select({
      sourceCommitId: mergeRequests.sourceCommitId,
      baseCommitId: mergeRequests.baseCommitId,
      mergeCommitId: mergeRequests.mergeCommitId,
    })
    .from(mergeRequests)
    .where(
      and(eq(mergeRequests.rootId, rootId), eq(mergeRequests.status, 'open')),
    );

  const mrCommitIds = new Set<string>();
  for (const mergeRequest of openMRs) {
    mrCommitIds.add(mergeRequest.sourceCommitId);
    if (mergeRequest.baseCommitId) mrCommitIds.add(mergeRequest.baseCommitId);
    if (mergeRequest.mergeCommitId) mrCommitIds.add(mergeRequest.mergeCommitId);
  }

  const allApprovalsForRoot = await db
    .select({
      id: approvals.id,
      commitId: approvals.commitId,
      branchId: approvals.branchId,
      status: approvals.status,
      mergeRequestId: approvals.mergeRequestId,
    })
    .from(approvals)
    .innerJoin(branches, eq(branches.id, approvals.branchId))
    .where(eq(branches.rootId, rootId));

  const deletableApprovalIds: string[] = [];
  const approvalCommitIds = new Set<string>();

  for (const approval of allApprovalsForRoot) {
    if (approval.mergeRequestId === null) {
      const isResolved = approval.status !== 'pending';
      const ownBranchHead = branchHeadMap.get(approval.branchId);
      const isStale = ownBranchHead !== approval.commitId;

      if (isResolved || isStale) {
        deletableApprovalIds.push(approval.id);
      } else {
        approvalCommitIds.add(approval.commitId);
      }
    } else {
      approvalCommitIds.add(approval.commitId);
    }
  }

  const closedMRs = await db
    .select({
      id: mergeRequests.id,
      updatedAt: mergeRequests.updatedAt,
    })
    .from(mergeRequests)
    .where(
      and(
        eq(mergeRequests.rootId, rootId),
        ne(mergeRequests.status, 'open'),
        lt(mergeRequests.updatedAt, cutoff),
      ),
    );

  const [initialCommit] = await db
    .select({ id: commits.id })
    .from(commits)
    .where(and(eq(commits.rootId, rootId), isNull(commits.parentCommitId)));
  if (!initialCommit) return null;

  const initialCommitId = initialCommit.id;

  const recentIds = new Set(
    (
      await db
        .select({ id: commits.id })
        .from(commits)
        .where(eq(commits.rootId, rootId))
        .orderBy(sql`${commits.createdAt} DESC`)
        .limit(config.keepMinCommits)
    ).map((commit) => commit.id),
  );

  const protectedIds = new Set([
    initialCommitId,
    ...branchHeadIds,
    ...publishedIds,
    ...mrCommitIds,
    ...approvalCommitIds,
    ...recentIds,
  ]);

  const allOldCommits = await db
    .select({ id: commits.id })
    .from(commits)
    .where(and(eq(commits.rootId, rootId), lt(commits.createdAt, cutoff)));

  const deletableCommitIds = allOldCommits
    .filter((commit) => !protectedIds.has(commit.id))
    .map((commit) => commit.id);

  const hasWork =
    deletableCommitIds.length > 0 ||
    closedMRs.length > 0 ||
    deletableApprovalIds.length > 0;
  if (!hasWork) return null;

  const bvCandidates =
    deletableCommitIds.length > 0
      ? (
          await db
            .select({ id: blockVersions.id })
            .from(blockVersions)
            .where(inArray(blockVersions.commitId, deletableCommitIds))
        ).map((blockVersion) => blockVersion.id)
      : [];

  const referencedBvIds = new Set(
    bvCandidates.length > 0
      ? (
          await db
            .select({ blockVersionId: commitSnapshots.blockVersionId })
            .from(commitSnapshots)
            .where(
              and(
                inArray(commitSnapshots.blockVersionId, bvCandidates),
                sql`${commitSnapshots.commitId} NOT IN (${sql.join(
                  deletableCommitIds.map((id) => sql`${id}`),
                  sql`, `,
                )})`,
              ),
            )
        ).map((row) => row.blockVersionId)
      : [],
  );

  const deletableBlockVersionIds = bvCandidates.filter(
    (id) => !referencedBvIds.has(id),
  );

  const deletableSnapshotCount =
    deletableCommitIds.length > 0
      ? (
          await db
            .select({ commitId: commitSnapshots.commitId })
            .from(commitSnapshots)
            .where(inArray(commitSnapshots.commitId, deletableCommitIds))
        ).length
      : 0;

  return {
    rootId,
    deletableCommitIds,
    deletableBlockVersionIds,
    deletableSnapshotCount,
    deletableMergeRequestIds: closedMRs.map((mergeRequest) => mergeRequest.id),
    deletableApprovalIds,
    initialCommitId,
  };
}

export async function executeRootPruning(
  tx: DrizzleInstance,
  plan: RootPruningPlan,
): Promise<void> {
  const {
    rootId,
    deletableCommitIds,
    deletableBlockVersionIds,
    initialCommitId,
  } = plan;

  const deletableSet = new Set(deletableCommitIds);

  const allCommitsForRoot = await tx
    .select({
      id: commits.id,
      parentCommitId: commits.parentCommitId,
      mergeSourceCommitId: commits.mergeSourceCommitId,
    })
    .from(commits)
    .where(eq(commits.rootId, rootId));

  for (const commit of allCommitsForRoot) {
    if (deletableSet.has(commit.id) || commit.id === initialCommitId) continue;
    if (commit.parentCommitId && deletableSet.has(commit.parentCommitId)) {
      await tx
        .update(commits)
        .set({ parentCommitId: initialCommitId })
        .where(eq(commits.id, commit.id));
    }
  }

  for (const commit of allCommitsForRoot) {
    if (
      commit.mergeSourceCommitId &&
      deletableSet.has(commit.mergeSourceCommitId)
    ) {
      await tx
        .update(commits)
        .set({ mergeSourceCommitId: null })
        .where(eq(commits.id, commit.id));
    }
  }

  if (deletableBlockVersionIds.length > 0) {
    // content_usages is keyed by blockVersionId with an ON DELETE CASCADE, so
    // deleting these old block versions below auto-removes their index rows — no
    // explicit cleanup needed here.
    await tx
      .delete(mergeConflicts)
      .where(inArray(mergeConflicts.sourceVersionId, deletableBlockVersionIds));
    await tx
      .delete(mergeConflicts)
      .where(inArray(mergeConflicts.targetVersionId, deletableBlockVersionIds));
    await tx
      .delete(mergeConflicts)
      .where(inArray(mergeConflicts.baseVersionId, deletableBlockVersionIds));
    await tx
      .delete(mergeConflicts)
      .where(
        inArray(mergeConflicts.resolvedVersionId, deletableBlockVersionIds),
      );
  }

  if (deletableCommitIds.length > 0) {
    await tx
      .delete(commitSnapshots)
      .where(inArray(commitSnapshots.commitId, deletableCommitIds));

    const allBvsInDeletableCommits = (
      await tx
        .select({ id: blockVersions.id })
        .from(blockVersions)
        .where(inArray(blockVersions.commitId, deletableCommitIds))
    ).map((blockVersion) => blockVersion.id);

    const survivingBvIds = allBvsInDeletableCommits.filter(
      (id) => !new Set(deletableBlockVersionIds).has(id),
    );
    if (survivingBvIds.length > 0) {
      await tx
        .update(blockVersions)
        .set({ commitId: initialCommitId })
        .where(inArray(blockVersions.id, survivingBvIds));
    }

    if (deletableBlockVersionIds.length > 0) {
      await tx
        .delete(blockVersions)
        .where(inArray(blockVersions.id, deletableBlockVersionIds));
    }
  }

  if (plan.deletableApprovalIds.length > 0) {
    await tx
      .delete(approvals)
      .where(inArray(approvals.id, plan.deletableApprovalIds));
  }

  if (plan.deletableMergeRequestIds.length > 0) {
    // Collect comment message IDs that will be cascade-deleted with the MRs
    const affectedThreads = await tx
      .select({ id: commentThreads.id })
      .from(commentThreads)
      .where(
        inArray(commentThreads.mergeRequestId, plan.deletableMergeRequestIds),
      );

    if (affectedThreads.length > 0) {
      const threadIds = affectedThreads.map((t) => t.id);
      const affectedMessages = await tx
        .select({ id: commentMessages.id })
        .from(commentMessages)
        .where(inArray(commentMessages.threadId, threadIds));

      if (affectedMessages.length > 0) {
        await tx.delete(searchIndex).where(
          and(
            eq(searchIndex.entityType, 'comment'),
            inArray(
              searchIndex.entityId,
              affectedMessages.map((m) => m.id),
            ),
          ),
        );
      }
    }

    // Clean up search index entries for the merge requests themselves
    await tx
      .delete(searchIndex)
      .where(
        and(
          eq(searchIndex.entityType, 'mergeRequest'),
          inArray(searchIndex.entityId, plan.deletableMergeRequestIds),
        ),
      );

    await tx
      .delete(mergeRequests)
      .where(inArray(mergeRequests.id, plan.deletableMergeRequestIds));
  }

  if (deletableCommitIds.length > 0) {
    await tx
      .update(publications)
      .set({ commitId: initialCommitId })
      .where(
        and(
          eq(publications.rootId, rootId),
          inArray(publications.commitId, deletableCommitIds),
        ),
      );
  }

  if (deletableCommitIds.length > 0) {
    const deletableCommits = allCommitsForRoot.filter((commit) =>
      deletableSet.has(commit.id),
    );

    const childCount = new Map<string, number>();
    for (const id of deletableCommitIds) {
      childCount.set(id, 0);
    }

    for (const commit of deletableCommits) {
      if (commit.parentCommitId && deletableSet.has(commit.parentCommitId)) {
        childCount.set(
          commit.parentCommitId,
          (childCount.get(commit.parentCommitId) ?? 0) + 1,
        );
      }
    }

    const queue: string[] = [];
    for (const [id, count] of childCount) {
      if (count === 0) queue.push(id);
    }

    while (queue.length > 0) {
      const id = queue.shift()!;
      await tx.delete(commits).where(eq(commits.id, id));

      const commit = deletableCommits.find((candidate) => candidate.id === id);
      if (commit?.parentCommitId && deletableSet.has(commit.parentCommitId)) {
        const newCount = (childCount.get(commit.parentCommitId) ?? 1) - 1;
        childCount.set(commit.parentCommitId, newCount);
        if (newCount === 0) queue.push(commit.parentCommitId);
      }
    }
  }
}

// ===========================================================================
// Archived-root hard delete (the "git gc" of a soft-archived page)
// ===========================================================================

/**
 * Physically removes ONE soft-archived root and its entire history, in
 * FK-safe order, within the caller's transaction. The roots row is deleted
 * last; its `parentRootId` self-cascade and the `rootId` cascades on
 * comment_threads / content_usages clean up the rest.
 *
 * The caller MUST process archived roots oldest-`archivedAt`-first: a child is
 * always archived before its parent (deleteRoot refuses to archive a parent
 * with live children), so ascending order guarantees a child row is gone before
 * its parent's `parentRootId` cascade could touch it.
 */
export async function hardDeleteRoot(
  tx: DrizzleInstance,
  rootId: string,
): Promise<void> {
  const branchIds = (
    await tx
      .select({ id: branches.id })
      .from(branches)
      .where(eq(branches.rootId, rootId))
  ).map((b) => b.id);

  const mrIds = (
    await tx
      .select({ id: mergeRequests.id })
      .from(mergeRequests)
      .where(eq(mergeRequests.rootId, rootId))
  ).map((m) => m.id);

  const threadIds = (
    await tx
      .select({ id: commentThreads.id })
      .from(commentThreads)
      .where(eq(commentThreads.rootId, rootId))
  ).map((t) => t.id);

  const messageIds =
    threadIds.length > 0
      ? (
          await tx
            .select({ id: commentMessages.id })
            .from(commentMessages)
            .where(inArray(commentMessages.threadId, threadIds))
        ).map((m) => m.id)
      : [];

  // Search index is plain text (no FK) — scrub the root, its MRs and comments.
  await tx
    .delete(searchIndex)
    .where(
      and(eq(searchIndex.entityType, 'root'), eq(searchIndex.entityId, rootId)),
    );
  if (mrIds.length > 0) {
    await tx
      .delete(searchIndex)
      .where(
        and(
          eq(searchIndex.entityType, 'mergeRequest'),
          inArray(searchIndex.entityId, mrIds),
        ),
      );
  }
  if (messageIds.length > 0) {
    await tx
      .delete(searchIndex)
      .where(
        and(
          eq(searchIndex.entityType, 'comment'),
          inArray(searchIndex.entityId, messageIds),
        ),
      );
  }

  // Non-cascading children first, in dependency order. content_usages (the
  // generalist asset/variable/reference index) cascades on both block_version_id
  // and root_id; we clear it explicitly by rootId up front for deterministic
  // ordering (covers every kind in one delete).
  await tx.delete(contentUsages).where(eq(contentUsages.rootId, rootId));
  await tx.delete(publications).where(eq(publications.rootId, rootId));
  // approvals.branchId / .commitId have no cascade — clear by branch (covers
  // branch-scoped approvals; MR-linked ones also cascade with the MR below).
  if (branchIds.length > 0) {
    await tx.delete(approvals).where(inArray(approvals.branchId, branchIds));
  }
  // Deleting MRs cascades merge_conflicts + approvals.mergeRequestId +
  // comment_threads.mergeRequestId, clearing all conflict refs to this root's
  // block versions before we delete them.
  await tx.delete(mergeRequests).where(eq(mergeRequests.rootId, rootId));
  // commit_snapshots.blockVersionId cascades here; conflict refs are gone.
  await tx.delete(blockVersions).where(eq(blockVersions.rootId, rootId));
  // Branches reference commits via headCommitId (no cascade), so they must go
  // BEFORE commits.
  await tx.delete(branches).where(eq(branches.rootId, rootId));
  // commit_snapshots.commitId cascades; the commits self-FKs are NO ACTION,
  // checked at statement end, so deleting the whole root's commits at once is ok.
  await tx.delete(commits).where(eq(commits.rootId, rootId));

  // Finally the root row: cascades comment_threads by rootId (content_usages was
  // already cleared above), and any already-processed (earlier-archived) child
  // roots via parentRootId.
  await tx.delete(roots).where(eq(roots.id, rootId));
}

// ===========================================================================
// Bounded, resumable pruning pass (serverless-safe)
// ===========================================================================

export type PruningPassOptions = {
  /** Max roots touched this invocation (archived + live combined). */
  maxRoots?: number;
  /** Soft wall-clock budget (ms); the pass returns before exceeding it. */
  maxDurationMs?: number;
  /**
   * How long after a live root's last prune scan it becomes "due" again (ms).
   * A root is re-scanned only once per this window, which makes the live work
   * set DRAINABLE (so `done` can flip to true) instead of cycling forever.
   * Default 24h.
   */
  liveRescanMs?: number;
  /** Max archived assets reclaimed this invocation. Default 100. */
  maxAssets?: number;
  dryRun?: boolean;
};

export type PruningPassResult = PruningResult & {
  /** Soft-archived roots hard-deleted this pass. */
  deletedRoots: string[];
  /** Archived, unreferenced assets reclaimed (row + S3 object) this pass. */
  deletedAssets: string[];
  /** Live roots whose history was pruned (or visited) this pass. */
  processedLiveRoots: number;
  /** Why the pass stopped: hit the count cap, the time budget, or ran dry. */
  stoppedReason: 'maxRoots' | 'budget' | 'idle';
  /**
   * True when the pass drained all currently-due work (stopped idle). Queue
   * drivers (Vercel Queues / Upstash QStash) re-enqueue another pass while this
   * is false; a plain cron can ignore it and just ping periodically.
   */
  done: boolean;
};

const DEFAULT_MAX_ROOTS = 50;
const DEFAULT_MAX_DURATION_MS = 8_000;
const DEFAULT_LIVE_RESCAN_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_ASSETS = 100;

/**
 * One bounded, resumable pruning pass. Designed for a periodic serverless cron:
 * each invocation does a capped amount of work in PER-ROOT transactions and
 * persists its own progress, so a single cron ping is enough and successive
 * pings drain the backlog. No giant cross-root transaction, no caller-side loop.
 *
 * Work is self-advancing:
 *  - archived roots past the trash window are hard-deleted oldest-first
 *    (self-draining — they vanish as they're done);
 *  - live roots are history-pruned least-recently-pruned-first via
 *    `roots.lastPrunedAt`, which is stamped every visit so the queue rotates.
 */
export async function runPruningPass(
  db: DrizzleInstance,
  cmsCtx: CMSProcedureCtx,
  dataRetention: DataRetentionConfig,
  plugins: CMSPlugin[],
  mediaConfig: MediaConfig,
  opts: PruningPassOptions = {},
): Promise<PruningPassResult> {
  const maxRoots = opts.maxRoots ?? DEFAULT_MAX_ROOTS;
  const maxDurationMs = opts.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
  const liveRescanMs = opts.liveRescanMs ?? DEFAULT_LIVE_RESCAN_MS;
  const maxAssets = opts.maxAssets ?? DEFAULT_MAX_ASSETS;
  const dryRun = opts.dryRun ?? false;
  const startedAt = Date.now();
  const deadline = startedAt + maxDurationMs;

  const totals = createEmptyPruningResult();
  const deletedRoots: string[] = [];
  const deletedAssets: string[] = [];
  let processedLiveRoots = 0;
  let budget = maxRoots;

  const archiveKeepDays =
    dataRetention.archiveKeepDays ?? dataRetention.keepDays;
  const archiveCutoff = new Date(
    startedAt - archiveKeepDays * 24 * 60 * 60 * 1000,
  );

  const finish = (
    reason: PruningPassResult['stoppedReason'],
  ): PruningPassResult => ({
    ...totals,
    deletedRoots,
    deletedAssets,
    processedLiveRoots,
    stoppedReason: reason,
    done: reason === 'idle',
  });

  // 1) Hard-delete soft-archived roots past the trash window (children before
  //    parents via archivedAt ASC). Self-draining across passes.
  const archivedRoots = await db
    .select({ id: roots.id })
    .from(roots)
    .where(
      and(isNotNull(roots.archivedAt), lt(roots.archivedAt, archiveCutoff)),
    )
    .orderBy(asc(roots.archivedAt))
    .limit(budget);

  for (const root of archivedRoots) {
    if (Date.now() >= deadline) return finish('budget');
    if (!dryRun) {
      await db.transaction((tx) => hardDeleteRoot(tx, root.id));
    }
    deletedRoots.push(root.id);
    totals.prunedRoots.push(root.id);
    budget--;
    if (budget <= 0) return finish('maxRoots');
  }

  // 2) History-prune live roots that are DUE (never scanned, or last scanned
  //    before the rescan window), least-recently-pruned first. Stamping
  //    lastPrunedAt drops a root out of the due set, so the set drains and the
  //    pass can report done — while a cron still re-scans each root every
  //    rescan window.
  const rescanCutoff = new Date(startedAt - liveRescanMs);
  const liveRoots = await db
    .select({ id: roots.id })
    .from(roots)
    .where(
      and(
        isNull(roots.archivedAt),
        or(isNull(roots.lastPrunedAt), lt(roots.lastPrunedAt, rescanCutoff)),
      ),
    )
    .orderBy(sql`${roots.lastPrunedAt} ASC NULLS FIRST`)
    .limit(budget);

  for (const root of liveRoots) {
    if (Date.now() >= deadline) return finish('budget');

    if (dryRun) {
      const plan = await planRootPruning(db, root.id, dataRetention);
      if (plan) {
        addCorePlanTotals(totals, plan);
        const pluginPlans = await collectPluginPruningPlans(
          db,
          cmsCtx,
          dataRetention,
          plugins,
          plan,
        );
        for (const pluginPlan of pluginPlans) {
          addPluginMetrics(
            totals,
            pluginPlan.pluginId,
            pluginPlan.plan.metrics,
          );
        }
      }
    } else {
      await db.transaction(async (tx) => {
        const txCtx: CMSProcedureCtx = { ...cmsCtx, db: tx };
        const plan = await planRootPruning(tx, root.id, dataRetention);
        if (plan) {
          addCorePlanTotals(totals, plan);
          await executeRootPruning(tx, plan);

          const pluginPlans = await collectPluginPruningPlans(
            tx,
            txCtx,
            dataRetention,
            plugins,
            plan,
          );
          for (const pluginPlan of pluginPlans) {
            const executeResult = await pluginPlan.plugin.pruning?.execute?.({
              ...txCtx,
              tx,
              dataRetention,
              rootPlan: plan,
              pluginPlan: pluginPlan.plan,
            });
            addPluginMetrics(
              totals,
              pluginPlan.pluginId,
              executeResult?.metrics ?? pluginPlan.plan.metrics,
            );
          }
        }

        // Always stamp — even with no work — so the round-robin advances past
        // roots that have nothing to prune.
        await tx
          .update(roots)
          .set({ lastPrunedAt: new Date() })
          .where(eq(roots.id, root.id));
      });
    }

    processedLiveRoots++;
    budget--;
    if (budget <= 0) return finish('maxRoots');
  }

  // 3) Reclaim archived assets that NO live content references and that are past
  //    the trash window. Liveness comes from the content_usages index (asset
  //    rows), which is AUTHORITATIVE: keyed by the immutable blockVersionId and
  //    populated at every version-creation site, so it cannot drift across
  //    branches/merges. An asset is reclaimable only if no referencing,
  //    non-deleted block version sits in the HEAD snapshot of any branch of any
  //    non-archived root — this liveness JOIN (not the absent per-asset FK) is
  //    what makes reclaim correct. DB row first (its content_usages rows cascade
  //    by block_version_id), then S3 best-effort.
  const reclaimable = await db
    .select({ id: assets.id, objectKey: assets.objectKey })
    .from(assets)
    .where(
      and(
        isNotNull(assets.archivedAt),
        lt(assets.archivedAt, archiveCutoff),
        sql`NOT EXISTS (
          SELECT 1
          FROM cms.content_usages cu
          JOIN cms.commit_snapshots cs ON cs.block_version_id = cu.block_version_id
          JOIN cms.branches b ON b.head_commit_id = cs.commit_id
          JOIN cms.roots r ON r.id = b.root_id AND r.archived_at IS NULL
          JOIN cms.block_versions bv ON bv.id = cu.block_version_id AND bv.deleted = false
          WHERE cu.target_kind = 'asset' AND cu.target_key = ${assets.id}
        )`,
      ),
    )
    .orderBy(asc(assets.archivedAt))
    .limit(maxAssets);

  let s3: ReturnType<typeof createS3Client> | null = null;
  for (const asset of reclaimable) {
    if (Date.now() >= deadline) return finish('budget');
    if (!dryRun) {
      await db.delete(assets).where(eq(assets.id, asset.id));
      try {
        s3 ??= createS3Client(mediaConfig);
        await deleteObject(s3, {
          bucket: mediaConfig.bucketName,
          key: asset.objectKey,
        });
      } catch {
        // Best-effort: an orphaned S3 object is recoverable garbage; never let
        // a storage error block reclamation (the DB row is already gone).
      }
    }
    deletedAssets.push(asset.id);
  }
  if (reclaimable.length === maxAssets) return finish('maxRoots');

  // Ran out of work within the budget.
  return finish('idle');
}
