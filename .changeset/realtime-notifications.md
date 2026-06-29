---
"@createcms/core": patch
---

Real-time notifications — automatic per-user push + a `useNotifications` React hook.

When a `realtime` transport is configured, every notification is now pushed to its recipient's private channel automatically — a built-in handler rides the existing `notify`/`notifyMany` dispatch, so all notification sources (comments, merges, approvals, …) deliver live with no extra wiring. It's best-effort: the durable notifications row and `listNotifications` poll stay the source of truth, and a dropped push self-corrects on the next reconcile.

On the client, `useNotifications(client, { userId, baseURL })` (from `@createcms/core/react`) seeds the list + unread count from the poll, then subscribes to the user's own `notif:<userId>` SSE stream and prepends pushed notifications live — de-duped by id so the unread count never drifts, and re-polled on (re)connect/error to reconcile. It manages its own `EventSource` (no provider to wire — just call it) opened with credentials so the session cookie authenticates the connection, and degrades to the seeded poll when realtime is unavailable. Returns `{ notifications, unreadCount, isLive, refresh }`.
