export async function publishApprovedBranch(
  cms: any,
  input: {
    rootId: string;
    branchId: string;
    publishedBy?: string;
  },
) {
  const request = await cms.api.pages.requestApproval({
    body: {
      branchId: input.branchId,
      requestedReviewers: ['reviewer-1'],
    },
    context: { userId: 'requester-1' },
  });

  await cms.api.pages.approve({
    body: {
      approvalId: request.approvals[0].id,
    },
    context: { userId: 'reviewer-1' },
  });

  return await cms.api.pages.publishBranch({ body: input });
}

export async function requestAndApproveMerge(
  cms: any,
  mergeRequestId: string,
  reviewers: string[] = ['reviewer-1'],
) {
  const request = await cms.api.pages.requestApproval({
    body: {
      mergeRequestId,
      requestedReviewers: reviewers,
    },
    context: { userId: 'requester-1' },
  });

  for (const approval of request.approvals) {
    await cms.api.pages.approve({
      body: {
        approvalId: approval.id,
      },
      context: { userId: approval.requestedReviewer },
    });
  }
}
