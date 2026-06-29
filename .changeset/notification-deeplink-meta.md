---
"@createcms/core": patch
---

Fix `createNotificationRouter<typeof cms>` typing when no plugin contributes
notification types: the empty plugin registry resolved to `Record<string, never>`
(a string index signature), which widened the known-type union to `string` and
collapsed every resolver's `n.meta` to `never`. The registry's index signature
is now stripped, so core (and app `NotificationMetaMap`) meta types correctly
even with no notification-type plugins.

Notification `meta` now also carries everything a deep link needs, so the
synchronous `createNotificationRouter` never has to look anything up:

- `approvalRequested` / `approvalApproved` / `approvalRejected` now include
  `rootId` and `branchName` (previously only `branchId`).
- `comment` now includes `rootId` (it already had `messageId`/`threadId`), and
  the reply-path `mention` notification carries `rootId` too.

`CoreNotificationMetaMap` is updated to match, so router resolvers get the new
fields typed. No schema change — these are `meta` (jsonb) fields populated from
data already joined at emit time.
