import { describe, expect, it } from 'vitest';

import { createCMS } from '../../../index';
import { setupTestCMS } from '../../../test-utils/cms';
import { setupTestDB } from '../../../test-utils/db';
import {
  DUMMY_MEDIA_CONFIG,
  TEST_COLLECTIONS,
} from '../../../test-utils/fixtures';

const USER_1 = 'user-1';
const USER_2 = 'user-2';
const USER_3 = 'user-3';

function createCMSWithUser(db: any, userId: string) {
  return createCMS({
    db,
    media: { ...DUMMY_MEDIA_CONFIG },
    collections: TEST_COLLECTIONS,
    authMiddleware: async () => ({ userId }),
  });
}

async function setupCommentFixture(userId = USER_1) {
  const { cms, db } = await setupTestCMS({
    authMiddleware: async () => ({ userId }),
  });

  const root = await cms.api.pages.createRoot({
    body: { slug: 'comments-page', properties: { title: 'Page' } },
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
      properties: { text: 'Draft content' },
    },
  });

  const mr = await cms.api.pages.createMergeRequest({
    body: {
      sourceBranchId: draft.branch.id,
      targetBranchId: root.branchId,
      title: 'Test MR',
      createdBy: userId,
    },
  });

  return { cms, db, root, draft, mr };
}

/**
 * Same fixture, but with two separate CMS instances sharing one db, each
 * authenticated as a different user — for tests that must call an endpoint
 * "as" a specific user (e.g. `listMentions`, which now derives its filter
 * from the session rather than a caller-supplied id).
 */
async function setupCommentFixtureMultiUser() {
  const { db } = await setupTestDB();
  const cms1 = createCMSWithUser(db, USER_1);
  const cms2 = createCMSWithUser(db, USER_2);

  const root = await cms1.api.pages.createRoot({
    body: { slug: 'comments-multi-user', properties: { title: 'Page' } },
  });

  const draft = await cms1.api.pages.createBranch({
    body: {
      rootId: root.rootId,
      name: 'draft',
      sourceBranchId: root.branchId,
    },
  });

  const mr = await cms1.api.pages.createMergeRequest({
    body: {
      sourceBranchId: draft.branch.id,
      targetBranchId: root.branchId,
      title: 'Test MR',
      createdBy: USER_1,
    },
  });

  return { cms1, cms2, db, root, draft, mr };
}

