---
"@createcms/core": patch
---

Notification `meta` now carries everything a deep link needs, so the synchronous
`createNotificationRouter` never has to look anything up:

- `approvalRequested` / `approvalApproved` / `approvalRejected` now include
  `rootId` and `branchName` (previously only `branchId`).
- `comment` now includes `rootId` (it already had `messageId`/`threadId`), and
  the reply-path `mention` notification carries `rootId` too.

`CoreNotificationMetaMap` is updated to match, so router resolvers get the new
fields typed. No schema change — these are `meta` (jsonb) fields populated from
data already joined at emit time.
