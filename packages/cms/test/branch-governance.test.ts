import { describe, expect, it } from 'vitest';

import { setupTestCMS } from './utils/cms';

describe('branch protection — protectMain', () => {
  it('exempts createRoot but rejects direct edits on the default branch', async () => {
    const { cms } = await setupTestCMS({
      branchProtection: { protectMain: true },
    });

    // createRoot seeds the default branch — it is exempt.
    const root = await cms.api.pages.createRoot({
      body: { slug: '/', properties: { title: 'Home' } },
    });
    expect(root.rootId).toBeTruthy();

    // A direct content mutation on the default branch is rejected.
    await expect(
      cms.api.pages.createBlock({
        body: {
          rootId: root.rootId,
          branchId: root.branchId,
          parentBlockId: root.rootId,
          type: 'paragraph',
          properties: { text: 'x' },
        },
      }),
    ).rejects.toThrow(/protected/i);
  });

  it('allows edits on a non-default branch', async () => {
    const { cms } = await setupTestCMS({
      branchProtection: { protectMain: true },
    });
    const root = await cms.api.pages.createRoot({
      body: { slug: '/', properties: { title: 'Home' } },
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
        branchId: draft.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'x' },
      },
    });
    expect(block.blockId).toBeTruthy();
  });
});

describe('branch protection — publish approval gate', () => {
  it('requireApprovalBeforePublish blocks publish until approved', async () => {
    const { cms } = await setupTestCMS({
      branchProtection: { requireApprovalBeforePublish: true },
    });
    const root = await cms.api.pages.createRoot({
      body: { slug: '/', properties: { title: 'Home' } },
    });

    await expect(
      cms.api.pages.publishBranch({
        body: { rootId: root.rootId, branchId: root.branchId },
      }),
    ).rejects.toThrow(/approval/i);

    const req = await cms.api.pages.requestApproval({
      body: {
        branchId: root.branchId,
        requestedBy: 'author',
        requestedReviewers: ['rev-1'],
      },
    });
    await cms.api.pages.approve({
      body: { approvalId: req.approvals[0].id, reviewedBy: 'rev-1' },
    });

    const pub = await cms.api.pages.publishBranch({
      body: { rootId: root.rootId, branchId: root.branchId },
    });
    expect(pub).toBeTruthy();
  });

  it('requiredReviewers: one approval is insufficient when two are required', async () => {
    const { cms } = await setupTestCMS({
      branchProtection: {
        requireApprovalBeforePublish: true,
        requiredReviewers: 2,
      },
    });
    const root = await cms.api.pages.createRoot({
      body: { slug: '/', properties: { title: 'Home' } },
    });

    const req = await cms.api.pages.requestApproval({
      body: {
        branchId: root.branchId,
        requestedBy: 'author',
        requestedReviewers: ['rev-1', 'rev-2'],
      },
    });
    await cms.api.pages.approve({
      body: {
        approvalId: req.approvals[0].id,
        reviewedBy: req.approvals[0].requestedReviewer,
      },
    });

    // 1 of 2 approved → still blocked.
    await expect(
      cms.api.pages.publishBranch({
        body: { rootId: root.rootId, branchId: root.branchId },
      }),
    ).rejects.toThrow(/approval/i);

    await cms.api.pages.approve({
      body: {
        approvalId: req.approvals[1].id,
        reviewedBy: req.approvals[1].requestedReviewer,
      },
    });
    const pub = await cms.api.pages.publishBranch({
      body: { rootId: root.rootId, branchId: root.branchId },
    });
    expect(pub).toBeTruthy();
  });
});

describe('defaultBranchName', () => {
  it('seeds the configured default branch and reads resolve against it', async () => {
    const { cms } = await setupTestCMS({ defaultBranchName: 'trunk' });
    const root = await cms.api.pages.createRoot({
      body: { slug: '/', properties: { title: 'Home' } },
    });

    const branches = await cms.api.pages.listBranches({
      query: { rootId: root.rootId },
    });
    expect(branches.branches.map((b) => b.name)).toContain('trunk');

    // listRoots joins on the configured default branch — the root must be found
    // (it wouldn't be if the SQL still hard-coded 'main').
    const roots = await cms.api.pages.listRoots({});
    expect(roots.roots.some((r) => r.rootId === root.rootId)).toBe(true);
  });

  it('protects the configured default branch from rename', async () => {
    const { cms } = await setupTestCMS({ defaultBranchName: 'trunk' });
    const root = await cms.api.pages.createRoot({
      body: { slug: '/', properties: { title: 'Home' } },
    });

    await expect(
      cms.api.pages.renameBranch({
        body: { branchId: root.branchId, newName: 'x' },
      }),
    ).rejects.toThrow(/main branch/i);
  });
});