describe('comments', () => {
  // ========================================================================
  // CREATE THREAD
  // ========================================================================

  describe('createCommentThread', () => {
    it('creates a merge-request thread with the first message', async () => {
      const { cms, mr } = await setupCommentFixture();

      const result = await cms.api.pages.createCommentThread({
        body: {
          targetType: 'mergeRequest',
          mergeRequestId: mr.mergeRequest.id,
          body: 'Looks good overall!',
        },
      });

      expect(result.thread.id).toBeDefined();
      expect(result.thread.targetType).toBe('mergeRequest');
      expect(result.thread.mergeRequestId).toBe(mr.mergeRequest.id);
      expect(result.thread.status).toBe('open');
      expect(result.thread.collection).toBe('pages');
      expect(result.thread.createdBy).toBe(USER_1);
      expect(result.thread.rootId).toBeDefined();

      expect(result.message.id).toBeDefined();
      expect(result.message.threadId).toBe(result.thread.id);
      expect(result.message.body).toBe('Looks good overall!');
      expect(result.message.messageType).toBe('comment');
      expect(result.message.authorId).toBe(USER_1);
      expect(result.message.mentions).toEqual([]);
    });

    it('creates a block-scoped thread with blockId and optional commitId', async () => {
      const { cms, root } = await setupCommentFixture();

      const result = await cms.api.pages.createCommentThread({
        body: {
          targetType: 'block',
          blockId: root.rootId,
          rootId: root.rootId,
          body: 'This block needs work',
        },
      });

      expect(result.thread.targetType).toBe('block');
      expect(result.thread.blockId).toBe(root.rootId);
      expect(result.thread.rootId).toBe(root.rootId);
      expect(result.thread.mergeRequestId).toBeNull();
    });

    it('creates a block thread within a merge request context', async () => {
      const { cms, root, mr } = await setupCommentFixture();

      const result = await cms.api.pages.createCommentThread({
        body: {
          targetType: 'block',
          blockId: root.rootId,
          mergeRequestId: mr.mergeRequest.id,
          body: 'Inline comment on this block in the MR',
        },
      });

      expect(result.thread.targetType).toBe('block');
      expect(result.thread.blockId).toBe(root.rootId);
      expect(result.thread.mergeRequestId).toBe(mr.mergeRequest.id);
    });

    it('rejects mergeRequest target without mergeRequestId', async () => {
      const { cms } = await setupCommentFixture();

      await expect(
        cms.api.pages.createCommentThread({
          body: {
            targetType: 'mergeRequest',
            body: 'Missing MR id',
          },
        }),
      ).rejects.toThrow();
    });

    it('rejects block target without blockId', async () => {
      const { cms } = await setupCommentFixture();

      await expect(
        cms.api.pages.createCommentThread({
          body: {
            targetType: 'block',
            body: 'Missing block id',
          },
        }),
      ).rejects.toThrow();
    });

    it('rejects when mergeRequestId does not exist', async () => {
      const { cms } = await setupCommentFixture();

      await expect(
        cms.api.pages.createCommentThread({
          body: {
            targetType: 'mergeRequest',
            mergeRequestId: 'nonexistent',
            body: 'Bad MR',
          },
        }),
      ).rejects.toThrow(/merge request not found/i);
    });
  });

  // ========================================================================
  // CREATE MESSAGE (REPLY)
  // ========================================================================

  describe('createCommentMessage', () => {
    it('adds a reply to an existing thread', async () => {
      const { cms, mr } = await setupCommentFixture();

      const { thread } = await cms.api.pages.createCommentThread({
        body: {
          targetType: 'mergeRequest',
          mergeRequestId: mr.mergeRequest.id,
          body: 'Initial comment',
        },
      });

      const reply = await cms.api.pages.createCommentMessage({
        body: {
          threadId: thread.id,
          body: 'Thanks for the feedback!',
        },
      });

      expect(reply.message.threadId).toBe(thread.id);
      expect(reply.message.body).toBe('Thanks for the feedback!');
      expect(reply.message.messageType).toBe('comment');
      expect(reply.message.authorId).toBe(USER_1);
      expect(reply.message.mentions).toEqual([]);
    });

    it('supports nested replies via parentMessageId', async () => {
      const { cms, mr } = await setupCommentFixture();

      const { thread, message: firstMsg } =
        await cms.api.pages.createCommentThread({
          body: {
            targetType: 'mergeRequest',
            mergeRequestId: mr.mergeRequest.id,
            body: 'Top-level comment',
          },
        });

      const reply = await cms.api.pages.createCommentMessage({
        body: {
          threadId: thread.id,
          body: 'Reply to first message',
          parentMessageId: firstMsg.id,
        },
      });

      expect(reply.message.parentMessageId).toBe(firstMsg.id);
    });

    it('rejects reply to non-existent thread', async () => {
      const { cms } = await setupCommentFixture();

      await expect(
        cms.api.pages.createCommentMessage({
          body: {
            threadId: 'nonexistent',
            body: 'Orphan reply',
          },
        }),
      ).rejects.toThrow(/comment thread not found/i);
    });

    it('rejects parentMessageId from a different thread', async () => {
      const { cms, mr, root } = await setupCommentFixture();

      const { thread: thread1, message: msg1 } =
        await cms.api.pages.createCommentThread({
          body: {
            targetType: 'mergeRequest',
            mergeRequestId: mr.mergeRequest.id,
            body: 'Thread 1',
          },
        });

      const { thread: thread2 } = await cms.api.pages.createCommentThread({
        body: {
          targetType: 'block',
          blockId: root.rootId,
          body: 'Thread 2',
        },
      });

      await expect(
        cms.api.pages.createCommentMessage({
          body: {
            threadId: thread2.id,
            body: 'Cross-thread reply',
            parentMessageId: msg1.id,
          },
        }),
      ).rejects.toThrow(/comment message not found/i);
    });
  });

  // ========================================================================
  // REPLY TO RESOLVED THREAD
  // ========================================================================

  describe('reply to resolved thread', () => {
    it('allows replying to a resolved thread', async () => {
      const { cms, mr } = await setupCommentFixture();

      const { thread } = await cms.api.pages.createCommentThread({
        body: {
          targetType: 'mergeRequest',
          mergeRequestId: mr.mergeRequest.id,
          body: 'Will be resolved',
        },
      });

      await cms.api.pages.resolveCommentThread({
        body: { threadId: thread.id },
      });

      const reply = await cms.api.pages.createCommentMessage({
        body: {
          threadId: thread.id,
          body: 'Follow-up after resolve',
        },
      });

      expect(reply.message.body).toBe('Follow-up after resolve');
      expect(reply.message.threadId).toBe(thread.id);
    });
  });

  // ========================================================================
  // LIST THREADS
  // ========================================================================

  describe('listCommentThreads', () => {
    it('lists threads filtered by mergeRequestId', async () => {
      const { cms, mr, root } = await setupCommentFixture();

      await cms.api.pages.createCommentThread({
        body: {
          targetType: 'mergeRequest',
          mergeRequestId: mr.mergeRequest.id,
          body: 'MR comment',
        },
      });

      await cms.api.pages.createCommentThread({
        body: {
          targetType: 'block',
          blockId: root.rootId,
          body: 'Block comment (no MR)',
        },
      });

      const result = await cms.api.pages.listCommentThreads({
        query: { mergeRequestId: mr.mergeRequest.id },
      });

      expect(result.total).toBe(1);
      expect(result.threads[0].mergeRequestId).toBe(mr.mergeRequest.id);
      expect(result.threads[0].messageCount).toBeGreaterThanOrEqual(1);
      expect(result.threads[0].firstMessage).toBeDefined();
    });

    it('lists threads filtered by blockId', async () => {
      const { cms, root, mr } = await setupCommentFixture();

      await cms.api.pages.createCommentThread({
        body: {
          targetType: 'block',
          blockId: root.rootId,
          body: 'Block comment',
        },
      });

      await cms.api.pages.createCommentThread({
        body: {
          targetType: 'mergeRequest',
          mergeRequestId: mr.mergeRequest.id,
          body: 'MR comment',
        },
      });

      const result = await cms.api.pages.listCommentThreads({
        query: { blockId: root.rootId },
      });

      expect(result.total).toBe(1);
      expect(result.threads[0].blockId).toBe(root.rootId);
    });

    it('lists threads filtered by status', async () => {
      const { cms, mr } = await setupCommentFixture();

      const { thread } = await cms.api.pages.createCommentThread({
        body: {
          targetType: 'mergeRequest',
          mergeRequestId: mr.mergeRequest.id,
          body: 'Will be resolved',
        },
      });

      await cms.api.pages.resolveCommentThread({
        body: { threadId: thread.id },
      });

      await cms.api.pages.createCommentThread({
        body: {
          targetType: 'mergeRequest',
          mergeRequestId: mr.mergeRequest.id,
          body: 'Still open',
        },
      });

      const openThreads = await cms.api.pages.listCommentThreads({
        query: { status: 'open' },
      });
      expect(openThreads.total).toBe(1);

      const resolvedThreads = await cms.api.pages.listCommentThreads({
        query: { status: 'resolved' },
      });
      expect(resolvedThreads.total).toBe(1);
    });

    it('supports pagination', async () => {
      const { cms, mr } = await setupCommentFixture();

      for (let i = 0; i < 5; i++) {
        await cms.api.pages.createCommentThread({
          body: {
            targetType: 'mergeRequest',
            mergeRequestId: mr.mergeRequest.id,
            body: `Comment ${i}`,
          },
        });
      }

      const page1 = await cms.api.pages.listCommentThreads({
        query: { limit: 2, offset: 0 },
      });
      expect(page1.threads).toHaveLength(2);
      expect(page1.total).toBe(5);
      expect(page1.hasMore).toBe(true);

      const page3 = await cms.api.pages.listCommentThreads({
        query: { limit: 2, offset: 4 },
      });
      expect(page3.threads).toHaveLength(1);
      expect(page3.hasMore).toBe(false);
    });
  });

  // ========================================================================
  // GET THREAD
  // ========================================================================

  describe('getCommentThread', () => {
    it('returns thread with ordered messages (comments + system)', async () => {
      const { cms, mr } = await setupCommentFixture();

      const { thread } = await cms.api.pages.createCommentThread({
        body: {
          targetType: 'mergeRequest',
          mergeRequestId: mr.mergeRequest.id,
          body: 'First comment',
        },
      });

      await cms.api.pages.createCommentMessage({
        body: { threadId: thread.id, body: 'Second comment' },
      });

      await cms.api.pages.resolveCommentThread({
        body: { threadId: thread.id },
      });

      const result = await cms.api.pages.getCommentThread({
        query: { threadId: thread.id },
      });

      expect(result.thread.id).toBe(thread.id);
      expect(result.thread.status).toBe('resolved');
      expect(result.messages).toHaveLength(3);
      expect(result.messages[0].messageType).toBe('comment');
      expect(result.messages[0].body).toBe('First comment');
      expect(result.messages[1].messageType).toBe('comment');
      expect(result.messages[1].body).toBe('Second comment');
      expect(result.messages[2].messageType).toBe('system');
      expect(result.messages[2].systemType).toBe('threadResolved');
    });

    it('rejects when thread does not exist', async () => {
      const { cms } = await setupCommentFixture();

      await expect(
        cms.api.pages.getCommentThread({
          query: { threadId: 'nonexistent' },
        }),
      ).rejects.toThrow(/comment thread not found/i);
    });
  });

  // ========================================================================
  // RESOLVE THREAD
  // ========================================================================

  describe('resolveCommentThread', () => {
    it('resolves a thread and inserts a system message', async () => {
      const { cms, mr } = await setupCommentFixture();

      const { thread } = await cms.api.pages.createCommentThread({
        body: {
          targetType: 'mergeRequest',
          mergeRequestId: mr.mergeRequest.id,
          body: 'Please fix this',
        },
      });

      const result = await cms.api.pages.resolveCommentThread({
        body: { threadId: thread.id },
      });

      expect(result.thread.status).toBe('resolved');
      expect(result.thread.resolvedBy).toBe(USER_1);
      expect(result.thread.resolvedAt).toBeDefined();

      expect(result.message.messageType).toBe('system');
      expect(result.message.systemType).toBe('threadResolved');
      expect(result.message.meta).toEqual({ by: USER_1 });
    });

    it('rejects resolving an already-resolved thread', async () => {
      const { cms, mr } = await setupCommentFixture();

      const { thread } = await cms.api.pages.createCommentThread({
        body: {
          targetType: 'mergeRequest',
          mergeRequestId: mr.mergeRequest.id,
          body: 'Fix this',
        },
      });

      await cms.api.pages.resolveCommentThread({
        body: { threadId: thread.id },
      });

      await expect(
        cms.api.pages.resolveCommentThread({
          body: { threadId: thread.id },
        }),
      ).rejects.toThrow(/already resolved/i);
    });
  });

  // ========================================================================
  // REOPEN THREAD
  // ========================================================================

  describe('reopenCommentThread', () => {
    it('reopens a resolved thread and inserts a system message', async () => {
      const { cms, mr } = await setupCommentFixture();

      const { thread } = await cms.api.pages.createCommentThread({
        body: {
          targetType: 'mergeRequest',
          mergeRequestId: mr.mergeRequest.id,
          body: 'Fix this',
        },
      });

      await cms.api.pages.resolveCommentThread({
        body: { threadId: thread.id },
      });

      const result = await cms.api.pages.reopenCommentThread({
        body: { threadId: thread.id },
      });

      expect(result.thread.status).toBe('open');
      expect(result.thread.resolvedBy).toBeNull();
      expect(result.thread.resolvedAt).toBeNull();

      expect(result.message.messageType).toBe('system');
      expect(result.message.systemType).toBe('threadReopened');
    });

    it('rejects reopening a thread that is not resolved', async () => {
      const { cms, mr } = await setupCommentFixture();

      const { thread } = await cms.api.pages.createCommentThread({
        body: {
          targetType: 'mergeRequest',
          mergeRequestId: mr.mergeRequest.id,
          body: 'Still open',
        },
      });

      await expect(
        cms.api.pages.reopenCommentThread({
          body: { threadId: thread.id },
        }),
      ).rejects.toThrow(/not resolved/i);
    });
  });

  // ========================================================================
  // UPDATE MESSAGE
  // ========================================================================

  describe('updateCommentMessage', () => {
    it('updates message body and sets editedAt', async () => {
      const { cms, mr } = await setupCommentFixture();

      const { thread, message } = await cms.api.pages.createCommentThread({
        body: {
          targetType: 'mergeRequest',
          mergeRequestId: mr.mergeRequest.id,
          body: 'Original text',
        },
      });

      const updated = await cms.api.pages.updateCommentMessage({
        body: {
          messageId: message.id,
          body: 'Updated text',
        },
      });

      expect(updated.message.body).toBe('Updated text');
      expect(updated.message.editedAt).toBeDefined();
    });

    it('rejects updating a non-existent message', async () => {
      const { cms } = await setupCommentFixture();

      await expect(
        cms.api.pages.updateCommentMessage({
          body: {
            messageId: 'nonexistent',
            body: 'Updated',
          },
        }),
      ).rejects.toThrow(/comment message not found/i);
    });

    it('rejects editing by a different user', async () => {
      const { db } = await setupTestDB();
      const cms1 = createCMSWithUser(db, USER_1);
      const cms2 = createCMSWithUser(db, USER_2);

      const root = await cms1.api.pages.createRoot({
        body: { slug: 'edit-auth', properties: { title: 'Page' } },
      });

      const draft = await cms1.api.pages.createBranch({
        body: {
          rootId: root.rootId,
          name: 'draft',
          sourceBranchId: root.branchId,
        },
      });

      const mr = await cms1.api.pages.createMergeRequest({
        body: {
          sourceBranchId: draft.branch.id,
          targetBranchId: root.branchId,
          title: 'Test MR',
          createdBy: USER_1,
        },
      });

      const { message } = await cms1.api.pages.createCommentThread({
        body: {
          targetType: 'mergeRequest',
          mergeRequestId: mr.mergeRequest.id,
          body: 'User 1 comment',
        },
      });

      await expect(
        cms2.api.pages.updateCommentMessage({
          body: {
            messageId: message.id,
            body: 'Hijacked!',
          },
        }),
      ).rejects.toThrow(/author/i);
    });
  });

  // ========================================================================
  // DELETE MESSAGE
  // ========================================================================

  describe('deleteCommentMessage', () => {
    it('soft-deletes a message and hides body', async () => {
      const { cms, mr } = await setupCommentFixture();

      const { thread, message } = await cms.api.pages.createCommentThread({
        body: {
          targetType: 'mergeRequest',
          mergeRequestId: mr.mergeRequest.id,
          body: 'Will be deleted',
        },
      });

      const deleted = await cms.api.pages.deleteCommentMessage({
        body: { messageId: message.id },
      });

      expect(deleted.message.deletedAt).toBeDefined();

      const threadDetail = await cms.api.pages.getCommentThread({
        query: { threadId: thread.id },
      });

      const deletedMsg = threadDetail.messages.find((m) => m.id === message.id);
      expect(deletedMsg?.body).toBeNull();
    });

    it('rejects deleting a non-existent message', async () => {
      const { cms } = await setupCommentFixture();

      await expect(
        cms.api.pages.deleteCommentMessage({
          body: { messageId: 'nonexistent' },
        }),
      ).rejects.toThrow(/comment message not found/i);
    });

    it('rejects deleting an already-deleted message', async () => {
      const { cms, mr } = await setupCommentFixture();

      const { message } = await cms.api.pages.createCommentThread({
        body: {
          targetType: 'mergeRequest',
          mergeRequestId: mr.mergeRequest.id,
          body: 'Double delete',
        },
      });

      await cms.api.pages.deleteCommentMessage({
        body: { messageId: message.id },
      });

      await expect(
        cms.api.pages.deleteCommentMessage({
          body: { messageId: message.id },
        }),
      ).rejects.toThrow(/deleted/i);
    });

    it('rejects deleting by a different user', async () => {
      const { db } = await setupTestDB();
      const cms1 = createCMSWithUser(db, USER_1);
      const cms2 = createCMSWithUser(db, USER_2);

      const root = await cms1.api.pages.createRoot({
        body: { slug: 'del-auth', properties: { title: 'Page' } },
      });

      const draft = await cms1.api.pages.createBranch({
        body: {
          rootId: root.rootId,
          name: 'draft',
          sourceBranchId: root.branchId,
        },
      });

      const mr = await cms1.api.pages.createMergeRequest({
        body: {
          sourceBranchId: draft.branch.id,
          targetBranchId: root.branchId,
          title: 'Test MR',
          createdBy: USER_1,
        },
      });

      const { message } = await cms1.api.pages.createCommentThread({
        body: {
          targetType: 'mergeRequest',
          mergeRequestId: mr.mergeRequest.id,
          body: 'User 1 comment',
        },
      });

      await expect(
        cms2.api.pages.deleteCommentMessage({
          body: { messageId: message.id },
        }),
      ).rejects.toThrow(/author/i);
    });
  });

  // ========================================================================
  // COLLECTION ISOLATION
  // ========================================================================

  describe('collection isolation', () => {
    it('threads are scoped to their collection', async () => {
      const { cms, mr } = await setupCommentFixture();

      const { thread } = await cms.api.pages.createCommentThread({
        body: {
          targetType: 'mergeRequest',
          mergeRequestId: mr.mergeRequest.id,
          body: 'Pages thread',
        },
      });

      const listed = await cms.api.pages.listCommentThreads({
        query: {},
      });
      expect(listed.total).toBe(1);

      const detail = await cms.api.pages.getCommentThread({
        query: { threadId: thread.id },
      });
      expect(detail.thread.collection).toBe('pages');
    });
  });

  // ========================================================================
  // FULL LIFECYCLE
  // ========================================================================

  describe('full lifecycle', () => {
    it('create → reply → resolve → reopen produces correct message timeline', async () => {
      const { cms, mr } = await setupCommentFixture();

      const { thread } = await cms.api.pages.createCommentThread({
        body: {
          targetType: 'mergeRequest',
          mergeRequestId: mr.mergeRequest.id,
          body: 'Please review this section',
        },
      });

      await cms.api.pages.createCommentMessage({
        body: { threadId: thread.id, body: 'I agree, needs changes' },
      });

      await cms.api.pages.resolveCommentThread({
        body: { threadId: thread.id },
      });

      await cms.api.pages.reopenCommentThread({
        body: { threadId: thread.id },
      });

      await cms.api.pages.createCommentMessage({
        body: { threadId: thread.id, body: 'Actually, one more thing' },
      });

      const detail = await cms.api.pages.getCommentThread({
        query: { threadId: thread.id },
      });

      expect(detail.thread.status).toBe('open');
      expect(detail.messages).toHaveLength(5);

      const types = detail.messages.map((m) => m.messageType);
      expect(types).toEqual([
        'comment',
        'comment',
        'system',
        'system',
        'comment',
      ]);

      const systemTypes = detail.messages
        .filter((m) => m.messageType === 'system')
        .map((m) => m.systemType);
      expect(systemTypes).toEqual(['threadResolved', 'threadReopened']);
    });
  });

  // ========================================================================
  // MENTIONS
  // ========================================================================

  describe('mentions', () => {
    it('creates thread with mentions and stores them', async () => {
      const { cms, mr } = await setupCommentFixture();

      const result = await cms.api.pages.createCommentThread({
        body: {
          targetType: 'mergeRequest',
          mergeRequestId: mr.mergeRequest.id,
          body: 'Hey @user-2 and @user-3, check this out',
          mentions: [USER_2, USER_3],
        },
      });

      expect(result.message.mentions).toHaveLength(2);
      expect(result.message.mentions).toContain(USER_2);
      expect(result.message.mentions).toContain(USER_3);
    });

    it('creates reply with mentions', async () => {
      const { cms, mr } = await setupCommentFixture();

      const { thread } = await cms.api.pages.createCommentThread({
        body: {
          targetType: 'mergeRequest',
          mergeRequestId: mr.mergeRequest.id,
          body: 'Initial comment',
        },
      });

      const reply = await cms.api.pages.createCommentMessage({
        body: {
          threadId: thread.id,
          body: 'cc @user-2',
          mentions: [USER_2],
        },
      });

      expect(reply.message.mentions).toEqual([USER_2]);
    });

    it('excludes self-mentions', async () => {
      const { cms, mr } = await setupCommentFixture();

      const result = await cms.api.pages.createCommentThread({
        body: {
          targetType: 'mergeRequest',
          mergeRequestId: mr.mergeRequest.id,
          body: 'Mentioning myself @user-1 and @user-2',
          mentions: [USER_1, USER_2],
        },
      });

      expect(result.message.mentions).toEqual([USER_2]);
    });

    it('deduplicates mentions', async () => {
      const { cms, mr } = await setupCommentFixture();

      const result = await cms.api.pages.createCommentThread({
        body: {
          targetType: 'mergeRequest',
          mergeRequestId: mr.mergeRequest.id,
          body: '@user-2 @user-2 @user-2',
          mentions: [USER_2, USER_2, USER_2],
        },
      });

      expect(result.message.mentions).toEqual([USER_2]);
    });

    it('updates mentions when editing a message', async () => {
      const { cms, mr } = await setupCommentFixture();

      const { message } = await cms.api.pages.createCommentThread({
        body: {
          targetType: 'mergeRequest',
          mergeRequestId: mr.mergeRequest.id,
          body: 'cc @user-2',
          mentions: [USER_2],
        },
      });

      expect(message.mentions).toEqual([USER_2]);

      const updated = await cms.api.pages.updateCommentMessage({
        body: {
          messageId: message.id,
          body: 'cc @user-3 instead',
          mentions: [USER_3],
        },
      });

      expect(updated.message.mentions).toEqual([USER_3]);
    });

    it('getCommentThread includes mentions on each message', async () => {
      const { cms, mr } = await setupCommentFixture();

      const { thread } = await cms.api.pages.createCommentThread({
        body: {
          targetType: 'mergeRequest',
          mergeRequestId: mr.mergeRequest.id,
          body: 'Hey @user-2',
          mentions: [USER_2],
        },
      });

      await cms.api.pages.createCommentMessage({
        body: {
          threadId: thread.id,
          body: 'Also cc @user-3',
          mentions: [USER_3],
        },
      });

      const detail = await cms.api.pages.getCommentThread({
        query: { threadId: thread.id },
      });

      expect(detail.messages[0].mentions).toEqual([USER_2]);
      expect(detail.messages[1].mentions).toEqual([USER_3]);
    });

    it('listCommentThreads filters by mentionedUserId', async () => {
      const { cms, mr } = await setupCommentFixture();

      await cms.api.pages.createCommentThread({
        body: {
          targetType: 'mergeRequest',
          mergeRequestId: mr.mergeRequest.id,
          body: 'Mentions user-2',
          mentions: [USER_2],
        },
      });

      await cms.api.pages.createCommentThread({
        body: {
          targetType: 'mergeRequest',
          mergeRequestId: mr.mergeRequest.id,
          body: 'Mentions user-3',
          mentions: [USER_3],
        },
      });

      await cms.api.pages.createCommentThread({
        body: {
          targetType: 'mergeRequest',
          mergeRequestId: mr.mergeRequest.id,
          body: 'No mentions',
        },
      });

      const result = await cms.api.pages.listCommentThreads({
        query: { mentionedUserId: USER_2 },
      });

      expect(result.total).toBe(1);
      // firstMessage's inferred type omits `mentions` (a pre-existing gap in the
      // listCommentThreads return type); the field is populated at runtime.
      expect(
        (result.threads[0].firstMessage as { mentions?: string[] } | undefined)
          ?.mentions,
      ).toContain(USER_2);
    });

    it("listMentions returns only the calling user's mentions", async () => {
      const { cms1, cms2, mr } = await setupCommentFixtureMultiUser();

      await cms1.api.pages.createCommentThread({
        body: {
          targetType: 'mergeRequest',
          mergeRequestId: mr.mergeRequest.id,
          body: 'Hey @user-2',
          mentions: [USER_2],
        },
      });

      const { thread: thread2 } = await cms1.api.pages.createCommentThread({
        body: {
          targetType: 'mergeRequest',
          mergeRequestId: mr.mergeRequest.id,
          body: 'Another thread',
        },
      });

      await cms1.api.pages.createCommentMessage({
        body: {
          threadId: thread2.id,
          body: 'Also cc @user-2',
          mentions: [USER_2],
        },
      });

      // A third thread mentions a different user — it must not leak into
      // user-2's inbox, even though user-1 (comment:read too) created both.
      await cms1.api.pages.createCommentThread({
        body: {
          targetType: 'mergeRequest',
          mergeRequestId: mr.mergeRequest.id,
          body: 'Hey @user-3',
          mentions: [USER_3],
        },
      });

      // Called as user-1 (mentionedUserId is no longer a query param at all —
      // the filter is always the session user).
      const asUser1 = await cms1.api.pages.listMentions({ query: {} });
      expect(asUser1.total).toBe(0);

      const result = await cms2.api.pages.listMentions({ query: {} });

      expect(result.total).toBe(2);
      expect(result.mentions).toHaveLength(2);
      expect(result.mentions.every((m) => m.mentionedUserId === USER_2)).toBe(
        true,
      );
      expect(result.mentions.every((m) => m.mentionedBy === USER_1)).toBe(true);
      expect(result.mentions[0].message).toBeDefined();
      expect(result.mentions[0].thread).toBeDefined();
    });

    it('listMentions filters by threadId', async () => {
      const { cms1, cms2, mr } = await setupCommentFixtureMultiUser();

      const { thread: t1 } = await cms1.api.pages.createCommentThread({
        body: {
          targetType: 'mergeRequest',
          mergeRequestId: mr.mergeRequest.id,
          body: 'Thread 1 @user-2',
          mentions: [USER_2],
        },
      });

      await cms1.api.pages.createCommentThread({
        body: {
          targetType: 'mergeRequest',
          mergeRequestId: mr.mergeRequest.id,
          body: 'Thread 2 @user-2',
          mentions: [USER_2],
        },
      });

      const result = await cms2.api.pages.listMentions({
        query: { threadId: t1.id },
      });

      expect(result.total).toBe(1);
    });

    it('listMentions supports pagination', async () => {
      const { cms1, cms2, mr } = await setupCommentFixtureMultiUser();

      const { thread } = await cms1.api.pages.createCommentThread({
        body: {
          targetType: 'mergeRequest',
          mergeRequestId: mr.mergeRequest.id,
          body: 'Thread with mentions',
        },
      });

      for (let i = 0; i < 5; i++) {
        await cms1.api.pages.createCommentMessage({
          body: {
            threadId: thread.id,
            body: `Reply ${i} @user-2`,
            mentions: [USER_2],
          },
        });
      }

      const page1 = await cms2.api.pages.listMentions({
        query: { limit: 2, offset: 0 },
      });
      expect(page1.mentions).toHaveLength(2);
      expect(page1.total).toBe(5);
      expect(page1.hasMore).toBe(true);

      const page3 = await cms2.api.pages.listMentions({
        query: { limit: 2, offset: 4 },
      });
      expect(page3.mentions).toHaveLength(1);
      expect(page3.hasMore).toBe(false);
    });

    it('no mentions without explicit mentions array', async () => {
      const { cms, mr } = await setupCommentFixture();

      const result = await cms.api.pages.createCommentThread({
        body: {
          targetType: 'mergeRequest',
          mergeRequestId: mr.mergeRequest.id,
          body: 'No mentions here',
        },
      });

      expect(result.message.mentions).toEqual([]);

      const mentionsList = await cms.api.pages.listMentions({ query: {} });
      expect(mentionsList.total).toBe(0);
    });

    it('listMentions requires an authenticated user', async () => {
      const { cms } = await setupTestCMS({
        authMiddleware: async () => ({}),
      });

      await expect(cms.api.pages.listMentions({ query: {} })).rejects.toThrow(
        /user/i,
      );
    });
  });

  describe('deleteCommentThread', () => {
    it('soft-deletes a thread: gone from list and get 404s', async () => {
      const { cms, mr } = await setupCommentFixture();

      const created = await cms.api.pages.createCommentThread({
        body: {
          targetType: 'mergeRequest',
          mergeRequestId: mr.mergeRequest.id,
          body: 'To be deleted',
        },
      });
      const threadId = created.thread.id;

      const res = await cms.api.pages.deleteCommentThread({
        body: { threadId },
      });
      expect(res.threadId).toBe(threadId);

      await expect(
        cms.api.pages.getCommentThread({ query: { threadId } }),
      ).rejects.toThrow(/not found/i);

      const list = await cms.api.pages.listCommentThreads({
        query: { mergeRequestId: mr.mergeRequest.id },
      });
      expect(list.threads.map((t: any) => t.id)).not.toContain(threadId);
    });

    it('throws COMMENT_THREAD_NOT_FOUND for an unknown thread', async () => {
      const { cms } = await setupCommentFixture();
      await expect(
        cms.api.pages.deleteCommentThread({
          body: { threadId: 'commentThread_nope' },
        }),
      ).rejects.toThrow(/not found/i);
    });
  });

  // ========================================================================
  // SOFT-DELETE — resolve/reopen must not operate on a deleted thread
  // ========================================================================

  describe('resolve/reopen on a soft-deleted thread', () => {
    it('resolveCommentThread rejects a soft-deleted thread', async () => {
      const { cms, mr } = await setupCommentFixture();

      const { thread } = await cms.api.pages.createCommentThread({
        body: {
          targetType: 'mergeRequest',
          mergeRequestId: mr.mergeRequest.id,
          body: 'Will be deleted then resolved',
        },
      });

      await cms.api.pages.deleteCommentThread({
        body: { threadId: thread.id },
      });

      await expect(
        cms.api.pages.resolveCommentThread({ body: { threadId: thread.id } }),
      ).rejects.toThrow(/not found/i);
    });

    it('reopenCommentThread rejects a soft-deleted thread', async () => {
      const { cms, mr } = await setupCommentFixture();

      const { thread } = await cms.api.pages.createCommentThread({
        body: {
          targetType: 'mergeRequest',
          mergeRequestId: mr.mergeRequest.id,
          body: 'Will be resolved, deleted, then reopened',
        },
      });

      await cms.api.pages.resolveCommentThread({
        body: { threadId: thread.id },
      });
      await cms.api.pages.deleteCommentThread({
        body: { threadId: thread.id },
      });

      await expect(
        cms.api.pages.reopenCommentThread({ body: { threadId: thread.id } }),
      ).rejects.toThrow(/not found/i);
    });
  });
});
