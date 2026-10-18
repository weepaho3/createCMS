---
'@createcms/core': minor
---

Multipart uploads for large files. Files above `media.multipart.threshold`
(64 MiB) on a storage with the `multipart` capability get a
`createSignedUpload` entry with `multipart: { uploadId, partSize,
partCount }` and `signedUrl: null`; parts are signed in batches by the new
`signUploadParts` endpoint (URLs bind the exact part length), the held parts
are listed by `listUploadParts`, and `completeUpload` checks and assembles
the parts before the usual object checks. `abortUpload` aborts the multipart
upload. The browser upload queue uploads up to four parts of a file at once,
retries each part on its own, keeps the landed parts on pause and records
unfinished multipart uploads in `localStorage` for 24 hours, so picking the
same file again after a reload continues the upload.
`takeInterruptedUploads()` marks such uploads `resumable`.
