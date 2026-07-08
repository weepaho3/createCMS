import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { pgTable, text } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import type { CMSPlugin } from '../src/index';

import {
  approvals,
  assets,
  blockVersions,
  branches,
  commitSnapshots,
  commits,
  contentUsages,
  mergeConflicts,
  mergeRequests,
  publications,
  roots,
} from '../src/schema';
import { setupTestCMS } from '../src/test-utils/cms';

const pluginPruningRecords = pgTable('plugin_pruning_records', {
  id: text('id').primaryKey(),
  rootId: text('root_id').notNull(),
  commitId: text('commit_id').notNull(),
});

/**
 * Helper: creates a root and adds N child blocks to it, producing N+1 commits
 * (1 initial + N createBlock commits). Returns all IDs needed for assertions.
 */
async function createRootWithCommits(
  cms: Awaited<ReturnType<typeof setupTestCMS>>['cms'],
  db: Awaited<ReturnType<typeof setupTestCMS>>['db'],
  numBlocks: number,
  slugSuffix = '',
) {
  const root = await cms.api.pages.createRoot({
    body: {
      slug: `/page${slugSuffix}`,
      properties: { title: `Page${slugSuffix}` },
    },
  });

  const blockIds: string[] = [];
  for (let i = 0; i < numBlocks; i++) {
    const block = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: `Block ${i}` },
      },
    });
    blockIds.push(block.blockId);
  }

  const allCommits = await db
    .select()
    .from(commits)
    .where(eq(commits.rootId, root.rootId))
    .orderBy(commits.createdAt);

  return { ...root, blockIds, allCommits };
}

/**
 * Helper: backdate commits to simulate aging. Sets createdAt to `daysAgo` days
 * in the past for the specified commit IDs.
 */
async function backdateCommits(
  db: Awaited<ReturnType<typeof setupTestCMS>>['db'],
  commitIds: string[],
  daysAgo: number,
) {
  const pastDate = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  for (const id of commitIds) {
    await db
      .update(commits)
      .set({ createdAt: pastDate })
      .where(eq(commits.id, id));
  }
}

