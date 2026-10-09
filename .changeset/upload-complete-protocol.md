---
'@createcms/core': minor
---

Browser uploads use a presign/complete protocol. `createSignedUpload` writes
no row and returns `{ uploads: [{ id, objectKey, url, signedUrl, headers,
token }], expiresAt }`; after the PUT, `completeUpload({ uploads: [{ token }] })`
verifies the landed object (length, content type, magic bytes of a declared
image) and creates the row, so an abandoned PUT never produces an asset. New
browser uploads are stored at `<id>/<slug>`. `createSignedReplace` returns a
`token` and `commitReplace` takes `{ token }` only. New error codes
`UPLOAD_TOKEN_INVALID` and `UPLOAD_NOT_FOUND`; new optional
`media.uploadSecret`. The core client's upload ledger and replace atom follow
the protocol.
