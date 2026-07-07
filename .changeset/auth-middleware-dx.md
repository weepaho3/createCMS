---
"@createcms/core": patch
---

Harden the auth story so a missing or naive `authMiddleware` fails loudly
instead of silently.

- **Startup warning (dx-06).** Omitting `authMiddleware` leaves every endpoint —
  including destructive content, media, and admin mutations — unauthenticated
  and unscoped, with no signal. `createCMS` now logs a warning when no auth
  middleware is configured. Return `{}` from an `authMiddleware` to intentionally
  allow all and silence it.
- **Packaged deny path (dx-07).** Added `UNAUTHORIZED` (401) and `FORBIDDEN`
  (403) to the error codes, so `authMiddleware` can `throw new CMSError('UNAUTHORIZED')`
  and get the right HTTP status. The `createcms init` scaffold now uses this
  instead of `throw new Error('Unauthorized')`, which better-call mapped to a
  noisy HTTP 500.

Documented the deny contract and the open-API warning in the configuration
reference.
