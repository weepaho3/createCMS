---
"@createcms/core": patch
---

`branchProtection` can now be overridden **per collection**. A collection definition accepts its own `branchProtection` (a `Partial<BranchProtectionConfig>`): each field set there wins over the global config for that collection only, and unset fields inherit the global value (then the default).

This makes governance flexible per content type — e.g. a `reusableBlock` collection can set `branchProtection: { protectPublishedBranches: false }` to stay directly editable, while pages keep the global protection. The same applies to `requireApprovalToMerge`, `requireApprovalBeforePublish`, and `requiredReviewers`. Backward compatible: collections without an override behave exactly as before. (`defaultBranchName` and `mergeStrategy` remain global.)
