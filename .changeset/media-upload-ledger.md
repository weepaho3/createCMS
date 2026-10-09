---
'@createcms/core': minor
'@createcms/react': minor
---

`media.useUploadAssets()` keeps a ledger of every file handed to `upload()`
until `reset()` drops the finished entries. `progress` is byte-summed
(`{ loaded, total, fraction }`) instead of a per-file average, each entry
ends `success`, `error` (`{ code, message }`) or `aborted`, `upload()`
resolves with that call's entries and PUTs at most `concurrency` files
(default 4) at once, and `signal` aborts a single call. `isAborted` and
`totalProgress` are removed; `status: 'done'` is now `'success'`. The
`@createcms/react` mirror types `CmsMediaUploadState` and
`CmsMediaUploadFileState` follow, with `CmsMediaUploadStatus` and
`CmsMediaUploadProgress` added.
