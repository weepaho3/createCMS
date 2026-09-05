---
'@createcms/core': patch
---

`media.commitReplace` now re-validates the declared MIME type and size
against the media config, requires `objectKey` to match the issued `slug`,
and confirms the object exists in the bucket with the declared content
length and type before repointing the asset row.
