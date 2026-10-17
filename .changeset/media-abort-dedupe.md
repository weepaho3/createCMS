---
'@createcms/core': minor
---

New media endpoints `abortUpload` (deletes the object of a signed upload or
replace that will not be completed) and `findDuplicates` (exact matches by
SHA-256, name and size as a hint). `createSignedUpload` accepts a base64
`sha256` per file and signs it into the PUT when the storage verifies
checksums; the hash is stored on the asset. `runPruning` sweeps objects
without an asset row that are older than the signed URL lifetime plus one
hour, page by page (`sweepCursor`, `maxSweepObjects`).
