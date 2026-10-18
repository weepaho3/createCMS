---
'@createcms/core': minor
---

Media search and filters: `listAssets` searches file name, description,
credit and copyright with `q` (a weighted full-text index plus substring
matches), filters by kind, type, folder subtree, visibility, provenance,
uploader, dates, size, dimensions, orientation and expiring rights, sorts by
name, update time and width, skips the count with `includeTotal: false` and
no longer lists variants or revisions. `getAssetFacets` counts matches per
kind, provenance and visibility. Bulk endpoints accept
`allMatching: { query, except }`, resolved on the server. `listFolders`
reports `folderCount`, the `deleteFolder` preview `pages`. Schema
definitions can index an `expression`.
