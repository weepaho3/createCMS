---
'@createcms/react': minor
---

`Media.Thumbnail` renders `deliveryUrl` (the asset gate) by default, never
the bucket URL of a private asset. `CmsAssetListItem` gains `deliveryUrl`
and its `url` is `null` for private assets.
