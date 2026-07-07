import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  assets,
  blockVersions,
  branches,
  commentThreads,
  commitSnapshots,
  commits,
  contentUsages,
  mergeConflicts,
  mergeRequests,
} from '../src/schema';
import { setupTestCMS } from './utils/cms';
import { requestAndApproveMerge } from './utils/helpers';

// ============================================================================
// getDiff
// ============================================================================

describe('getDiff', () => {
  it('returns empty diff when branches point to the same commit', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/p', properties: { title: 'Page' } },
    });

    const draft = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'draft',
        sourceBranchId: root.branchId,
      },
    });

    const result = await cms.api.pages.getDiff({
      query: {
        sourceBranchId: draft.branch.id,
        targetBranchId: root.branchId,
      },
    });

    expect(result.diff).toEqual([]);
    expect(result.sourceCommitId).toBe(root.commit.id);
    expect(result.targetCommitId).toBe(root.commit.id);
    expect(result.commonAncestorCommitId).toBe(root.commit.id);
  });

  it('detects an added block', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/p', properties: { title: 'Page' } },
    });

    const draft = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'draft',
        sourceBranchId: root.branchId,
      },
    });

    const block = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: draft.branch.id,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'New paragraph' },
      },
    });

    const result = await cms.api.pages.getDiff({
      query: {
        sourceBranchId: draft.branch.id,
        targetBranchId: root.branchId,
      },
    });

    const addedBlock = result.diff.find((d) => d.blockId === block.blockId);
    expect(addedBlock).toBeDefined();
    expect(addedBlock!.changeTypes).toContain('added');

    const rootEntry = result.diff.find((d) => d.blockId === root.rootId);
    expect(rootEntry).toBeDefined();
    expect(rootEntry!.changeTypes).toContain('childrenReordered');
  });

  it('detects a deleted block', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/p', properties: { title: 'Page' } },
    });

    const block = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'To be deleted' },
      },
    });

    const draft = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'draft',
        sourceBranchId: root.branchId,
      },
    });

    await cms.api.pages.deleteBlock({
      body: {
        rootId: root.rootId,
        branchId: draft.branch.id,
        blockId: block.blockId,
      },
    });

    const result = await cms.api.pages.getDiff({
      query: {
        sourceBranchId: draft.branch.id,
        targetBranchId: root.branchId,
      },
    });

    const deletedEntry = result.diff.find((d) => d.blockId === block.blockId);
    expect(deletedEntry).toBeDefined();
    expect(deletedEntry!.changeTypes).toContain('deleted');

    const rootEntry = result.diff.find((d) => d.blockId === root.rootId);
    expect(rootEntry).toBeDefined();
    expect(rootEntry!.changeTypes).toContain('childrenReordered');
  });

  it('detects a modified block', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/p', properties: { title: 'Page' } },
    });

    const block = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Original' },
      },
    });

    const draft = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'draft',
        sourceBranchId: root.branchId,
      },
    });

    await cms.api.pages.updateBlock({
      body: {
        rootId: root.rootId,
        branchId: draft.branch.id,
        blockId: block.blockId,
        type: 'paragraph',
        properties: { text: 'Updated' },
      },
    });

    const result = await cms.api.pages.getDiff({
      query: {
        sourceBranchId: draft.branch.id,
        targetBranchId: root.branchId,
      },
    });

    const modifiedEntry = result.diff.find((d) => d.blockId === block.blockId);
    expect(modifiedEntry).toBeDefined();
    expect(modifiedEntry!.changeTypes).toEqual(['modified']);
    expect(modifiedEntry!.sourceVersion!.properties).toEqual({
      text: 'Updated',
    });
    expect(modifiedEntry!.baseVersion!.properties).toEqual({
      text: 'Original',
    });
  });

  it('detects a moved block across parents', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/p', properties: { title: 'Page' } },
    });

    const containerA = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Container A' },
      },
    });

    const containerB = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Container B' },
      },
    });

    const child = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: containerA.blockId,
        type: 'paragraph',
        properties: { text: 'Child' },
      },
    });

    const draft = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'draft',
        sourceBranchId: root.branchId,
      },
    });

    await cms.api.pages.moveBlock({
      body: {
        rootId: root.rootId,
        branchId: draft.branch.id,
        blockId: child.blockId,
        newParentBlockId: containerB.blockId,
        newIndex: 0,
      },
    });

    const result = await cms.api.pages.getDiff({
      query: {
        sourceBranchId: draft.branch.id,
        targetBranchId: root.branchId,
      },
    });

    const movedEntry = result.diff.find((d) => d.blockId === child.blockId);
    expect(movedEntry).toBeDefined();
    expect(movedEntry!.changeTypes).toContain('moved');

    const oldParent = result.diff.find((d) => d.blockId === containerA.blockId);
    expect(oldParent).toBeDefined();
    expect(oldParent!.changeTypes).toContain('childrenReordered');

    const newParent = result.diff.find((d) => d.blockId === containerB.blockId);
    expect(newParent).toBeDefined();
    expect(newParent!.changeTypes).toContain('childrenReordered');
  });

  it('detects children reordered within the same parent', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/p', properties: { title: 'Page' } },
    });

    const blockA = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'A' },
      },
    });

    const blockB = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'B' },
      },
    });

    const draft = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'draft',
        sourceBranchId: root.branchId,
      },
    });

    await cms.api.pages.moveBlock({
      body: {
        rootId: root.rootId,
        branchId: draft.branch.id,
        blockId: blockB.blockId,
        newParentBlockId: root.rootId,
        newIndex: 0,
      },
    });

    const result = await cms.api.pages.getDiff({
      query: {
        sourceBranchId: draft.branch.id,
        targetBranchId: root.branchId,
      },
    });

    const rootEntry = result.diff.find((d) => d.blockId === root.rootId);
    expect(rootEntry).toBeDefined();
    expect(rootEntry!.changeTypes).toContain('childrenReordered');
    expect(rootEntry!.changeTypes).not.toContain('modified');

    const entryA = result.diff.find((d) => d.blockId === blockA.blockId);
    const entryB = result.diff.find((d) => d.blockId === blockB.blockId);
    expect(entryA).toBeDefined();
    expect(entryA!.changeTypes).toContain('moved');
    expect(entryB).toBeDefined();
    expect(entryB!.changeTypes).toContain('moved');
  });

  it('detects modified + childrenReordered on the same block', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/p', properties: { title: 'Page' } },
    });

    const blockA = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'A' },
      },
    });

    await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'B' },
      },
    });

    const draft = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'draft',
        sourceBranchId: root.branchId,
      },
    });

    await cms.api.pages.updateRoot({
      body: {
        rootId: root.rootId,
        branchId: draft.branch.id,
        slug: '/p',
        properties: { title: 'Updated Title' },
      },
    });

    await cms.api.pages.moveBlock({
      body: {
        rootId: root.rootId,
        branchId: draft.branch.id,
        blockId: blockA.blockId,
        newParentBlockId: root.rootId,
        newIndex: 1,
      },
    });

    const result = await cms.api.pages.getDiff({
      query: {
        sourceBranchId: draft.branch.id,
        targetBranchId: root.branchId,
      },
    });

    const rootEntry = result.diff.find((d) => d.blockId === root.rootId);
    expect(rootEntry).toBeDefined();
    expect(rootEntry!.changeTypes).toContain('modified');
    expect(rootEntry!.changeTypes).toContain('childrenReordered');
  });

  it('rejects when a branch does not exist', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/p', properties: { title: 'Page' } },
    });

    await expect(
      cms.api.pages.getDiff({
        query: {
          sourceBranchId: 'nonexistent',
          targetBranchId: root.branchId,
        },
      }),
    ).rejects.toThrow(/Branch not found/);
  });
});

// ============================================================================
// checkConflicts
// ============================================================================

