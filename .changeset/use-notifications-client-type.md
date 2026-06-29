---
"@createcms/core": patch
---

`useNotifications` now takes your typed `createCMSClient` instance directly — no
`as unknown as Parameters<typeof useNotifications>[0]` cast. The hook's internal
client shape brands `query.withUser` as `true` (matching the client's
`WithUserQuery`) instead of plain `boolean`, so a real typed client is
structurally assignable.

`userId` is now optional. Pass it straight from your auth session
(`session?.user?.id`) instead of the `?? ''` workaround: while it's undefined the
hook stays poll-only (seeded from `listNotifications`) and opens the
`notif:<userId>` subscription once it resolves. The CMS has no current-user
endpoint, so your app still supplies the id.
