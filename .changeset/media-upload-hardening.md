---
'@createcms/core': patch
---

fix(media): scope variant refs to the active tenant and measure real upload bytes

`validateVariantRefs` looked up `variantOf` ids with no scope filter, letting a
multi-tenant caller reference or probe another tenant's asset ids. It now ANDs
the active scope's asset `where`, mirroring every other media query.

On the two server buffer-upload paths (`uploadAssets`, `replaceAsset`) the
`maxFileSize` check, the persisted `size` column, and the S3 `contentLength` all
used the client-declared `size` — a body field the server never verified. They
now use the true byte length measured from the held buffer, so an under-declared
`size` can no longer bypass the limit or corrupt stored metadata. The
client-side `createSignedUpload` path is unchanged (the server never holds those
bytes).
