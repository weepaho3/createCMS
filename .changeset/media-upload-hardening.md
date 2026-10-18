---
'@createcms/core': minor
---

Media upload hardening: every upload path sniffs the first 4,100 bytes
(PNG, JPEG, GIF, WebP, AVIF, HEIC, MP4, QuickTime, WebM, MP3, Ogg, WAV,
PDF, ZIP) and refuses markup under any non-text type and renderable types
whose bytes do not match. SVG is refused even when `allowedMimeTypes` lists
it. Stored file names are normalized (NFC, no control or bidi override
characters, 200 bytes, extension of the type). Upload tokens are bound to
the endpoint and host that signed them, and no key of an existing asset is
ever signed. State-changing media requests with cookies must come from the
CMS's own origin or `media.allowedOrigins` (new error `ORIGIN_NOT_ALLOWED`).
Signing is limited by `media.uploadRateLimit` (default 60 files per actor
and minute) and an optional `media.quota` (new error `QUOTA_EXCEEDED`).