describe('checkConflicts', () => {
  it('reports no conflicts when only source changed', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/p', properties: { title: 'Page' } },
    });

    const block = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Original' },
      },
    });

    const draft = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'draft',
        sourceBranchId: root.branchId,
      },
    });

    await cms.api.pages.updateBlock({
      body: {
        rootId: root.rootId,
        branchId: draft.branch.id,
        blockId: block.blockId,
        type: 'paragraph',
        properties: { text: 'Source change' },
      },
    });

    const result = await cms.api.pages.checkConflicts({
      query: {
        sourceBranchId: draft.branch.id,
        targetBranchId: root.branchId,
      },
    });

    expect(result.hasConflicts).toBe(false);
    expect(result.conflicts).toEqual([]);
  });

  it('reports no conflicts when only target changed', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/p', properties: { title: 'Page' } },
    });

    const block = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Original' },
      },
    });

    const draft = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'draft',
        sourceBranchId: root.branchId,
      },
    });

    // Change on main (target), not on draft (source)
    await cms.api.pages.updateBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        blockId: block.blockId,
        type: 'paragraph',
        properties: { text: 'Target change' },
      },
    });

    const result = await cms.api.pages.checkConflicts({
      query: {
        sourceBranchId: draft.branch.id,
        targetBranchId: root.branchId,
      },
    });

    expect(result.hasConflicts).toBe(false);
    expect(result.conflicts).toEqual([]);
  });

  it('detects a conflict when both sides changed the same block differently', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/p', properties: { title: 'Page' } },
    });

    const block = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Original' },
      },
    });

    const draft = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'draft',
        sourceBranchId: root.branchId,
      },
    });

    await cms.api.pages.updateBlock({
      body: {
        rootId: root.rootId,
        branchId: draft.branch.id,
        blockId: block.blockId,
        type: 'paragraph',
        properties: { text: 'Source version' },
      },
    });

    await cms.api.pages.updateBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        blockId: block.blockId,
        type: 'paragraph',
        properties: { text: 'Target version' },
      },
    });

    const result = await cms.api.pages.checkConflicts({
      query: {
        sourceBranchId: draft.branch.id,
        targetBranchId: root.branchId,
      },
    });

    expect(result.hasConflicts).toBe(true);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].blockId).toBe(block.blockId);
    expect(result.conflicts[0].sourceVersionId).toBeDefined();
    expect(result.conflicts[0].targetVersionId).toBeDefined();
  });

  it('reports no conflict when neither side changed from the common ancestor', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/p', properties: { title: 'Page' } },
    });

    const draft = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'draft',
        sourceBranchId: root.branchId,
      },
    });

    const result = await cms.api.pages.checkConflicts({
      query: {
        sourceBranchId: draft.branch.id,
        targetBranchId: root.branchId,
      },
    });

    expect(result.hasConflicts).toBe(false);
  });

  it('rejects when a branch does not exist', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/p', properties: { title: 'Page' } },
    });

    await expect(
      cms.api.pages.checkConflicts({
        query: {
          sourceBranchId: 'nonexistent',
          targetBranchId: root.branchId,
        },
      }),
    ).rejects.toThrow(/Branch not found/);
  });
});

// ============================================================================
// createMergeRequest
// ============================================================================

describe('createMergeRequest', () => {
  it('creates a merge request with no conflicts', async () => {
    const { cms, db } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/p', properties: { title: 'Page' } },
    });

    const draft = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'draft',
        sourceBranchId: root.branchId,
      },
    });

    await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: draft.branch.id,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'New block' },
      },
    });

    const result = await cms.api.pages.createMergeRequest({
      body: {
        sourceBranchId: draft.branch.id,
        targetBranchId: root.branchId,
        title: 'Add paragraph',
        createdBy: 'user-1',
      },
    });

    expect(result.mergeRequest.id).toBeDefined();
    expect(result.hasConflicts).toBe(false);
    expect(result.conflicts).toEqual([]);

    const [mr] = await db
      .select()
      .from(mergeRequests)
      .where(eq(mergeRequests.id, result.mergeRequest.id));

    expect(mr.status).toBe('open');
    expect(mr.sourceBranchId).toBe(draft.branch.id);
    expect(mr.targetBranchId).toBe(root.branchId);
    expect(mr.title).toBe('Add paragraph');
    expect(mr.createdBy).toBe('user-1');
  });

  it('uses middleware userId when createdBy is omitted', async () => {
    const { cms, db } = await setupTestCMS({
      middleware: async () => ({ userId: 'middleware-user' }),
    });

    const root = await cms.api.pages.createRoot({
      body: { slug: '/p', properties: { title: 'Page' } },
    });

    const draft = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'draft',
        sourceBranchId: root.branchId,
      },
    });

    const result = await cms.api.pages.createMergeRequest({
      body: {
        sourceBranchId: draft.branch.id,
        targetBranchId: root.branchId,
        title: 'Middleware actor MR',
      },
    });

    const [mr] = await db
      .select()
      .from(mergeRequests)
      .where(eq(mergeRequests.id, result.mergeRequest.id));

    expect(mr.createdBy).toBe('middleware-user');
  });

  it('creates a merge request with conflicts and stores them', async () => {
    const { cms, db } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/p', properties: { title: 'Page' } },
    });

    const block = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Original' },
      },
    });

    const draft = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'draft',
        sourceBranchId: root.branchId,
      },
    });

    await cms.api.pages.updateBlock({
      body: {
        rootId: root.rootId,
        branchId: draft.branch.id,
        blockId: block.blockId,
        type: 'paragraph',
        properties: { text: 'Source version' },
      },
    });

    await cms.api.pages.updateBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        blockId: block.blockId,
        type: 'paragraph',
        properties: { text: 'Target version' },
      },
    });

    const result = await cms.api.pages.createMergeRequest({
      body: {
        title: 'Test MR',
        sourceBranchId: draft.branch.id,
        targetBranchId: root.branchId,
        createdBy: 'user-1',
      },
    });

    expect(result.hasConflicts).toBe(true);
    expect(result.conflicts.length).toBeGreaterThanOrEqual(1);

    const conflictBlock = result.conflicts.find(
      (c: any) => c.blockId === block.blockId,
    );
    expect(conflictBlock).toBeDefined();

    // Verify conflicts are persisted
    const dbConflicts = await db
      .select()
      .from(mergeConflicts)
      .where(eq(mergeConflicts.mergeRequestId, result.mergeRequest.id));

    expect(dbConflicts.length).toBeGreaterThanOrEqual(1);
    const dbConflict = dbConflicts.find((c: any) => c.blockId === block.blockId);
    expect(dbConflict).toBeDefined();
    expect(dbConflict!.resolution).toBeNull();
  });

  it('rejects duplicate open merge request for same source and target', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/p', properties: { title: 'Page' } },
    });

    const draft = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'draft',
        sourceBranchId: root.branchId,
      },
    });

    await cms.api.pages.createMergeRequest({
      body: {
        title: 'Test MR',
        sourceBranchId: draft.branch.id,
        targetBranchId: root.branchId,
        createdBy: 'user-1',
      },
    });

    await expect(
      cms.api.pages.createMergeRequest({
        body: {
          title: 'Test MR',
          sourceBranchId: draft.branch.id,
          targetBranchId: root.branchId,
          createdBy: 'user-1',
        },
      }),
    ).rejects.toThrow(/An open merge request already exists/);
  });
});

// ============================================================================
// listMergeRequests
// ============================================================================

