import { describe, expect, it } from 'vitest';

import {
  mergePushedNotification,
  pushedNotificationFromFrame,
} from '../src/client/notifications';
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

describe('pushedNotificationFromFrame', () => {
  const data = (recipientId: string) => ({
    id: 'n1',
    recipientId,
    actorId: null,
    type: 'custom',
    title: 't',
    body: null,
    resourceType: null,
    resourceId: null,
    collection: null,
    meta: null,
    createdAt: '2026-01-01T00:00:00.000Z', // string on the wire
  });
  const frame = (recipientId: string) => ({
    id: 'evt-1',
    event: 'notification',
    channel: `notif:${recipientId}`,
    data: data(recipientId),
  });

  it('decodes a valid envelope, strips the wrapper, coerces createdAt to Date', () => {
    const item = pushedNotificationFromFrame(frame('u1'), 'u1');
    expect(item).not.toBeNull();
    expect(item?.id).toBe('n1');
    expect(item?.readAt).toBeNull();
    expect(item?.createdAt).toBeInstanceOf(Date);
  });

  it('drops system frames (top-level type)', () => {
    expect(
      pushedNotificationFromFrame({ type: 'connected', channel: 'x' }, 'u1'),
    ).toBeNull();
  });

  it('drops non-notification events', () => {
    expect(
      pushedNotificationFromFrame(
        { event: 'delta', data: data('u1') },
        'u1',
      ),
    ).toBeNull();
  });

  it('drops a payload addressed to another user (defense-in-depth)', () => {
    expect(pushedNotificationFromFrame(frame('victim'), 'u1')).toBeNull();
  });

  it('drops a schema-invalid payload and non-objects', () => {
    expect(
      pushedNotificationFromFrame(
        { event: 'notification', data: { id: 'x' } },
        'u1',
      ),
    ).toBeNull();
    expect(pushedNotificationFromFrame(null, 'u1')).toBeNull();
  });
});
