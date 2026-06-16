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
};

/** A single row returned by `listNotifications`. `actorUser` is present only
 *  when requested via the `withUser` query flag. */
export type NotificationListItem = NotificationPayload & {
  readAt: Date | null;
  actorUser?: unknown;
};

/** Result of `listNotifications`. */
export type ListNotificationsResult = {
  notifications: NotificationListItem[];
  total: number;
  hasMore: boolean;
  unreadCount: number;
};

export type OnNotificationHandler = (
  notification: NotificationPayload,
) => void | Promise<void>;

export type NotificationInput = Omit<NotificationPayload, 'id' | 'createdAt'>;
