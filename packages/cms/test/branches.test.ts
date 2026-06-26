import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  branches,
  commitSnapshots,
  commits,
  mergeRequests,
  publications,
} from '../src/schema';
import { setupTestCMS } from './utils/cms';
import { requestAndApproveMerge } from './utils/helpers';

describe('createBranch', () => {
  it('creates a branch pointing at the source branch head commit', async () => {
    const { cms, db } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/', properties: { title: 'Home' } },
    });

    const result = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'draft',
        sourceBranchId: root.branchId,
      },
    });

    expect(result.branchId).toBeDefined();
    expect(result.headCommitId).toBe(root.commitId);

    const [branch] = await db
      .select()
      .from(branches)
      .where(eq(branches.id, result.branchId));

    expect(branch.name).toBe('draft');
    expect(branch.rootId).toBe(root.rootId);
    expect(branch.headCommitId).toBe(root.commitId);
    expect(branch.createdBy).toBeNull();
  });

  it('stores createdBy when provided', async () => {
    const { cms, db } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/page', properties: { title: 'Page' } },
    });

    const result = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'user-branch',
        sourceBranchId: root.branchId,
        createdBy: 'user-42',
      },
    });

    const [branch] = await db
      .select()
      .from(branches)
      .where(eq(branches.id, result.branchId));

    expect(branch.createdBy).toBe('user-42');
  });

  it('uses middleware userId when createdBy is omitted', async () => {
    const { cms, db } = await setupTestCMS({
      middleware: async () => ({ userId: 'middleware-user' }),
    });

    const root = await cms.api.pages.createRoot({
      body: { slug: '/page', properties: { title: 'Page' } },
    });

    const result = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'middleware-branch',
        sourceBranchId: root.branchId,
      },
    });

    const [branch] = await db
      .select()
      .from(branches)
      .where(eq(branches.id, result.branchId));

    expect(branch.createdBy).toBe('middleware-user');
  });

  it('uses authMiddleware userId when createdBy is omitted', async () => {
    const { cms, db } = await setupTestCMS({
      authMiddleware: async () => ({ userId: 'auth-middleware-user' }),
    });

    const root = await cms.api.pages.createRoot({
      body: { slug: '/page', properties: { title: 'Page' } },
    });

    const result = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'auth-middleware-branch',
        sourceBranchId: root.branchId,
      },
    });

    const [branch] = await db
      .select()
      .from(branches)
      .where(eq(branches.id, result.branchId));

    expect(branch.createdBy).toBe('auth-middleware-user');
  });

  it('forks from a non-main branch at its current head', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/p', properties: { title: 'Page' } },
    });

    // Advance main by adding a block
    const block = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Hello' },
      },
    });

    // Fork from main (now at block.commitId, not root.commitId)
    const draft = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'draft',
        sourceBranchId: root.branchId,
      },
    });

    expect(draft.headCommitId).toBe(block.commitId);

    // Fork from draft (should also be at block.commitId)
    const feature = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'feature',
        sourceBranchId: draft.branchId,
      },
    });

    expect(feature.headCommitId).toBe(block.commitId);
  });

  it('rejects creating a branch with a duplicate name for the same root', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/p', properties: { title: 'Page' } },
    });

    await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'draft',
        sourceBranchId: root.branchId,
      },
    });

    await expect(
      cms.api.pages.createBranch({
        body: {
          rootId: root.rootId,
          name: 'draft',
          sourceBranchId: root.branchId,
        },
      }),
    ).rejects.toThrow(/A branch with this name already exists/);
  });

  it('allows the same branch name on different roots', async () => {
    const { cms } = await setupTestCMS();

    const rootA = await cms.api.pages.createRoot({
      body: { slug: '/a', properties: { title: 'Page A' } },
    });

    const rootB = await cms.api.pages.createRoot({
      body: { slug: '/b', properties: { title: 'Page B' } },
    });

    const branchA = await cms.api.pages.createBranch({
      body: {
        rootId: rootA.rootId,
        name: 'draft',
        sourceBranchId: rootA.branchId,
      },
    });

    const branchB = await cms.api.pages.createBranch({
      body: {
        rootId: rootB.rootId,
        name: 'draft',
        sourceBranchId: rootB.branchId,
      },
    });

    expect(branchA.branchId).not.toBe(branchB.branchId);
  });

  it('rejects when source branch does not exist', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/p', properties: { title: 'Page' } },
    });

    await expect(
      cms.api.pages.createBranch({
        body: {
          rootId: root.rootId,
          name: 'draft',
          sourceBranchId: 'nonexistent-branch-id',
        },
      }),
    ).rejects.toThrow(/Branch not found/);
  });

  it('rejects when source branch belongs to a different root', async () => {
    const { cms } = await setupTestCMS();

    const rootA = await cms.api.pages.createRoot({
      body: { slug: '/a', properties: { title: 'Page A' } },
    });

    const rootB = await cms.api.pages.createRoot({
      body: { slug: '/b', properties: { title: 'Page B' } },
    });

    await expect(
      cms.api.pages.createBranch({
        body: {
          rootId: rootA.rootId,
          name: 'draft',
          sourceBranchId: rootB.branchId,
        },
      }),
    ).rejects.toThrow(/Branch not found/);
  });

  it('new branch is independent — edits do not affect the source branch', async () => {
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

    // Edit on the new branch
    const block = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: draft.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Draft content' },
      },
    });

    // Draft branch head should have advanced
    const [draftBranch] = await db
      .select()
      .from(branches)
      .where(eq(branches.id, draft.branchId));
    expect(draftBranch.headCommitId).toBe(block.commitId);

    // Main branch head should remain at the original commit
    const [mainBranch] = await db
      .select()
      .from(branches)
      .where(eq(branches.id, root.branchId));
    expect(mainBranch.headCommitId).toBe(root.commitId);
  });
});

