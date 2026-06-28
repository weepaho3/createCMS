---
"@createcms/core": patch
---

Add `media.moveAssets` — move assets between folders (and to the root).

`moveAssets({ assetIds, folderId })` sets the folder of one or more assets (`folderId: null` moves them to the root) — the missing write counterpart to `moveFolder` for drag-and-drop in a media library. Bulk-by-ids and scoped like `updateAssetStatus`: non-existent, out-of-scope, and archived ids are skipped and returned in `skipped` so a batch partially succeeds; a moved asset's variants follow it into the same folder so an original and its variants are never split apart (and a variant id passed on its own is skipped — variants are not moved directly). Returns `{ moved, movedIds, skipped }`. Throws `FOLDER_NOT_FOUND` for an unknown (or out-of-scope) target folder, `ASSET_NOT_FOUND` if none of the ids reference a live asset.