describe('listMergeRequests', () => {
  it('excludes merge requests whose root was soft-deleted', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/doomed', properties: { title: 'Doomed' } },
    });
    const draft = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'draft',
        sourceBranchId: root.branchId,
      },
    });
    await cms.api.pages.createMergeRequest({
      body: {
        sourceBranchId: draft.branch.id,
        targetBranchId: root.branchId,
        title: 'MR for a doomed page',
        createdBy: 'user-1',
      },
    });

    const before = await cms.api.pages.listMergeRequests({ query: {} });
    expect(before.total).toBe(1);
    expect(before.mergeRequests).toHaveLength(1);

    // Soft-delete the page; its MR must drop out of the list.
    await cms.api.pages.deleteRoot({ body: { rootId: root.rootId } });

    const after = await cms.api.pages.listMergeRequests({ query: {} });
    expect(after.total).toBe(0);
    expect(after.mergeRequests).toHaveLength(0);
  });

  it('returns paginated merge requests with branch names', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/p', properties: { title: 'Page' } },
    });

    const draft = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'draft',
        sourceBranchId: root.branchId,
      },
    });

    const feature = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'feature',
        sourceBranchId: root.branchId,
      },
    });

    await cms.api.pages.createMergeRequest({
      body: {
        sourceBranchId: draft.branch.id,
        targetBranchId: root.branchId,
        title: 'Draft MR',
        createdBy: 'user-1',
      },
    });

    await cms.api.pages.createMergeRequest({
      body: {
        sourceBranchId: feature.branch.id,
        targetBranchId: root.branchId,
        title: 'Feature MR',
        createdBy: 'user-2',
      },
    });

    const result = await cms.api.pages.listMergeRequests({
      query: {
        rootId: root.rootId,
        limit: 1,
        offset: 0,
      },
    });

    expect(result.mergeRequests).toHaveLength(1);
    expect(result.total).toBe(2);
    expect(result.hasMore).toBe(true);
    expect(result.mergeRequests[0].sourceBranchName).toBeDefined();
    expect(result.mergeRequests[0].targetBranchName).toBe('main');
  });

  it('filters by rootId', async () => {
    const { cms } = await setupTestCMS();

    const rootA = await cms.api.pages.createRoot({
      body: { slug: '/a', properties: { title: 'Page A' } },
    });
    const rootB = await cms.api.pages.createRoot({
      body: { slug: '/b', properties: { title: 'Page B' } },
    });

    const draftA = await cms.api.pages.createBranch({
      body: {
        rootId: rootA.rootId,
        name: 'draft-a',
        sourceBranchId: rootA.branchId,
      },
    });
    const draftB = await cms.api.pages.createBranch({
      body: {
        rootId: rootB.rootId,
        name: 'draft-b',
        sourceBranchId: rootB.branchId,
      },
    });

    await cms.api.pages.createMergeRequest({
      body: {
        title: 'Test MR',
        sourceBranchId: draftA.branch.id,
        targetBranchId: rootA.branchId,
        createdBy: 'user-1',
      },
    });
    await cms.api.pages.createMergeRequest({
      body: {
        title: 'Test MR',
        sourceBranchId: draftB.branch.id,
        targetBranchId: rootB.branchId,
        createdBy: 'user-2',
      },
    });

    const result = await cms.api.pages.listMergeRequests({
      query: {
        rootId: rootA.rootId,
      },
    });

    expect(result.mergeRequests).toHaveLength(1);
    expect(result.mergeRequests[0].rootId).toBe(rootA.rootId);
  });

  it('filters by status', async () => {
    const { cms, db } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/p', properties: { title: 'Page' } },
    });

    const draft = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'draft',
        sourceBranchId: root.branchId,
      },
    });

    const mr = await cms.api.pages.createMergeRequest({
      body: {
        title: 'Test MR',
        sourceBranchId: draft.branch.id,
        targetBranchId: root.branchId,
        createdBy: 'user-1',
      },
    });

    await db
      .update(mergeRequests)
      .set({ status: 'closed' })
      .where(eq(mergeRequests.id, mr.mergeRequest.id));

    const result = await cms.api.pages.listMergeRequests({
      query: {
        status: 'closed',
      },
    });

    expect(result.mergeRequests).toHaveLength(1);
    expect(result.mergeRequests[0].status).toBe('closed');
  });

  it('supports search across title and description', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/p', properties: { title: 'Page' } },
    });

    const draft = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'draft',
        sourceBranchId: root.branchId,
      },
    });

    await cms.api.pages.createMergeRequest({
      body: {
        sourceBranchId: draft.branch.id,
        targetBranchId: root.branchId,
        title: 'Hero redesign',
        description: 'Updates the hero section',
        createdBy: 'user-1',
      },
    });

    const result = await cms.api.pages.listMergeRequests({
      query: {
        search: 'hero',
      },
    });

    expect(result.mergeRequests).toHaveLength(1);
    expect(result.mergeRequests[0].title).toBe('Hero redesign');
  });

  it('includes conflict metadata', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/p', properties: { title: 'Page' } },
    });

    const block = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Base' },
      },
    });

    const draft = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'draft',
        sourceBranchId: root.branchId,
      },
    });

    await cms.api.pages.updateBlock({
      body: {
        rootId: root.rootId,
        branchId: draft.branch.id,
        blockId: block.blockId,
        type: 'paragraph',
        properties: { text: 'Source version' },
      },
    });

    await cms.api.pages.updateBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        blockId: block.blockId,
        type: 'paragraph',
        properties: { text: 'Target version' },
      },
    });

    await cms.api.pages.createMergeRequest({
      body: {
        title: 'Test MR',
        sourceBranchId: draft.branch.id,
        targetBranchId: root.branchId,
        createdBy: 'user-1',
      },
    });

    const result = await cms.api.pages.listMergeRequests({
      query: {
        rootId: root.rootId,
      },
    });

    expect(result.mergeRequests).toHaveLength(1);
    expect(result.mergeRequests[0].hasConflicts).toBe(true);
    expect(result.mergeRequests[0].conflictCount).toBeGreaterThan(0);
  });

  it('does not inflate conflict/comment counts when an MR has both (scalar subqueries, no Cartesian fan-out)', async () => {
    const { cms, db } = await setupTestCMS();
    const { root, mr, dbConflicts } = await createConflictingMR(cms, db);

    // Two comment threads on the same MR (inserted directly). The old query
    // LEFT JOINed both merge_conflicts AND comment_threads, fanning out to
    // conflicts×threads rows; the scalar-subquery rewrite counts each side
    // independently, so neither count is multiplied by the other.
    await db.insert(commentThreads).values([
      {
        collection: 'pages',
        targetType: 'mergeRequest',
        mergeRequestId: mr.mergeRequest.id,
        createdBy: 'user-1',
      },
      {
        collection: 'pages',
        targetType: 'mergeRequest',
        mergeRequestId: mr.mergeRequest.id,
        createdBy: 'user-1',
      },
    ]);

    const result = await cms.api.pages.listMergeRequests({
      query: { rootId: root.rootId },
    });
    const item = result.mergeRequests.find((m) => m.id === mr.mergeRequest.id)!;
    expect(item.conflictCount).toBe(dbConflicts.length);
    expect(item.commentCount).toBe(2);
  });

  it('excludes soft-deleted comment threads from commentCount', async () => {
    const { cms, db } = await setupTestCMS();
    const { root, mr } = await createConflictingMR(cms, db);

    await db.insert(commentThreads).values([
      {
        collection: 'pages',
        targetType: 'mergeRequest',
        mergeRequestId: mr.mergeRequest.id,
        createdBy: 'user-1',
      },
      {
        collection: 'pages',
        targetType: 'mergeRequest',
        mergeRequestId: mr.mergeRequest.id,
        createdBy: 'user-1',
        deletedAt: new Date(), // soft-deleted → must NOT be counted
      },
    ]);

    const result = await cms.api.pages.listMergeRequests({
      query: { rootId: root.rootId },
    });
    const item = result.mergeRequests.find((m) => m.id === mr.mergeRequest.id)!;
    expect(item.commentCount).toBe(1);
  });

  it('filters by sourceBranchId, targetBranchId, and createdBy', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/filters', properties: { title: 'Page' } },
    });

    const draft = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'draft',
        sourceBranchId: root.branchId,
      },
    });

    const feature = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'feature',
        sourceBranchId: root.branchId,
      },
    });

    await cms.api.pages.createMergeRequest({
      body: {
        title: 'Test MR',
        sourceBranchId: draft.branch.id,
        targetBranchId: root.branchId,
        createdBy: 'alice',
      },
    });

    await cms.api.pages.createMergeRequest({
      body: {
        title: 'Test MR',
        sourceBranchId: feature.branch.id,
        targetBranchId: root.branchId,
        createdBy: 'bob',
      },
    });

    const result = await cms.api.pages.listMergeRequests({
      query: {
        sourceBranchId: feature.branch.id,
        targetBranchId: root.branchId,
        createdBy: 'bob',
      },
    });

    expect(result.mergeRequests).toHaveLength(1);
    expect(result.mergeRequests[0].sourceBranchId).toBe(feature.branch.id);
    expect(result.mergeRequests[0].targetBranchId).toBe(root.branchId);
    expect(result.mergeRequests[0].createdBy).toBe('bob');
    expect(result.total).toBe(1);
    expect(result.hasMore).toBe(false);
  });

  it('reports correct pagination metadata across pages', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/mr-pagination', properties: { title: 'Page' } },
    });

    for (const [index, name] of ['draft', 'feature', 'qa'].entries()) {
      const branch = await cms.api.pages.createBranch({
        body: {
          rootId: root.rootId,
          name,
          sourceBranchId: root.branchId,
        },
      });

      await cms.api.pages.createMergeRequest({
        body: {
          title: 'Test MR',
          sourceBranchId: branch.branch.id,
          targetBranchId: root.branchId,
          createdBy: `user-${index + 1}`,
        },
      });
    }

    const page1 = await cms.api.pages.listMergeRequests({
      query: {
        rootId: root.rootId,
        limit: 2,
        offset: 0,
      },
    });
    const page2 = await cms.api.pages.listMergeRequests({
      query: {
        rootId: root.rootId,
        limit: 2,
        offset: 2,
      },
    });

    expect(page1.mergeRequests).toHaveLength(2);
    expect(page1.total).toBe(3);
    expect(page1.hasMore).toBe(true);
    expect(page2.mergeRequests).toHaveLength(1);
    expect(page2.total).toBe(3);
    expect(page2.hasMore).toBe(false);
  });

  it('returns root enrichment when withRoot is true', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/with-root', properties: { title: 'My Page' } },
    });

    const feature = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'feature-root',
        sourceBranchId: root.branchId,
      },
    });

    await cms.api.pages.createMergeRequest({
      body: {
        sourceBranchId: feature.branch.id,
        targetBranchId: root.branchId,
        title: 'Root enrichment test',
        createdBy: 'user-1',
      },
    });

    const result = await cms.api.pages.listMergeRequests({
      query: { rootId: root.rootId, withRoot: true },
    });

    expect(result.mergeRequests).toHaveLength(1);
    const mr = result.mergeRequests[0];
    expect(mr.root).toBeDefined();
    expect(mr.root!.rootId).toBe(root.rootId);
    expect(mr.root!.slug).toBe('with-root');
    expect(mr.root!.properties).toEqual(
      expect.objectContaining({ title: 'My Page' }),
    );
    expect(typeof mr.root!.hasPublications).toBe('boolean');
    expect(mr.root!.hasPublications).toBe(false);
  });

  it('omits root enrichment when withRoot is not passed', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/no-root', properties: { title: 'Page' } },
    });

    const feature = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'feature-no-root',
        sourceBranchId: root.branchId,
      },
    });

    await cms.api.pages.createMergeRequest({
      body: {
        sourceBranchId: feature.branch.id,
        targetBranchId: root.branchId,
        title: 'No root test',
        createdBy: 'user-1',
      },
    });

    const result = await cms.api.pages.listMergeRequests({
      query: { rootId: root.rootId },
    });

    expect(result.mergeRequests).toHaveLength(1);
    expect(result.mergeRequests[0].root).toBeUndefined();
  });
});

// ============================================================================
// updateMergeRequest
// ============================================================================

