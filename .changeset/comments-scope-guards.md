---
'@createcms/core': minor
---

fix(comments): enforce the active scope on every thread-addressed endpoint

Only `deleteCommentThread` enforced the caller's scope; every other
thread-addressed comment endpoint resolved a thread by id and collection alone.
Under the multi-tenant plugin that allowed cross-tenant reads and writes of
comment threads. All thread endpoints now go through a shared scope-enforcing
loader, `createCommentThread` validates the supplied `rootId`, and
`resolveCommentThread` / `reopenCommentThread` no longer operate on
soft-deleted threads.

**Breaking:** `listMentions` filtered on a caller-supplied `mentionedUserId`,
letting any caller read another user's mention inbox. It now derives the filter
from the session user, and the `mentionedUserId` query parameter has been
removed.
