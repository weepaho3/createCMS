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
      requestedBy: 'requester-1',
      requestedReviewers: ['reviewer-1'],
    },
  });

  await cms.api.pages.approve({
    body: {
      approvalId: request.approvals[0].id,
      reviewedBy: 'reviewer-1',
    },
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
      requestedBy: 'requester-1',
      requestedReviewers: reviewers,
    },
  });

  for (const approval of request.approvals) {
    await cms.api.pages.approve({
      body: {
        approvalId: approval.id,
        reviewedBy: approval.requestedReviewer,
      },
    });
  }
}
