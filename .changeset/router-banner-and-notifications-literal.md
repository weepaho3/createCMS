---
"@createcms/core": patch
---

Two DX fixes:

dx-18: a `basePath`/mount mismatch used to fail as a bare 404 with no hint at the
cause. A `GET` to the mount root (`basePath`, default `/api/cms`) now answers with a
small JSON banner (`{ ok, cms, basePath, message }`) so the mount can be verified
with one `curl <basePath>`. Endpoints below the root are still routed normally. New
troubleshooting entry documents the check.

dx-19: `notifications` is now typed `false` (was `boolean`), so wiring it to a
widened `boolean` (e.g. an env var) is a compile error instead of a silent trap
where the types stayed enabled while the runtime disabled the feature. Omit the
option to keep notifications enabled (unchanged default).
