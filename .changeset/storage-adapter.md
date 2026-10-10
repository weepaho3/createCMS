---
'@createcms/core': patch
---

New `StorageAdapter` interface with declared `capabilities`, exported with
`StorageCapabilities`, `StorageError` and `createS3StorageAdapter`. Set
`media.storage` to route every storage operation (put, delete, head, range
read, signed PUT/GET URLs) through a custom backend; S3 stays the default and
is unchanged. Routes check capabilities before any I/O: signed uploads, the
image byte check on `completeUpload`/`commitReplace` and the gate's download
redirect fail with the new `STORAGE_UNSUPPORTED` (500) when the adapter does
not declare them. The signed-upload response `headers` now come from the
adapter.
