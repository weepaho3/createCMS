---
'@createcms/core': minor
---

fix(branches): deleting a branch no longer fails once it has merge history

`deleteBranch` threw a raw foreign-key error on any branch that had been merged
or had an approval request, so the standard branch → merge request → merge →
delete workflow failed at the last step with an opaque 500 and the branch stayed
permanently undeletable.

`merge_requests.source_branch_id`, `merge_requests.target_branch_id` and
`approvals.branch_id` are now nullable with `ON DELETE SET NULL`, so merge and
approval history survives the branch row. Open merge requests still block
deletion, and publications still block deletion.

**Breaking:** `ApprovalOutput.branchId` is now `string | null`. It is null for
approvals whose branch has since been deleted. Consumers reading `branchId` off
an approval must handle null.

**Migration:** this changes the database schema. Regenerate and apply your
Drizzle migrations (`drizzle-kit generate`) after upgrading.
