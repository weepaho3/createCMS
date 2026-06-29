import type { notificationTypeEnum } from '../db/schema.generated';

export type NotificationType = (typeof notificationTypeEnum.enumValues)[number];

export type NotificationPayload = {
  id: string;
  recipientId: string;
  actorId: string | null;
  type: NotificationType;
  title: string;
  body: string | null;
  resourceType: string | null;
  resourceId: string | null;
  collection: string | null;
  meta: Record<string, unknown> | null;
  createdAt: Date;
  /**
   * The actor's exposed user columns, resolved at dispatch time from the CMS
   * `user` config (the same `exposeColumns` allowlist `withUser` uses, sent in
   * full). Present on the realtime push and `onNotification` payloads so a
   * consumer can show the responsible user immediately; `null` when there is no
   * actor or no `user` config. NOT a persisted column — durable reads enrich
   * separately via `listNotifications`'s `withUser` flag.
   */
  actorUser?: Record<string, unknown> | null;
};

/**
 * A single row returned by `listNotifications`. `actorUser` is present only when
 * requested via the `withUser` query flag; its shape is the subset of your
 * `user` table's columns exposed by `exposeColumns`. `TActorUser` is inferred
 * from `typeof cms` at the API boundary (a partial of the user-table row).
 */
export type NotificationListItem<TActorUser = Record<string, unknown>> = Omit<
  NotificationPayload,
  'actorUser'
> & {
  readAt: Date | null;
  actorUser?: TActorUser | null;
};

/** Result of `listNotifications`. */
export type ListNotificationsResult<TActorUser = Record<string, unknown>> = {
  notifications: NotificationListItem<TActorUser>[];
  total: number;
  hasMore: boolean;
  unreadCount: number;
};

export type OnNotificationHandler = (
  notification: NotificationPayload,
) => void | Promise<void>;

export type NotificationInput = Omit<
  NotificationPayload,
  'id' | 'createdAt' | 'actorUser'
>;
