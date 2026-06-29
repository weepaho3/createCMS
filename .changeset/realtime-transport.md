---
"@createcms/core": patch
---

Add the shared realtime transport primitive (foundation for real-time notifications + A/B live results).

A new optional `realtime` config slot accepts a transport — `upstashRealtime({ url, token })` over `@upstash/realtime` (both `@upstash/*` packages are optional peers). When set, the CMS mounts a shared `/realtime` Server-Sent-Events route that authenticates each connection via your `authMiddleware` (the session is read from the request cookie — `EventSource` cannot send auth headers) and authorizes every requested channel against that identity: a user may subscribe only to their own private `notif:<userId>` channel (fails closed when unauthenticated), while `ab:live:<testId>` channels stay world-readable. The route lives in the request pipeline so a long-lived stream never enters per-request endpoint routing, and it falls through cleanly when the optional subscribe peer isn't installed.

The transport itself is a generic, schema-less publish/subscribe pipe (`publish(channel, event, data)`); event typing is owned per feature (Zod) and inferred via `typeof cms`, so plugins contribute their own event schemas (`realtimeEvents`) without the core knowing them. This phase ships the transport, the authenticated `/realtime` route + per-user channel-authorization policy, and the `notification` event schema; it is dormant until the notification publisher and client hooks land.
