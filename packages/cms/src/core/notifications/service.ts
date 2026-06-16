import type { DrizzleInstance } from '../types/drizzle';
import type {
  NotificationInput,
  NotificationPayload,
  OnNotificationHandler,
} from './types';

import { notifications } from '../db/schema.generated';

export type NotificationService = ReturnType<typeof createNotificationService>;

function mapRowToPayload(
  row: typeof notifications.$inferSelect,
): NotificationPayload {
  return {
    id: row.id,
    recipientId: row.recipientId,
    actorId: row.actorId,
    type: row.type,
    title: row.title,
    body: row.body,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    collection: row.collection,
    meta: row.meta,
    createdAt: new Date(row.createdAt),
  };
}

export function createNotificationService(
  db: DrizzleInstance,
  handlers: OnNotificationHandler[],
) {
  function dispatch(payload: NotificationPayload): void {
    for (const handler of handlers) {
      try {
        const result = handler(payload);
        if (result instanceof Promise) {
          result.catch((err) => {
            console.error('[cms] onNotification handler failed:', err);
          });
        }
      } catch (err) {
        console.error('[cms] onNotification handler failed:', err);
      }
    }
  }

  return {
    async notify(input: NotificationInput): Promise<NotificationPayload> {
      const [row] = await db
        .insert(notifications)
        .values({
          recipientId: input.recipientId,
          actorId: input.actorId,
          type: input.type,
          title: input.title,
          body: input.body,
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          collection: input.collection,
          meta: input.meta,
        })
        .returning();

      const payload = mapRowToPayload(row);
      dispatch(payload);
      return payload;
    },

    async notifyMany(
      inputs: NotificationInput[],
    ): Promise<NotificationPayload[]> {
      if (inputs.length === 0) return [];

      const rows = await db
        .insert(notifications)
        .values(
          inputs.map((input) => ({
            recipientId: input.recipientId,
            actorId: input.actorId,
            type: input.type,
            title: input.title,
            body: input.body,
            resourceType: input.resourceType,
            resourceId: input.resourceId,
            collection: input.collection,
            meta: input.meta,
          })),
        )
        .returning();

      const payloads = rows.map(mapRowToPayload);

      for (const payload of payloads) {
        dispatch(payload);
      }

      return payloads;
    },
  };
}

/**
 * Fires notifications collected during a transaction, AFTER it has committed.
 *
 * Use the collect-then-flush pattern: push `NotificationInput`s into an array
 * inside `db.transaction(...)`, then call this in the transaction promise's
 * `.then(...)`. Because a rolled-back transaction rejects that promise, the
 * inserts (and `onNotification` side effects) only ever happen for changes
 * that actually committed. Fire-and-forget: a notification failure never
 * affects the committed mutation.
 */
export function flushNotifications(
  service: NotificationService | undefined,
  inputs: NotificationInput[],
): void {
  if (!service || inputs.length === 0) return;
  void service.notifyMany(inputs).catch((err) => {
    console.error('[cms] notification dispatch failed:', err);
  });
}
