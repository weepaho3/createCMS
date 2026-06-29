---
"@createcms/core": patch
---

Add an optional, Upstash-backed realtime layer — and a `notifications` on/off switch.

Configure `realtime: { url, token }` (your Upstash Redis credentials; `@upstash/realtime` + `@upstash/redis` are optional peers) to mount a shared `/realtime` SSE route. The route authenticates each connection via your `authMiddleware` (the session is read from the request cookie — `EventSource` can't send auth headers) and authorizes every channel against that identity: a user may subscribe only to their own private `notif:<userId>` channel (fails closed when unauthenticated), while `ab:live:<testId>` stays world-readable. The server is the broker — the browser only ever talks to your same-origin route; the Upstash credentials never leave the server. Realtime is Upstash-only (no pluggable transport).

Separately, `notifications: false` on `createCMS` fully disables the notifications feature: the tables aren't generated, the routes never register, and `client.notifications` plus `cms.notify` are absent from the inferred types (a stray call is a compile error). Default: enabled. Use a literal `false`. `notifications` and `realtime` are independent — A/B live results can use `realtime` with `notifications: false`.
