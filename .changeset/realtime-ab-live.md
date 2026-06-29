---
"@createcms/core": patch
---

A/B live results now ride the shared realtime transport (fixes a never-working path; removes a duplicate pipeline).

The A/B live-dashboard delta stream previously lived entirely inside the A/B plugin: the Upstash analytics adapter constructed its own realtime instance and published deltas via raw Redis pub/sub, the plugin served its own `/abTest/realtime` SSE bridge, and `useLiveResults` subscribed with a bare `EventSource`. That path mis-used `@upstash/realtime` (which was never installed) and so never actually delivered — the dashboard only ever updated on the `getResults` poll.

It now uses the shared core realtime transport end-to-end: the `trackEvent` ingest publishes each delta over `ctx.realtime` to the public `ab:live:<testId>` channel (decoupled from the storage adapter, so it works with the Postgres adapter too — not just Upstash), the `/abTest/realtime` bridge is gone (clients use the shared `/realtime` route), and `useLiveResults` consumes the same envelope/reconnect contract as `useNotifications`, falling back to the `getResults` poll. The Upstash analytics adapter now only owns durable event storage and needs just `@upstash/redis`.

Live A/B results therefore now require a `realtime` transport to be configured (`realtime: upstashRealtime({ url, token })`); without it they degrade to the poll, exactly as before.