describe('updateMergeRequest', () => {
  it('updates title and description of an open merge request', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/update-mr', properties: { title: 'Page' } },
    });

    const feature = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'feature',
        sourceBranchId: root.branchId,
      },
    });

    await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: feature.branch.id,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'New content' },
      },
    });

    const mr = await cms.api.pages.createMergeRequest({
      body: {
        sourceBranchId: feature.branch.id,
        targetBranchId: root.branchId,
        createdBy: 'user-1',
        title: 'Original title',
        description: 'Original description',
      },
    });

    const updated = await cms.api.pages.updateMergeRequest({
      body: {
        mergeRequestId: mr.mergeRequest.id,
        title: 'Updated title',
        description: 'Updated description',
      },
    });

    expect(updated.mergeRequest.title).toBe('Updated title');
    expect(updated.mergeRequest.description).toBe('Updated description');
    expect(updated.mergeRequest.id).toBe(mr.mergeRequest.id);
    expect(updated.mergeRequest.status).toBe('open');
  });

  it('allows partial updates — only title or only description', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/partial-mr', properties: { title: 'Page' } },
    });

    const feature = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'feature',
        sourceBranchId: root.branchId,
      },
    });

    await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: feature.branch.id,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Content' },
      },
    });

    const mr = await cms.api.pages.createMergeRequest({
      body: {
        sourceBranchId: feature.branch.id,
        targetBranchId: root.branchId,
        createdBy: 'user-1',
        title: 'Original',
        description: 'Keep this',
      },
    });

    const updated = await cms.api.pages.updateMergeRequest({
      body: {
        mergeRequestId: mr.mergeRequest.id,
        title: 'New title only',
      },
    });

    expect(updated.mergeRequest.title).toBe('New title only');
    expect(updated.mergeRequest.description).toBe('Keep this');
  });

  it('rejects updating a non-existent merge request', async () => {
    const { cms } = await setupTestCMS();

    await expect(
      cms.api.pages.updateMergeRequest({
        body: {
          mergeRequestId: 'non-existent-id',
          title: 'Nope',
        },
      }),
    ).rejects.toThrow(/merge request not found/i);
  });

  it('rejects updating a merged merge request', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/merged-mr', properties: { title: 'Page' } },
    });

    const feature = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'feature',
        sourceBranchId: root.branchId,
      },
    });

    await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: feature.branch.id,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Content' },
      },
    });

    const mr = await cms.api.pages.createMergeRequest({
      body: {
        title: 'Test MR',
        sourceBranchId: feature.branch.id,
        targetBranchId: root.branchId,
        createdBy: 'user-1',
      },
    });

    await requestAndApproveMerge(cms, mr.mergeRequest.id);

    await cms.api.pages.executeMerge({
      body: {
        mergeRequestId: mr.mergeRequest.id,
        mergedBy: 'user-1',
      },
    });

    await expect(
      cms.api.pages.updateMergeRequest({
        body: {
          mergeRequestId: mr.mergeRequest.id,
          title: 'Too late',
        },
      }),
    ).rejects.toThrow(/not open/i);
  });
});

// ============================================================================
// executeMerge
// ============================================================================

