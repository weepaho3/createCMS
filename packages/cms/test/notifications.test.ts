import { describe, expect, it, vi } from 'vitest';

import type {
  CMSPlugin,
  NotificationPayload,
  OnNotificationHandler,
} from '../src/index';

import { createCMS } from '../src/index';
import { setupTestCMS } from '../src/test-utils/cms';
import { DUMMY_MEDIA_CONFIG, TEST_COLLECTIONS } from '../src/test-utils/fixtures';
import { requestAndApproveMerge } from '../src/test-utils/helpers';

const USER_1 = 'user-1';
const USER_2 = 'user-2';
const USER_3 = 'user-3';

type CMS = Awaited<ReturnType<typeof setupTestCMS>>['cms'];

function createCMSWithUser(
  db: any,
  userId: string,
  opts?: {
    onNotification?: OnNotificationHandler;
    plugins?: CMSPlugin<any>[];
  },
) {
  return createCMS({
    db,
    media: { ...DUMMY_MEDIA_CONFIG },
    collections: TEST_COLLECTIONS,
    authMiddleware: async () => ({ userId }),
    onNotification: opts?.onNotification,
    plugins: opts?.plugins,
  });
}

/**
 * Sets up a root, branch, block, and merge request — the common prerequisite
 * for all trigger tests that need a merge request context.
 */
async function setupMergeRequestContext(cms: CMS, createdBy: string) {
  const root = await cms.api.pages.createRoot({
    body: { slug: `page-${Date.now()}`, properties: { title: 'Page' } },
  });

  const draft = await cms.api.pages.createBranch({
    body: {
      rootId: root.rootId,
      name: `branch-${Date.now()}`,
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
      createdBy,
    },
  });

  return { root, draft, mr };
}

// ---------------------------------------------------------------------------
// Service: notify / notifyMany
// ---------------------------------------------------------------------------

