---
'@createcms/core': minor
---

Three-way merges now auto-resolve blocks where source and target changed
disjoint sets of top-level properties (git-style: block ≈ file, property ≈
line). Same-key edits — including richText — remain conflicts, as do
delete-vs-edit, type changes, and divergent children. `checkConflicts` and
`createMergeRequest` responses gain `autoMergeableBlockIds`.

Agreement counts per property: when both sides make the identical change to
the same property, that agreement merges together with each side's remaining
disjoint edits.
