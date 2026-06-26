---
"@createcms/core": patch
---

Add branch-protection and approval governance to the CMS config, plus a configurable default branch name.

- **`branchProtection.protectPublishedBranches`** — lock a branch against direct content mutations (create/update/delete/move/duplicate of blocks, `updateRoot`, and reverting the branch) for exactly as long as it is **published**; the live tree is immutable in place, so edits go via another branch + merge and a re-publish. Unpublishing makes the branch editable again. Applies to any published branch (a root can have several at once, e.g. A/B variants), not just the default one; a never-published branch is freely editable. Throws the new `PROTECTED_BRANCH` (403) error.
- **`branchProtection.requireApprovalBeforePublish`** — make `publishBranch` always require approvals, not just when one was explicitly requested. Default `false` (existing conditional behavior).
- **`branchProtection.requiredReviewers`** — minimum distinct approved reviewers for the merge / publish gates (default `1`).
- **`defaultBranchName`** — the branch every root is seeded with, replacing the hard-coded `'main'` throughout (rename/delete guards, read/search resolution, and i18n translation copy-seeding).

**Breaking:** `branchProtection.requireApprovalToMerge` defaults to `false`. Previously `executeMerge` ALWAYS required approvals; merges now succeed without approval unless you set `requireApprovalToMerge: true`. Set it explicitly to keep the prior gate.
