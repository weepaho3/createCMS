---
"@createcms/core": patch
---

`listBranches` now returns `hasPublications` (a boolean) per branch, so callers can tell which branches are currently published without a separate query — analogous to `hasPublications` on `listRoots`. The value was already computed internally (it drives `isDeletable`); it is now exposed on each `BranchListItem`.
