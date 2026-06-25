---
"@createcms/core": patch
---

`getRootHistory` now attributes each commit to the branch it was **created on**, deterministically — fixing wrong branch labels for shared ancestors.

Previously the branch label was inferred with a recursive "nearest branch tip wins (`MIN(depth)`)" heuristic, which mis-attributed commits that lie on more than one branch's first-parent chain (a feature branch with fewer post-fork commits could "claim" main's shared history). The originating branch is now stored on each commit and read directly.

- `commits` gains `branchId` (links to the live branch — follows renames; no FK) and `originBranchName` (a deletion-proof name snapshot). Both are set at commit-write time.
- `getRootHistory` resolves `branch = COALESCE(live branch name, originBranchName)` via a simple join — the recursive CTE is gone (O(n), deterministic).

**Schema change, no backfill (beta):** the new `origin_branch_name` column is `NOT NULL`; recreate the database. There is no migration of existing commit rows.
