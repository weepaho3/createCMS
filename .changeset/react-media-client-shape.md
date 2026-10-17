---
'@createcms/react': minor
---

`MediaClient` describes the full `cmsClient.media` surface (optional
`getAssets`, `updateAsset`, `restoreAssets`, `renameFolder`, `moveFolder`,
`getFolderPath`, `deleteFolder`, `getAssetUsages`, `listRevisions`,
`setCurrentRevision`, `createSignedReplace`, `commitReplace`), and
`CmsAssetListItem` carries the new asset fields. The editor's `image` field
value is `string | AssetRef`.
