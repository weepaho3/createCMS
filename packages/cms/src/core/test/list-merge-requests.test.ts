import { describe, expect, it } from 'vitest';

import { setupTestCMS } from '../../../test/utils/cms';

// Pins the perf-11 follow-up (commit 8d6f64e): listMergeRequests.commentCount
// must count only LIVE comment threads — a soft-deleted thread (deletedAt set)
// must not inflate the count, matching the soft-delete model used everywhere else.
describe('listMergeRequests — commentCount excludes soft-deleted threads', () => {
  it('drops a soft-deleted comment thread from the count', async () => {
    const { cms } = await setupTestCMS({
      authMiddleware: async () => ({ userId: 'tester' }),
    });

    const root = await cms.api.pages.createRoot({
      body: { slug: 'mr', properties: { title: 'MR' } },
    });
    const draft = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'feature',
        sourceBranchId: root.branchId,
      },
    });
    const { mergeRequest } = await cms.api.pages.createMergeRequest({
      body: {
        sourceBranchId: draft.branch.id,
        targetBranchId: root.branchId,
        title: 'MR',
        createdBy: 'tester',
      },
    });

    const t1 = await cms.api.pages.createCommentThread({
      body: { targetType: 'mergeRequest', mergeRequestId: mergeRequest.id, body: 'first' },
    });
    await cms.api.pages.createCommentThread({
      body: { targetType: 'mergeRequest', mergeRequestId: mergeRequest.id, body: 'second' },
    });

    const countFor = async () =>
      (await cms.api.pages.listMergeRequests()).mergeRequests.find(
        (m) => m.id === mergeRequest.id,
      )?.commentCount;

    expect(await countFor()).toBe(2);

    // Soft-delete one thread → it must fall out of the count.
    await cms.api.pages.deleteCommentThread({
      body: { threadId: t1.thread.id },
    });

    expect(await countFor()).toBe(1);
  });
});