describe('getBranch', () => {
  it('returns the branch by id with all fields', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/p', properties: { title: 'Page' } },
    });

    const branch = await cms.api.pages.getBranch({
      query: { branchId: root.branchId },
    });

    expect(branch.id).toBe(root.branchId);
    expect(branch.rootId).toBe(root.rootId);
    expect(branch.name).toBe('main');
    expect(branch.headCommitId).toBe(root.commitId);
    expect(branch.createdBy).toBeNull();
    expect(branch.createdAt).toBeInstanceOf(Date);
    expect(branch.updatedAt).toBeInstanceOf(Date);
    expect(branch.isDeletable).toBe(false);
  });

  it('returns isDeletable true for a regular branch', async () => {
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

    const branch = await cms.api.pages.getBranch({
      query: { branchId: draft.branchId },
    });

    expect(branch.isDeletable).toBe(true);
  });

  it('returns isDeletable false for a published branch', async () => {
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

    await db.insert(publications).values({
      rootId: root.rootId,
      branchId: draft.branchId,
      commitId: draft.headCommitId,
      publishedBy: 'user-1',
    });

    const branch = await cms.api.pages.getBranch({
      query: { branchId: draft.branchId },
    });

    expect(branch.isDeletable).toBe(false);
  });

  it('rejects when branch does not exist', async () => {
    const { cms } = await setupTestCMS();

    await expect(
      cms.api.pages.getBranch({ query: { branchId: 'nonexistent-id' } }),
    ).rejects.toThrow(/Branch not found/);
  });
});

