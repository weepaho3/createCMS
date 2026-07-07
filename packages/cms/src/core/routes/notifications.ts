import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import * as z from 'zod';

import type { ListNotificationsResult } from '../notifications/types';
import type { CMSProcedureCtx } from '../types';

import { notifications, notificationTypeEnum } from '../db/schema.generated';
import { cmsMeta, createCMSEndpoint } from '../endpoint';
import { CMSError } from '../errors';
import { userEnrichment } from '../user/enrichment';
import { parseTimestamp, parseTimestampOrNull } from '../utils/parse-timestamp';

const notificationTypeSchema = z.enum(notificationTypeEnum.enumValues);

export function createNotificationEndpoints(cmsCtx: CMSProcedureCtx) {
  const { db } = cmsCtx;

  return {
    /**
     * Retrieves a paginated list of notifications for the current user, optionally filtered by type, collection, or read status.
     *
     * @param type - Optional notification type to filter results.
     * @param unreadOnly - If true, returns only unread notifications.
     * @param collection - Optional collection name to filter notifications.
     * @param limit - Maximum number of notifications to return (1–100, default 20).
     * @param offset - Pagination offset (default 0).
     *
     * @returns The notification list, total count, hasMore flag, and count of all unread notifications.
     *
     * @throws USER_ID_REQUIRED - No authenticated user in the request context.
     *
     * @example
     * const result = await cmsClient.notifications.listNotifications({ query: { unreadOnly: true, limit: 10 } });
     */
    listNotifications: createCMSEndpoint(
      '/notifications/listNotifications',
      {
        method: 'GET',
        query: z
          .object({
            type: notificationTypeSchema.optional(),
            unreadOnly: z.coerce.boolean().optional(),
            collection: z.string().optional(),
            limit: z.coerce.number().min(1).max(100).optional(),
            offset: z.coerce.number().min(0).optional(),
          })
          .optional(),
        metadata: cmsMeta(
          {
            $Infer: {
              query: {} as {
                type?: z.infer<typeof notificationTypeSchema>;
                unreadOnly?: boolean;
                collection?: string;
                limit?: number;
                offset?: number;
              },
            },
          },
          {
            permissionResource: 'notification',
            operation: 'read',
            scope: 'system',
          },
        ),
      },
      async (ctx) => {
        const userId = ctx.context.userId;
        if (!userId) throw new CMSError('USER_ID_REQUIRED');

        const input = ctx.query ?? {};
        const limit = input.limit ?? 20;
        const offset = input.offset ?? 0;

        const conditions = [
          eq(notifications.recipientId, userId),
          isNull(notifications.archivedAt),
        ];

        if (input.type) {
          conditions.push(eq(notifications.type, input.type));
        }
        if (input.unreadOnly) {
          conditions.push(isNull(notifications.readAt));
        }
        if (input.collection) {
          conditions.push(eq(notifications.collection, input.collection));
        }

        const whereCondition = and(...conditions)!;

        const enrich = userEnrichment(ctx, {
          cmsColumn: 'cms.notifications.actor_id',
          alias: 'actor_user',
          outputKey: 'actorUser',
        });

        const [[{ count }], [{ unreadCount }], dataResult] = await Promise.all([
          db
            .select({ count: sql<number>`count(*)`.mapWith(Number) })
            .from(notifications)
            .where(whereCondition),
          db
            .select({ unreadCount: sql<number>`count(*)`.mapWith(Number) })
            .from(notifications)
            .where(
              and(
                eq(notifications.recipientId, userId),
                isNull(notifications.archivedAt),
                isNull(notifications.readAt),
              ),
            ),
          db.execute(sql`
            SELECT
              ${notifications.id},
              ${notifications.recipientId} AS recipient_id,
              ${notifications.actorId} AS actor_id,
              ${notifications.type},
              ${notifications.title},
              ${notifications.body},
              ${notifications.resourceType} AS resource_type,
              ${notifications.resourceId} AS resource_id,
              ${notifications.collection},
              ${notifications.meta},
              ${notifications.readAt} AS read_at,
              ${notifications.createdAt} AS created_at
              ${enrich.select}
            FROM ${notifications}
            ${enrich.join}
            WHERE ${whereCondition}
            ORDER BY ${notifications.createdAt} DESC
            LIMIT ${limit} OFFSET ${offset}
          `),
        ]);

        const rows = dataResult.rows as Array<Record<string, unknown>>;

        return {
          notifications: rows.map((row) => {
            const item: Record<string, unknown> = {
              id: row.id,
              recipientId: row.recipient_id,
              actorId: row.actor_id,
              type: row.type,
              title: row.title,
              body: row.body,
              resourceType: row.resource_type,
              resourceId: row.resource_id,
              collection: row.collection,
              meta: row.meta,
              readAt: parseTimestampOrNull(row.read_at),
              createdAt: parseTimestamp(row.created_at),
            };
            enrich.apply(item, row);
            return item;
          }),
          total: count,
          hasMore: offset + rows.length < count,
          unreadCount,
        } as unknown as ListNotificationsResult;
      },
    ),

    /**
     * Marks notification(s) as read for the current user.
     * If no notificationId is provided, marks all unread notifications as read.
     *
     * @param notificationId - Optional notification id to mark as read; if omitted, all unread notifications for the user are marked read.
     *
     * @returns Count of notifications marked as read.
     *
     * @throws USER_ID_REQUIRED - No authenticated user in the request context.
     * @throws NOTIFICATION_NOT_FOUND - The specified notification does not exist.
     * @throws NOTIFICATION_RECIPIENT_MISMATCH - The current user is not the recipient of the notification.
     *
     * @example
     * await cmsClient.notifications.markNotificationsRead({ body: { notificationId: 'notif-123' } });
     */
    markNotificationsRead: createCMSEndpoint(
      '/notifications/markNotificationsRead',
      {
        method: 'POST',
        body: z
          .object({
            notificationId: z.string().optional(),
          })
          .optional(),
        metadata: cmsMeta(
          {
            $Infer: {
              body: {} as { notificationId?: string },
            },
          },
          {
            permissionResource: 'notification',
            operation: 'update',
            scope: 'system',
          },
        ),
      },
      async (ctx) => {
        const userId = ctx.context.userId;
        if (!userId) throw new CMSError('USER_ID_REQUIRED');

        const notificationId = ctx.body?.notificationId;
        const now = new Date();

        if (notificationId) {
          const [notification] = await db
            .select({
              id: notifications.id,
              recipientId: notifications.recipientId,
            })
            .from(notifications)
            .where(eq(notifications.id, notificationId));

          if (!notification) throw new CMSError('NOTIFICATION_NOT_FOUND');
          if (notification.recipientId !== userId) {
            throw new CMSError('NOTIFICATION_RECIPIENT_MISMATCH');
          }

          const updated = await db
            .update(notifications)
            .set({ readAt: now })
            .where(
              and(
                eq(notifications.id, notificationId),
                isNull(notifications.readAt),
              ),
            )
            .returning({ id: notifications.id });

          return { markedCount: updated.length };
        }

        const result = await db
          .update(notifications)
          .set({ readAt: now })
          .where(
            and(
              eq(notifications.recipientId, userId),
              isNull(notifications.readAt),
            ),
          )
          .returning({ id: notifications.id });

        return { markedCount: result.length };
      },
    ),

    /**
     * Marks notification(s) as unread for the current user.
     * If no notificationId is provided, marks all read notifications as unread.
     *
     * @param notificationId - Optional notification id to mark as unread; if omitted, all read notifications for the user are marked unread.
     *
     * @returns Count of notifications marked as unread.
     *
     * @throws USER_ID_REQUIRED - No authenticated user in the request context.
     * @throws NOTIFICATION_NOT_FOUND - The specified notification does not exist.
     * @throws NOTIFICATION_RECIPIENT_MISMATCH - The current user is not the recipient of the notification.
     *
     * @example
     * await cmsClient.notifications.markNotificationsUnread({ body: { notificationId: 'notif-123' } });
     */
    markNotificationsUnread: createCMSEndpoint(
      '/notifications/markNotificationsUnread',
      {
        method: 'POST',
        body: z
          .object({
            notificationId: z.string().optional(),
          })
          .optional(),
        metadata: cmsMeta(
          {
            $Infer: {
              body: {} as { notificationId?: string },
            },
          },
          {
            permissionResource: 'notification',
            operation: 'update',
            scope: 'system',
          },
        ),
      },
      async (ctx) => {
        const userId = ctx.context.userId;
        if (!userId) throw new CMSError('USER_ID_REQUIRED');

        const notificationId = ctx.body?.notificationId;

        if (notificationId) {
          const [notification] = await db
            .select({
              id: notifications.id,
              recipientId: notifications.recipientId,
            })
            .from(notifications)
            .where(eq(notifications.id, notificationId));

          if (!notification) throw new CMSError('NOTIFICATION_NOT_FOUND');
          if (notification.recipientId !== userId) {
            throw new CMSError('NOTIFICATION_RECIPIENT_MISMATCH');
          }

          const updated = await db
            .update(notifications)
            .set({ readAt: null })
            .where(
              and(
                eq(notifications.id, notificationId),
                isNotNull(notifications.readAt),
              ),
            )
            .returning({ id: notifications.id });

          return { markedCount: updated.length };
        }

        const result = await db
          .update(notifications)
          .set({ readAt: null })
          .where(
            and(
              eq(notifications.recipientId, userId),
              isNotNull(notifications.readAt),
            ),
          )
          .returning({ id: notifications.id });

        return { markedCount: result.length };
      },
    ),

    /**
     * Archives a notification, removing it from the user's active notification list.
     *
     * @param notificationId - The notification id to archive.
     *
     * @returns The archived notification id.
     *
     * @throws USER_ID_REQUIRED - No authenticated user in the request context.
     * @throws NOTIFICATION_NOT_FOUND - The notification does not exist.
     * @throws NOTIFICATION_RECIPIENT_MISMATCH - The current user is not the recipient of the notification.
     *
     * @example
     * await cmsClient.notifications.archiveNotification({ body: { notificationId: 'notif-123' } });
     */
    archiveNotification: createCMSEndpoint(
      '/notifications/archiveNotification',
      {
        method: 'POST',
        body: z.object({
          notificationId: z.string(),
        }),
        metadata: cmsMeta(
          {
            $Infer: {
              body: {} as { notificationId: string },
            },
          },
          {
            // Soft-archive, but it's a "delete" from the recipient's intent —
            // consistent with deleteRoot/deleteCommentThread/archiveAsset.
            permissionResource: 'notification',
            operation: 'delete',
            scope: 'system',
          },
        ),
      },
      async (ctx) => {
        const userId = ctx.context.userId;
        if (!userId) throw new CMSError('USER_ID_REQUIRED');

        const { notificationId } = ctx.body;

        const [notification] = await db
          .select({
            id: notifications.id,
            recipientId: notifications.recipientId,
          })
          .from(notifications)
          .where(eq(notifications.id, notificationId));

        if (!notification) throw new CMSError('NOTIFICATION_NOT_FOUND');
        if (notification.recipientId !== userId) {
          throw new CMSError('NOTIFICATION_RECIPIENT_MISMATCH');
        }

        await db
          .update(notifications)
          .set({ archivedAt: new Date() })
          .where(eq(notifications.id, notificationId));

        return { notificationId };
      },
    ),
  };
}
