---
"@createcms/core": patch
---

Security-hardening pass (sec-01, sec-03 … sec-08). Several **breaking** changes
that close real holes; all fail secure by default.

- **`authMiddleware` is now required** (sec-01). `createCMS` throws at
  construction if it is missing, so auth can never be silently absent. To run
  with no auth on purpose (public/dev), pass the new `allowAnonymous()` export,
  which authorizes every request and is byte-identical to the old omitted-
  middleware behavior. The undocumented `middleware` alias for `authMiddleware`
  was removed.
- **Default `allowedMimeTypes` is now an explicit allowlist** (sec-04):
  `image/png`, `image/jpeg`, `image/webp`, `image/gif`, `video/mp4`,
  `video/webm`, `application/pdf` — no `image/*`/`video/*` wildcards, so
  `image/svg+xml` (a stored-XSS vector) is excluded by default. Uploads that
  carry file bytes are additionally checked against their real magic bytes, so
  a file **declared** as `image/png` but **containing** SVG/HTML is rejected
  before it reaches storage. Upgraders who relied on wildcard formats (avif,
  heic, mov, …) must re-add them explicitly via `media.allowedMimeTypes`.
- **`user.exposeColumns` is now required when a `user` table is configured**
  (sec-06). It previously defaulted to *every* column, which leaked password
  hashes / tokens through `withUser`. `resolveUserConfig` now throws instead of
  defaulting to all columns — you must name the safe columns explicitly.
- **Multi-tenant slug is no longer taken from the request body/query by
  default** (sec-03). `resolveTenantSlug` returns the session-derived fallback
  and ignores request-supplied slugs unless you opt in with
  `{ allowRequestOverride: true }` (intended only behind an admin check),
  closing a cross-tenant access path.

Internal hardening (no API change): magic-byte MIME sniffing helper; fixed a
prefix-match bug in `isFileTypeAllowed` (`imagexml/evil` no longer matched the
`image` prefix); `SAFE_IDENTIFIER` validation applied to every table/column
identifier spliced into `sql.raw()` in the user-join helpers.

Also adds a **Security** documentation page covering the required-auth model,
media privacy and MIME/SVG handling, rate limiting, CSRF, and multi-tenant
isolation.
