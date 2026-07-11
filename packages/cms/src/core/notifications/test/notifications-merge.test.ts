import { describe, expect, it } from 'vitest';

import {
  mergePolledNotifications,
  mergePushedNotification,
} from '../merge';
import type { NotificationListItem } from '../types';

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

describe('mergePolledNotifications', () => {
  // Minimal serialized shape — the merge only reads id/readAt/createdAt, and on
  // the wire `createdAt` is an ISO string (see `Serialize`).
  const item = (id: string, createdAt: string, readAt: string | null = null) => ({
    id,
    createdAt,
    readAt,
  });

  it('takes the poll as the durable truth when nothing raced', () => {
    const prev = { notifications: [item('a', '2026-01-03')], unreadCount: 1 };
    const poll = { notifications: [item('a', '2026-01-03')], unreadCount: 1 };
    const next = mergePolledNotifications(prev, poll);
    expect(next.notifications.map((n) => n.id)).toEqual(['a']);
    expect(next.unreadCount).toBe(1);
  });

  it('preserves a genuine mid-poll push newer than the snapshot', () => {
    // `n` pushed live at 01-04; the poll snapshot only saw up to 01-03.
    const prev = {
      notifications: [item('n', '2026-01-04'), item('a', '2026-01-03')],
      unreadCount: 2,
    };
    const poll = { notifications: [item('a', '2026-01-03')], unreadCount: 1 };
    const next = mergePolledNotifications(prev, poll);
    expect(next.notifications.map((n) => n.id)).toEqual(['n', 'a']);
    expect(next.unreadCount).toBe(2); // 1 durable + 1 raced push
  });

  it('does NOT re-add or double-count an item past the page window', () => {
    // `old` scrolled past the poll's page, so the poll omits it — but it is OLDER
    // than the page and already inside the server's TOTAL unreadCount. Re-adding
    // it would drift the badge to 5 and yank a stale row to the top (react-09).
    const prev = {
      notifications: [
        item('n', '2026-01-05'),
        item('c', '2026-01-04'),
        item('b', '2026-01-03'),
        item('old', '2026-01-02'),
      ],
      unreadCount: 4,
    };
    const poll = {
      notifications: [
        item('n', '2026-01-05'),
        item('c', '2026-01-04'),
        item('b', '2026-01-03'),
      ],
      unreadCount: 4, // server TOTAL unread (already counts `old`)
    };
    const next = mergePolledNotifications(prev, poll);
    expect(next.notifications.map((n) => n.id)).toEqual(['n', 'c', 'b']);
    expect(next.unreadCount).toBe(4);
  });

  it('trusts an empty poll and keeps nothing extra', () => {
    const prev = { notifications: [item('a', '2026-01-03')], unreadCount: 1 };
    const poll = { notifications: [], unreadCount: 0 };
    const next = mergePolledNotifications(prev, poll);
    expect(next.notifications).toEqual([]);
    expect(next.unreadCount).toBe(0);
  });
});
