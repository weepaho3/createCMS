---
"@createcms/core": patch
---

React / client-layer hardening (react-01 … react-16). Highlights:

- **react-01**: the browser realtime entry no longer bundles the entire generated
  Drizzle schema (+ `drizzle-orm/pg-core` + `nanoid`). The notification wire schema
  used to runtime-import the DB enum from `schema.generated`; the core types now
  live in a dependency-free `NOTIFICATION_TYPES` constants module (shared with
  `core-schema`), and the wire `type` accepts any string so plugin notifications
  still push.
- **react-02 / react-03**: added the missing `'use client'` directive to the React
  client entries (`client/react.ts`, `client/react-store.ts`), `react/realtime.ts`,
  and the `ab-test` / `media-optimize` hook modules, so importing `@createcms/core/react`
  (and wrapping your app in `RealtimeProvider`) no longer fails to bundle in an RSC
  app. JSDoc examples corrected to import the RSC-safe rendering API from
  `@createcms/core/react/blocks` in Server Components.
- **react-14**: split the pure `CMS_ERRORS` data from the `CMSError extends APIError`
  class so the browser client no longer pulls the `better-call` server lib; added
  `"sideEffects": false` so bundlers can tree-shake it.
- **react-04**: `useOptimize` now keys its memo on a file content-key (name/size/
  lastModified), so replacing a file array with a same-length one re-runs.
- **react-08**: client `runPluginInit` failures are caught + logged (no more
  unhandled rejection); the docstring matches the synchronous-build reality.
- **react-09**: `useNotifications` merges the reconcile poll into state by id
  (a racing live push is no longer overwritten), re-adding only genuine mid-poll
  pushes — items newer than the newest polled row — so the unread badge never
  drifts or reorders when the list is longer than the page size. Polls are
  guarded with a monotonic request id, and a failed poll now surfaces an `error`
  instead of being swallowed.
- **react-10**: `CMSClientStore.listen` returns its unsubscribe and uses
  `atom.listen` (was `subscribe`, immediate-fire, and leaked).
- **react-13**: proxy atom-listeners fire only on MUTATING calls (a GET read no
  longer forces subscribed query atoms to refetch); deferral uses `queueMicrotask`.
- **react-12**: renderer threads `fromReference` through the whole referenced
  subtree (no stray "No component mapped" dev warnings on grandchildren) and keys
  the inlined reference fragments.
- **react-11 / react-15**: documented the stable-client / non-referentially-stable
  proxy constraint; dropped the `resolveWireName` re-export from the `'use client'`
  tracking module (import it from the core entry server-side).

react-05/06/07 were already fixed by the earlier api-design client work; react-16
(render-test suite) is intentionally out of scope.
