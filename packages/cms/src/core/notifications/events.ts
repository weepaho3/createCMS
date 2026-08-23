import * as z from 'zod';

/**
 * The realtime wire schema for a pushed notification: a Zod mirror of
 * {@link NotificationPayload}. Core owns this event; it is the payload
 * delivered on the per-user `notif:<recipientId>` channel. The transport stays
 * event-agnostic, so this schema is what types the notification push at its own
 * boundary (publish-side validation + client `onData` inference).
 *
 * `createdAt` is a `Date` in memory but a string on the SSE wire (JSON); the
 * receive side coerces it back via `z.coerce.date()`.
 *
 * `actorUser` carries the responsible user's exposed columns so a live push can
 * render the actor immediately (no second poll). It is `.nullish()`: absent
 * when there is no `user` config, `null` when the actor has no matching row.
 */
export const notificationEventSchema = z.object({
  id: z.string(),
  recipientId: z.string(),
  actorId: z.string().nullable(),
  // Any string: core types live in `./constants` (NOTIFICATION_TYPES) but
  // plugins contribute their own, and the client must accept a plugin push
  // (not drop it). The wire type is validated by shape here; the per-type
  // `meta` is narrowed at the type level via `typeof cms`, not at this
  // runtime boundary.
  type: z.string(),
  title: z.string(),
  body: z.string().nullable(),
  resourceType: z.string().nullable(),
  resourceId: z.string().nullable(),
  collection: z.string().nullable(),
  meta: z.record(z.string(), z.unknown()).nullable(),
  actorUser: z.record(z.string(), z.unknown()).nullish(),
  createdAt: z.coerce.date(),
});

export type NotificationEvent = z.infer<typeof notificationEventSchema>;