describe('executeMerge', () => {
  it('merges without approval by default (requireApprovalToMerge defaults false)', async () => {
    // The default config does NOT require approval — this is the documented
    // pre-1.0 behavior change. Execute a merge with no approval at all and
    // expect it to succeed. (Set requireApprovalToMerge: true to gate it.)
    const { cms, db } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/no-approval', properties: { title: 'Page' } },
    });

    const draft = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'draft',
        sourceBranchId: root.branchId,
      },
    });

    await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: draft.branch.id,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'New content' },
      },
    });

    const mr = await cms.api.pages.createMergeRequest({
      body: {
        title: 'Test MR',
        sourceBranchId: draft.branch.id,
        targetBranchId: root.branchId,
        createdBy: 'user-1',
      },
    });

    // No requestApproval / approve calls.
    const result = await cms.api.pages.executeMerge({
      body: { mergeRequestId: mr.mergeRequest.id },
    });

    expect(result.fastForward).toBe(true);

    const [mergedMR] = await db
      .select()
      .from(mergeRequests)
      .where(eq(mergeRequests.id, mr.mergeRequest.id));
    expect(mergedMR.status).toBe('merged');
  });

  it('performs a fast-forward merge when target has not diverged', async () => {
    const { cms, db } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/p', properties: { title: 'Page' } },
    });

    const draft = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'draft',
        sourceBranchId: root.branchId,
      },
    });

    const block = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: draft.branch.id,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'New content' },
      },
    });

    const mr = await cms.api.pages.createMergeRequest({
      body: {
        title: 'Test MR',
        sourceBranchId: draft.branch.id,
        targetBranchId: root.branchId,
        createdBy: 'user-1',
      },
    });

    await requestAndApproveMerge(cms, mr.mergeRequest.id);

    const result = await cms.api.pages.executeMerge({
      body: {
        mergeRequestId: mr.mergeRequest.id,
      },
    });

    expect(result.fastForward).toBe(true);
    expect(result.commit.id).toBeDefined();

    // Target branch head should now point to source branch head
    const [targetBranch] = await db
      .select()
      .from(branches)
      .where(eq(branches.id, root.branchId));

    const [sourceBranch] = await db
      .select()
      .from(branches)
      .where(eq(branches.id, draft.branch.id));

    expect(targetBranch.headCommitId).toBe(sourceBranch.headCommitId);

    // MR should be marked as merged
    const [mergedMR] = await db
      .select()
      .from(mergeRequests)
      .where(eq(mergeRequests.id, mr.mergeRequest.id));

    expect(mergedMR.status).toBe('merged');
  });

  it('performs a three-way merge when both sides changed different blocks', async () => {
    const { cms, db } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/p', properties: { title: 'Page' } },
    });

    const blockA = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Block A' },
      },
    });

    const blockB = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Block B' },
      },
    });

    const draft = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'draft',
        sourceBranchId: root.branchId,
      },
    });

    // Source changes block A
    await cms.api.pages.updateBlock({
      body: {
        rootId: root.rootId,
        branchId: draft.branch.id,
        blockId: blockA.blockId,
        type: 'paragraph',
        properties: { text: 'Block A - source edit' },
      },
    });

    // Target changes block B
    await cms.api.pages.updateBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        blockId: blockB.blockId,
        type: 'paragraph',
        properties: { text: 'Block B - target edit' },
      },
    });

    const mr = await cms.api.pages.createMergeRequest({
      body: {
        title: 'Test MR',
        sourceBranchId: draft.branch.id,
        targetBranchId: root.branchId,
        createdBy: 'user-1',
      },
    });

    // Source edited block A, target edited block B — independent edits should
    // produce zero conflicts in a correct three-way merge.
    expect(mr.hasConflicts).toBe(false);
    expect(mr.conflicts).toHaveLength(0);

    await requestAndApproveMerge(cms, mr.mergeRequest.id);

    const result = await cms.api.pages.executeMerge({
      body: {
        mergeRequestId: mr.mergeRequest.id,
        mergedBy: 'user-1',
        message: 'Merge draft edits into main',
      },
    });

    expect(result.fastForward).toBe(false);
    expect(result.commit.id).toBeDefined();

    const [mergeCommit] = await db
      .select()
      .from(commits)
      .where(eq(commits.id, result.commit.id));
    expect(mergeCommit.message).toBe('Merge draft edits into main');

    // Target branch head should point to the merge commit
    const [targetBranch] = await db
      .select()
      .from(branches)
      .where(eq(branches.id, root.branchId));

    expect(targetBranch.headCommitId).toBe(result.commit.id);

    // The merged snapshot should contain the source edit for block A
    const [snapA] = await db
      .select({ blockVersionId: commitSnapshots.blockVersionId })
      .from(commitSnapshots)
      .where(eq(commitSnapshots.commitId, result.commit.id));

    // Verify the merge commit snapshot exists
    const allSnaps = await db
      .select()
      .from(commitSnapshots)
      .where(eq(commitSnapshots.commitId, result.commit.id));

    expect(allSnaps.length).toBeGreaterThan(0);

    // Verify block A has source's version in the merged snapshot
    const blockASnap = allSnaps.find((s) => s.blockId === blockA.blockId);
    expect(blockASnap).toBeDefined();

    const [blockAVersion] = await db
      .select()
      .from(blockVersions)
      .where(eq(blockVersions.id, blockASnap!.blockVersionId));

    expect(blockAVersion.properties).toEqual({
      text: 'Block A - source edit',
    });
  });

  it('rejects when no merge approval exists for the merge request commit', async () => {
    const { cms } = await setupTestCMS({
      branchProtection: { requireApprovalToMerge: true },
    });

    const root = await cms.api.pages.createRoot({
      body: { slug: '/needs-approval', properties: { title: 'Page' } },
    });

    const draft = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'draft',
        sourceBranchId: root.branchId,
      },
    });

    await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: draft.branch.id,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'New content' },
      },
    });

    const mr = await cms.api.pages.createMergeRequest({
      body: {
        title: 'Test MR',
        sourceBranchId: draft.branch.id,
        targetBranchId: root.branchId,
        createdBy: 'user-1',
      },
    });

    await expect(
      cms.api.pages.executeMerge({
        body: {
          mergeRequestId: mr.mergeRequest.id,
        },
      }),
    ).rejects.toThrow(/approval is required before execution/i);
  });

  it('rejects while any requested merge approval is pending or rejected', async () => {
    const { cms } = await setupTestCMS({
      branchProtection: { requireApprovalToMerge: true },
    });

    const root = await cms.api.pages.createRoot({
      body: { slug: '/incomplete-approval', properties: { title: 'Page' } },
    });

    const draft = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'draft',
        sourceBranchId: root.branchId,
      },
    });

    await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: draft.branch.id,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'New content' },
      },
    });

    const mr = await cms.api.pages.createMergeRequest({
      body: {
        title: 'Test MR',
        sourceBranchId: draft.branch.id,
        targetBranchId: root.branchId,
        createdBy: 'user-1',
      },
    });

    const pendingRequest = await cms.api.pages.requestApproval({
      body: {
        mergeRequestId: mr.mergeRequest.id,
        requestedBy: 'requester-1',
        requestedReviewers: ['reviewer-1', 'reviewer-2'],
      },
    });

    await cms.api.pages.approve({
      body: {
        approvalId: pendingRequest.approvals[0].id,
        reviewedBy: pendingRequest.approvals[0].requestedReviewer,
      },
    });

    await expect(
      cms.api.pages.executeMerge({
        body: {
          mergeRequestId: mr.mergeRequest.id,
        },
      }),
    ).rejects.toThrow(/not all requested approvals are approved/i);

    await cms.api.pages.reject({
      body: {
        approvalId: pendingRequest.approvals[1].id,
        reviewedBy: pendingRequest.approvals[1].requestedReviewer,
        rejectionReason: 'Needs changes',
      },
    });

    await expect(
      cms.api.pages.executeMerge({
        body: {
          mergeRequestId: mr.mergeRequest.id,
        },
      }),
    ).rejects.toThrow(/not all requested approvals are approved/i);
  });

  it('rejects when there are unresolved conflicts', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/p', properties: { title: 'Page' } },
    });

    const block = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Original' },
      },
    });

    const draft = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'draft',
        sourceBranchId: root.branchId,
      },
    });

    await cms.api.pages.updateBlock({
      body: {
        rootId: root.rootId,
        branchId: draft.branch.id,
        blockId: block.blockId,
        type: 'paragraph',
        properties: { text: 'Source version' },
      },
    });

    await cms.api.pages.updateBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        blockId: block.blockId,
        type: 'paragraph',
        properties: { text: 'Target version' },
      },
    });

    const mr = await cms.api.pages.createMergeRequest({
      body: {
        title: 'Test MR',
        sourceBranchId: draft.branch.id,
        targetBranchId: root.branchId,
        createdBy: 'user-1',
      },
    });

    expect(mr.hasConflicts).toBe(true);

    await requestAndApproveMerge(cms, mr.mergeRequest.id);

    await expect(
      cms.api.pages.executeMerge({
        body: {
          mergeRequestId: mr.mergeRequest.id,
        },
      }),
    ).rejects.toThrow(/Cannot merge: there are unresolved conflicts/);
  });

  it('rejects when merge request is not open', async () => {
    const { cms, db } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/p', properties: { title: 'Page' } },
    });

    const draft = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'draft',
        sourceBranchId: root.branchId,
      },
    });

    const mr = await cms.api.pages.createMergeRequest({
      body: {
        title: 'Test MR',
        sourceBranchId: draft.branch.id,
        targetBranchId: root.branchId,
        createdBy: 'user-1',
      },
    });

    // Manually close the MR
    await db
      .update(mergeRequests)
      .set({ status: 'closed' })
      .where(eq(mergeRequests.id, mr.mergeRequest.id));

    await expect(
      cms.api.pages.executeMerge({
        body: {
          mergeRequestId: mr.mergeRequest.id,
        },
      }),
    ).rejects.toThrow(/Merge request is not open/);
  });

  it('rejects when merge request does not exist', async () => {
    const { cms } = await setupTestCMS();

    await expect(
      cms.api.pages.executeMerge({
        body: {
          mergeRequestId: 'nonexistent',
        },
      }),
    ).rejects.toThrow(/Merge request not found/);
  });

  it('merges the latest source branch head even when commits were added after MR creation', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/live-mr', properties: { title: 'Page' } },
    });

    const draft = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'draft',
        sourceBranchId: root.branchId,
      },
    });

    await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: draft.branch.id,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'First change' },
      },
    });

    const mr = await cms.api.pages.createMergeRequest({
      body: {
        title: 'Test MR',
        sourceBranchId: draft.branch.id,
        targetBranchId: root.branchId,
        createdBy: 'user-1',
      },
    });

    // Push more commits to the source branch after MR creation
    const laterBlock = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: draft.branch.id,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Second change (post-MR)' },
      },
    });

    await requestAndApproveMerge(cms, mr.mergeRequest.id);

    const result = await cms.api.pages.executeMerge({
      body: {
        mergeRequestId: mr.mergeRequest.id,
        mergedBy: 'user-1',
      },
    });

    expect(result.fastForward).toBe(true);

    // The target branch should now include the later block
    const { tree } = await cms.api.pages.getBlockTree({
      query: {
        rootId: root.rootId,
        branchId: root.branchId,
      },
    });

    const laterChild = tree.children.find(
      (c: any) => c.blockId === laterBlock.blockId,
    );
    expect(laterChild).toBeDefined();
    expect((laterChild!.properties as { text: string }).text).toBe(
      'Second change (post-MR)',
    );
  });

  it('verifies merged snapshot contains correct block versions from both sides', async () => {
    const { cms, db } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/p', properties: { title: 'Page' } },
    });

    // Create two blocks on main
    const blockA = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'A original' },
      },
    });

    const blockB = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'B original' },
      },
    });

    // Create a third block that won't be changed (should survive merge)
    const blockC = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'C unchanged' },
      },
    });

    const draft = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'draft',
        sourceBranchId: root.branchId,
      },
    });

    // Source edits block A only
    await cms.api.pages.updateBlock({
      body: {
        rootId: root.rootId,
        branchId: draft.branch.id,
        blockId: blockA.blockId,
        type: 'paragraph',
        properties: { text: 'A from source' },
      },
    });

    // Target edits block B only
    await cms.api.pages.updateBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        blockId: blockB.blockId,
        type: 'paragraph',
        properties: { text: 'B from target' },
      },
    });

    const mr = await cms.api.pages.createMergeRequest({
      body: {
        title: 'Test MR',
        sourceBranchId: draft.branch.id,
        targetBranchId: root.branchId,
        createdBy: 'user-1',
      },
    });

    // Source edited block A, target edited block B — independent edits should
    // produce zero conflicts in a correct three-way merge.
    expect(mr.hasConflicts).toBe(false);
    expect(mr.conflicts).toHaveLength(0);

    await requestAndApproveMerge(cms, mr.mergeRequest.id);

    const result = await cms.api.pages.executeMerge({
      body: {
        mergeRequestId: mr.mergeRequest.id,
        mergedBy: 'user-1',
      },
    });

    expect(result.fastForward).toBe(false);

    // Load the merged snapshot
    const snaps = await db
      .select()
      .from(commitSnapshots)
      .where(eq(commitSnapshots.commitId, result.commit.id));

    // Block A should have source's version
    const snapA = snaps.find((s) => s.blockId === blockA.blockId);
    expect(snapA).toBeDefined();
    const [versionA] = await db
      .select()
      .from(blockVersions)
      .where(eq(blockVersions.id, snapA!.blockVersionId));
    expect(versionA.properties).toEqual({ text: 'A from source' });

    // Block B should have target's version
    const snapB = snaps.find((s) => s.blockId === blockB.blockId);
    expect(snapB).toBeDefined();
    const [versionB] = await db
      .select()
      .from(blockVersions)
      .where(eq(blockVersions.id, snapB!.blockVersionId));
    expect(versionB.properties).toEqual({ text: 'B from target' });

    // Block C should still be present (unchanged)
    const snapC = snaps.find((s) => s.blockId === blockC.blockId);
    expect(snapC).toBeDefined();
    const [versionC] = await db
      .select()
      .from(blockVersions)
      .where(eq(blockVersions.id, snapC!.blockVersionId));
    expect(versionC.properties).toEqual({ text: 'C unchanged' });
  });
});

// ============================================================================
// Merge strategy: fast-forward vs merge-commit
// ============================================================================

