import { describe, expect, it } from 'vitest';

import type { NotificationListItem } from '../types';

import { createNotificationRouter } from '../../../react/notifications-router';

function notif(
  over: Partial<NotificationListItem> & Pick<NotificationListItem, 'type'>,
): NotificationListItem {
  return {
    id: 'n1',
    recipientId: 'u1',
    actorId: 'a1',
    title: 't',
    body: null,
    resourceType: null,
    resourceId: null,
    collection: null,
    meta: null,
    createdAt: new Date('2026-01-01'),
    readAt: null,
    ...over,
  };
}

describe('createNotificationRouter', () => {
  const router = createNotificationRouter({
    mention: (n) => ({
      href: `/threads/${n.meta.threadId}#${n.meta.messageId}`,
      icon: 'at-sign',
    }),
    published: (n) => ({ href: `/${n.collection}/${n.resourceId}` }),
    fallback: (n) => ({
      href: n.resourceId ? `/${n.collection}/${n.resourceId}` : null,
    }),
  });

  it('routes a type with an explicit resolver, narrowing meta', () => {
    const route = router.resolve(
      notif({
        type: 'mention',
        resourceId: 'thread-9',
        collection: 'pages',
        meta: { messageId: 'm5', threadId: 'thread-9', rootId: 'r1' },
      }),
    );
    expect(route.href).toBe('/threads/thread-9#m5');
    expect(route.icon).toBe('at-sign');
  });

  it('uses the resolver fields (collection + resourceId) for published', () => {
    const route = router.resolve(
      notif({ type: 'published', collection: 'pages', resourceId: 'root-3' }),
    );
    expect(route.href).toBe('/pages/root-3');
  });

  it('falls back for a type without an explicit resolver (e.g. custom)', () => {
    const route = router.resolve(
      notif({ type: 'custom', collection: 'pages', resourceId: 'x1' }),
    );
    expect(route.href).toBe('/pages/x1');
  });

  it('fallback can mark a notification non-navigable (href null)', () => {
    const route = router.resolve(notif({ type: 'comment', resourceId: null }));
    expect(route.href).toBeNull();
  });
});