async function ensurePluginPruningTable(
  db: Awaited<ReturnType<typeof setupTestCMS>>['db'],
) {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS plugin_pruning_records (
      id text PRIMARY KEY,
      root_id text NOT NULL,
      commit_id text NOT NULL
    )
  `);
}

async function insertPluginPruningRecords(
  db: Awaited<ReturnType<typeof setupTestCMS>>['db'],
  rootId: string,
  commitIds: string[],
  prefix: string,
) {
  if (commitIds.length === 0) return;

  await db.insert(pluginPruningRecords).values(
    commitIds.map((commitId, index) => ({
      id: `${prefix}-${index}-${commitId}`,
      rootId,
      commitId,
    })),
  );
}

async function listPluginPruningRecords(
  db: Awaited<ReturnType<typeof setupTestCMS>>['db'],
  rootId?: string,
) {
  if (rootId) {
    return await db
      .select()
      .from(pluginPruningRecords)
      .where(eq(pluginPruningRecords.rootId, rootId));
  }

  return await db.select().from(pluginPruningRecords);
}

function createPluginPruningTestPlugin(options?: {
  throwAfterDelete?: boolean;
  onPlan?: (rootPlan: { rootId: string; deletableCommitIds: string[] }) => void;
}): CMSPlugin<{ recordIds: string[] }> {
  return {
    id: 'pluginPruningTest',
    pruning: {
      plan: async ({ db, rootPlan }) => {
        options?.onPlan?.({
          rootId: rootPlan.rootId,
          deletableCommitIds: rootPlan.deletableCommitIds,
        });

        if (rootPlan.deletableCommitIds.length === 0) {
          return null;
        }

        const rows = await db
          .select({ id: pluginPruningRecords.id })
          .from(pluginPruningRecords)
          .where(
            inArray(pluginPruningRecords.commitId, rootPlan.deletableCommitIds),
          );

        if (rows.length === 0) {
          return null;
        }

        return {
          rootId: rootPlan.rootId,
          data: { recordIds: rows.map((row) => row.id) },
          metrics: { deletedRecords: rows.length },
        };
      },
      execute: async ({ tx, pluginPlan }) => {
        const recordIds = pluginPlan.data?.recordIds ?? [];
        if (recordIds.length === 0) {
          return;
        }

        await tx
          .delete(pluginPruningRecords)
          .where(inArray(pluginPruningRecords.id, recordIds));

        if (options?.throwAfterDelete) {
          throw new Error('PLUGIN_PRUNING_FAILED');
        }
      },
    },
  };
}

describe('runPruning', () => {
  it('runs admin routes through the shared middleware chain', async () => {
    let capturedScope: 'collection' | 'system' | undefined;
    let capturedPermissionResource: string | undefined;
    let capturedOperation: string | undefined;

    const { cms } = await setupTestCMS({
      dataRetention: { keepDays: 7, keepMinCommits: 3 },
      middleware: async (ctx) => {
        capturedScope = ctx.scope;
        capturedPermissionResource = ctx.permissionResource;
        capturedOperation = ctx.operation;

        return { userId: 'admin-user' };
      },
    });

    await cms.api.admin.runPruning({ body: { dryRun: true } });

    expect(capturedScope).toBe('system');
    expect(capturedPermissionResource).toBe('admin');
    expect(capturedOperation).toBe('delete');
  });

  it('throws DATA_RETENTION_NOT_CONFIGURED when dataRetention is not set', async () => {
    const { cms } = await setupTestCMS();

    await expect(
      cms.api.admin.runPruning({ body: { dryRun: false } }),
    ).rejects.toThrow(/dataRetention is not configured/i);
  });

  it('deletes commits older than keepDays while preserving keepMinCommits', async () => {
    const { cms, db } = await setupTestCMS({
      dataRetention: { keepDays: 7, keepMinCommits: 3 },
    });

    // 11 commits total: C0 (initial) + C1..C10
    const { rootId, allCommits } = await createRootWithCommits(cms, db, 10);

    // Backdate C0..C7 (8 commits) to 30 days ago; C8..C10 stay recent
    const oldCommitIds = allCommits.slice(0, 8).map((c) => c.id);
    await backdateCommits(db, oldCommitIds, 30);

    const result = await cms.api.admin.runPruning({ body: { dryRun: false } });

    expect(result.prunedRoots).toContain(rootId);

    const remainingCommits = await db
      .select()
      .from(commits)
      .where(eq(commits.rootId, rootId));

    // Protected: initial (C0) + keepMinCommits picks C10,C9,C8 (3 most recent)
    //            + branch head (C10, already in recent set)
    // Deletable from old set: C1..C7 (7 commits) — C0 is protected as initial
    expect(result.deletedCommits).toBe(7);
    // Remaining: C0 + C8 + C9 + C10 = 4
    expect(remainingCommits.length).toBe(4);

    const initial = remainingCommits.find((c) => c.parentCommitId === null);
    expect(initial).toBeDefined();
  });

  it('always preserves the initial commit', async () => {
    const { cms, db } = await setupTestCMS({
      dataRetention: { keepDays: 0, keepMinCommits: 1 },
    });

    const { rootId, allCommits } = await createRootWithCommits(cms, db, 5);

    await backdateCommits(
      db,
      allCommits.map((c) => c.id),
      30,
    );

    await cms.api.admin.runPruning({ body: { dryRun: false } });

    const remainingCommits = await db
      .select()
      .from(commits)
      .where(eq(commits.rootId, rootId));

    const initial = remainingCommits.find((c) => c.parentCommitId === null);
    expect(initial).toBeDefined();
    expect(initial!.id).toBe(allCommits[0].id);
  });

  it('preserves branch head commits even when older than keepDays', async () => {
    const { cms, db } = await setupTestCMS({
      dataRetention: { keepDays: 7, keepMinCommits: 1 },
    });

    const { rootId, branchId, allCommits } = await createRootWithCommits(
      cms,
      db,
      3,
    );

    await backdateCommits(
      db,
      allCommits.map((c) => c.id),
      30,
    );

    const [branch] = await db
      .select()
      .from(branches)
      .where(eq(branches.id, branchId));
    const headCommitId = branch.headCommitId;

    await cms.api.admin.runPruning({ body: { dryRun: false } });

    const [headCommit] = await db
      .select()
      .from(commits)
      .where(eq(commits.id, headCommitId));
    expect(headCommit).toBeDefined();

    // Branch head's snapshot must also survive
    const headSnapshots = await db
      .select()
      .from(commitSnapshots)
      .where(eq(commitSnapshots.commitId, headCommitId));
    expect(headSnapshots.length).toBeGreaterThan(0);
  });

  it('preserves published branch HEAD with its snapshots and block versions', async () => {
    const { cms, db } = await setupTestCMS({
      dataRetention: { keepDays: 7, keepMinCommits: 1 },
    });

    const { rootId, branchId, allCommits } = await createRootWithCommits(
      cms,
      db,
      5,
    );

    // Publish the branch — content delivery uses the live HEAD, not a pinned commit
    const headCommitId = allCommits[allCommits.length - 1].id;
    await db.insert(publications).values({
      rootId,
      branchId,
      commitId: headCommitId,
      publishedBy: 'test-user',
    });

    await backdateCommits(
      db,
      allCommits.map((c) => c.id),
      30,
    );

    await cms.api.admin.runPruning({ body: { dryRun: false } });

    // Branch HEAD (= published content) must survive
    const [headCommit] = await db
      .select()
      .from(commits)
      .where(eq(commits.id, headCommitId));
    expect(headCommit).toBeDefined();

    // Its snapshot must survive
    const headSnapshots = await db
      .select()
      .from(commitSnapshots)
      .where(eq(commitSnapshots.commitId, headCommitId));
    expect(headSnapshots.length).toBeGreaterThan(0);

    // Old commits (not the HEAD) can be pruned
    const oldCommitId = allCommits[1].id;
    const [oldCommit] = await db
      .select()
      .from(commits)
      .where(eq(commits.id, oldCommitId));
    expect(oldCommit).toBeUndefined();
  });

  it('respects keepMinCommits even with keepDays=0', async () => {
    const { cms, db } = await setupTestCMS({
      dataRetention: { keepDays: 0, keepMinCommits: 5 },
    });

    // 11 commits total
    const { rootId, allCommits } = await createRootWithCommits(cms, db, 10);

    await backdateCommits(
      db,
      allCommits.map((c) => c.id),
      30,
    );

    await cms.api.admin.runPruning({ body: { dryRun: false } });

    const remainingCommits = await db
      .select()
      .from(commits)
      .where(eq(commits.rootId, rootId));

    // keepMinCommits=5 protects the 5 most recent (C6..C10).
    // Initial commit (C0) is always protected.
    // Branch head (C10) overlaps with recent set.
    // Deletable: C1..C5 = 5 commits
    // Remaining: C0 + C6 + C7 + C8 + C9 + C10 = 6
    expect(remainingCommits.length).toBe(6);
  });

  it('dry run returns counts but does not delete anything', async () => {
    const { cms, db } = await setupTestCMS({
      dataRetention: { keepDays: 7, keepMinCommits: 1 },
    });

    const { rootId, allCommits } = await createRootWithCommits(cms, db, 5);

    await backdateCommits(
      db,
      allCommits.slice(0, 4).map((c) => c.id),
      30,
    );

    const commitsBefore = await db
      .select()
      .from(commits)
      .where(eq(commits.rootId, rootId));
    const bvsBefore = await db
      .select()
      .from(blockVersions)
      .where(eq(blockVersions.rootId, rootId));

    const result = await cms.api.admin.runPruning({ body: { dryRun: true } });

    expect(result.deletedCommits).toBeGreaterThan(0);
    expect(result.deletedBlockVersions).toBeGreaterThan(0);
    expect(result.deletedSnapshots).toBeGreaterThan(0);

    // Nothing was actually deleted
    const commitsAfter = await db
      .select()
      .from(commits)
      .where(eq(commits.rootId, rootId));
    const bvsAfter = await db
      .select()
      .from(blockVersions)
      .where(eq(blockVersions.rootId, rootId));
    expect(commitsAfter.length).toBe(commitsBefore.length);
    expect(bvsAfter.length).toBe(bvsBefore.length);
  });

  it('repoints surviving commits to the initial commit and maintains a valid chain', async () => {
    const { cms, db } = await setupTestCMS({
      dataRetention: { keepDays: 7, keepMinCommits: 1 },
    });

    // 6 commits: C0 (initial), C1..C5
    const { rootId, allCommits } = await createRootWithCommits(cms, db, 5);

    // Backdate C0..C2 (3 commits) to 30 days ago; C3..C5 stay recent
    await backdateCommits(
      db,
      allCommits.slice(0, 3).map((c) => c.id),
      30,
    );

    const initialCommitId = allCommits[0].id;

    await cms.api.admin.runPruning({ body: { dryRun: false } });

    const survivingCommits = await db
      .select()
      .from(commits)
      .where(eq(commits.rootId, rootId))
      .orderBy(commits.createdAt);

    // C0 (initial) + C3 + C4 + C5 = 4 remaining
    expect(survivingCommits.length).toBe(4);

    // Initial commit has no parent
    const initial = survivingCommits.find((c) => c.id === initialCommitId);
    expect(initial).toBeDefined();
    expect(initial!.parentCommitId).toBeNull();

    // The epoch commit (C3) should now point to the initial commit
    const epochCommit = survivingCommits.find(
      (c) => c.id !== initialCommitId && c.parentCommitId === initialCommitId,
    );
    expect(epochCommit).toBeDefined();

    // Every surviving commit's parentCommitId must reference another surviving commit
    const survivingIds = new Set(survivingCommits.map((c) => c.id));
    for (const c of survivingCommits) {
      if (c.parentCommitId !== null) {
        expect(survivingIds.has(c.parentCommitId)).toBe(true);
      }
    }
  });

  it('prunes multiple roots independently', async () => {
    const { cms, db } = await setupTestCMS({
      dataRetention: { keepDays: 7, keepMinCommits: 1 },
    });

    const root1 = await createRootWithCommits(cms, db, 5, '-1');
    const root2 = await createRootWithCommits(cms, db, 3, '-2');

    await backdateCommits(
      db,
      root1.allCommits.slice(0, 4).map((c) => c.id),
      30,
    );
    await backdateCommits(
      db,
      root2.allCommits.slice(0, 2).map((c) => c.id),
      30,
    );

    const result = await cms.api.admin.runPruning({ body: { dryRun: false } });

    expect(result.prunedRoots).toContain(root1.rootId);
    expect(result.prunedRoots).toContain(root2.rootId);

    for (const rootId of [root1.rootId, root2.rootId]) {
      const [initial] = await db
        .select()
        .from(commits)
        .where(and(eq(commits.rootId, rootId), isNull(commits.parentCommitId)));
      expect(initial).toBeDefined();
    }
  });

  it('deletes block versions and snapshots for pruned commits', async () => {
    const { cms, db } = await setupTestCMS({
      dataRetention: { keepDays: 7, keepMinCommits: 1 },
    });

    const { rootId, allCommits } = await createRootWithCommits(cms, db, 5);

    const oldCommitIds = allCommits.slice(0, 4).map((c) => c.id);
    await backdateCommits(db, oldCommitIds, 30);

    const result = await cms.api.admin.runPruning({ body: { dryRun: false } });

    expect(result.deletedBlockVersions).toBeGreaterThan(0);
    expect(result.deletedSnapshots).toBeGreaterThan(0);

    // Verify deleted commits have no orphaned block versions or snapshots
    for (const commitId of oldCommitIds) {
      const remainingCommit = await db
        .select()
        .from(commits)
        .where(eq(commits.id, commitId));

      if (remainingCommit.length === 0) {
        const bvs = await db
          .select()
          .from(blockVersions)
          .where(eq(blockVersions.commitId, commitId));
        expect(bvs.length).toBe(0);

        const snaps = await db
          .select()
          .from(commitSnapshots)
          .where(eq(commitSnapshots.commitId, commitId));
        expect(snaps.length).toBe(0);
      }
    }
  });

  it('getBlockTree still works correctly after pruning', async () => {
    const { cms, db } = await setupTestCMS({
      dataRetention: { keepDays: 7, keepMinCommits: 1 },
    });

    const { rootId, branchId, allCommits, blockIds } =
      await createRootWithCommits(cms, db, 5);

    // Backdate first 4 commits to 30 days ago
    await backdateCommits(
      db,
      allCommits.slice(0, 4).map((c) => c.id),
      30,
    );

    await cms.api.admin.runPruning({ body: { dryRun: false } });

    // getBlockTree from the branch head must still work
    const tree = await cms.api.pages.getBlockTree({
      query: { rootId, branchId },
    });

    expect(tree.tree).toBeDefined();
    expect(tree.tree.blockId).toBe(rootId);
    // All 5 child blocks should be in the tree (they were added to the root)
    expect(tree.tree.children.length).toBe(5);
    for (const child of tree.tree.children) {
      expect(blockIds).toContain(child.blockId);
    }
  });

  it('does nothing when no commits are older than keepDays', async () => {
    const { cms, db } = await setupTestCMS({
      dataRetention: { keepDays: 30, keepMinCommits: 1 },
    });

    await createRootWithCommits(cms, db, 3);

    const result = await cms.api.admin.runPruning({ body: { dryRun: false } });

    expect(result.deletedCommits).toBe(0);
    expect(result.deletedBlockVersions).toBe(0);
    expect(result.deletedSnapshots).toBe(0);
    expect(result.prunedRoots).toHaveLength(0);
  });

  it('prunes resolved publication approvals but keeps pending ones for the current head', async () => {
    const { cms, db } = await setupTestCMS({
      dataRetention: { keepDays: 7, keepMinCommits: 1 },
    });

    const { rootId, branchId, allCommits } = await createRootWithCommits(
      cms,
      db,
      5,
    );

    // Request approvals: reviewer-1 will approve, reviewer-2 stays pending
    const result1 = await cms.api.pages.requestApproval({
      body: {
        branchId,
        requestedReviewers: ['reviewer-1', 'reviewer-2'],
      },
      context: { userId: 'requester-1' },
    });

    // Approve one, leave the other pending
    await cms.api.pages.approve({
      body: {
        approvalId: result1.approvals.find(
          (a: any) => a.requestedReviewer === 'reviewer-1',
        )!.id,
      },
      context: { userId: 'reviewer-1' },
    });

    const approvalsBefore = await db
      .select()
      .from(approvals)
      .where(eq(approvals.branchId, branchId));
    expect(approvalsBefore.length).toBe(2);

    // Backdate old commits
    await backdateCommits(
      db,
      allCommits.slice(0, 4).map((c) => c.id),
      30,
    );

    const result = await cms.api.admin.runPruning({ body: { dryRun: false } });

    // Only the approved one is pruned; the pending one for the current head stays
    expect(result.deletedApprovals).toBe(1);

    const approvalsAfter = await db
      .select()
      .from(approvals)
      .where(eq(approvals.branchId, branchId));
    expect(approvalsAfter.length).toBe(1);
    expect(approvalsAfter[0].status).toBe('pending');
    expect(approvalsAfter[0].requestedReviewer).toBe('reviewer-2');
  });

  it('prunes stale pending publication approvals when the branch head has advanced', async () => {
    const { cms, db } = await setupTestCMS({
      dataRetention: { keepDays: 7, keepMinCommits: 1 },
    });

    const { rootId, branchId, allCommits } = await createRootWithCommits(
      cms,
      db,
      3,
    );

    // Request a pending approval at the current head
    await cms.api.pages.requestApproval({
      body: {
        branchId,
        requestedReviewers: ['reviewer-1'],
      },
      context: { userId: 'requester-1' },
    });

    // Advance the branch head by creating another block
    await cms.api.pages.createBlock({
      body: {
        rootId,
        branchId,
        parentBlockId: rootId,
        type: 'paragraph',
        properties: { text: 'New block' },
      },
    });

    // The approval now points to an old commit — it's stale
    await backdateCommits(
      db,
      allCommits.slice(0, 2).map((c) => c.id),
      30,
    );

    const result = await cms.api.admin.runPruning({ body: { dryRun: false } });

    // Stale pending approval should be pruned
    expect(result.deletedApprovals).toBe(1);

    const approvalsAfter = await db
      .select()
      .from(approvals)
      .where(eq(approvals.branchId, branchId));
    expect(approvalsAfter.length).toBe(0);
  });

  it('cascades merge_conflicts and MR-linked approvals when closed MRs are pruned', async () => {
    const { cms, db } = await setupTestCMS({
      dataRetention: { keepDays: 7, keepMinCommits: 1 },
    });

    const root = await cms.api.pages.createRoot({
      body: { slug: '/page', properties: { title: 'Page' } },
    });

    // Create a second branch from main and make a change on it
    const featureBranch = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'feature',
        sourceBranchId: root.branchId,
      },
    });

    await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: featureBranch.branch.id,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Feature block' },
      },
    });

    // Create a merge request
    const mr = await cms.api.pages.createMergeRequest({
      body: {
        sourceBranchId: featureBranch.branch.id,
        targetBranchId: root.branchId,
        createdBy: 'test-user',
        title: 'Feature merge',
      },
    });

    // Request and approve the merge
    const approvalResult = await cms.api.pages.requestApproval({
      body: {
        mergeRequestId: mr.mergeRequest.id,
        requestedReviewers: ['reviewer-1'],
      },
      context: { userId: 'requester-1' },
    });
    await cms.api.pages.approve({
      body: {
        approvalId: approvalResult.approvals[0].id,
      },
      context: { userId: 'reviewer-1' },
    });

    // Execute the merge (status becomes 'merged')
    await cms.api.pages.executeMerge({
      body: {
        mergeRequestId: mr.mergeRequest.id,
        mergedBy: 'test-user',
      },
    });

    // Verify approvals exist for this MR
    const mrApprovalsBefore = await db
      .select()
      .from(approvals)
      .where(eq(approvals.mergeRequestId, mr.mergeRequest.id));
    expect(mrApprovalsBefore.length).toBe(1);

    // Backdate the MR's updatedAt and all commits to trigger pruning
    const allCommits = await db
      .select()
      .from(commits)
      .where(eq(commits.rootId, root.rootId));
    await backdateCommits(
      db,
      allCommits.map((c) => c.id),
      30,
    );
    await db
      .update(mergeRequests)
      .set({ updatedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) })
      .where(eq(mergeRequests.id, mr.mergeRequest.id));

    const result = await cms.api.admin.runPruning({ body: { dryRun: false } });

    expect(result.deletedMergeRequests).toBe(1);

    // MR should be gone
    const mrAfter = await db
      .select()
      .from(mergeRequests)
      .where(eq(mergeRequests.id, mr.mergeRequest.id));
    expect(mrAfter.length).toBe(0);

    // Cascaded: approvals for this MR should be gone
    const mrApprovalsAfter = await db
      .select()
      .from(approvals)
      .where(eq(approvals.mergeRequestId, mr.mergeRequest.id));
    expect(mrApprovalsAfter.length).toBe(0);

    // Cascaded: merge_conflicts for this MR should be gone
    const conflictsAfter = await db
      .select()
      .from(mergeConflicts)
      .where(eq(mergeConflicts.mergeRequestId, mr.mergeRequest.id));
    expect(conflictsAfter.length).toBe(0);
  });

  it('dry run reports deletedApprovals count without deleting', async () => {
    const { cms, db } = await setupTestCMS({
      dataRetention: { keepDays: 7, keepMinCommits: 1 },
    });

    const { rootId, branchId, allCommits } = await createRootWithCommits(
      cms,
      db,
      3,
    );

    // Create an approval and approve it so it becomes resolved (prunable)
    const req = await cms.api.pages.requestApproval({
      body: {
        branchId,
        requestedReviewers: ['reviewer-1'],
      },
      context: { userId: 'requester-1' },
    });
    await cms.api.pages.approve({
      body: {
        approvalId: req.approvals[0].id,
      },
      context: { userId: 'reviewer-1' },
    });

    await backdateCommits(
      db,
      allCommits.slice(0, 2).map((c) => c.id),
      30,
    );

    const result = await cms.api.admin.runPruning({ body: { dryRun: true } });

    expect(result.deletedApprovals).toBe(1);

    // Nothing actually deleted
    const approvalsAfter = await db
      .select()
      .from(approvals)
      .where(eq(approvals.branchId, branchId));
    expect(approvalsAfter.length).toBe(1);
  });

  it('reports plugin pruning metrics in dryRun without deleting plugin data', async () => {
    const plugin = createPluginPruningTestPlugin();
    const { cms, db } = await setupTestCMS({
      dataRetention: { keepDays: 7, keepMinCommits: 1 },
      plugins: [plugin],
    });

    await ensurePluginPruningTable(db);

    const { rootId, allCommits } = await createRootWithCommits(cms, db, 5);
    await backdateCommits(
      db,
      allCommits.slice(0, 4).map((c) => c.id),
      30,
    );

    const pluginCommitIds = allCommits.slice(1, 4).map((c) => c.id);
    await insertPluginPruningRecords(
      db,
      rootId,
      pluginCommitIds,
      'dry-run-plugin-record',
    );

    const result = await cms.api.admin.runPruning({ body: { dryRun: true } });

    expect(result.plugins['pluginPruningTest']).toEqual({
      deletedRecords: 3,
    });

    const remainingRecords = await listPluginPruningRecords(db, rootId);
    expect(remainingRecords).toHaveLength(3);
  });

  it('deletes plugin-owned data during pruning execution', async () => {
    const plugin = createPluginPruningTestPlugin();
    const { cms, db } = await setupTestCMS({
      dataRetention: { keepDays: 7, keepMinCommits: 1 },
      plugins: [plugin],
    });

    await ensurePluginPruningTable(db);

    const { rootId, allCommits } = await createRootWithCommits(cms, db, 5);
    await backdateCommits(
      db,
      allCommits.slice(0, 4).map((c) => c.id),
      30,
    );

    await insertPluginPruningRecords(
      db,
      rootId,
      allCommits.slice(1, 4).map((c) => c.id),
      'execute-plugin-record',
    );

    const result = await cms.api.admin.runPruning({ body: { dryRun: false } });

    expect(result.plugins['pluginPruningTest']).toEqual({
      deletedRecords: 3,
    });

    const remainingRecords = await listPluginPruningRecords(db, rootId);
    expect(remainingRecords).toHaveLength(0);
  });

  it('passes root-scoped pruning data into plugin planning', async () => {
    const seenRootPlans = new Map<string, string[]>();
    const plugin = createPluginPruningTestPlugin({
      onPlan: (rootPlan) => {
        seenRootPlans.set(rootPlan.rootId, rootPlan.deletableCommitIds);
      },
    });
    const { cms, db } = await setupTestCMS({
      dataRetention: { keepDays: 7, keepMinCommits: 1 },
      plugins: [plugin],
    });

    await ensurePluginPruningTable(db);

    const root1 = await createRootWithCommits(cms, db, 5, '-plugin-1');
    const root2 = await createRootWithCommits(cms, db, 4, '-plugin-2');

    await backdateCommits(
      db,
      root1.allCommits.slice(0, 4).map((c) => c.id),
      30,
    );
    await backdateCommits(
      db,
      root2.allCommits.slice(0, 3).map((c) => c.id),
      30,
    );

    await cms.api.admin.runPruning({ body: { dryRun: true } });

    const root1CommitIds = new Set(root1.allCommits.map((c) => c.id));
    const root2CommitIds = new Set(root2.allCommits.map((c) => c.id));

    expect(
      seenRootPlans.get(root1.rootId)?.every((id) => root1CommitIds.has(id)),
    ).toBe(true);
    expect(
      seenRootPlans.get(root2.rootId)?.every((id) => root2CommitIds.has(id)),
    ).toBe(true);
  });

  it('rolls back core and plugin pruning when plugin execution fails', async () => {
    const plugin = createPluginPruningTestPlugin({ throwAfterDelete: true });
    const { cms, db } = await setupTestCMS({
      dataRetention: { keepDays: 7, keepMinCommits: 1 },
      plugins: [plugin],
    });

    await ensurePluginPruningTable(db);

    const { rootId, allCommits } = await createRootWithCommits(cms, db, 5);
    await backdateCommits(
      db,
      allCommits.slice(0, 4).map((c) => c.id),
      30,
    );

    await insertPluginPruningRecords(
      db,
      rootId,
      allCommits.slice(1, 4).map((c) => c.id),
      'rollback-plugin-record',
    );

    const commitsBefore = await db
      .select()
      .from(commits)
      .where(eq(commits.rootId, rootId));
    const pluginRowsBefore = await listPluginPruningRecords(db, rootId);

    await expect(
      cms.api.admin.runPruning({ body: { dryRun: false } }),
    ).rejects.toThrow(/PLUGIN_PRUNING_FAILED/);

    const commitsAfter = await db
      .select()
      .from(commits)
      .where(eq(commits.rootId, rootId));
    const pluginRowsAfter = await listPluginPruningRecords(db, rootId);

    expect(commitsAfter).toHaveLength(commitsBefore.length);
    expect(pluginRowsAfter).toHaveLength(pluginRowsBefore.length);
  });
});

describe('runPruning — archived-root hard-delete + resumability (5c)', () => {
  it('hard-deletes a soft-archived root and its full history past the trash window', async () => {
    const { cms, db } = await setupTestCMS({
      dataRetention: { keepDays: 7, keepMinCommits: 1, archiveKeepDays: 7 },
    });

    const { rootId } = await createRootWithCommits(cms, db, 3);
    await cms.api.pages.archiveRoot({ body: { rootId } });
    // Backdate the archive so it's unambiguously past the 7-day trash window.
    await db
      .update(roots)
      .set({ archivedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) })
      .where(eq(roots.id, rootId));

    const result = await cms.api.admin.runPruning({ body: { dryRun: false } });
    expect(result.deletedRoots).toContain(rootId);

    const [rootRow] = await db.select().from(roots).where(eq(roots.id, rootId));
    expect(rootRow).toBeUndefined();
    expect(
      await db.select().from(branches).where(eq(branches.rootId, rootId)),
    ).toHaveLength(0);
    expect(
      await db.select().from(commits).where(eq(commits.rootId, rootId)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(blockVersions)
        .where(eq(blockVersions.rootId, rootId)),
    ).toHaveLength(0);
  });

  it('keeps archived roots that are still within the trash window', async () => {
    const { cms, db } = await setupTestCMS({
      dataRetention: { keepDays: 7, keepMinCommits: 1, archiveKeepDays: 30 },
    });

    const { rootId } = await createRootWithCommits(cms, db, 2);
    await cms.api.pages.archiveRoot({ body: { rootId } });

    const result = await cms.api.admin.runPruning({ body: { dryRun: false } });
    expect(result.deletedRoots).not.toContain(rootId);

    const [rootRow] = await db.select().from(roots).where(eq(roots.id, rootId));
    expect(rootRow).toBeDefined();
    expect(rootRow.archivedAt).not.toBeNull();
  });

  it('reports done=true when the due work set is drained', async () => {
    const { cms, db } = await setupTestCMS({
      dataRetention: { keepDays: 7, keepMinCommits: 1 },
    });
    await createRootWithCommits(cms, db, 2);

    const result = await cms.api.admin.runPruning({ body: { dryRun: false } });
    expect(result.done).toBe(true);
    expect(result.stoppedReason).toBe('idle');
  });

  it('reports done=false (more work remains) when maxRoots caps the pass', async () => {
    const { cms, db } = await setupTestCMS({
      dataRetention: { keepDays: 7, keepMinCommits: 1 },
    });
    await createRootWithCommits(cms, db, 2, '-a');
    await createRootWithCommits(cms, db, 2, '-b');

    const result = await cms.api.admin.runPruning({
      body: { dryRun: false, maxRoots: 1 },
    });
    expect(result.done).toBe(false);
    expect(result.stoppedReason).toBe('maxRoots');
    expect(result.processedLiveRoots).toBe(1);
  });

  it('does not re-scan a live root within the rescan window (drainable)', async () => {
    const { cms, db } = await setupTestCMS({
      dataRetention: { keepDays: 7, keepMinCommits: 1 },
    });
    await createRootWithCommits(cms, db, 2);

    // First pass stamps lastPrunedAt; second pass (default 24h rescan) finds it
    // not yet due -> nothing to process -> still done.
    await cms.api.admin.runPruning({ body: { dryRun: false } });
    const second = await cms.api.admin.runPruning({ body: { dryRun: false } });
    expect(second.processedLiveRoots).toBe(0);
    expect(second.done).toBe(true);
  });

  it('reclaims an archived, unreferenced, old asset (row deleted)', async () => {
    const { cms, db } = await setupTestCMS({
      dataRetention: { keepDays: 7, keepMinCommits: 1, archiveKeepDays: 7 },
    });

    const [asset] = await db
      .insert(assets)
      .values({
        slug: 'gc.png',
        mimeType: 'image/png',
        size: 1,
        objectKey: 'gc.png',
        archivedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      })
      .returning();

    const result = await cms.api.admin.runPruning({ body: { dryRun: false } });
    expect(result.deletedAssets).toContain(asset.id);

    const [row] = await db.select().from(assets).where(eq(assets.id, asset.id));
    expect(row).toBeUndefined();
  });

  it('keeps an archived asset that is still referenced by a live root', async () => {
    const { cms, db } = await setupTestCMS({
      dataRetention: { keepDays: 7, keepMinCommits: 1, archiveKeepDays: 7 },
    });

    const [asset] = await db
      .insert(assets)
      .values({
        slug: 'used.png',
        mimeType: 'image/png',
        size: 1,
        objectKey: 'used.png',
      })
      .returning();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/p', properties: { title: 'P' } },
    });
    await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: asset.id },
      },
    });

    // Archive the asset and backdate past the trash window — but it's still
    // referenced by a LIVE root, so the GC must keep it.
    await db
      .update(assets)
      .set({ archivedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) })
      .where(eq(assets.id, asset.id));

    const result = await cms.api.admin.runPruning({ body: { dryRun: false } });
    expect(result.deletedAssets).not.toContain(asset.id);

    const [row] = await db.select().from(assets).where(eq(assets.id, asset.id));
    expect(row).toBeDefined();
  });

  it('keeps an asset still used on ANOTHER branch after an edit on a sibling branch (branch-correct regression)', async () => {
    const { cms, db } = await setupTestCMS({
      dataRetention: { keepDays: 7, keepMinCommits: 1, archiveKeepDays: 7 },
    });

    const [asset] = await db
      .insert(assets)
      .values({
        slug: 'cross.png',
        mimeType: 'image/png',
        size: 1,
        objectKey: 'cross.png',
      })
      .returning();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/p', properties: { title: 'P' } },
    });
    const block = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: asset.id },
      },
    });

    // Branch off main, then drop the asset from the SAME block on the feature
    // branch. With a blockId-keyed index this edit would wipe the reference
    // globally (the old data-loss bug). Version-keyed, the feature edit creates
    // a new version with no ref while main's referencing version is untouched.
    const feature = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'feature',
        sourceBranchId: root.branchId,
      },
    });
    await cms.api.pages.updateBlock({
      body: {
        rootId: root.rootId,
        branchId: feature.branch.id,
        blockId: block.blockId,
        type: 'paragraph',
        properties: { text: 'no asset here' },
      },
    });

    // The index still holds main's reference — it never drifted.
    expect(
      (
        await db
          .select()
          .from(contentUsages)
          .where(
            and(
              eq(contentUsages.targetKind, 'asset'),
              eq(contentUsages.targetKey, asset.id),
            ),
          )
      ).length,
    ).toBeGreaterThan(0);

    // Archive + age the asset, then GC. The asset is still live on main's head,
    // so it must be kept.
    await db
      .update(assets)
      .set({ archivedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) })
      .where(eq(assets.id, asset.id));

    const result = await cms.api.admin.runPruning({ body: { dryRun: false } });
    expect(result.deletedAssets).not.toContain(asset.id);

    const [row] = await db.select().from(assets).where(eq(assets.id, asset.id));
    expect(row).toBeDefined();
  });

  it('archiveAsset skips an asset that is still referenced by live content', async () => {
    const { cms, db } = await setupTestCMS();

    const [asset] = await db
      .insert(assets)
      .values({
        slug: 'guard.png',
        mimeType: 'image/png',
        size: 1,
        objectKey: 'guard.png',
      })
      .returning();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/p', properties: { title: 'P' } },
    });
    await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: asset.id },
      },
    });

    const archiveResult = await cms.api.media.archiveAssets({
      body: { assetIds: [asset.id] },
    });
    expect(archiveResult.archived).toBe(0);
    expect(archiveResult.skipped).toContain(asset.id);

    const [row] = await db.select().from(assets).where(eq(assets.id, asset.id));
    expect(row.archivedAt).toBeNull();
  });
});