describe('executeMerge — merge strategy (fast-forward vs merge-commit)', () => {
  // A draft branch strictly ahead of the default branch → a fast-forward IS
  // possible (the target has not diverged), plus an open merge request.
  async function setupFastForwardable(
    cms: Awaited<ReturnType<typeof setupTestCMS>>['cms'],
  ) {
    const root = await cms.api.pages.createRoot({
      body: { slug: '/p', properties: { title: 'Page' } },
    });
    const draft = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'draft',
        sourceBranchId: root.branchId,
      },
    });
    await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: draft.branch.id,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'New content' },
      },
    });
    const mr = await cms.api.pages.createMergeRequest({
      body: {
        title: 'MR',
        sourceBranchId: draft.branch.id,
        targetBranchId: root.branchId,
        createdBy: 'user-1',
      },
    });
    return { root, draft, mr };
  }

  it('default config fast-forwards (no merge commit)', async () => {
    const { cms } = await setupTestCMS();
    const { mr } = await setupFastForwardable(cms);
    const result = await cms.api.pages.executeMerge({
      body: { mergeRequestId: mr.mergeRequest.id },
    });
    expect(result.fastForward).toBe(true);
    expect(result.commit.id).toBeDefined();
  });

  it("mergeStrategy: 'merge-commit' forces a merge commit even when fast-forward is possible", async () => {
    const { cms, db } = await setupTestCMS({ mergeStrategy: 'merge-commit' });
    const { root, mr } = await setupFastForwardable(cms);
    const result = await cms.api.pages.executeMerge({
      body: { mergeRequestId: mr.mergeRequest.id },
    });
    expect(result.fastForward).toBe(false);
    expect(result.commit.id).toBeDefined();

    // The target head advances to the merge commit, which records the source as
    // its merge parent — and the merged tree still carries the source's content.
    const [target] = await db
      .select()
      .from(branches)
      .where(eq(branches.id, root.branchId));
    expect(target.headCommitId).toBe(result.commit.id);
    const [mergeCommit] = await db
      .select()
      .from(commits)
      .where(eq(commits.id, result.commit.id));
    expect(mergeCommit.mergeSourceCommitId).toBeTruthy();

    const tree = await cms.api.pages.getBlockTree({
      query: { rootId: root.rootId, branchId: root.branchId },
    });
    expect(tree.tree.children).toHaveLength(1);
  });

  it('per-call noFastForward: true forces a merge commit under the default strategy', async () => {
    const { cms } = await setupTestCMS();
    const { mr } = await setupFastForwardable(cms);
    const result = await cms.api.pages.executeMerge({
      body: { mergeRequestId: mr.mergeRequest.id, noFastForward: true },
    });
    expect(result.fastForward).toBe(false);
    expect(result.commit.id).toBeDefined();
  });

  it('per-call noFastForward: false overrides mergeStrategy: merge-commit (forces fast-forward)', async () => {
    const { cms } = await setupTestCMS({ mergeStrategy: 'merge-commit' });
    const { mr } = await setupFastForwardable(cms);
    const result = await cms.api.pages.executeMerge({
      body: { mergeRequestId: mr.mergeRequest.id, noFastForward: false },
    });
    expect(result.fastForward).toBe(true);
    expect(result.commit.id).toBeDefined();
  });

  it('nothing to merge stays a no-op fast-forward under merge-commit strategy (no empty commit)', async () => {
    const { cms } = await setupTestCMS({ mergeStrategy: 'merge-commit' });
    const root = await cms.api.pages.createRoot({
      body: { slug: '/p', properties: { title: 'Page' } },
    });
    // A draft forked from the default branch with NO changes → both heads equal.
    const draft = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'draft',
        sourceBranchId: root.branchId,
      },
    });
    const mr = await cms.api.pages.createMergeRequest({
      body: {
        title: 'MR',
        sourceBranchId: draft.branch.id,
        targetBranchId: root.branchId,
        createdBy: 'user-1',
      },
    });

    // Even with merge-commit strategy AND noFastForward, an empty merge must not
    // fabricate a commit — heads are already equal.
    const result = await cms.api.pages.executeMerge({
      body: { mergeRequestId: mr.mergeRequest.id, noFastForward: true },
    });
    expect(result.fastForward).toBe(true);
    expect(result.commit.id).toBeDefined();
  });
});

// ============================================================================
// Cross-root validation
// ============================================================================

describe('cross-root validation', () => {
  it('getDiff rejects branches from different roots', async () => {
    const { cms } = await setupTestCMS();

    const root1 = await cms.api.pages.createRoot({
      body: { slug: '/root-1', properties: { title: 'Root 1' } },
    });
    const root2 = await cms.api.pages.createRoot({
      body: { slug: '/root-2', properties: { title: 'Root 2' } },
    });

    await expect(
      cms.api.pages.getDiff({
        query: {
          sourceBranchId: root1.branchId,
          targetBranchId: root2.branchId,
        },
      }),
    ).rejects.toThrow(/same root/i);
  });

  it('checkConflicts rejects branches from different roots', async () => {
    const { cms } = await setupTestCMS();

    const root1 = await cms.api.pages.createRoot({
      body: { slug: '/root-1', properties: { title: 'Root 1' } },
    });
    const root2 = await cms.api.pages.createRoot({
      body: { slug: '/root-2', properties: { title: 'Root 2' } },
    });

    await expect(
      cms.api.pages.checkConflicts({
        query: {
          sourceBranchId: root1.branchId,
          targetBranchId: root2.branchId,
        },
      }),
    ).rejects.toThrow(/same root/i);
  });

  it('createMergeRequest rejects branches from different roots', async () => {
    const { cms } = await setupTestCMS();

    const root1 = await cms.api.pages.createRoot({
      body: { slug: '/root-1', properties: { title: 'Root 1' } },
    });
    const root2 = await cms.api.pages.createRoot({
      body: { slug: '/root-2', properties: { title: 'Root 2' } },
    });

    await expect(
      cms.api.pages.createMergeRequest({
        body: {
          title: 'Test MR',
          sourceBranchId: root1.branchId,
          targetBranchId: root2.branchId,
          createdBy: 'user-1',
        },
      }),
    ).rejects.toThrow(/same root/i);
  });
});

// ============================================================================
// Delete-vs-modify conflicts
// ============================================================================

describe('delete-vs-modify conflicts', () => {
  it('detects a conflict when source deletes a block that target modified', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/dvm', properties: { title: 'Page' } },
    });

    const block = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Original' },
      },
    });

    const feature = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'feature',
        sourceBranchId: root.branchId,
      },
    });

    await cms.api.pages.deleteBlock({
      body: {
        rootId: root.rootId,
        branchId: feature.branch.id,
        blockId: block.blockId,
      },
    });

    await cms.api.pages.updateBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        blockId: block.blockId,
        type: 'paragraph',
        properties: { text: 'Modified on main' },
      },
    });

    const result = await cms.api.pages.checkConflicts({
      query: {
        sourceBranchId: feature.branch.id,
        targetBranchId: root.branchId,
      },
    });

    expect(result.hasConflicts).toBe(true);
    const conflict = result.conflicts.find(
      (c: any) => c.blockId === block.blockId,
    );
    expect(conflict).toBeDefined();
    expect(conflict!.sourceVersionId).not.toBe(conflict!.targetVersionId);
  });
});

// ============================================================================
// resolveConflicts
// ============================================================================

let conflictCounter = 0;
async function createConflictingMR(cms: any, db: any) {
  const root = await cms.api.pages.createRoot({
    body: { slug: `/rc-${++conflictCounter}`, properties: { title: 'Page' } },
  });

  const block = await cms.api.pages.createBlock({
    body: {
      rootId: root.rootId,
      branchId: root.branchId,
      parentBlockId: root.rootId,
      type: 'paragraph',
      properties: { text: 'Original' },
    },
  });

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
      properties: { text: 'Source edit' },
    },
  });

  await cms.api.pages.updateBlock({
    body: {
      rootId: root.rootId,
      branchId: root.branchId,
      blockId: block.blockId,
      type: 'paragraph',
      properties: { text: 'Target edit' },
    },
  });

  const mr = await cms.api.pages.createMergeRequest({
    body: {
      title: 'Test MR',
      sourceBranchId: feature.branch.id,
      targetBranchId: root.branchId,
      createdBy: 'user-1',
    },
  });

  expect(mr.hasConflicts).toBe(true);

  const dbConflicts = await db
    .select()
    .from(mergeConflicts)
    .where(eq(mergeConflicts.mergeRequestId, mr.mergeRequest.id));

  return { root, block, feature, mr, dbConflicts };
}

