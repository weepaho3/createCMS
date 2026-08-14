---
'@createcms/core': minor
---

Three-way merges now auto-resolve blocks where source and target changed
disjoint sets of top-level properties (git-style: block ≈ file, property ≈
line). Same-key edits — including richText — remain conflicts, as do
delete-vs-edit, type changes, and divergent children. `checkConflicts` and
`createMergeRequest` responses gain `autoMergeableBlockIds`.
