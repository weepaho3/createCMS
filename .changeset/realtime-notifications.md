---
"@createcms/core": patch
---

Real-time notifications — automatic per-user push + a realtime-only `useNotifications` hook.

When `realtime` is configured, every notification is pushed to its recipient's private channel automatically — a built-in handler rides the existing dispatch, so all notification sources (comments, merges, approvals, …) deliver live with no extra wiring.

On the client, wrap your app once in `RealtimeProvider` (from `@createcms/core/react/realtime`) — `<RealtimeProvider baseURL="/api/cms">` — to open one shared connection, then call `useNotifications(client, { userId })`. It seeds list + unread count from the `listNotifications` poll, prepends live pushes de-duped by id, and the provider replays anything missed across a reconnect. `useNotifications` is realtime-only and type-requires `client.notifications`, so it only compiles when notifications are enabled. Without realtime there's no built-in polling hook — read the durable list yourself via `client.notifications.listNotifications`.
