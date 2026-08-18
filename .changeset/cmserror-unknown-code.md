---
'@createcms/core': patch
---

`CMS_ERRORS` ships as its own export so Next.js does not stub it from a `'use client'` chunk. `CMSError` also survives a missing map entry (500 with `cmsCode` preserved) instead of throwing TypeError on `def.status`.