describe('resolveConflicts', () => {
  it('resolves a conflict with source resolution', async () => {
    const { cms, db } = await setupTestCMS();
    const { mr, dbConflicts } = await createConflictingMR(cms, db);

    const result = await cms.api.pages.resolveConflicts({
      body: {
        mergeRequestId: mr.mergeRequest.id,
        resolutions: [
          {
            conflictId: dbConflicts[0].id,
            resolution: 'source',
            resolvedBy: 'user-1',
          },
        ],
      },
    });

    expect(result.resolved).toHaveLength(1);
    expect(result.resolved[0].resolution).toBe('source');
    expect(result.resolved[0].resolvedBy).toBe('user-1');
    expect(result.resolved[0].resolvedVersionId).toBe(
      dbConflicts[0].sourceVersionId,
    );
    expect(result.resolved[0].resolvedAt).toBeInstanceOf(Date);
  });

  it('resolves a conflict with target resolution', async () => {
    const { cms, db } = await setupTestCMS();
    const { mr, dbConflicts } = await createConflictingMR(cms, db);

    const result = await cms.api.pages.resolveConflicts({
      body: {
        mergeRequestId: mr.mergeRequest.id,
        resolutions: [
          {
            conflictId: dbConflicts[0].id,
            resolution: 'target',
            resolvedBy: 'user-1',
          },
        ],
      },
    });

    expect(result.resolved).toHaveLength(1);
    expect(result.resolved[0].resolution).toBe('target');
    expect(result.resolved[0].resolvedVersionId).toBe(
      dbConflicts[0].targetVersionId,
    );
  });

  it('resolves a conflict with manual resolution using an existing block version', async () => {
    const { cms, db } = await setupTestCMS();
    const { mr, dbConflicts } = await createConflictingMR(cms, db);

    // Use the base version as the manual resolution
    const manualVersionId = dbConflicts[0].baseVersionId!;

    const result = await cms.api.pages.resolveConflicts({
      body: {
        mergeRequestId: mr.mergeRequest.id,
        resolutions: [
          {
            conflictId: dbConflicts[0].id,
            resolution: 'manual',
            resolvedVersionId: manualVersionId,
            resolvedBy: 'user-1',
          },
        ],
      },
    });

    expect(result.resolved).toHaveLength(1);
    expect(result.resolved[0].resolution).toBe('manual');
    expect(result.resolved[0].resolvedVersionId).toBe(manualVersionId);
  });

  it('reports remaining unresolved conflicts', async () => {
    const { cms, db } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/rc2', properties: { title: 'Page' } },
    });

    const blockA = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'A' },
      },
    });

    const blockB = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'B' },
      },
    });

    const feature = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'feature',
        sourceBranchId: root.branchId,
      },
    });

    // Both sides edit both blocks
    await cms.api.pages.updateBlock({
      body: {
        rootId: root.rootId,
        branchId: feature.branch.id,
        blockId: blockA.blockId,
        type: 'paragraph',
        properties: { text: 'A source' },
      },
    });
    await cms.api.pages.updateBlock({
      body: {
        rootId: root.rootId,
        branchId: feature.branch.id,
        blockId: blockB.blockId,
        type: 'paragraph',
        properties: { text: 'B source' },
      },
    });
    await cms.api.pages.updateBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        blockId: blockA.blockId,
        type: 'paragraph',
        properties: { text: 'A target' },
      },
    });
    await cms.api.pages.updateBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        blockId: blockB.blockId,
        type: 'paragraph',
        properties: { text: 'B target' },
      },
    });

    const mr = await cms.api.pages.createMergeRequest({
      body: {
        title: 'Test MR',
        sourceBranchId: feature.branch.id,
        targetBranchId: root.branchId,
        createdBy: 'user-1',
      },
    });

    expect(mr.hasConflicts).toBe(true);

    const dbConflicts = await db
      .select()
      .from(mergeConflicts)
      .where(eq(mergeConflicts.mergeRequestId, mr.mergeRequest.id));

    expect(dbConflicts.length).toBeGreaterThanOrEqual(2);

    // Resolve only the first conflict
    const result = await cms.api.pages.resolveConflicts({
      body: {
        mergeRequestId: mr.mergeRequest.id,
        resolutions: [
          {
            conflictId: dbConflicts[0].id,
            resolution: 'source',
            resolvedBy: 'user-1',
          },
        ],
      },
    });

    expect(result.resolved).toHaveLength(1);
    expect(result.remainingUnresolved).toBeGreaterThanOrEqual(1);
  });

  it('rejects when merge request is not open', async () => {
    const { cms, db } = await setupTestCMS();
    const { mr, dbConflicts } = await createConflictingMR(cms, db);

    // Close the MR by updating status directly
    await db
      .update(mergeRequests)
      .set({ status: 'closed' })
      .where(eq(mergeRequests.id, mr.mergeRequest.id));

    await expect(
      cms.api.pages.resolveConflicts({
        body: {
          mergeRequestId: mr.mergeRequest.id,
          resolutions: [
            {
              conflictId: dbConflicts[0].id,
              resolution: 'source',
              resolvedBy: 'user-1',
            },
          ],
        },
      }),
    ).rejects.toThrow(/not open/);
  });

  it('rejects when conflict does not belong to the merge request', async () => {
    const { cms, db } = await setupTestCMS();
    await createConflictingMR(cms, db);

    // Create a second conflicting MR
    const { mr: mr2 } = await createConflictingMR(cms, db);

    // Get conflicts from the first MR
    const firstMRConflicts = await db
      .select()
      .from(mergeConflicts)
      .where(
        eq(
          mergeConflicts.mergeRequestId,
          (await db.select().from(mergeRequests)).find(
            (m) => m.id !== mr2.mergeRequest.id,
          )!.id,
        ),
      );

    await expect(
      cms.api.pages.resolveConflicts({
        body: {
          mergeRequestId: mr2.mergeRequest.id,
          resolutions: [
            {
              conflictId: firstMRConflicts[0].id,
              resolution: 'source',
              resolvedBy: 'user-1',
            },
          ],
        },
      }),
    ).rejects.toThrow(/conflict not found/i);
  });

  it('rejects manual resolution without a resolvedVersionId', async () => {
    const { cms, db } = await setupTestCMS();
    const { mr, dbConflicts } = await createConflictingMR(cms, db);

    await expect(
      cms.api.pages.resolveConflicts({
        body: {
          mergeRequestId: mr.mergeRequest.id,
          resolutions: [
            {
              conflictId: dbConflicts[0].id,
              resolution: 'manual',
              resolvedBy: 'user-1',
            },
          ],
        },
      }),
    ).rejects.toThrow(/resolvedVersionId/i);
  });

  it('rejects manual resolution with a non-existent block version', async () => {
    const { cms, db } = await setupTestCMS();
    const { mr, dbConflicts } = await createConflictingMR(cms, db);

    await expect(
      cms.api.pages.resolveConflicts({
        body: {
          mergeRequestId: mr.mergeRequest.id,
          resolutions: [
            {
              conflictId: dbConflicts[0].id,
              resolution: 'manual',
              resolvedVersionId: 'nonexistent-version-id',
              resolvedBy: 'user-1',
            },
          ],
        },
      }),
    ).rejects.toThrow(/resolvedVersionId/i);
  });

  it('allows re-resolving an already resolved conflict', async () => {
    const { cms, db } = await setupTestCMS();
    const { mr, dbConflicts } = await createConflictingMR(cms, db);

    // First resolution: source
    await cms.api.pages.resolveConflicts({
      body: {
        mergeRequestId: mr.mergeRequest.id,
        resolutions: [
          {
            conflictId: dbConflicts[0].id,
            resolution: 'source',
            resolvedBy: 'user-1',
          },
        ],
      },
    });

    // Re-resolve: target
    const result = await cms.api.pages.resolveConflicts({
      body: {
        mergeRequestId: mr.mergeRequest.id,
        resolutions: [
          {
            conflictId: dbConflicts[0].id,
            resolution: 'target',
            resolvedBy: 'user-2',
          },
        ],
      },
    });

    expect(result.resolved[0].resolution).toBe('target');
    expect(result.resolved[0].resolvedBy).toBe('user-2');
    expect(result.resolved[0].resolvedVersionId).toBe(
      dbConflicts[0].targetVersionId,
    );
  });

  it('resolves all conflicts then allows executeMerge to succeed', async () => {
    const { cms, db } = await setupTestCMS();
    const { mr, dbConflicts } = await createConflictingMR(cms, db);

    // Resolve all conflicts
    await cms.api.pages.resolveConflicts({
      body: {
        mergeRequestId: mr.mergeRequest.id,
        resolutions: dbConflicts.map((c: any) => ({
          conflictId: c.id,
          resolution: 'source' as const,
          resolvedBy: 'user-1',
        })),
      },
    });

    await requestAndApproveMerge(cms, mr.mergeRequest.id);

    const result = await cms.api.pages.executeMerge({
      body: {
        mergeRequestId: mr.mergeRequest.id,
        mergedBy: 'user-1',
      },
    });

    expect(result.fastForward).toBe(false);
    expect(result.commit.id).toBeDefined();
  });
});

// ============================================================================
// createMergeBlockVersion
// ============================================================================

