---
'@createcms/core': minor
---

feat(merges): add `dismissStaleApprovals` branch-protection flag

By default an approval keeps counting after new commits are pushed to a merge
request's source branch, matching GitHub's default pull-request behaviour. This
is unchanged.

Teams that need every merged commit to have been reviewed can now set
`branchProtection.dismissStaleApprovals: true` (globally or per collection),
the equivalent of GitHub's "Dismiss stale pull request approvals when new
commits are pushed". With it on, the merge gate only counts approvals recorded
against the source branch's current head, and a superseded approval fails with
the new `APPROVALS_STALE` error.
