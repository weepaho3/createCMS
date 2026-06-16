import { describe, expect, it } from 'vitest';

import { setupTestCMS } from './utils/cms';

async function createMergeRequestFixture() {
  const { cms } = await setupTestCMS();

  const root = await cms.api.pages.createRoot({
    body: { slug: '/approvals', properties: { title: 'Page' } },
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
      properties: { text: 'Draft content' },
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

  return { cms, root, draft, mr };
}

describe('approvals', () => {
  it('creates one merge approval per reviewer and exposes them via get/list routes', async () => {
    const { cms, mr, draft } = await createMergeRequestFixture();

    const request = await cms.api.pages.requestApproval({
      body: {
        mergeRequestId: mr.mergeRequestId,
        requestedBy: 'author-1',
        requestedReviewers: ['reviewer-1', 'reviewer-2'],
        message: 'Please review this merge',
      },
    });

    expect(request.approvals).toHaveLength(2);
    expect(
      request.approvals.every(
        (approval) => approval.targetType === 'mergeRequest',
      ),
    ).toBe(true);
    expect(
      request.approvals.every(
        (approval) => approval.branchId === draft.branchId,
      ),
    ).toBe(true);
    expect(
      request.approvals.every((approval) => approval.status === 'pending'),
    ).toBe(true);

    const fetched = await cms.api.pages.getApproval({
      query: { approvalId: request.approvals[0].id },
    });

    expect(fetched.id).toBe(request.approvals[0].id);
    expect(fetched.mergeRequestId).toBe(mr.mergeRequestId);
    expect(fetched.message).toBe('Please review this merge');

    const listed = await cms.api.pages.listApprovals({
      query: {
        mergeRequestId: mr.mergeRequestId,
        status: 'pending',
        targetType: 'mergeRequest',
      },
    });

    expect(listed.total).toBe(2);
    expect(listed.hasMore).toBe(false);
    expect(
      listed.approvals.map((approval) => approval.requestedReviewer).sort(),
    ).toEqual(['reviewer-1', 'reviewer-2']);
  });

  it('only allows the requested reviewer to approve or reject a request', async () => {
    const { cms, mr } = await createMergeRequestFixture();

    const request = await cms.api.pages.requestApproval({
      body: {
        mergeRequestId: mr.mergeRequestId,
        requestedBy: 'author-1',
        requestedReviewers: ['reviewer-1', 'reviewer-2'],
      },
    });

    await expect(
      cms.api.pages.approve({
        body: {
          approvalId: request.approvals[0].id,
          reviewedBy: 'someone-else',
        },
      }),
    ).rejects.toThrow(/only the requested reviewer/i);

    const approved = await cms.api.pages.approve({
      body: {
        approvalId: request.approvals[0].id,
        reviewedBy: 'reviewer-1',
      },
    });

    expect(approved.status).toBe('approved');
    expect(approved.reviewedBy).toBe('reviewer-1');

    const rejected = await cms.api.pages.reject({
      body: {
        approvalId: request.approvals[1].id,
        reviewedBy: 'reviewer-2',
        rejectionReason: 'Needs work',
      },
    });

    expect(rejected.status).toBe('rejected');
    expect(rejected.rejectionReason).toBe('Needs work');
    expect(rejected.reviewedBy).toBe('reviewer-2');
  });

  it('cancels pending approvals and rejects cancellation after review', async () => {
    const { cms, mr } = await createMergeRequestFixture();

    const request = await cms.api.pages.requestApproval({
      body: {
        mergeRequestId: mr.mergeRequestId,
        requestedBy: 'author-1',
        requestedReviewers: ['reviewer-1', 'reviewer-2'],
      },
    });

    const cancelled = await cms.api.pages.cancelApproval({
      body: { approvalId: request.approvals[0].id },
    });

    expect(cancelled.approvalId).toBe(request.approvals[0].id);

    await cms.api.pages.approve({
      body: {
        approvalId: request.approvals[1].id,
        reviewedBy: 'reviewer-2',
      },
    });

    await expect(
      cms.api.pages.cancelApproval({
        body: { approvalId: request.approvals[1].id },
      }),
    ).rejects.toThrow(/approval is not pending/i);

    const listed = await cms.api.pages.listApprovals({
      query: { mergeRequestId: mr.mergeRequestId },
    });

    expect(listed.total).toBe(1);
    expect(listed.approvals[0].status).toBe('approved');
  });

  it('rejects duplicate approval requests for the same reviewer', async () => {
    const { cms, mr } = await createMergeRequestFixture();

    await cms.api.pages.requestApproval({
      body: {
        mergeRequestId: mr.mergeRequestId,
        requestedBy: 'author-1',
        requestedReviewers: ['reviewer-1'],
      },
    });

    await expect(
      cms.api.pages.requestApproval({
        body: {
          mergeRequestId: mr.mergeRequestId,
          requestedBy: 'author-1',
          requestedReviewers: ['reviewer-1'],
        },
      }),
    ).rejects.toThrow(/already been requested/i);
  });

  it('rejects approving a non-pending approval', async () => {
    const { cms, mr } = await createMergeRequestFixture();

    const request = await cms.api.pages.requestApproval({
      body: {
        mergeRequestId: mr.mergeRequestId,
        requestedBy: 'author-1',
        requestedReviewers: ['reviewer-1'],
      },
    });

    await cms.api.pages.approve({
      body: {
        approvalId: request.approvals[0].id,
        reviewedBy: 'reviewer-1',
      },
    });

    await expect(
      cms.api.pages.approve({
        body: {
          approvalId: request.approvals[0].id,
          reviewedBy: 'reviewer-1',
        },
      }),
    ).rejects.toThrow(/not pending/i);
  });

  it('allows approving an MR approval even after the source branch advanced', async () => {
    const { cms, mr, root, draft } = await createMergeRequestFixture();

    const request = await cms.api.pages.requestApproval({
      body: {
        mergeRequestId: mr.mergeRequestId,
        requestedBy: 'author-1',
        requestedReviewers: ['reviewer-1'],
      },
    });

    await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: draft.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Another block' },
      },
    });

    const approved = await cms.api.pages.approve({
      body: {
        approvalId: request.approvals[0].id,
        reviewedBy: 'reviewer-1',
      },
    });

    expect(approved.status).toBe('approved');
  });

  it('allows rejecting an MR approval even after the source branch advanced', async () => {
    const { cms, mr, root, draft } = await createMergeRequestFixture();

    const request = await cms.api.pages.requestApproval({
      body: {
        mergeRequestId: mr.mergeRequestId,
        requestedBy: 'author-1',
        requestedReviewers: ['reviewer-1'],
      },
    });

    await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: draft.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Another block' },
      },
    });

    const rejected = await cms.api.pages.reject({
      body: {
        approvalId: request.approvals[0].id,
        reviewedBy: 'reviewer-1',
        rejectionReason: 'needs work',
      },
    });

    expect(rejected.status).toBe('rejected');
  });

  it('still rejects publication approval when branch has advanced past the approved commit', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/pub-stale', properties: { title: 'Page' } },
    });

    const request = await cms.api.pages.requestApproval({
      body: {
        branchId: root.branchId,
        requestedBy: 'author-1',
        requestedReviewers: ['reviewer-1'],
      },
    });

    await cms.api.pages.updateRoot({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        slug: '/pub-stale',
        properties: { title: 'Updated' },
      },
    });

    await expect(
      cms.api.pages.approve({
        body: {
          approvalId: request.approvals[0].id,
          reviewedBy: 'reviewer-1',
        },
      }),
    ).rejects.toThrow(/stale/i);
  });

  it('returns empty results for contradictory targetType + mergeRequestId filter', async () => {
    const { cms, mr } = await createMergeRequestFixture();

    await cms.api.pages.requestApproval({
      body: {
        mergeRequestId: mr.mergeRequestId,
        requestedBy: 'author-1',
        requestedReviewers: ['reviewer-1'],
      },
    });

    const listed = await cms.api.pages.listApprovals({
      query: {
        targetType: 'publication',
        mergeRequestId: mr.mergeRequestId,
      },
    });

    expect(listed.total).toBe(0);
    expect(listed.approvals).toHaveLength(0);
  });

  it('captures publication approvals for the exact branch head commit', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/publication-approval', properties: { title: 'Page' } },
    });

    const firstRequest = await cms.api.pages.requestApproval({
      body: {
        branchId: root.branchId,
        requestedBy: 'author-1',
        requestedReviewers: ['reviewer-1'],
      },
    });

    await cms.api.pages.updateRoot({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        slug: '/publication-approval',
        properties: {
          title: 'Page Updated',
        },
      },
    });

    const secondRequest = await cms.api.pages.requestApproval({
      body: {
        branchId: root.branchId,
        requestedBy: 'author-1',
        requestedReviewers: ['reviewer-1'],
      },
    });

    expect(firstRequest.approvals[0].targetType).toBe('publication');
    expect(secondRequest.approvals[0].targetType).toBe('publication');
    expect(secondRequest.approvals[0].commitId).not.toBe(
      firstRequest.approvals[0].commitId,
    );

    const listed = await cms.api.pages.listApprovals({
      query: {
        branchId: root.branchId,
        targetType: 'publication',
      },
    });

    expect(listed.total).toBe(2);
    expect(
      listed.approvals.every((approval) => approval.mergeRequestId === null),
    ).toBe(true);
  });

  it('excludes approvals whose root was soft-deleted', async () => {
    const { cms, root, mr } = await createMergeRequestFixture();

    await cms.api.pages.requestApproval({
      body: {
        mergeRequestId: mr.mergeRequestId,
        requestedBy: 'author-1',
        requestedReviewers: ['reviewer-1'],
        message: 'Please review',
      },
    });

    const before = await cms.api.pages.listApprovals({ query: {} });
    expect(before.total).toBeGreaterThan(0);

    // Soft-delete the page; its approvals must drop out of the list.
    await cms.api.pages.deleteRoot({ body: { rootId: root.rootId } });

    const after = await cms.api.pages.listApprovals({ query: {} });
    expect(after.total).toBe(0);
    expect(after.approvals).toHaveLength(0);
  });
});
