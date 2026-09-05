---
'@createcms/core': patch
---

Search index now updates after `executeMerge`, `publishBranch`,
`duplicateRoot` and `revertBranch`. `revertBranch` additionally returns
`rootId`.
