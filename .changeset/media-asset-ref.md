---
'@createcms/core': minor
---

An `image` property accepts an `AssetRef` (`{ assetId, alt, decorative,
caption, crop, focal, revisionId }`) besides a bare asset id, so alt text and
crop travel with the block through branches, merges and translations.
Fractions are validated, a `revisionId` must be a revision of the asset, and
`requireAlt` on the property demands alt text or `decorative: true`.
`assetIdOf`, `normalizeAssetRef` and `imageAlt` help renderers;
`richTextImageAttrsSchema` and `richTextLinkAttrsSchema` validate the
image node and link mark of rich text documents.
