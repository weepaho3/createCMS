---
"@createcms/core": patch
---

Notifications now carry everything you need for deep links and showing the
responsible user, with types to match:

- **`createNotificationRouter`** (new, from `@createcms/core/react`) — define a
  resolver per notification `type` that builds a deep link from the item's
  fields; each resolver gets `meta` narrowed to that type. Pass
  `createNotificationRouter<typeof cms>(…)` to type core **and**
  plugin-contributed types. A required `fallback` keeps routing total. Pure and
  client-side — no realtime peer, no server or schema change.
- **Plugin-extensible notification types** — a new `notificationTypes` plugin
  seam (a Zod meta map): its keys fold into the `notification_type` enum at
  `createcms generate` (so a plugin persists its own `type`) and are inferred
  into `typeof cms` so the router types each plugin `meta`. The emit side
  (`cms.notify` / `notificationService.notify`) accepts plugin/app type strings.
  App-only `custom` types can also be typed by augmenting `NotificationMetaMap`.
- **Typed `actorUser`** — `listNotifications` (with `withUser`) and
  `useNotifications` now type `actorUser` off your `user` config (a partial of
  the user-table row) instead of `unknown`, inferred straight from `typeof cms`.
- **Actor on the live push** — the realtime notification event now carries
  `actorUser`, resolved server-side from the `user` config's `exposeColumns`
  (batched). The responsible user's name/avatar are available the instant a push
  lands, no second poll. `actorUser` is also passed to `onNotification` handlers.