describe('listBranches', () => {
  it('returns all branches for a root with isDeletable', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/p', properties: { title: 'Page' } },
    });

    await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'draft',
        sourceBranchId: root.branchId,
      },
    });

    await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'feature',
        sourceBranchId: root.branchId,
      },
    });

    const result = await cms.api.pages.listBranches({
      query: { rootId: root.rootId },
    });

    expect(result.branches).toHaveLength(3);
    expect(result.total).toBe(3);
    expect(result.hasMore).toBe(false);

    const mainBranch = result.branches.find((b) => b.name === 'main');
    const draftBranch = result.branches.find((b) => b.name === 'draft');
    const featureBranch = result.branches.find((b) => b.name === 'feature');

    expect(mainBranch!.isDeletable).toBe(false);
    expect(draftBranch!.isDeletable).toBe(true);
    expect(featureBranch!.isDeletable).toBe(true);
  });

  it('returns only branches for the requested root', async () => {
    const { cms } = await setupTestCMS();

    const rootA = await cms.api.pages.createRoot({
      body: { slug: '/a', properties: { title: 'Page A' } },
    });

    const rootB = await cms.api.pages.createRoot({
      body: { slug: '/b', properties: { title: 'Page B' } },
    });

    await cms.api.pages.createBranch({
      body: {
        rootId: rootA.rootId,
        name: 'draft',
        sourceBranchId: rootA.branchId,
      },
    });

    await cms.api.pages.createBranch({
      body: {
        rootId: rootB.rootId,
        name: 'draft',
        sourceBranchId: rootB.branchId,
      },
    });

    const resultA = await cms.api.pages.listBranches({
      query: { rootId: rootA.rootId },
    });

    expect(resultA.branches).toHaveLength(2);
    expect(resultA.branches.every((b) => b.rootId === rootA.rootId)).toBe(true);
  });

  it('supports pagination', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/p', properties: { title: 'Page' } },
    });

    await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'draft',
        sourceBranchId: root.branchId,
      },
    });

    await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'feature',
        sourceBranchId: root.branchId,
      },
    });

    const page1 = await cms.api.pages.listBranches({
      query: { rootId: root.rootId, limit: 2, offset: 0 },
    });

    expect(page1.branches).toHaveLength(2);
    expect(page1.total).toBe(3);
    expect(page1.hasMore).toBe(true);

    const page2 = await cms.api.pages.listBranches({
      query: { rootId: root.rootId, limit: 2, offset: 2 },
    });

    expect(page2.branches).toHaveLength(1);
    expect(page2.total).toBe(3);
    expect(page2.hasMore).toBe(false);
  });

  it('filters by search on branch name', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/p', properties: { title: 'Page' } },
    });

    await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'draft-review',
        sourceBranchId: root.branchId,
      },
    });

    await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'feature',
        sourceBranchId: root.branchId,
      },
    });

    const result = await cms.api.pages.listBranches({
      query: { rootId: root.rootId, search: 'draft' },
    });

    expect(result.branches).toHaveLength(1);
    expect(result.branches[0].name).toBe('draft-review');
  });

  it('filters by hasPublications', async () => {
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

    await db.insert(publications).values({
      rootId: root.rootId,
      branchId: draft.branchId,
      commitId: draft.headCommitId,
      publishedBy: 'user-1',
    });

    const result = await cms.api.pages.listBranches({
      query: { rootId: root.rootId, hasPublications: true },
    });

    expect(result.branches).toHaveLength(1);
    expect(result.branches[0].id).toBe(draft.branchId);
  });

  it('returns hasPublications per branch', async () => {
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

    await db.insert(publications).values({
      rootId: root.rootId,
      branchId: draft.branchId,
      commitId: draft.headCommitId,
      publishedBy: 'user-1',
    });

    const result = await cms.api.pages.listBranches({
      query: { rootId: root.rootId },
    });

    const byId = new Map(result.branches.map((b) => [b.id, b.hasPublications]));
    expect(byId.get(draft.branchId)).toBe(true);
    expect(byId.get(root.branchId)).toBe(false);
  });

  it('filters by hasOpenMergeRequests', async () => {
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

    await db.insert(mergeRequests).values({
      rootId: root.rootId,
      sourceBranchId: draft.branchId,
      targetBranchId: root.branchId,
      sourceCommitId: draft.headCommitId,
      baseCommitId: root.commitId,
      status: 'open',
      createdBy: 'user-1',
    });

    const result = await cms.api.pages.listBranches({
      query: { rootId: root.rootId, hasOpenMergeRequests: true },
    });

    expect(result.branches).toHaveLength(2);
    expect(result.branches.map((b) => b.id).sort()).toEqual(
      [draft.branchId, root.branchId].sort(),
    );
  });

  it('filters by isDeletable', async () => {
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

    await db.insert(publications).values({
      rootId: root.rootId,
      branchId: draft.branchId,
      commitId: draft.headCommitId,
      publishedBy: 'user-1',
    });

    const result = await cms.api.pages.listBranches({
      query: { rootId: root.rootId, isDeletable: true },
    });

    expect(result.branches).toHaveLength(0);
  });
});

