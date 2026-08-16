---
'@createcms/core': patch
---

`POST /{collection}/resolveTree` resolves a posted, unsaved tree the way
`getBlockTree` resolves a stored one — variables substituted, links resolved,
references as a `references` sidecar (`includeReferencePreviews`) and/or
inlined into the tree (`inlineReferences`) — without writing anything, so an
editor can preview its working copy.
