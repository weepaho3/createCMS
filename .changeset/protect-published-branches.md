---
"@createcms/core": patch
---

Replace `branchProtection.protectMain` with `branchProtection.protectPublishedBranches`.

**Breaking:** `protectMain` (shipped in 0.2.3) is removed. It protected the default branch by name; the replacement instead locks a branch against direct content mutations for exactly as long as it is **published** — published content is the live, production-facing tree, so it is made immutable in place. Changes go via another branch + merge, then a re-publish; unpublishing makes the branch directly editable again. This applies to **any** published branch (a root can have several at once, e.g. A/B variants), not just the default one, and a never-published branch is freely editable.

- Enforced by a shared `assertBranchWritable` guard on every content-mutation route, including `revertBranch` (which rewrites a published branch's head in place).
- `createRoot` is never gated (it seeds a fresh, unpublished branch).
- Still throws `PROTECTED_BRANCH` (403).

Migration: rename `protectMain: true` to `protectPublishedBranches: true`. Note the new semantics — protection now follows the publication state, not the branch name.
