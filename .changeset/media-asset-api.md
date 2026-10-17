---
'@createcms/core': minor
---

New media endpoints: `updateAsset` (display name, metadata, provenance)
with optimistic concurrency (`ASSET_CONFLICT`), `setFocalPoint`,
`setProvenance`, `restoreAssets`, `batchAssets` (`POST /media/batch`, up to
500 ids, result per id), `listRevisions` and `setCurrentRevision`. A replace
keeps the superseded bytes as a revision (optional `revisionNote`); pruning
keeps the ten newest revisions per asset, and `?rev=` on the gate serves a
pinned one. Downloads are named after the original file with a correct
RFC 6266 and RFC 8187 `Content-Disposition`. Media writes publish
`media.asset.*` and `media.folder.*` events on the realtime channel `media`
(or `media:<tenant>`), which the default channel policy opens to signed-in
callers.
