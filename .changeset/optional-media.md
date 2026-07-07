---
"@createcms/core": patch
---

`media` is now optional on `createCMS()`. A content-only app that never uploads
can omit it entirely — no more S3-shaped placeholder credentials just to satisfy
the type. The media endpoints stay on the API (stable shape), but any operation
that actually needs storage throws a clear `MEDIA_NOT_CONFIGURED` error instead
of crashing on `undefined`. DB-only media operations (e.g. `createFolder`) still
work without a media config, and asset pruning skips S3 cleanup when media is
absent. Existing configs that pass `media` are unaffected.