describe('renameBranch', () => {
  it('renames a branch and returns the updated record', async () => {
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

    const updated = await cms.api.pages.renameBranch({
      body: { branchId: draft.branchId, newName: 'review' },
    });

    expect(updated.id).toBe(draft.branchId);
    expect(updated.name).toBe('review');
  });

  it('rejects renaming the main branch', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/p', properties: { title: 'Page' } },
    });

    await expect(
      cms.api.pages.renameBranch({
        body: { branchId: root.branchId, newName: 'old-main' },
      }),
    ).rejects.toThrow(/The main branch cannot be renamed/);
  });

  it('rejects renaming to a name that already exists on the same root', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/p', properties: { title: 'Page' } },
    });

    await cms.api.pages.createBranch({
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

    await expect(
      cms.api.pages.renameBranch({
        body: { branchId: feature.branchId, newName: 'draft' },
      }),
    ).rejects.toThrow(/A branch with this name already exists/);
  });

  it('rejects when branch does not exist', async () => {
    const { cms } = await setupTestCMS();

    await expect(
      cms.api.pages.renameBranch({
        body: { branchId: 'nonexistent-id', newName: 'whatever' },
      }),
    ).rejects.toThrow(/Branch not found/);
  });
});

describe('deleteBranch', () => {
  it('deletes a branch and removes it from the database', async () => {
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

    const result = await cms.api.pages.deleteBranch({
      body: { branchId: draft.branchId },
    });

    expect(result.branchId).toBe(draft.branchId);

    const remaining = await cms.api.pages.listBranches({
      query: { rootId: root.rootId },
    });
    expect(remaining.branches).toHaveLength(1);
    expect(remaining.branches[0].name).toBe('main');
  });

  it('rejects deleting the main branch', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/p', properties: { title: 'Page' } },
    });

    await expect(
      cms.api.pages.deleteBranch({ body: { branchId: root.branchId } }),
    ).rejects.toThrow(/The main branch cannot be deleted/);
  });

  it('rejects deleting a branch with active publications', async () => {
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

    await db.insert(publications).values({
      rootId: root.rootId,
      branchId: draft.branchId,
      commitId: draft.headCommitId,
      publishedBy: 'user-1',
    });

    await expect(
      cms.api.pages.deleteBranch({ body: { branchId: draft.branchId } }),
    ).rejects.toThrow(/Cannot delete a branch that has active publications/);
  });

  it('rejects deleting a branch with open merge requests', async () => {
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

    await db.insert(mergeRequests).values({
      rootId: root.rootId,
      sourceBranchId: draft.branchId,
      targetBranchId: root.branchId,
      sourceCommitId: draft.headCommitId,
      status: 'open',
      createdBy: 'user-1',
    });

    await expect(
      cms.api.pages.deleteBranch({ body: { branchId: draft.branchId } }),
    ).rejects.toThrow(
      /Cannot delete a branch that is part of open merge requests/,
    );
  });

  it('rejects when branch does not exist', async () => {
    const { cms } = await setupTestCMS();

    await expect(
      cms.api.pages.deleteBranch({ body: { branchId: 'nonexistent-id' } }),
    ).rejects.toThrow(/Branch not found/);
  });
});

