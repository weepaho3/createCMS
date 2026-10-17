---
'@createcms/core': minor
---

Asset slugs are unique per scope: the global `assets_slug_unique` index
becomes the non-unique `assets_slug_idx`, so two tenants can own the same
file name with the same slug. Server-side `uploadAssets` and `replaceAsset`
store objects at `<id>/<slug>`, so equal slugs never share an object. Publish
discovery only changes the status of assets in the publishing request's
scope, and `deleteFolder` ignores archived assets and assets outside the
scope when deciding whether a folder is empty. Requires `createcms generate`
and a migration.
