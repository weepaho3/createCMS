---
'@createcms/core': minor
---

The upload client signs each file when a pool slot takes it and completes it
right after its PUT, so slow batches no longer hit expired signatures and a
closed tab keeps every file that already landed. Network errors, 408, 429,
5xx and S3 `RequestTimeout` are retried with full-jitter backoff (up to five
attempts) for the PUT, `createSignedUpload` and `completeUpload`; a PUT whose
signature expired is re-signed once and otherwise ends `UPLOAD_EXPIRED`. An
entry shows `progress` 0.99 until its row exists. Server-side S3 HEAD, ranged
GET and DELETE retry up to three times. The default `signedUrlExpiresIn` is
300 s.
