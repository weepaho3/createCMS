import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  branches,
  commitSnapshots,
  commits,
  mergeRequests,
  publications,
} from '../../../schema';
import { setupTestCMS } from '../../../test-utils/cms';
import { requestAndApproveMerge } from '../../../test-utils/helpers';

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

    expect(result.branch.id).toBeDefined();
    expect(result.branch.headCommitId).toBe(root.commit.id);

    const [branch] = await db
      .select()
      .from(branches)
      .where(eq(branches.id, result.branch.id));

    expect(branch.name).toBe('draft');
    expect(branch.rootId).toBe(root.rootId);
    expect(branch.headCommitId).toBe(root.commit.id);
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
      .where(eq(branches.id, result.branch.id));

    expect(branch.createdBy).toBe('user-42');
  });

  it('uses middleware userId when createdBy is omitted', async () => {
    const { cms, db } = await setupTestCMS({
      authMiddleware: async () => ({ userId: 'middleware-user' }),
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
      .where(eq(branches.id, result.branch.id));

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
      .where(eq(branches.id, result.branch.id));

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

    expect(draft.branch.headCommitId).toBe(block.commit.id);

    // Fork from draft (should also be at block.commitId)
    const feature = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'feature',
        sourceBranchId: draft.branch.id,
      },
    });

    expect(feature.branch.headCommitId).toBe(block.commit.id);
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

    expect(branchA.branch.id).not.toBe(branchB.branch.id);
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
        branchId: draft.branch.id,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Draft content' },
      },
    });

    // Draft branch head should have advanced
    const [draftBranch] = await db
      .select()
      .from(branches)
      .where(eq(branches.id, draft.branch.id));
    expect(draftBranch.headCommitId).toBe(block.commit.id);

    // Main branch head should remain at the original commit
    const [mainBranch] = await db
      .select()
      .from(branches)
      .where(eq(branches.id, root.branchId));
    expect(mainBranch.headCommitId).toBe(root.commit.id);
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
    expect(branch.headCommitId).toBe(root.commit.id);
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
      query: { branchId: draft.branch.id },
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
      branchId: draft.branch.id,
      commitId: draft.branch.headCommitId,
      publishedBy: 'user-1',
    });

    const branch = await cms.api.pages.getBranch({
      query: { branchId: draft.branch.id },
    });

    expect(branch.isDeletable).toBe(false);
  });

  it('rejects when branch does not exist', async () => {
    const { cms } = await setupTestCMS();

    await expect(
      cms.api.pages.getBranch({ query: { branchId: 'nonexistent-id' } }),
    ).rejects.toThrow(/Branch not found/);
  });

  it('returns the branch by { rootId, name }', async () => {
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
      query: { rootId: root.rootId, name: 'draft' },
    });

    expect(branch.id).toBe(draft.branch.id);
    expect(branch.rootId).toBe(root.rootId);
    expect(branch.name).toBe('draft');
    expect(branch.headCommitId).toBe(draft.branch.headCommitId);
    expect(branch.isDeletable).toBe(true);
  });

  it('rejects when no branch with that { rootId, name } exists', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/p', properties: { title: 'Page' } },
    });

    await expect(
      cms.api.pages.getBranch({
        query: { rootId: root.rootId, name: 'does-not-exist' },
      }),
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
      branchId: draft.branch.id,
      commitId: draft.branch.headCommitId,
      publishedBy: 'user-1',
    });

    const result = await cms.api.pages.listBranches({
      query: { rootId: root.rootId, hasPublications: true },
    });

    expect(result.branches).toHaveLength(1);
    expect(result.branches[0].id).toBe(draft.branch.id);
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
      branchId: draft.branch.id,
      commitId: draft.branch.headCommitId,
      publishedBy: 'user-1',
    });

    const result = await cms.api.pages.listBranches({
      query: { rootId: root.rootId },
    });

    const byId = new Map(result.branches.map((b) => [b.id, b.hasPublications]));
    expect(byId.get(draft.branch.id)).toBe(true);
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
      sourceBranchId: draft.branch.id,
      targetBranchId: root.branchId,
      sourceCommitId: draft.branch.headCommitId,
      baseCommitId: root.commit.id,
      status: 'open',
      createdBy: 'user-1',
    });

    const result = await cms.api.pages.listBranches({
      query: { rootId: root.rootId, hasOpenMergeRequests: true },
    });

    expect(result.branches).toHaveLength(2);
    expect(result.branches.map((b) => b.id).sort()).toEqual(
      [draft.branch.id, root.branchId].sort(),
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
      branchId: draft.branch.id,
      commitId: draft.branch.headCommitId,
      publishedBy: 'user-1',
    });

    const result = await cms.api.pages.listBranches({
      query: { rootId: root.rootId, isDeletable: true },
    });

    expect(result.branches).toHaveLength(0);
  });

  it('does not invert isDeletable when the wire string "false" is passed', async () => {
    // Regression guard for the z.coerce.boolean() wire trap: over HTTP a
    // client serializes booleans to strings, and `Boolean('false') === true`.
    // The string 'false' must resolve to protected branches, not collapse to
    // the same result as 'true'.
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

    const protectedResult = await cms.api.pages.listBranches({
      query: {
        rootId: root.rootId,
        isDeletable: 'false' as unknown as boolean,
      },
    });
    expect(protectedResult.branches.map((b) => b.name)).toEqual(['main']);

    const deletableResult = await cms.api.pages.listBranches({
      query: { rootId: root.rootId, isDeletable: 'true' as unknown as boolean },
    });
    expect(deletableResult.branches.map((b) => b.name)).toEqual(['draft']);
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
      body: { branchId: draft.branch.id, newName: 'review' },
    });

    expect(updated.branch.id).toBe(draft.branch.id);
    expect(updated.branch.name).toBe('review');
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
        body: { branchId: feature.branch.id, newName: 'draft' },
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
      body: { branchId: draft.branch.id },
    });

    expect(result.branchId).toBe(draft.branch.id);

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
      branchId: draft.branch.id,
      commitId: draft.branch.headCommitId,
      publishedBy: 'user-1',
    });

    await expect(
      cms.api.pages.deleteBranch({ body: { branchId: draft.branch.id } }),
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
      sourceBranchId: draft.branch.id,
      targetBranchId: root.branchId,
      sourceCommitId: draft.branch.headCommitId,
      status: 'open',
      createdBy: 'user-1',
    });

    await expect(
      cms.api.pages.deleteBranch({ body: { branchId: draft.branch.id } }),
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

  it('deletes a branch after its merge request has been merged', async () => {
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

    await cms.api.pages.executeMerge({
      body: { mergeRequestId: mr.mergeRequest.id, mergedBy: 'user-1' },
    });

    const result = await cms.api.pages.deleteBranch({
      body: { branchId: draft.branch.id },
    });

    expect(result.branchId).toBe(draft.branch.id);

    const remaining = await cms.api.pages.listBranches({
      query: { rootId: root.rootId },
    });
    expect(remaining.branches.map((b) => b.id)).not.toContain(draft.branch.id);
  });

  it('preserves merge-request history when the source branch is deleted', async () => {
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

    await cms.api.pages.executeMerge({
      body: { mergeRequestId: mr.mergeRequest.id, mergedBy: 'user-1' },
    });

    await cms.api.pages.deleteBranch({
      body: { branchId: draft.branch.id },
    });

    const [row] = await db
      .select()
      .from(mergeRequests)
      .where(eq(mergeRequests.id, mr.mergeRequest.id));

    expect(row).toBeDefined();
    expect(row.status).toBe('merged');
    expect(row.sourceBranchId).toBeNull();
    expect(row.targetBranchId).toBe(root.branchId);
  });

  it('still refuses to delete a branch with an OPEN merge request', async () => {
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
      cms.api.pages.deleteBranch({ body: { branchId: draft.branch.id } }),
    ).rejects.toThrow(/open merge requests/i);
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
      query: { sourceBranchId: draft.branch.id, targetBranchId: root.branchId },
    });

    expect(result.hasCommonAncestor).toBe(true);
    expect(result.commonAncestorCommitId).toBe(root.commit.id);
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
        branchId: draft.branch.id,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Change 1' },
      },
    });

    await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: draft.branch.id,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Change 2' },
      },
    });

    const result = await cms.api.pages.checkDivergence({
      query: { sourceBranchId: draft.branch.id, targetBranchId: root.branchId },
    });

    expect(result.hasCommonAncestor).toBe(true);
    expect(result.commonAncestorCommitId).toBe(root.commit.id);
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
        branchId: draft.branch.id,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Draft 1' },
      },
    });

    await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: draft.branch.id,
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
      query: { sourceBranchId: draft.branch.id, targetBranchId: root.branchId },
    });

    expect(result.hasCommonAncestor).toBe(true);
    expect(result.commonAncestorCommitId).toBe(root.commit.id);
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
        query: { sourceBranchId: 'nonexistent', targetBranchId: root.branchId },
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
        targetCommitId: first.commit.id,
        message: 'Revert to first child only',
        createdBy: 'user-1',
      },
    });

    expect(result.commit.id).not.toBe(first.commit.id);
    expect(result.commit.id).not.toBe(second.commit.id);

    const [newCommit] = await db
      .select()
      .from(commits)
      .where(eq(commits.id, result.commit.id));

    expect(newCommit.parentCommitId).toBe(second.commit.id);
    expect(newCommit.message).toBe('Revert to first child only');
    expect(newCommit.createdBy).toBe('user-1');

    const [branch] = await db
      .select()
      .from(branches)
      .where(eq(branches.id, root.branchId));

    expect(branch.headCommitId).toBe(result.commit.id);

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
      .where(eq(commitSnapshots.commitId, first.commit.id));

    const result = await cms.api.pages.revertBranch({
      body: { branchId: root.branchId, targetCommitId: first.commit.id },
    });

    const latest = await cms.api.pages.getBlockTree({
      query: { rootId: root.rootId, branchId: root.branchId },
    });

    expect(latest.tree.children).toHaveLength(1);
    expect(latest.tree.children[0].blockId).toBe(first.blockId);

    const newSnapshots = await db
      .select()
      .from(commitSnapshots)
      .where(eq(commitSnapshots.commitId, result.commit.id));

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
        body: { branchId: rootA.branchId, targetCommitId: rootB.commit.id },
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

    expect(result.commits).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.hasMore).toBe(false);

    const commit = result.commits[0];
    expect(commit.id).toBe(root.commit.id);
    expect(commit.message).toBe('Initial commit');
    expect(commit.type).toBe('initial');
    expect(commit.parents).toEqual([]);
    expect(commit.branch).toBe('main');
    expect(commit.isPublished).toBe(false);
    // createdAt is a Date, like every other list endpoint (ret-15), not an ISO string.
    expect(commit.createdAt).toBeInstanceOf(Date);
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

    expect(result.commits).toHaveLength(3);
    expect(result.commits[0].id).toBe(block2.commit.id);
    expect(result.commits[1].id).toBe(block1.commit.id);
    expect(result.commits[2].id).toBe(root.commit.id);

    expect(result.commits[0].type).toBe('commit');
    expect(result.commits[1].type).toBe('commit');
    expect(result.commits[2].type).toBe('initial');

    expect(result.commits[0].parents).toEqual([block1.commit.id]);
    expect(result.commits[1].parents).toEqual([root.commit.id]);
    expect(result.commits[2].parents).toEqual([]);
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
        branchId: draft.branch.id,
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

    expect(result.commits).toHaveLength(3);

    const draftCommit = result.commits.find(
      (c) => c.id === draftBlock.commit.id,
    );
    const mainCommit = result.commits.find((c) => c.id === mainBlock.commit.id);
    const initialCommit = result.commits.find((c) => c.id === root.commit.id);

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
        branchId: draft.branch.id,
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
        sourceBranchId: draft.branch.id,
        targetBranchId: root.branchId,
        title: 'Test MR',
        createdBy: 'user-1',
      },
    });

    await requestAndApproveMerge(cms, mr.mergeRequest.id);

    const mergeResult = await cms.api.pages.executeMerge({
      body: {
        mergeRequestId: mr.mergeRequest.id,
        mergedBy: 'user-1',
      },
    });

    const result = await cms.api.pages.getRootHistory({
      query: { rootId: root.rootId },
    });

    if (mergeResult.commit.id) {
      const mergeCommit = result.commits.find(
        (c) => c.id === mergeResult.commit.id,
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
      commitId: root.commit.id,
      publishedBy: 'user-1',
    });

    const result = await cms.api.pages.getRootHistory({
      query: { rootId: root.rootId },
    });

    const publishedCommit = result.commits.find((c) => c.id === root.commit.id);
    const unpublishedCommit = result.commits.find(
      (c) => c.id !== root.commit.id,
    );

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

    expect(page1.commits).toHaveLength(2);
    expect(page1.total).toBe(3);
    expect(page1.hasMore).toBe(true);

    const page2 = await cms.api.pages.getRootHistory({
      query: { rootId: root.rootId, limit: 2, offset: 2 },
    });

    expect(page2.commits).toHaveLength(1);
    expect(page2.total).toBe(3);
    expect(page2.hasMore).toBe(false);

    // No overlap between pages
    const page1Ids = page1.commits.map((c) => c.id);
    const page2Ids = page2.commits.map((c) => c.id);
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

    const allAIds = resultA.commits.map((c) => c.id);
    const allBIds = resultB.commits.map((c) => c.id);
    expect(allAIds.filter((id) => allBIds.includes(id))).toHaveLength(0);
  });

  describe('withChanges', () => {
    it('omits changes when withChanges is absent or false', async () => {
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
          properties: { text: 'Content' },
        },
      });

      const absent = await cms.api.pages.getRootHistory({
        query: { rootId: root.rootId },
      });
      for (const commit of absent.commits) {
        expect(commit.changes).toBeUndefined();
      }

      const explicit = await cms.api.pages.getRootHistory({
        query: { rootId: root.rootId, withChanges: false },
      });
      for (const commit of explicit.commits) {
        expect(commit.changes).toBeUndefined();
      }
    });

    it('counts every seeded block as added on the initial commit', async () => {
      const { cms } = await setupTestCMS();

      const root = await cms.api.pages.createRoot({
        body: { slug: '/p', properties: { title: 'Page' } },
      });

      const result = await cms.api.pages.getRootHistory({
        query: { rootId: root.rootId, withChanges: true },
      });

      // createRoot seeds exactly one block version (the root block itself),
      // so the initial commit's whole snapshot counts as added.
      const initial = result.commits.find((c) => c.id === root.commit.id)!;
      expect(initial.changes).toEqual({ added: 1, modified: 0, deleted: 0 });
    });

    it('counts an added block plus the parent whose children changed', async () => {
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
          properties: { text: 'Content' },
        },
      });

      const result = await cms.api.pages.getRootHistory({
        query: { rootId: root.rootId, withChanges: true },
      });

      // Version-level semantics: createBlock writes the new block version AND
      // the parent root's version (its children array gained the block), so
      // the commit counts added:1 (the block) + modified:1 (the root).
      const entry = result.commits.find((c) => c.id === block.commit.id)!;
      expect(entry.changes).toEqual({ added: 1, modified: 1, deleted: 0 });
    });

    it('counts a deletion as deleted plus the modified parent', async () => {
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
          properties: { text: 'Content' },
        },
      });

      const del = await cms.api.pages.deleteBlock({
        body: {
          rootId: root.rootId,
          branchId: root.branchId,
          blockId: block.blockId,
        },
      });

      const result = await cms.api.pages.getRootHistory({
        query: { rootId: root.rootId, withChanges: true },
      });

      // deleteBlock writes a tombstone version for the block (deleted:1) and
      // the parent root's version with the child ref removed (modified:1).
      const entry = result.commits.find((c) => c.id === del.commit.id)!;
      expect(entry.changes).toEqual({ added: 0, modified: 1, deleted: 1 });
    });

    it('counts a property edit as modified only', async () => {
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
          properties: { text: 'Before' },
        },
      });

      const edit = await cms.api.pages.updateBlock({
        body: {
          rootId: root.rootId,
          branchId: root.branchId,
          blockId: block.blockId,
          type: 'paragraph',
          properties: { text: 'After' },
        },
      });

      const result = await cms.api.pages.getRootHistory({
        query: { rootId: root.rootId, withChanges: true },
      });

      // Only the edited block gets a new version — no parent touched.
      const entry = result.commits.find((c) => c.id === edit.commit.id)!;
      expect(entry.changes).toEqual({ added: 0, modified: 1, deleted: 0 });
    });

    it('carries counts onto later pagination pages', async () => {
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

      const page2 = await cms.api.pages.getRootHistory({
        query: { rootId: root.rootId, limit: 2, offset: 2, withChanges: true },
      });

      // Page 2 (of 3 commits, newest first) holds only the initial commit.
      expect(page2.commits).toHaveLength(1);
      expect(page2.commits[0].id).toBe(root.commit.id);
      expect(page2.commits[0].changes).toEqual({
        added: 1,
        modified: 0,
        deleted: 0,
      });
    });

    it('computes merge-commit counts against the first (target-side) parent', async () => {
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

      // Diverge: edit Block A on draft
      await cms.api.pages.updateBlock({
        body: {
          rootId: root.rootId,
          branchId: draft.branch.id,
          blockId: blockA.blockId,
          type: 'paragraph',
          properties: { text: 'Block A (draft)' },
        },
      });

      // Diverge: edit Block B on main — the EDIT-divergence variant. (This
      // used to be the only workable variant: buildMergedSnapshot dropped
      // blocks the target ADDED after the branch point. That is fixed — the
      // delete-vs-edit exclusion is now gated on a live base version — and the
      // ADD-divergence variant is covered by the next test; both are kept.)
      await cms.api.pages.updateBlock({
        body: {
          rootId: root.rootId,
          branchId: root.branchId,
          blockId: blockB.blockId,
          type: 'paragraph',
          properties: { text: 'Block B (main)' },
        },
      });

      const mr = await cms.api.pages.createMergeRequest({
        body: {
          sourceBranchId: draft.branch.id,
          targetBranchId: root.branchId,
          title: 'Test MR',
          createdBy: 'user-1',
        },
      });

      await requestAndApproveMerge(cms, mr.mergeRequest.id);

      const mergeResult = await cms.api.pages.executeMerge({
        body: {
          mergeRequestId: mr.mergeRequest.id,
          mergedBy: 'user-1',
        },
      });

      const result = await cms.api.pages.getRootHistory({
        query: { rootId: root.rootId, withChanges: true },
      });

      const mergeCommit = result.commits.find(
        (c) => c.id === mergeResult.commit.id,
      )!;
      expect(mergeCommit).toBeDefined();
      expect(mergeCommit.type).toBe('merge');
      // Diffed against parent_commit_id (the target/main-side parent): the
      // merge landed the draft edit of Block A on main — Block B (with the
      // main-side edit) and the root already existed there with the same
      // versions.
      expect(mergeCommit.changes).toEqual({
        added: 0,
        modified: 1,
        deleted: 0,
      });
    });

    it('computes merge-commit counts when the target diverged by adding a block', async () => {
      // ADD-divergence variant of the previous test: main ADDS Block B after
      // the branch point instead of editing a pre-branch block. Before
      // buildMergedSnapshot gated its delete-vs-edit exclusion on a live base
      // version, the merge dropped Block B from the merged snapshot, so it
      // leaked into these counts as a spurious deletion (and vanished from
      // the tree).
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

      // Diverge: edit Block A on draft (property-only).
      await cms.api.pages.updateBlock({
        body: {
          rootId: root.rootId,
          branchId: draft.branch.id,
          blockId: blockA.blockId,
          type: 'paragraph',
          properties: { text: 'Block A (draft)' },
        },
      });

      // Diverge: ADD Block B on main after the branch point.
      const blockB = await cms.api.pages.createBlock({
        body: {
          rootId: root.rootId,
          branchId: root.branchId,
          parentBlockId: root.rootId,
          type: 'paragraph',
          properties: { text: 'Block B (added on main)' },
        },
      });

      const mr = await cms.api.pages.createMergeRequest({
        body: {
          sourceBranchId: draft.branch.id,
          targetBranchId: root.branchId,
          title: 'Test MR',
          createdBy: 'user-1',
        },
      });

      await requestAndApproveMerge(cms, mr.mergeRequest.id);

      const mergeResult = await cms.api.pages.executeMerge({
        body: {
          mergeRequestId: mr.mergeRequest.id,
          mergedBy: 'user-1',
        },
      });

      const result = await cms.api.pages.getRootHistory({
        query: { rootId: root.rootId, withChanges: true },
      });

      const mergeCommit = result.commits.find(
        (c) => c.id === mergeResult.commit.id,
      )!;
      expect(mergeCommit).toBeDefined();
      expect(mergeCommit.type).toBe('merge');
      // Diffed against the target-side parent, which already held Block B and
      // the root version listing it: the merge landed only the draft edit of
      // Block A. Block B must NOT read as a deletion.
      expect(mergeCommit.changes).toEqual({
        added: 0,
        modified: 1,
        deleted: 0,
      });

      // And Block B is still in the merged tree.
      const { tree } = await cms.api.pages.getBlockTree({
        query: { rootId: root.rootId, branchId: root.branchId },
      });
      const survivor = tree.children.find(
        (c: any) => c.blockId === blockB.blockId,
      );
      expect(survivor).toBeDefined();
      expect((survivor!.properties as { text: string }).text).toBe(
        'Block B (added on main)',
      );
    });

    it('counts a merge-landed deletion as deleted', async () => {
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

      // The whole point of the merge: land a deletion on main.
      await cms.api.pages.deleteBlock({
        body: {
          rootId: root.rootId,
          branchId: draft.branch.id,
          blockId: blockA.blockId,
        },
      });

      // Diverge main with a property edit that does NOT touch the root block,
      // so the merge is a real 3-way merge (not a fast-forward) without a
      // conflict on the root's children.
      await cms.api.pages.updateBlock({
        body: {
          rootId: root.rootId,
          branchId: root.branchId,
          blockId: blockB.blockId,
          type: 'paragraph',
          properties: { text: 'Block B (main)' },
        },
      });

      const mr = await cms.api.pages.createMergeRequest({
        body: {
          sourceBranchId: draft.branch.id,
          targetBranchId: root.branchId,
          title: 'Land deletion',
          createdBy: 'user-1',
        },
      });

      await requestAndApproveMerge(cms, mr.mergeRequest.id);

      const mergeResult = await cms.api.pages.executeMerge({
        body: {
          mergeRequestId: mr.mergeRequest.id,
          mergedBy: 'user-1',
        },
      });

      const result = await cms.api.pages.getRootHistory({
        query: { rootId: root.rootId, withChanges: true },
      });

      const mergeCommit = result.commits.find(
        (c) => c.id === mergeResult.commit.id,
      )!;
      expect(mergeCommit.type).toBe('merge');
      // The merged snapshot EXCLUDES the deleted block instead of carrying a
      // tombstone (buildMergedSnapshot), so the deletion shows up only as the
      // block being ABSENT from the merge commit vs live in the target-side
      // parent — it must still count as deleted. The root is modified (its
      // children lost Block A on draft); Block B kept the target's version.
      expect(mergeCommit.changes).toEqual({
        added: 0,
        modified: 1,
        deleted: 1,
      });
    });

    it('counts blocks dropped by a revert as deleted', async () => {
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
          properties: { text: 'Content' },
        },
      });

      const revert = await cms.api.pages.revertBranch({
        body: {
          branchId: root.branchId,
          targetCommitId: root.commit.id,
          createdBy: 'user-1',
        },
      });

      const result = await cms.api.pages.getRootHistory({
        query: { rootId: root.rootId, withChanges: true },
      });

      // The revert snapshot is exactly the target commit's map — the block
      // created after that commit is simply ABSENT, not tombstoned. Absent in
      // the revert while live in the parent must count as deleted; the root
      // block reverts to its pre-block version (modified).
      const entry = result.commits.find((c) => c.id === revert.commit.id)!;
      expect(entry.changes).toEqual({ added: 0, modified: 1, deleted: 1 });
    });

    it('counts blocks restored by reverting past an earlier revert as added', async () => {
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
          properties: { text: 'Content' },
        },
      });

      // First revert to the initial commit: the branch head's snapshot now
      // LACKS the block id entirely (no tombstone carried forward).
      await cms.api.pages.revertBranch({
        body: { branchId: root.branchId, targetCommitId: root.commit.id },
      });

      // Revert forward again to the commit that had the block. Relative to
      // its absence-based parent snapshot the block re-appears — the
      // re-introduction counts as added (plus the root's version change).
      const restore = await cms.api.pages.revertBranch({
        body: { branchId: root.branchId, targetCommitId: block.commit.id },
      });

      const result = await cms.api.pages.getRootHistory({
        query: { rootId: root.rootId, withChanges: true },
      });

      const entry = result.commits.find((c) => c.id === restore.commit.id)!;
      expect(entry.changes).toEqual({ added: 1, modified: 1, deleted: 0 });
    });
  });
});
