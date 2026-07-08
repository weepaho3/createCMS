/**
 * The core notification types — the single source of truth for both the
 * generated DB enum (via `core-schema.ts`) and any code that needs the values
 * WITHOUT importing the generated Drizzle schema. Importing `schema.generated`
 * for its enum drags the entire Postgres schema + `drizzle-orm/pg-core` +
 * `nanoid` into whatever bundle references it — notably the browser realtime
 * entry, which only needs a Zod mirror (see notifications/events.ts, react-01).
 *
 * Plugins may contribute ADDITIONAL types (folded into the generated enum at
 * `createcms generate`), so this list is the CORE set only — the realtime wire
 * schema deliberately accepts any string so a plugin notification still pushes.
 */
export const NOTIFICATION_TYPES = [
  'mention',
  'comment',
  'threadResolved',
  'threadReopened',
  'approvalRequested',
  'approvalApproved',
  'approvalRejected',
  'mergeRequestOpened',
  'mergeRequestMerged',
  'mergeRequestClosed',
  'mergeRequestReopened',
  'published',
  'custom',
] as const;

export type CoreNotificationType = (typeof NOTIFICATION_TYPES)[number];
