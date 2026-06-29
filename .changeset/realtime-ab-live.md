---
"@createcms/core": patch
---

A/B live results ride the shared realtime connection (fixes a never-working path).

The A/B live-dashboard delta stream previously lived inside the plugin (its own mis-constructed realtime instance + a bare `EventSource`) and never actually delivered. It now uses the shared realtime layer end-to-end: the `trackEvent` ingest publishes each delta over `ctx.realtime` to the public `ab:live:<testId>` channel — decoupled from the analytics storage adapter, so it works with the Postgres adapter too — and `useLiveResults` rides the same `RealtimeProvider` connection as `useNotifications`.

`useLiveResults` moves off the client proxy to its own subpath, `@createcms/core/plugins/ab-test/live` (which pulls in the optional `@upstash/realtime` peer, keeping the main A/B client peer-free). It applies live increments and reconciles against the absolute `getResults` aggregate on (re)connect; without `realtime` the stream never connects and the SSR `initial` (+ any `getResults` reconcile) stands.
