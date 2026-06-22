---
"@createcms/core": patch
---

Add branch-protection and approval governance to the CMS config, plus a configurable default branch name.

- **`branchProtection.protectMain`** — reject direct content mutations on the default branch (create/update/delete/move/duplicate of blocks, and `updateRoot`); edits must go via a branch + merge. `createRoot` is exempt. Throws the new `PROTECTED_BRANCH` (403) error.
- **`branchProtection.requireApprovalBeforePublish`** — make `publishBranch` always require approvals, not just when one was explicitly requested. Default `false` (existing conditional behavior).
- **`branchProtection.requiredReviewers`** — minimum distinct approved reviewers for the merge / publish gates (default `1`).
- **`defaultBranchName`** — the branch every root is seeded with, replacing the hard-coded `'main'` throughout (rename/delete guards, read/search resolution).

**Breaking:** `branchProtection.requireApprovalToMerge` defaults to `false`. Previously `executeMerge` ALWAYS required approvals; merges now succeed without approval unless you set `requireApprovalToMerge: true`. Set it explicitly to keep the prior gate.
