import type { DrizzleInstance } from '../types/drizzle';
import type { ResolvedUserConfig } from '../user/resolve';
import type {
  NotificationInput,
  NotificationPayload,
  OnNotificationHandler,
} from './types';

import { notifications } from '../db/schema.generated';
import { batchFetchUsers } from '../user/join-helpers';

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

function toInsertRow(
  input: NotificationInput,
): typeof notifications.$inferInsert {
  return {
    recipientId: input.recipientId,
    actorId: input.actorId,
    // Widened to allow plugin/app type strings; the generated enum is the
    // runtime authority (core-only in this package, core+plugin in apps).
    type: input.type as (typeof notifications.$inferInsert)['type'],
    title: input.title,
    body: input.body,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    collection: input.collection,
    meta: input.meta,
  };
}

export function createNotificationService(
  db: DrizzleInstance,
  handlers: OnNotificationHandler[],
  resolvedUser?: ResolvedUserConfig,
) {
  // Test/flush seam: every floated handler promise and every floated
  // `flushNotifications` batch (registered via the exposed `track`) is
  // added here so `flush()` can await them deterministically instead of tests
  // racing a real `setTimeout`.
  const inFlight = new Set<Promise<unknown>>();
  function track<T>(p: Promise<T>): Promise<T> {
    inFlight.add(p);
    // `.catch(() => {})` on the cleanup chain (NOT on `p`): callers still get the
    // original `p` to await/catch, but the internal bookkeeping chain must never
    // surface an unhandled rejection when `p` is a not-yet-caught promise
    // (`notify` tracks the raw `notifyOne` before the caller attaches `.catch`).
    void p.finally(() => inFlight.delete(p)).catch(() => {});
    return p;
  }

  function dispatch(payload: NotificationPayload): void {
    for (const handler of handlers) {
      try {
        const result = handler(payload);
        if (result instanceof Promise) {
          // Floated async-handler rejection. Tracked so `flush()` waits.
          track(
            result.catch((err) => {
              console.error('[cms] onNotification handler failed:', err);
            }),
          );
        }
      } catch (err) {
        console.error('[cms] onNotification handler failed:', err);
      }
    }
  }

  /**
   * Resolve each payload's `actorUser` from the `user` config (the full
   * `exposeColumns` allowlist), in one batched query, BEFORE dispatch so the
   * realtime push / `onNotification` handlers carry the responsible user.
   * Best-effort: a lookup failure leaves `actorUser` unset, never drops the
   * already-persisted notification.
   */
  async function enrichActors(payloads: NotificationPayload[]): Promise<void> {
    if (!resolvedUser) return;
    const actorIds = [
      ...new Set(
        payloads.map((p) => p.actorId).filter((id): id is string => id != null),
      ),
    ];
    if (actorIds.length === 0) return;
    try {
      const users = await batchFetchUsers(db, resolvedUser, true, actorIds);
      for (const p of payloads) {
        p.actorUser = p.actorId ? (users.get(p.actorId) ?? null) : null;
      }
    } catch (err) {
      console.error('[cms] actor enrichment failed:', err);
    }
  }

  async function notifyOne(
    input: NotificationInput,
  ): Promise<NotificationPayload> {
    const [row] = await db
      .insert(notifications)
      .values(toInsertRow(input))
      .returning();

    const payload = mapRowToPayload(row);
    await enrichActors([payload]);
    dispatch(payload);
    return payload;
  }

  return {
    // Register a floated promise into the in-flight set so `flush()` awaits it.
    // Exposed for `flushNotifications` below.
    track,
    // Awaits every currently-floated notification promise (batched flushes,
    // async handler side effects, and floated single `notify` calls),
    // re-checking after each round because a settling batch dispatches handlers
    // that add fresh in-flight promises.
    async flush(): Promise<void> {
      while (inFlight.size) await Promise.allSettled([...inFlight]);
    },

    // Self-registers into the in-flight set so a floated
    // `notificationService.notify(...).catch(...)` (e.g. publishBranch's
    // publish notification) is awaited by `flush()`, not only the
    // flushNotifications/notifyMany path. Awaited callers see identical behavior.
    notify: (input: NotificationInput): Promise<NotificationPayload> =>
      track(notifyOne(input)),

    async notifyMany(
      inputs: NotificationInput[],
    ): Promise<NotificationPayload[]> {
      if (inputs.length === 0) return [];

      const rows = await db
        .insert(notifications)
        .values(inputs.map(toInsertRow))
        .returning();

      const payloads = rows.map(mapRowToPayload);
      await enrichActors(payloads);

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
  // Register the floated batch so `service.flush()` (via
  // `cms.$flushNotifications()`) can await it deterministically.
  void service.track(
    service.notifyMany(inputs).catch((err) => {
      console.error('[cms] notification dispatch failed:', err);
    }),
  );
}

/**
 * Runs `fn` inside a transaction with a `pending` array to collect
 * `NotificationInput`s, then flushes them AFTER the transaction commits.
 * Wraps the collect-then-flush pattern (see {@link flushNotifications}) so a
 * rolled-back transaction never fires notifications for uncommitted changes.
 */
export function withNotifications<T>(
  db: DrizzleInstance,
  service: NotificationService | undefined,
  fn: (tx: DrizzleInstance, pending: NotificationInput[]) => Promise<T>,
): Promise<T> {
  const pending: NotificationInput[] = [];
  return db
    .transaction((tx) => fn(tx, pending))
    .then((result) => {
      flushNotifications(service, pending);
      return result;
    });
}
