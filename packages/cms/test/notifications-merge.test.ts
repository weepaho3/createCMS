import { describe, expect, it } from 'vitest';

import { mergePushedNotification } from '../src/core/notifications/merge';
import type { NotificationListItem } from '../src/core/notifications/types';

/**
 * The reducing core of useNotifications. De-duping the list AND the unread count
 * together is what keeps unreadCount from drifting when a push and a poll race —
 * these lock that invariant.
 */
function notif(id: string, readAt: Date | null = null): NotificationListItem {
  return {
    id,
    recipientId: 'u1',
    actorId: null,
    type: 'custom',
    title: id,
    body: null,
    resourceType: null,
    resourceId: null,
    collection: null,
    meta: null,
    createdAt: new Date('2026-01-01'),
    readAt,
  };
}

describe('mergePushedNotification', () => {
  const empty = { notifications: [], unreadCount: 0 };

  it('prepends a new notification and bumps the unread count', () => {
    const next = mergePushedNotification(empty, notif('a'));
    expect(next.notifications.map((n) => n.id)).toEqual(['a']);
    expect(next.unreadCount).toBe(1);
  });

  it('prepends (newest first)', () => {
    const s1 = mergePushedNotification(empty, notif('a'));
    const s2 = mergePushedNotification(s1, notif('b'));
    expect(s2.notifications.map((n) => n.id)).toEqual(['b', 'a']);
    expect(s2.unreadCount).toBe(2);
  });

  it('de-dupes by id without double-counting (push/poll race)', () => {
    const s1 = mergePushedNotification(empty, notif('a'));
    const s2 = mergePushedNotification(s1, notif('a'));
    expect(s2).toBe(s1); // unchanged reference
    expect(s2.notifications).toHaveLength(1);
    expect(s2.unreadCount).toBe(1);
  });

  it('does not bump unread count for an already-read push', () => {
    const next = mergePushedNotification(empty, notif('a', new Date()));
    expect(next.notifications).toHaveLength(1);
    expect(next.unreadCount).toBe(0);
  });
});