describe('checkDivergence', () => {
  it('returns zero ahead when both branches point at the same commit', async () => {
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

    const result = await cms.api.pages.checkDivergence({
      body: { sourceBranchId: draft.branchId, targetBranchId: root.branchId },
    });

    expect(result.hasCommonAncestor).toBe(true);
    expect(result.commonAncestorCommitId).toBe(root.commitId);
    expect(result.sourceAhead).toBe(0);
    expect(result.targetAhead).toBe(0);
    expect(result.canFastForward).toBe(true);
  });

  it('detects source ahead when only source has new commits', async () => {
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

    await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: draft.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Change 1' },
      },
    });

    await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: draft.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Change 2' },
      },
    });

    const result = await cms.api.pages.checkDivergence({
      body: { sourceBranchId: draft.branchId, targetBranchId: root.branchId },
    });

    expect(result.hasCommonAncestor).toBe(true);
    expect(result.commonAncestorCommitId).toBe(root.commitId);
    expect(result.sourceAhead).toBe(2);
    expect(result.targetAhead).toBe(0);
    expect(result.canFastForward).toBe(true);
  });

  it('detects both sides ahead when branches have diverged', async () => {
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

    // Advance draft by 2 commits
    await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: draft.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Draft 1' },
      },
    });

    await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: draft.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Draft 2' },
      },
    });

    // Advance main by 1 commit
    await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Main 1' },
      },
    });

    const result = await cms.api.pages.checkDivergence({
      body: { sourceBranchId: draft.branchId, targetBranchId: root.branchId },
    });

    expect(result.hasCommonAncestor).toBe(true);
    expect(result.commonAncestorCommitId).toBe(root.commitId);
    expect(result.sourceAhead).toBe(2);
    expect(result.targetAhead).toBe(1);
    expect(result.canFastForward).toBe(false);
  });

  it('rejects when a branch does not exist', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/p', properties: { title: 'Page' } },
    });

    await expect(
      cms.api.pages.checkDivergence({
        body: { sourceBranchId: 'nonexistent', targetBranchId: root.branchId },
      }),
    ).rejects.toThrow(/Branch not found/);
  });
});

describe('revertBranch', () => {
  it('creates a new commit that restores an older snapshot and advances the branch head', async () => {
    const { cms, db } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/p', properties: { title: 'Page' } },
    });

    const first = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'First' },
      },
    });

    const second = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Second' },
      },
    });

    const result = await cms.api.pages.revertBranch({
      body: {
        branchId: root.branchId,
        targetCommitId: first.commitId,
        message: 'Revert to first child only',
        createdBy: 'user-1',
      },
    });

    expect(result.newCommitId).not.toBe(first.commitId);
    expect(result.newCommitId).not.toBe(second.commitId);

    const [newCommit] = await db
      .select()
      .from(commits)
      .where(eq(commits.id, result.newCommitId));

    expect(newCommit.parentCommitId).toBe(second.commitId);
    expect(newCommit.message).toBe('Revert to first child only');
    expect(newCommit.createdBy).toBe('user-1');

    const [branch] = await db
      .select()
      .from(branches)
      .where(eq(branches.id, root.branchId));

    expect(branch.headCommitId).toBe(result.newCommitId);

    const latest = await cms.api.pages.getBlockTree({
      query: { rootId: root.rootId, branchId: root.branchId },
    });

    expect(latest.tree.children).toHaveLength(1);
    expect(latest.tree.children[0].blockId).toBe(first.blockId);
    expect(latest.tree.children[0].properties).toEqual({ text: 'First' });
  });

  it('can revert to a commit whose snapshot was pruned', async () => {
    const { cms, db } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/p', properties: { title: 'Page' } },
    });

    const first = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'First' },
      },
    });

    await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Second' },
      },
    });

    await db
      .delete(commitSnapshots)
      .where(eq(commitSnapshots.commitId, first.commitId));

    const result = await cms.api.pages.revertBranch({
      body: { branchId: root.branchId, targetCommitId: first.commitId },
    });

    const latest = await cms.api.pages.getBlockTree({
      query: { rootId: root.rootId, branchId: root.branchId },
    });

    expect(latest.tree.children).toHaveLength(1);
    expect(latest.tree.children[0].blockId).toBe(first.blockId);

    const newSnapshots = await db
      .select()
      .from(commitSnapshots)
      .where(eq(commitSnapshots.commitId, result.newCommitId));

    expect(newSnapshots.length).toBeGreaterThan(0);
  });

  it('rejects when the branch does not exist', async () => {
    const { cms } = await setupTestCMS();

    await expect(
      cms.api.pages.revertBranch({
        body: {
          branchId: 'nonexistent-branch',
          targetCommitId: 'nonexistent-commit',
        },
      }),
    ).rejects.toThrow(/Branch not found/);
  });

  it('rejects when the target commit does not belong to the branch root', async () => {
    const { cms } = await setupTestCMS();

    const rootA = await cms.api.pages.createRoot({
      body: { slug: '/a', properties: { title: 'Page A' } },
    });

    const rootB = await cms.api.pages.createRoot({
      body: { slug: '/b', properties: { title: 'Page B' } },
    });

    await expect(
      cms.api.pages.revertBranch({
        body: { branchId: rootA.branchId, targetCommitId: rootB.commitId },
      }),
    ).rejects.toThrow(/Commit not found/);
  });
});