describe('notification service', () => {
  it('persists a notification via notify()', async () => {
    const { cms } = await setupTestCMS({
      authMiddleware: async () => ({ userId: USER_1 }),
    });

    const payload = await cms.notify({
      recipientId: USER_1,
      actorId: USER_2,
      type: 'custom',
      title: 'Hello',
      body: null,
      resourceType: null,
      resourceId: null,
      collection: null,
      meta: null,
    });

    expect(payload.id).toBeDefined();
    expect(payload.id).toMatch(/^ntf_/);
    expect(payload.recipientId).toBe(USER_1);
    expect(payload.actorId).toBe(USER_2);
    expect(payload.type).toBe('custom');
    expect(payload.title).toBe('Hello');
    expect(payload.createdAt).toBeInstanceOf(Date);

    const list = await cms.api.notifications.list();

    expect(list.notifications).toHaveLength(1);
    expect(list.notifications[0].id).toBe(payload.id);
  });

  it('dispatches to onNotification handler', async () => {
    const received: NotificationPayload[] = [];
    const { db } = await setupTestCMS();

    const cms = createCMSWithUser(db, USER_1, {
      onNotification: (n) => {
        received.push(n);
      },
    });

    const payload = await cms.notify({
      recipientId: USER_2,
      actorId: USER_1,
      type: 'custom',
      title: 'Handler test',
      body: null,
      resourceType: null,
      resourceId: null,
      collection: null,
      meta: null,
    });

    expect(received).toHaveLength(1);
    expect(received[0].id).toBe(payload.id);
    expect(received[0].title).toBe('Handler test');
  });

  it('notifyMany persists multiple notifications and dispatches all', async () => {
    const received: NotificationPayload[] = [];
    const { db } = await setupTestCMS();

    const cms = createCMSWithUser(db, USER_1, {
      onNotification: (n) => {
        received.push(n);
      },
    });

    const payloads = await cms.notificationService.notifyMany([
      {
        recipientId: USER_2,
        actorId: USER_1,
        type: 'custom',
        title: 'Batch 1',
        body: null,
        resourceType: null,
        resourceId: null,
        collection: null,
        meta: null,
      },
      {
        recipientId: USER_3,
        actorId: USER_1,
        type: 'custom',
        title: 'Batch 2',
        body: null,
        resourceType: null,
        resourceId: null,
        collection: null,
        meta: null,
      },
    ]);

    expect(payloads).toHaveLength(2);
    expect(received).toHaveLength(2);
    expect(payloads[0].recipientId).toBe(USER_2);
    expect(payloads[1].recipientId).toBe(USER_3);
  });

  it('notifyMany with empty array returns empty without DB call', async () => {
    const { db } = await setupTestCMS();
    const cms = createCMSWithUser(db, USER_1);
    const payloads = await cms.notificationService.notifyMany([]);
    expect(payloads).toEqual([]);
  });

  it('handler that throws does not break other handlers', async () => {
    const received: NotificationPayload[] = [];
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const { db } = await setupTestCMS();

    const cms = createCMS({
      db,
      media: { ...DUMMY_MEDIA_CONFIG },
      collections: TEST_COLLECTIONS,
      authMiddleware: async () => ({ userId: USER_1 }),
      onNotification: () => {
        throw new Error('boom');
      },
      plugins: [
        {
          id: 'spyPlugin',
          onNotification: (n: NotificationPayload) => {
            received.push(n);
          },
        },
      ],
    });

    const payload = await cms.notify({
      recipientId: USER_2,
      actorId: USER_1,
      type: 'custom',
      title: 'Error resilience',
      body: null,
      resourceType: null,
      resourceId: null,
      collection: null,
      meta: null,
    });

    expect(payload.id).toBeDefined();
    expect(received).toHaveLength(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[cms] onNotification handler failed:',
      expect.any(Error),
    );

    consoleErrorSpy.mockRestore();
  });

  it('async handler rejection is caught and logged', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const { db } = await setupTestCMS();

    const cms = createCMS({
      db,
      media: { ...DUMMY_MEDIA_CONFIG },
      collections: TEST_COLLECTIONS,
      authMiddleware: async () => ({ userId: USER_1 }),
      onNotification: async () => {
        throw new Error('async boom');
      },
    });

    await cms.notify({
      recipientId: USER_2,
      actorId: USER_1,
      type: 'custom',
      title: 'Async error test',
      body: null,
      resourceType: null,
      resourceId: null,
      collection: null,
      meta: null,
    });

    await cms.$flushNotifications();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[cms] onNotification handler failed:',
      expect.any(Error),
    );

    consoleErrorSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Endpoints: listNotifications, markNotificationsRead, markNotificationsUnread,
//            archiveNotification
// ---------------------------------------------------------------------------

describe('notification endpoints', () => {
  async function seedNotifications(cms: CMS, count: number) {
    const payloads: NotificationPayload[] = [];
    for (let i = 0; i < count; i++) {
      payloads.push(
        await cms.notify({
          recipientId: USER_1,
          actorId: USER_2,
          type: 'custom',
          title: `Notification ${i + 1}`,
          body: null,
          resourceType: null,
          resourceId: null,
          collection: 'pages',
          meta: null,
        }),
      );
    }
    return payloads;
  }

  it('lists notifications for the current user with pagination', async () => {
    const { cms } = await setupTestCMS({
      authMiddleware: async () => ({ userId: USER_1 }),
    });

    await seedNotifications(cms, 5);

    const result = await cms.api.notifications.list({
      query: { limit: 2, offset: 0 },
    });

    expect(result.notifications).toHaveLength(2);
    expect(result.total).toBe(5);
    expect(result.hasMore).toBe(true);
    expect(result.unreadCount).toBe(5);
  });

  it('returns unreadCount reflecting total unread across all filters', async () => {
    const { cms } = await setupTestCMS({
      authMiddleware: async () => ({ userId: USER_1 }),
    });

    await seedNotifications(cms, 3);

    const list = await cms.api.notifications.list();
    await cms.api.notifications.markNotificationsRead({
      body: { notificationId: list.notifications[0].id },
    });

    const updated = await cms.api.notifications.list();

    expect(updated.total).toBe(3);
    expect(updated.unreadCount).toBe(2);
  });

  it('filters by unreadOnly', async () => {
    const { cms } = await setupTestCMS({
      authMiddleware: async () => ({ userId: USER_1 }),
    });

    await seedNotifications(cms, 3);

    const list = await cms.api.notifications.list();
    await cms.api.notifications.markNotificationsRead({
      body: { notificationId: list.notifications[0].id },
    });

    const unread = await cms.api.notifications.list({
      query: { unreadOnly: true },
    });

    expect(unread.notifications).toHaveLength(2);
    expect(unread.total).toBe(2);
  });

  it('filters by type', async () => {
    const { cms } = await setupTestCMS({
      authMiddleware: async () => ({ userId: USER_1 }),
    });

    await cms.notify({
      recipientId: USER_1,
      actorId: USER_2,
      type: 'mention',
      title: 'Mention',
      body: null,
      resourceType: null,
      resourceId: null,
      collection: null,
      meta: null,
    });

    await cms.notify({
      recipientId: USER_1,
      actorId: USER_2,
      type: 'custom',
      title: 'Custom',
      body: null,
      resourceType: null,
      resourceId: null,
      collection: null,
      meta: null,
    });

    const mentions = await cms.api.notifications.list({
      query: { type: 'mention' },
    });

    expect(mentions.notifications).toHaveLength(1);
    expect(mentions.notifications[0].type).toBe('mention');
  });

  it('filters by collection', async () => {
    const { cms } = await setupTestCMS({
      authMiddleware: async () => ({ userId: USER_1 }),
    });

    await cms.notify({
      recipientId: USER_1,
      actorId: USER_2,
      type: 'custom',
      title: 'Pages notif',
      body: null,
      resourceType: null,
      resourceId: null,
      collection: 'pages',
      meta: null,
    });

    await cms.notify({
      recipientId: USER_1,
      actorId: USER_2,
      type: 'custom',
      title: 'Other notif',
      body: null,
      resourceType: null,
      resourceId: null,
      collection: 'articles',
      meta: null,
    });

    const pages = await cms.api.notifications.list({
      query: { collection: 'pages' },
    });

    expect(pages.notifications).toHaveLength(1);
    expect(pages.notifications[0].collection).toBe('pages');
  });

  it('does not show other users notifications', async () => {
    const { db } = await setupTestCMS();

    const cms1 = createCMSWithUser(db, USER_1);
    const cms2 = createCMSWithUser(db, USER_2);

    await cms1.notify({
      recipientId: USER_1,
      actorId: USER_2,
      type: 'custom',
      title: 'For user 1 only',
      body: null,
      resourceType: null,
      resourceId: null,
      collection: null,
      meta: null,
    });

    const listUser2 = await cms2.api.notifications.list();

    expect(listUser2.notifications).toHaveLength(0);
    expect(listUser2.unreadCount).toBe(0);
  });

  describe('markNotificationsRead', () => {
    it('marks a single notification as read', async () => {
      const { cms } = await setupTestCMS({
        authMiddleware: async () => ({ userId: USER_1 }),
      });

      await seedNotifications(cms, 2);

      const list = await cms.api.notifications.list();
      const notifId = list.notifications[0].id;

      const result = await cms.api.notifications.markNotificationsRead({
        body: { notificationId: notifId },
      });

      expect(result.markedCount).toBe(1);

      const updated = await cms.api.notifications.list();
      expect(updated.unreadCount).toBe(1);
    });

    it('returns markedCount 0 for already-read notification', async () => {
      const { cms } = await setupTestCMS({
        authMiddleware: async () => ({ userId: USER_1 }),
      });

      const notif = await cms.notify({
        recipientId: USER_1,
        actorId: USER_2,
        type: 'custom',
        title: 'Already read test',
        body: null,
        resourceType: null,
        resourceId: null,
        collection: null,
        meta: null,
      });

      await cms.api.notifications.markNotificationsRead({
        body: { notificationId: notif.id },
      });

      const result = await cms.api.notifications.markNotificationsRead({
        body: { notificationId: notif.id },
      });

      expect(result.markedCount).toBe(0);
    });

    it('marks all notifications as read when no id is given', async () => {
      const { cms } = await setupTestCMS({
        authMiddleware: async () => ({ userId: USER_1 }),
      });

      await seedNotifications(cms, 3);

      const result = await cms.api.notifications.markNotificationsRead();

      expect(result.markedCount).toBe(3);

      const list = await cms.api.notifications.list();
      expect(list.unreadCount).toBe(0);
    });

    it('throws NOTIFICATION_NOT_FOUND for non-existent id', async () => {
      const { cms } = await setupTestCMS({
        authMiddleware: async () => ({ userId: USER_1 }),
      });

      await expect(
        cms.api.notifications.markNotificationsRead({
          body: { notificationId: 'ntf_nonexistent' },
        }),
      ).rejects.toThrow(/Notification not found/);
    });

    it('throws NOTIFICATION_RECIPIENT_MISMATCH for other user notification', async () => {
      const { db } = await setupTestCMS();

      const cms1 = createCMSWithUser(db, USER_1);
      const cms2 = createCMSWithUser(db, USER_2);

      const notif = await cms1.notify({
        recipientId: USER_1,
        actorId: USER_2,
        type: 'custom',
        title: 'Not yours',
        body: null,
        resourceType: null,
        resourceId: null,
        collection: null,
        meta: null,
      });

      await expect(
        cms2.api.notifications.markNotificationsRead({
          body: { notificationId: notif.id },
        }),
      ).rejects.toThrow(/You can only access your own notifications/);
    });
  });

  describe('archiveNotification', () => {
    it('soft-deletes a notification (archive)', async () => {
      const { cms } = await setupTestCMS({
        authMiddleware: async () => ({ userId: USER_1 }),
      });

      const notif = await cms.notify({
        recipientId: USER_1,
        actorId: USER_2,
        type: 'custom',
        title: 'To delete',
        body: null,
        resourceType: null,
        resourceId: null,
        collection: null,
        meta: null,
      });

      const result = await cms.api.notifications.archiveNotification({
        body: { notificationId: notif.id },
      });

      expect(result.notificationId).toBe(notif.id);

      const list = await cms.api.notifications.list();
      expect(list.notifications).toHaveLength(0);
      expect(list.unreadCount).toBe(0);
    });

    it('throws NOTIFICATION_NOT_FOUND for non-existent id', async () => {
      const { cms } = await setupTestCMS({
        authMiddleware: async () => ({ userId: USER_1 }),
      });

      await expect(
        cms.api.notifications.archiveNotification({
          body: { notificationId: 'ntf_nonexistent' },
        }),
      ).rejects.toThrow(/Notification not found/);
    });

    it('throws NOTIFICATION_RECIPIENT_MISMATCH for other users notification', async () => {
      const { db } = await setupTestCMS();

      const cms1 = createCMSWithUser(db, USER_1);
      const cms2 = createCMSWithUser(db, USER_2);

      const notif = await cms1.notify({
        recipientId: USER_1,
        actorId: USER_2,
        type: 'custom',
        title: 'Not yours to delete',
        body: null,
        resourceType: null,
        resourceId: null,
        collection: null,
        meta: null,
      });

      await expect(
        cms2.api.notifications.archiveNotification({
          body: { notificationId: notif.id },
        }),
      ).rejects.toThrow(/You can only access your own notifications/);
    });
  });

  describe('markNotificationsUnread', () => {
    it('marks a single read notification unread', async () => {
      const { cms } = await setupTestCMS({
        authMiddleware: async () => ({ userId: USER_1 }),
      });

      const notif = await cms.notify({
        recipientId: USER_1,
        actorId: USER_2,
        type: 'custom',
        title: 'Toggle me',
        body: null,
        resourceType: null,
        resourceId: null,
        collection: null,
        meta: null,
      });

      await cms.api.notifications.markNotificationsRead({
        body: { notificationId: notif.id },
      });

      const unread = await cms.api.notifications.markNotificationsUnread({
        body: { notificationId: notif.id },
      });
      expect(unread.markedCount).toBe(1);

      const list = await cms.api.notifications.list();
      expect(list.unreadCount).toBe(1);
    });

    it('returns markedCount 0 for an already-unread notification', async () => {
      const { cms } = await setupTestCMS({
        authMiddleware: async () => ({ userId: USER_1 }),
      });

      const notif = await cms.notify({
        recipientId: USER_1,
        actorId: USER_2,
        type: 'custom',
        title: 'Already unread',
        body: null,
        resourceType: null,
        resourceId: null,
        collection: null,
        meta: null,
      });

      const unread = await cms.api.notifications.markNotificationsUnread({
        body: { notificationId: notif.id },
      });
      expect(unread.markedCount).toBe(0);
    });

    it('marks all read notifications unread when no id is given', async () => {
      const { cms } = await setupTestCMS({
        authMiddleware: async () => ({ userId: USER_1 }),
      });

      for (const title of ['a', 'b', 'c']) {
        await cms.notify({
          recipientId: USER_1,
          actorId: USER_2,
          type: 'custom',
          title,
          body: null,
          resourceType: null,
          resourceId: null,
          collection: null,
          meta: null,
        });
      }

      await cms.api.notifications.markNotificationsRead();
      const unread = await cms.api.notifications.markNotificationsUnread();
      expect(unread.markedCount).toBe(3);

      const list = await cms.api.notifications.list();
      expect(list.unreadCount).toBe(3);
    });

    it('throws NOTIFICATION_NOT_FOUND for non-existent id', async () => {
      const { cms } = await setupTestCMS({
        authMiddleware: async () => ({ userId: USER_1 }),
      });

      await expect(
        cms.api.notifications.markNotificationsUnread({
          body: { notificationId: 'ntf_nonexistent' },
        }),
      ).rejects.toThrow(/Notification not found/);
    });

    it('throws NOTIFICATION_RECIPIENT_MISMATCH for another users notification', async () => {
      const { db } = await setupTestCMS();
      const cms1 = createCMSWithUser(db, USER_1);
      const cms2 = createCMSWithUser(db, USER_2);

      const notif = await cms1.notify({
        recipientId: USER_1,
        actorId: USER_2,
        type: 'custom',
        title: 'Not yours',
        body: null,
        resourceType: null,
        resourceId: null,
        collection: null,
        meta: null,
      });

      await expect(
        cms2.api.notifications.markNotificationsUnread({
          body: { notificationId: notif.id },
        }),
      ).rejects.toThrow(/You can only access your own notifications/);
    });
  });
});

// ---------------------------------------------------------------------------
// Triggers: comment, mention, approval, merge, publication notifications
// ---------------------------------------------------------------------------

describe('notification triggers', () => {
  describe('comment notifications', () => {
    it('sends mention notifications when creating a comment thread', async () => {
      const received: NotificationPayload[] = [];
      const { db } = await setupTestCMS();

      const cms = createCMSWithUser(db, USER_1, {
        onNotification: (n) => {
          received.push(n);
        },
      });

      const { mr } = await setupMergeRequestContext(cms, USER_1);

      await cms.api.pages.createCommentThread({
        body: {
          targetType: 'mergeRequest',
          mergeRequestId: mr.mergeRequest.id,
          body: 'Hey @user-2 check this!',
          mentions: [USER_2],
        },
      });

      await cms.$flushNotifications();

      const mentions = received.filter((n) => n.type === 'mention');
      expect(mentions).toHaveLength(1);
      expect(mentions[0].recipientId).toBe(USER_2);
      expect(mentions[0].actorId).toBe(USER_1);
    });

    it('sends reply notification to thread creator', async () => {
      const received: NotificationPayload[] = [];
      const { db } = await setupTestCMS();

      const cms1 = createCMSWithUser(db, USER_1);
      const { mr } = await setupMergeRequestContext(cms1, USER_1);

      const thread = await cms1.api.pages.createCommentThread({
        body: {
          targetType: 'mergeRequest',
          mergeRequestId: mr.mergeRequest.id,
          body: 'Original thread',
        },
      });

      const cms2 = createCMSWithUser(db, USER_2, {
        onNotification: (n) => {
          received.push(n);
        },
      });

      await cms2.api.pages.createCommentMessage({
        body: {
          threadId: thread.thread.id,
          body: 'Replying to your thread',
        },
      });

      await cms2.$flushNotifications();

      const replies = received.filter((n) => n.type === 'comment');
      expect(replies).toHaveLength(1);
      expect(replies[0].recipientId).toBe(USER_1);
      expect(replies[0].title).toBe('New reply in your thread');
    });
  });

  describe('thread resolution notifications', () => {
    it('sends threadResolved notification when resolving a thread', async () => {
      const received: NotificationPayload[] = [];
      const { db } = await setupTestCMS();

      const cms1 = createCMSWithUser(db, USER_1);
      const { mr } = await setupMergeRequestContext(cms1, USER_1);

      const thread = await cms1.api.pages.createCommentThread({
        body: {
          targetType: 'mergeRequest',
          mergeRequestId: mr.mergeRequest.id,
          body: 'Thread to resolve',
        },
      });

      const cms2 = createCMSWithUser(db, USER_2, {
        onNotification: (n) => {
          received.push(n);
        },
      });

      await cms2.api.pages.resolveCommentThread({
        body: { threadId: thread.thread.id },
      });

      await cms2.$flushNotifications();

      const resolved = received.filter(
        (n) => n.type === 'threadResolved' && !(n.meta as any)?.reopened,
      );
      expect(resolved).toHaveLength(1);
      expect(resolved[0].recipientId).toBe(USER_1);
    });

    it('sends threadReopened with reopened meta when reopening', async () => {
      const received: NotificationPayload[] = [];
      const { db } = await setupTestCMS();

      const cms1 = createCMSWithUser(db, USER_1);
      const { mr } = await setupMergeRequestContext(cms1, USER_1);

      const thread = await cms1.api.pages.createCommentThread({
        body: {
          targetType: 'mergeRequest',
          mergeRequestId: mr.mergeRequest.id,
          body: 'Thread to reopen',
        },
      });

      const cms2 = createCMSWithUser(db, USER_2, {
        onNotification: (n) => {
          received.push(n);
        },
      });

      await cms2.api.pages.resolveCommentThread({
        body: { threadId: thread.thread.id },
      });

      await cms2.api.pages.reopenCommentThread({
        body: { threadId: thread.thread.id },
      });

      await cms2.$flushNotifications();

      const reopened = received.filter(
        (n) =>
          n.type === 'threadReopened' && (n.meta as any)?.reopened === true,
      );
      expect(reopened).toHaveLength(1);
      expect(reopened[0].recipientId).toBe(USER_1);
      expect((reopened[0].meta as any).reopened).toBe(true);
    });
  });

  describe('approval notifications', () => {
    it('sends approvalRequested notifications to reviewers', async () => {
      const received: NotificationPayload[] = [];
      const { db } = await setupTestCMS();

      const cms = createCMSWithUser(db, USER_1, {
        onNotification: (n) => {
          received.push(n);
        },
      });

      const { mr } = await setupMergeRequestContext(cms, USER_1);

      await cms.api.pages.requestApproval({
        body: {
          mergeRequestId: mr.mergeRequest.id,
          requestedReviewers: [USER_2, USER_3],
          message: 'Please review',
        },
      });

      await cms.$flushNotifications();

      const approvalNotifs = received.filter(
        (n) => n.type === 'approvalRequested',
      );
      expect(approvalNotifs).toHaveLength(2);
      expect(approvalNotifs.map((n) => n.recipientId).sort()).toEqual(
        [USER_2, USER_3].sort(),
      );
      // meta carries the deep-link fields a SYNC router can't fetch later:
      // rootId + branchName, not just branchId.
      expect(approvalNotifs[0].meta).toMatchObject({
        rootId: expect.any(String),
        branchId: expect.any(String),
        branchName: expect.any(String),
      });
    });

    it('sends approvalApproved notification to the requester', async () => {
      const received: NotificationPayload[] = [];
      const { db } = await setupTestCMS();

      const cms = createCMSWithUser(db, USER_1);

      const { mr } = await setupMergeRequestContext(cms, USER_1);

      const approval = await cms.api.pages.requestApproval({
        body: {
          mergeRequestId: mr.mergeRequest.id,
          requestedReviewers: [USER_2],
          message: 'Please review',
        },
      });

      const cms2 = createCMSWithUser(db, USER_2, {
        onNotification: (n) => {
          received.push(n);
        },
      });

      await cms2.api.pages.approve({
        body: {
          approvalId: approval.approvals[0].id,
        },
      });

      await cms2.$flushNotifications();

      const approved = received.filter((n) => n.type === 'approvalApproved');
      expect(approved).toHaveLength(1);
      expect(approved[0].recipientId).toBe(USER_1);
      expect(approved[0].actorId).toBe(USER_2);
    });

    it('sends approvalRejected notification to the requester', async () => {
      const received: NotificationPayload[] = [];
      const { db } = await setupTestCMS();

      const cms = createCMSWithUser(db, USER_1);

      const { mr } = await setupMergeRequestContext(cms, USER_1);

      const approval = await cms.api.pages.requestApproval({
        body: {
          mergeRequestId: mr.mergeRequest.id,
          requestedReviewers: [USER_2],
          message: 'Please review',
        },
      });

      const cms2 = createCMSWithUser(db, USER_2, {
        onNotification: (n) => {
          received.push(n);
        },
      });

      await cms2.api.pages.reject({
        body: {
          approvalId: approval.approvals[0].id,
          rejectionReason: 'Needs changes',
        },
      });

      await cms2.$flushNotifications();

      const rejected = received.filter((n) => n.type === 'approvalRejected');
      expect(rejected).toHaveLength(1);
      expect(rejected[0].recipientId).toBe(USER_1);
      expect(rejected[0].actorId).toBe(USER_2);
      expect(rejected[0].body).toBe('Needs changes');
    });
  });

  describe('merge request notifications', () => {
    it('sends mergeRequestOpened notification to target branch owner', async () => {
      const received: NotificationPayload[] = [];
      const { db } = await setupTestCMS();

      const cms1 = createCMSWithUser(db, USER_1);

      const root = await cms1.api.pages.createRoot({
        body: { slug: 'mr-open-page', properties: { title: 'Page' } },
      });

      const cms2 = createCMSWithUser(db, USER_2, {
        onNotification: (n) => {
          received.push(n);
        },
      });

      const draft = await cms2.api.pages.createBranch({
        body: {
          rootId: root.rootId,
          name: 'feature-branch',
          sourceBranchId: root.branchId,
        },
      });

      await cms2.api.pages.createBlock({
        body: {
          rootId: root.rootId,
          branchId: draft.branch.id,
          parentBlockId: root.rootId,
          type: 'paragraph',
          properties: { text: 'New content' },
        },
      });

      await cms2.api.pages.createMergeRequest({
        body: {
          sourceBranchId: draft.branch.id,
          targetBranchId: root.branchId,
          title: 'Test MR',
          createdBy: USER_2,
        },
      });

      await cms2.$flushNotifications();

      const opened = received.filter((n) => n.type === 'mergeRequestOpened');
      expect(opened).toHaveLength(1);
      expect(opened[0].recipientId).toBe(USER_1);
      expect(opened[0].actorId).toBe(USER_2);
    });

    it('sends mergeRequestMerged notification to MR creator', async () => {
      const received: NotificationPayload[] = [];
      const { db } = await setupTestCMS();

      const cms1 = createCMSWithUser(db, USER_1, {
        onNotification: (n) => {
          received.push(n);
        },
      });

      const { mr } = await setupMergeRequestContext(cms1, USER_1);

      // cms1's authMiddleware pins the acting user to USER_1, so the reviewer
      // must be USER_1 for the approval to go through (context.userId is
      // overridden by the middleware).
      await requestAndApproveMerge(cms1, mr.mergeRequest.id, [USER_1]);

      received.length = 0;

      const cms2 = createCMSWithUser(db, USER_2, {
        onNotification: (n) => {
          received.push(n);
        },
      });

      await cms2.api.pages.executeMerge({
        body: {
          mergeRequestId: mr.mergeRequest.id,
          mergedBy: USER_2,
        },
      });

      await cms2.$flushNotifications();

      const merged = received.filter((n) => n.type === 'mergeRequestMerged');
      expect(merged).toHaveLength(1);
      expect(merged[0].recipientId).toBe(USER_1);
      expect(merged[0].actorId).toBe(USER_2);
    });
  });

  describe('publication notifications', () => {
    it('sends published notification to branch creator', async () => {
      const received: NotificationPayload[] = [];
      const { db } = await setupTestCMS();

      const cms1 = createCMSWithUser(db, USER_1, {
        onNotification: (n) => {
          received.push(n);
        },
      });

      const root = await cms1.api.pages.createRoot({
        body: { slug: 'publish-page', properties: { title: 'Page' } },
      });

      const branch = await cms1.api.pages.createBranch({
        body: {
          rootId: root.rootId,
          name: 'to-publish',
          sourceBranchId: root.branchId,
        },
      });

      await cms1.api.pages.createBlock({
        body: {
          rootId: root.rootId,
          branchId: branch.branch.id,
          parentBlockId: root.rootId,
          type: 'paragraph',
          properties: { text: 'Publishable content' },
        },
      });

      received.length = 0;

      const cms2 = createCMSWithUser(db, USER_2, {
        onNotification: (n) => {
          received.push(n);
        },
      });

      await cms2.api.pages.publishBranch({
        body: {
          rootId: root.rootId,
          branchId: branch.branch.id,
          publishedBy: USER_2,
        },
      });

      await cms2.$flushNotifications();

      const published = received.filter((n) => n.type === 'published');
      expect(published).toHaveLength(1);
      expect(published[0].recipientId).toBe(USER_1);
      expect(published[0].actorId).toBe(USER_2);
    });
  });

  describe('self-action suppression', () => {
    it('does not send mergeRequestOpened when user targets their own branch', async () => {
      const received: NotificationPayload[] = [];
      const { db } = await setupTestCMS();

      const cms = createCMSWithUser(db, USER_1, {
        onNotification: (n) => {
          received.push(n);
        },
      });

      await setupMergeRequestContext(cms, USER_1);

      await cms.$flushNotifications();

      const opened = received.filter((n) => n.type === 'mergeRequestOpened');
      expect(opened).toHaveLength(0);
    });

    it('does not send mergeRequestMerged when creator merges their own MR', async () => {
      const received: NotificationPayload[] = [];
      const { db } = await setupTestCMS();

      const cms = createCMSWithUser(db, USER_1, {
        onNotification: (n) => {
          received.push(n);
        },
      });

      const { mr } = await setupMergeRequestContext(cms, USER_1);

      // cms's authMiddleware pins the acting user to USER_1, so the reviewer
      // must be USER_1 for the approval to go through.
      await requestAndApproveMerge(cms, mr.mergeRequest.id, [USER_1]);

      received.length = 0;

      await cms.api.pages.executeMerge({
        body: {
          mergeRequestId: mr.mergeRequest.id,
          mergedBy: USER_1,
        },
      });

      await cms.$flushNotifications();

      const merged = received.filter((n) => n.type === 'mergeRequestMerged');
      expect(merged).toHaveLength(0);
    });

    it('does not send published when branch creator publishes their own branch', async () => {
      const received: NotificationPayload[] = [];
      const { db } = await setupTestCMS();

      const cms = createCMSWithUser(db, USER_1, {
        onNotification: (n) => {
          received.push(n);
        },
      });

      const root = await cms.api.pages.createRoot({
        body: {
          slug: 'self-publish-page',
          properties: { title: 'Page' },
        },
      });

      const branch = await cms.api.pages.createBranch({
        body: {
          rootId: root.rootId,
          name: 'self-publish',
          sourceBranchId: root.branchId,
        },
      });

      await cms.api.pages.createBlock({
        body: {
          rootId: root.rootId,
          branchId: branch.branch.id,
          parentBlockId: root.rootId,
          type: 'paragraph',
          properties: { text: 'Content' },
        },
      });

      received.length = 0;

      await cms.api.pages.publishBranch({
        body: {
          rootId: root.rootId,
          branchId: branch.branch.id,
          publishedBy: USER_1,
        },
      });

      await cms.$flushNotifications();

      const published = received.filter((n) => n.type === 'published');
      expect(published).toHaveLength(0);
    });
  });

  describe('plugin onNotification hook', () => {
    it('plugin receives all notifications', async () => {
      const pluginReceived: NotificationPayload[] = [];
      const { db } = await setupTestCMS();

      const cms = createCMS({
        db,
        media: { ...DUMMY_MEDIA_CONFIG },
        collections: TEST_COLLECTIONS,
        authMiddleware: async () => ({ userId: USER_1 }),
        plugins: [
          {
            id: 'slackNotifier',
            onNotification: (n: NotificationPayload) => {
              pluginReceived.push(n);
            },
          },
        ],
      });

      await cms.notify({
        recipientId: USER_2,
        actorId: USER_1,
        type: 'custom',
        title: 'Plugin test',
        body: null,
        resourceType: null,
        resourceId: null,
        collection: null,
        meta: null,
      });

      expect(pluginReceived).toHaveLength(1);
      expect(pluginReceived[0].title).toBe('Plugin test');
    });

    it('both top-level and plugin handlers receive notifications', async () => {
      const topLevel: NotificationPayload[] = [];
      const pluginLevel: NotificationPayload[] = [];
      const { db } = await setupTestCMS();

      const cms = createCMS({
        db,
        media: { ...DUMMY_MEDIA_CONFIG },
        collections: TEST_COLLECTIONS,
        authMiddleware: async () => ({ userId: USER_1 }),
        onNotification: (n) => {
          topLevel.push(n);
        },
        plugins: [
          {
            id: 'emailNotifier',
            onNotification: (n: NotificationPayload) => {
              pluginLevel.push(n);
            },
          },
        ],
      });

      await cms.notify({
        recipientId: USER_2,
        actorId: USER_1,
        type: 'custom',
        title: 'Multi handler test',
        body: null,
        resourceType: null,
        resourceId: null,
        collection: null,
        meta: null,
      });

      expect(topLevel).toHaveLength(1);
      expect(pluginLevel).toHaveLength(1);
    });
  });
});
