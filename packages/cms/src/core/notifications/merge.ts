import type { NotificationListItem } from './types';

export type NotificationsState<TActorUser = Record<string, unknown>> = {
  notifications: NotificationListItem<TActorUser>[];
  unreadCount: number;
};

/**
 * Apply a pushed notification to the current state — prepend it and bump the
 * unread count, but ONLY if it is genuinely new (de-duped by id). De-duping the
 * list AND the count together keeps `unreadCount` from drifting when a push and
 * a poll race. Pure — the reducing core of `useNotifications`, unit-tested.
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
