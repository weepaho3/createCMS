---
'@createcms/core': minor
---

fix(routes): close two permission-resource bypasses

`duplicateBlock` minted a new top-level root when `targetParentBlockId` was
omitted, while declaring only `block:create` — so a host granting `block:create`
but denying `root:create` could be bypassed through duplication. This was the
same defect already fixed on `duplicateRoot`, still reachable through the older
door.

**Breaking:** `targetParentBlockId` is now required on `duplicateBlock`, which
is child-duplication only. Use `duplicateRoot` to duplicate a subtree into a new
top-level entry — it takes the same arguments and has always been guarded as
`root:create`. `duplicateBlock` now returns a non-union type (`mode` is always
`'child'`), so callers no longer need to narrow it.

`publishRelease` made content live under `release:update` while the equivalent
`publishBranch` requires `publication:create`.

**Breaking:** `publishRelease` now declares `publication:create`. Hosts granting
`release:update` for release curation must also grant `publication:create` to
allow publishing.
