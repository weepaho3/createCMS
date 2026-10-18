---
'@createcms/core': minor
---

Media downloads and edits: `downloadIntent` signs short-lived download URLs
(5 minutes, attachment named after the original name, optionally a
rendition) for assets the caller can read, limited by
`media.downloadRateLimit` signatures per actor and minute (new error code
`RATE_LIMITED`, 429 with `Retry-After`) and reported to
`media.onAssetDownload` for audit logs. `media.allowReplaceWithDifferentType:
false` rejects a replace that changes the MIME type. Entries of the upload
queue carry the future `assetId` as soon as the upload is signed.
