---
'@createcms/core': patch
---

When `updateBlocks` rejects a link property whose value carries the
resolved read shape (`href` / `targetRootId`), the `TYPE_MISMATCH` error
now names the affected properties and points at reading the tree with
`raw: true`; the structured `data` carries `resolvedLinkKeys`.
