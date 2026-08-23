---
'@createcms/core': patch
---

`ROOT_NOT_FOUND` now says what actually happened: a root that is missing,
archived, or outside the active scope reports "Root not found: the id
does not exist, is archived, or lies outside the active scope (check the
language or tenant context of the request)", while a genuine snapshot
failure keeps "Root block not found in snapshot". The code and status
are unchanged.