describe('createMergeBlockVersion', () => {
  it('creates a custom block version for a conflicting block', async () => {
    const { cms, db } = await setupTestCMS();
    const { mr, block } = await createConflictingMR(cms, db);

    const { blockVersionId } = await cms.api.pages.createMergeBlockVersion({
      body: {
        mergeRequestId: mr.mergeRequest.id,
        blockId: block.blockId,
        type: 'paragraph',
        properties: { text: 'Manually merged content' },
      },
    });

    expect(blockVersionId).toBeDefined();

    const [version] = await db
      .select()
      .from(blockVersions)
      .where(eq(blockVersions.id, blockVersionId));

    expect(version.blockId).toBe(block.blockId);
    expect(version.properties).toEqual({ text: 'Manually merged content' });
    expect(version.type).toBe('paragraph');
  });

  it('rejects when the block is not in conflict for the MR', async () => {
    const { cms, db } = await setupTestCMS();
    const { mr } = await createConflictingMR(cms, db);

    await expect(
      cms.api.pages.createMergeBlockVersion({
        body: {
          mergeRequestId: mr.mergeRequest.id,
          blockId: 'nonexistent-block',
          type: 'paragraph',
          properties: { text: 'whatever' },
        },
      }),
    ).rejects.toThrow(/conflict not found/i);
  });

  it('rejects when the merge request is not open', async () => {
    const { cms, db } = await setupTestCMS();
    const { mr, block } = await createConflictingMR(cms, db);

    await db
      .update(mergeRequests)
      .set({ status: 'closed' })
      .where(eq(mergeRequests.id, mr.mergeRequest.id));

    await expect(
      cms.api.pages.createMergeBlockVersion({
        body: {
          mergeRequestId: mr.mergeRequest.id,
          blockId: block.blockId,
          type: 'paragraph',
          properties: { text: 'whatever' },
        },
      }),
    ).rejects.toThrow(/not open/i);
  });

  it('end-to-end: create custom version, resolve with it, then merge', async () => {
    const { cms, db } = await setupTestCMS();
    const { mr, block, dbConflicts } = await createConflictingMR(cms, db);

    // Step 1: Create a custom merged version
    const { blockVersionId } = await cms.api.pages.createMergeBlockVersion({
      body: {
        mergeRequestId: mr.mergeRequest.id,
        blockId: block.blockId,
        type: 'paragraph',
        properties: { text: 'Best of both: source + target' },
      },
    });

    // Step 2: Resolve all conflicts using the custom version
    const blockConflict = dbConflicts.find((c: any) => c.blockId === block.blockId)!;
    const otherConflicts = dbConflicts.filter(
      (c: any) => c.blockId !== block.blockId,
    );

    await cms.api.pages.resolveConflicts({
      body: {
        mergeRequestId: mr.mergeRequest.id,
        resolutions: [
          {
            conflictId: blockConflict.id,
            resolution: 'manual',
            resolvedVersionId: blockVersionId,
            resolvedBy: 'user-1',
          },
          ...otherConflicts.map((c: any) => ({
            conflictId: c.id,
            resolution: 'source' as const,
            resolvedBy: 'user-1',
          })),
        ],
      },
    });

    // Step 3: Approve and merge
    await requestAndApproveMerge(cms, mr.mergeRequest.id);

    const result = await cms.api.pages.executeMerge({
      body: {
        mergeRequestId: mr.mergeRequest.id,
        mergedBy: 'user-1',
      },
    });

    expect(result.fastForward).toBe(false);
    expect(result.commit.id).toBeDefined();

    // Verify the merged snapshot contains the custom version
    const snaps = await db
      .select()
      .from(commitSnapshots)
      .where(eq(commitSnapshots.commitId, result.commit.id));

    const blockSnap = snaps.find((s) => s.blockId === block.blockId);
    expect(blockSnap).toBeDefined();
    expect(blockSnap!.blockVersionId).toBe(blockVersionId);
  });

  it('indexes asset references of a manually-resolved version, so the GC keeps the asset (third insert-site regression)', async () => {
    const { cms, db } = await setupTestCMS({
      dataRetention: { keepDays: 7, keepMinCommits: 1, archiveKeepDays: 7 },
    });
    const { mr, block, dbConflicts } = await createConflictingMR(cms, db);

    const [asset] = await db
      .insert(assets)
      .values({
        slug: 'merge.png',
        mimeType: 'image/png',
        size: 1,
        objectKey: 'merge.png',
      })
      .returning();

    // Resolve the conflict with a custom version that EMBEDS the asset. This is
    // the one block-version insert outside commit-writer; it must still index the
    // reference, or the merged-live asset would be invisible to the GC.
    const { blockVersionId } = await cms.api.pages.createMergeBlockVersion({
      body: {
        mergeRequestId: mr.mergeRequest.id,
        blockId: block.blockId,
        type: 'paragraph',
        properties: { text: asset.id },
      },
    });

    // The reference is recorded against the resolved version immediately.
    const refs = await db
      .select()
      .from(contentUsages)
      .where(
        and(
          eq(contentUsages.targetKind, 'asset'),
          eq(contentUsages.blockVersionId, blockVersionId),
        ),
      );
    expect(refs).toHaveLength(1);
    expect(refs[0].targetKey).toBe(asset.id);

    // Drive the resolved version to the live head via a real merge.
    const blockConflict = dbConflicts.find((c: any) => c.blockId === block.blockId)!;
    const otherConflicts = dbConflicts.filter(
      (c: any) => c.blockId !== block.blockId,
    );
    await cms.api.pages.resolveConflicts({
      body: {
        mergeRequestId: mr.mergeRequest.id,
        resolutions: [
          {
            conflictId: blockConflict.id,
            resolution: 'manual',
            resolvedVersionId: blockVersionId,
            resolvedBy: 'user-1',
          },
          ...otherConflicts.map((c: any) => ({
            conflictId: c.id,
            resolution: 'source' as const,
            resolvedBy: 'user-1',
          })),
        ],
      },
    });
    await requestAndApproveMerge(cms, mr.mergeRequest.id);
    await cms.api.pages.executeMerge({
      body: { mergeRequestId: mr.mergeRequest.id, mergedBy: 'user-1' },
    });

    // Archive + age the asset, then GC. The merged version is now the live head
    // and references the asset, so it must be kept (not deleted out from under
    // the page).
    await db
      .update(assets)
      .set({ archivedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) })
      .where(eq(assets.id, asset.id));

    const result = await cms.api.admin.runPruning({ body: { dryRun: false } });
    expect(result.deletedAssets).not.toContain(asset.id);

    const [row] = await db.select().from(assets).where(eq(assets.id, asset.id));
    expect(row).toBeDefined();
  });
});

// ============================================================================
// closeMergeRequest / reopenMergeRequest
// ============================================================================

async function setupOpenMergeRequest() {
  const ctx = await setupTestCMS();
  const { cms } = ctx;

  const root = await cms.api.pages.createRoot({
    body: { slug: '/p', properties: { title: 'Page' } },
  });
  const draft = await cms.api.pages.createBranch({
    body: { rootId: root.rootId, name: 'draft', sourceBranchId: root.branchId },
  });
  await cms.api.pages.createBlock({
    body: {
      rootId: root.rootId,
      branchId: draft.branch.id,
      parentBlockId: root.rootId,
      type: 'paragraph',
      properties: { text: 'New block' },
    },
  });
  const mr = await cms.api.pages.createMergeRequest({
    body: {
      sourceBranchId: draft.branch.id,
      targetBranchId: root.branchId,
      title: 'MR',
      createdBy: 'user-1',
    },
  });

  return { ...ctx, root, draft, mergeRequestId: mr.mergeRequest.id };
}

describe('closeMergeRequest', () => {
  it('closes an open merge request', async () => {
    const { cms, db, mergeRequestId } = await setupOpenMergeRequest();

    const updated = await cms.api.pages.closeMergeRequest({
      body: { mergeRequestId },
    });
    expect(updated.mergeRequest.status).toBe('closed');

    const [mr] = await db
      .select()
      .from(mergeRequests)
      .where(eq(mergeRequests.id, mergeRequestId));
    expect(mr.status).toBe('closed');
    expect(mr.mergeCommitId).toBeNull();
  });

  it('rejects closing a non-open merge request', async () => {
    const { cms, mergeRequestId } = await setupOpenMergeRequest();
    await cms.api.pages.closeMergeRequest({ body: { mergeRequestId } });

    await expect(
      cms.api.pages.closeMergeRequest({ body: { mergeRequestId } }),
    ).rejects.toThrow(/not open/i);
  });
});

describe('reopenMergeRequest', () => {
  it('reopens a closed merge request', async () => {
    const { cms, db, mergeRequestId } = await setupOpenMergeRequest();
    await cms.api.pages.closeMergeRequest({ body: { mergeRequestId } });

    const updated = await cms.api.pages.reopenMergeRequest({
      body: { mergeRequestId },
    });
    expect(updated.mergeRequest.status).toBe('open');

    const [mr] = await db
      .select()
      .from(mergeRequests)
      .where(eq(mergeRequests.id, mergeRequestId));
    expect(mr.status).toBe('open');
  });

  it('rejects reopening an already-open merge request', async () => {
    const { cms, mergeRequestId } = await setupOpenMergeRequest();
    await expect(
      cms.api.pages.reopenMergeRequest({ body: { mergeRequestId } }),
    ).rejects.toThrow(/not closed/i);
  });

  it('rejects reopening a merged merge request', async () => {
    const { cms, db, mergeRequestId } = await setupOpenMergeRequest();
    await db
      .update(mergeRequests)
      .set({ status: 'merged' })
      .where(eq(mergeRequests.id, mergeRequestId));

    await expect(
      cms.api.pages.reopenMergeRequest({ body: { mergeRequestId } }),
    ).rejects.toThrow(/already been merged/i);
  });

  it('rejects reopening when another open MR exists for the same branches', async () => {
    const { cms, draft, root, mergeRequestId } = await setupOpenMergeRequest();
    await cms.api.pages.closeMergeRequest({ body: { mergeRequestId } });

    await cms.api.pages.createMergeRequest({
      body: {
        sourceBranchId: draft.branch.id,
        targetBranchId: root.branchId,
        title: 'MR2',
        createdBy: 'user-1',
      },
    });

    await expect(
      cms.api.pages.reopenMergeRequest({ body: { mergeRequestId } }),
    ).rejects.toThrow(/already exists/i);
  });
});
