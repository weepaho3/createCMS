---
'@createcms/core': minor
'@createcms/react': minor
---

Media malware scanning and erasure. An optional `media.scan` adapter keeps
new bytes private as `processingState: 'pending'` until the pruning pass
scanned them: clean assets become `ready` (and public where they are),
infected objects are deleted and the asset is `failed`. Only `ready` assets
are delivered (`ASSET_NOT_READY` otherwise) or made public; `listAssets`
filters by `processingState`. `purgeAssets({ assetIds, reason })` erases
assets with their revisions and renditions under the new `purge`
operation, emits `media.asset.purged` with the reason code, calls
`media.onAssetPurge` and reports dangling usages. The React library gains
the `purge` store command and bulk action (typed confirmation),
`data-processing-state` on `Media.Item` and the `processing` catalog group.