describe('getRootHistory', () => {
  it('returns the initial commit for a new root', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/p', properties: { title: 'Page' } },
    });

    const result = await cms.api.pages.getRootHistory({
      query: { rootId: root.rootId },
    });

    expect(result.data).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.offset).toBe(0);
    expect(result.limit).toBe(50);

    const commit = result.data[0];
    expect(commit.id).toBe(root.commitId);
    expect(commit.message).toBe('Initial commit');
    expect(commit.type).toBe('initial');
    expect(commit.parents).toEqual([]);
    expect(commit.branch).toBe('main');
    expect(commit.isPublished).toBe(false);
    expect(commit.createdAt).toBeDefined();
  });

  it('returns commits in reverse chronological order', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/p', properties: { title: 'Page' } },
    });

    const block1 = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'First' },
      },
    });

    const block2 = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Second' },
      },
    });

    const result = await cms.api.pages.getRootHistory({
      query: { rootId: root.rootId },
    });

    expect(result.data).toHaveLength(3);
    expect(result.data[0].id).toBe(block2.commitId);
    expect(result.data[1].id).toBe(block1.commitId);
    expect(result.data[2].id).toBe(root.commitId);

    expect(result.data[0].type).toBe('commit');
    expect(result.data[1].type).toBe('commit');
    expect(result.data[2].type).toBe('initial');

    expect(result.data[0].parents).toEqual([block1.commitId]);
    expect(result.data[1].parents).toEqual([root.commitId]);
    expect(result.data[2].parents).toEqual([]);
  });

  it('labels commits with the correct branch name', async () => {
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

    const draftBlock = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: draft.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Draft content' },
      },
    });

    const mainBlock = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Main content' },
      },
    });

    const result = await cms.api.pages.getRootHistory({
      query: { rootId: root.rootId },
    });

    expect(result.data).toHaveLength(3);

    const draftCommit = result.data.find((c) => c.id === draftBlock.commitId);
    const mainCommit = result.data.find((c) => c.id === mainBlock.commitId);
    const initialCommit = result.data.find((c) => c.id === root.commitId);

    expect(draftCommit!.branch).toBe('draft');
    expect(mainCommit!.branch).toBe('main');
    expect(initialCommit!.branch).toBe('main');
  });

  it('detects merge commits with correct type and parents', async () => {
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
        properties: { text: 'Block A' },
      },
    });

    const draft = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'draft',
        sourceBranchId: root.branchId,
      },
    });

    // Diverge: edit on draft
    await cms.api.pages.updateBlock({
      body: {
        rootId: root.rootId,
        branchId: draft.branchId,
        blockId: blockA.blockId,
        type: 'paragraph',
        properties: { text: 'Block A (draft)' },
      },
    });

    // Diverge: new block on main
    await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Block B' },
      },
    });

    const mr = await cms.api.pages.createMergeRequest({
      body: {
        sourceBranchId: draft.branchId,
        targetBranchId: root.branchId,
        title: 'Test MR',
        createdBy: 'user-1',
      },
    });

    await requestAndApproveMerge(cms, mr.mergeRequestId);

    const mergeResult = await cms.api.pages.executeMerge({
      body: {
        mergeRequestId: mr.mergeRequestId,
        mergedBy: 'user-1',
      },
    });

    const result = await cms.api.pages.getRootHistory({
      query: { rootId: root.rootId },
    });

    if (mergeResult.mergeCommitId) {
      const mergeCommit = result.data.find(
        (c) => c.id === mergeResult.mergeCommitId,
      );
      expect(mergeCommit).toBeDefined();
      expect(mergeCommit!.type).toBe('merge');
      expect(mergeCommit!.parents).toHaveLength(2);
    }
  });

  it('marks published commits with isPublished', async () => {
    const { cms, db } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/p', properties: { title: 'Page' } },
    });

    await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Content' },
      },
    });

    await db.insert(publications).values({
      rootId: root.rootId,
      branchId: root.branchId,
      commitId: root.commitId,
      publishedBy: 'user-1',
    });

    const result = await cms.api.pages.getRootHistory({
      query: { rootId: root.rootId },
    });

    const publishedCommit = result.data.find((c) => c.id === root.commitId);
    const unpublishedCommit = result.data.find((c) => c.id !== root.commitId);

    expect(publishedCommit!.isPublished).toBe(true);
    expect(unpublishedCommit!.isPublished).toBe(false);
  });

  it('supports offset/limit pagination', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/p', properties: { title: 'Page' } },
    });

    await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Block 1' },
      },
    });

    await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Block 2' },
      },
    });

    const page1 = await cms.api.pages.getRootHistory({
      query: { rootId: root.rootId, limit: 2, offset: 0 },
    });

    expect(page1.data).toHaveLength(2);
    expect(page1.total).toBe(3);
    expect(page1.offset).toBe(0);
    expect(page1.limit).toBe(2);

    const page2 = await cms.api.pages.getRootHistory({
      query: { rootId: root.rootId, limit: 2, offset: 2 },
    });

    expect(page2.data).toHaveLength(1);
    expect(page2.total).toBe(3);
    expect(page2.offset).toBe(2);
    expect(page2.limit).toBe(2);

    // No overlap between pages
    const page1Ids = page1.data.map((c) => c.id);
    const page2Ids = page2.data.map((c) => c.id);
    expect(page1Ids.filter((id) => page2Ids.includes(id))).toHaveLength(0);
  });

  it('rejects when root does not exist', async () => {
    const { cms } = await setupTestCMS();

    await expect(
      cms.api.pages.getRootHistory({
        query: { rootId: 'nonexistent-root' },
      }),
    ).rejects.toThrow(/not found/i);
  });

  it('returns only commits for the requested root', async () => {
    const { cms } = await setupTestCMS();

    const rootA = await cms.api.pages.createRoot({
      body: { slug: '/a', properties: { title: 'Page A' } },
    });

    const rootB = await cms.api.pages.createRoot({
      body: { slug: '/b', properties: { title: 'Page B' } },
    });

    await cms.api.pages.createBlock({
      body: {
        rootId: rootA.rootId,
        branchId: rootA.branchId,
        parentBlockId: rootA.rootId,
        type: 'paragraph',
        properties: { text: 'A content' },
      },
    });

    await cms.api.pages.createBlock({
      body: {
        rootId: rootB.rootId,
        branchId: rootB.branchId,
        parentBlockId: rootB.rootId,
        type: 'paragraph',
        properties: { text: 'B content' },
      },
    });

    const resultA = await cms.api.pages.getRootHistory({
      query: { rootId: rootA.rootId },
    });

    const resultB = await cms.api.pages.getRootHistory({
      query: { rootId: rootB.rootId },
    });

    expect(resultA.total).toBe(2);
    expect(resultB.total).toBe(2);

    const allAIds = resultA.data.map((c) => c.id);
    const allBIds = resultB.data.map((c) => c.id);
    expect(allAIds.filter((id) => allBIds.includes(id))).toHaveLength(0);
  });
});
