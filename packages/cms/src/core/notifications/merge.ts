import type { NotificationListItem } from './types';

export type NotificationsState<TActorUser = Record<string, unknown>> = {
  notifications: NotificationListItem<TActorUser>[];
  unreadCount: number;
};

/**
 * Apply a pushed notification to the current state: prepend it and bump the
 * unread count, but only if it is genuinely new (de-duped by id). De-duping
 * the list and the count together keeps `unreadCount` from drifting when a
 * push and a poll race. Pure; the reducing core of `useNotifications`,
 * unit-tested.
 */
export function mergePushedNotification<
  TItem extends { id: string; readAt: unknown },
>(
  state: { notifications: TItem[]; unreadCount: number },
  pushed: TItem,
): { notifications: TItem[]; unreadCount: number } {
  if (state.notifications.some((n) => n.id === pushed.id)) return state;
  return {
    notifications: [pushed, ...state.notifications],
    unreadCount: state.unreadCount + (pushed.readAt ? 0 : 1),
  };
}

/**
 * Reconcile a seed/reconcile poll into the current state without clobbering
 * live pushes. The poll is the durable source of truth, but its snapshot is
 * taken server-side and may predate a push that landed on the wire mid-flight:
 * a wholesale `setState({ notifications: res.notifications, ... })` would drop
 * that push until the next poll. Instead we union: keep any local item that is
 * a genuine mid-poll push (strictly newer than everything the poll returned,
 * so it can only have arrived after the server took its snapshot) ahead of the
 * durable list, take the server's `unreadCount` as authoritative for the
 * durable set, and add back the unread of those pushes so the badge never
 * under-counts.
 *
 * The freshness gate matters: a local item the poll omitted is not always a
 * push. Once the list is longer than the poll's `limit`, an item that scrolled
 * past the page window is also absent from the poll, but it is OLDER than the
 * page and already inside the server's total `unreadCount`, so re-adding it
 * would double-count the badge and yank a stale row to the top. Only items
 * newer than the newest polled row are real races. An empty poll gives no
 * reference point, so trust the poll and keep nothing extra (a real push is
 * persisted server-side and reappears on the next reconcile). Pure and
 * de-duped by id.
 */
export function mergePolledNotifications<
  TItem extends { id: string; readAt: unknown; createdAt: string },
>(
  prev: { notifications: TItem[]; unreadCount: number },
  poll: { notifications: TItem[]; unreadCount: number },
): { notifications: TItem[]; unreadCount: number } {
  const polledIds = new Set(poll.notifications.map((n) => n.id));
  // Items are ordered newest-first and ISO strings compare chronologically, so
  // `poll.notifications[0]` carries the newest timestamp the snapshot saw.
  const newestPolled = poll.notifications[0]?.createdAt;
  const pushedExtras = prev.notifications.filter(
    (n) =>
      !polledIds.has(n.id) &&
      newestPolled !== undefined &&
      n.createdAt > newestPolled,
  );
  const unreadExtras = pushedExtras.reduce(
    (count, n) => count + (n.readAt ? 0 : 1),
    0,
  );
  return {
    notifications: [...pushedExtras, ...poll.notifications],
    unreadCount: poll.unreadCount + unreadExtras,
  };
}
