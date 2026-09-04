---
'@createcms/core': patch
---

Revalidation pre/post-processing failures are logged and no longer turn a
committed mutation into an error response. The pre-resolved unpublish slug
is passed through the call instead of a process-lifetime map.
