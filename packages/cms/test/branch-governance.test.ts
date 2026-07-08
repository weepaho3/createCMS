import { describe, expect, it } from 'vitest';

import { allowAnonymous, createCMS } from '../src/index';
import { setupTestCMS } from '../src/test-utils/cms';
import { setupTestDB } from '../src/test-utils/db';
import { DUMMY_MEDIA_CONFIG } from '../src/test-utils/fixtures';

describe('branch protection — protectPublishedBranches', () => {
  const createParagraph = (
    cms: Awaited<ReturnType<typeof setupTestCMS>>['cms'],
    rootId: string,
    branchId: string,
    text: string,
  ) =>
    cms.api.pages.createBlock({
      body: {
        rootId,
        branchId,
        parentBlockId: rootId,
        type: 'paragraph',
        properties: { text },
      },
    });

  it('locks a branch only while it is published (editable → publish → locked → unpublish → editable)', async () => {
    const { cms } = await setupTestCMS({
      branchProtection: { protectPublishedBranches: true },
    });

    const root = await cms.api.pages.createRoot({
      body: { slug: '/', properties: { title: 'Home' } },
    });

    // Not published yet → the default branch is freely editable. This is the UX
    // fix: building out a fresh page needs no branch ceremony.
    const block = await createParagraph(cms, root.rootId, root.branchId, 'a');
    expect(block.blockId).toBeTruthy();

    // Going live locks the branch for direct edits.
    await cms.api.pages.publishBranch({
      body: { rootId: root.rootId, branchId: root.branchId },
    });
    await expect(
      createParagraph(cms, root.rootId, root.branchId, 'b'),
    ).rejects.toThrow(/published/i);

    // Taking it offline again makes it directly editable (reversible).
    await cms.api.pages.unpublishBranch({
      body: { rootId: root.rootId, branchId: root.branchId },
    });
    const after = await createParagraph(cms, root.rootId, root.branchId, 'c');
    expect(after.blockId).toBeTruthy();
  });

  it('locks ANY published branch, not just the default one', async () => {
    const { cms } = await setupTestCMS({
      branchProtection: { protectPublishedBranches: true },
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

    // Publish the NON-default branch (e.g. an A/B variant) → it locks…
    await cms.api.pages.publishBranch({
      body: { rootId: root.rootId, branchId: draft.branch.id },
    });
    await expect(
      createParagraph(cms, root.rootId, draft.branch.id, 'x'),
    ).rejects.toThrow(/published/i);

    // …while the unpublished default branch stays freely editable.
    const onDefault = await createParagraph(
      cms,
      root.rootId,
      root.branchId,
      'y',
    );
    expect(onDefault.blockId).toBeTruthy();
  });

  it('blocks revertBranch on a published branch (no direct-mutation side-channel)', async () => {
    const { cms } = await setupTestCMS({
      branchProtection: { protectPublishedBranches: true },
    });
    const root = await cms.api.pages.createRoot({
      body: { slug: '/', properties: { title: 'Home' } },
    });
    const block = await createParagraph(cms, root.rootId, root.branchId, 'a');

    // Publish at the block commit, then a revert to the initial commit must be
    // blocked just like a direct edit — revert rewrites the branch head.
    await cms.api.pages.publishBranch({
      body: { rootId: root.rootId, branchId: root.branchId },
    });
    await expect(
      cms.api.pages.revertBranch({
        body: { branchId: root.branchId, targetCommitId: root.commit.id },
      }),
    ).rejects.toThrow(/published/i);

    // Unpublish → revert is allowed again.
    await cms.api.pages.unpublishBranch({
      body: { rootId: root.rootId, branchId: root.branchId },
    });
    const reverted = await cms.api.pages.revertBranch({
      body: { branchId: root.branchId, targetCommitId: root.commit.id },
    });
    expect(reverted.commit.id).toBeTruthy();
    expect(block.commit.id).toBeTruthy();
  });

  it('off by default: a published branch stays editable', async () => {
    const { cms } = await setupTestCMS();
    const root = await cms.api.pages.createRoot({
      body: { slug: '/', properties: { title: 'Home' } },
    });
    await cms.api.pages.publishBranch({
      body: { rootId: root.rootId, branchId: root.branchId },
    });
    const block = await createParagraph(cms, root.rootId, root.branchId, 'a');
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
        requestedReviewers: ['rev-1'],
      },
      context: { userId: 'author' },
    });
    await cms.api.pages.approve({
      body: { approvalId: req.approvals[0].id },
      context: { userId: 'rev-1' },
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
        requestedReviewers: ['rev-1', 'rev-2'],
      },
      context: { userId: 'author' },
    });
    await cms.api.pages.approve({
      body: {
        approvalId: req.approvals[0].id,
      },
      context: { userId: req.approvals[0].requestedReviewer },
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
      },
      context: { userId: req.approvals[1].requestedReviewer },
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

describe('branch protection — per-collection override', () => {
  async function setupPerCollectionCMS() {
    const { db } = await setupTestDB();
    return createCMS({
      db,
      authMiddleware: allowAnonymous(),
      media: { ...DUMMY_MEDIA_CONFIG },
      // Global: protect published branches everywhere…
      branchProtection: { protectPublishedBranches: true },
      collections: {
        pages: {
          label: 'Pages',
          root: {
            properties: {
              title: { type: 'string', label: 'Title', required: true },
            },
          },
          blocks: {
            para: {
              label: 'Para',
              properties: { text: { type: 'string', label: 'Text' } },
            },
          },
        },
        widgets: {
          label: 'Widgets',
          // …except this collection opts out.
          branchProtection: { protectPublishedBranches: false },
          root: {
            properties: {
              name: { type: 'string', label: 'Name', required: true },
            },
          },
          blocks: {
            para: {
              label: 'Para',
              properties: { text: { type: 'string', label: 'Text' } },
            },
          },
        },
      },
    } as const);
  }

  it('lets a collection opt out of a globally-enabled protection', async () => {
    const cms = await setupPerCollectionCMS();

    // widgets overrides protectPublishedBranches=false → editable after publish.
    const w = await cms.api.widgets.createRoot({
      body: { properties: { name: 'W' } },
    });
    await cms.api.widgets.publishBranch({
      body: { rootId: w.rootId, branchId: w.branchId },
    });
    const block = await cms.api.widgets.createBlock({
      body: {
        rootId: w.rootId,
        branchId: w.branchId,
        parentBlockId: w.rootId,
        type: 'para',
        properties: { text: 'edited live' },
      },
    });
    expect(block.blockId).toBeTruthy();

    // pages inherits the global protection → locked after publish.
    const p = await cms.api.pages.createRoot({
      body: { properties: { title: 'P' } },
    });
    await cms.api.pages.publishBranch({
      body: { rootId: p.rootId, branchId: p.branchId },
    });
    await expect(
      cms.api.pages.createBlock({
        body: {
          rootId: p.rootId,
          branchId: p.branchId,
          parentBlockId: p.rootId,
          type: 'para',
          properties: { text: 'x' },
        },
      }),
    ).rejects.toThrow(/published/i);
  });
});
