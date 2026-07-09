---
'@createcms/core': patch
---

feat(diff): generalize getDiff to refs (branch | commit | published), per-change attribution, and history change counts

- **`getDiff` now compares arbitrary refs:** pass exactly one of `sourceBranchId` | `sourceCommitId` and one of `targetBranchId` | `targetCommitId` | `targetPublished` per side. Branch refs resolve to their head; commit refs are used as-is; `targetPublished` resolves to the live head of the entry's publication branch (exactly what `getPublishedContent` serves) and throws `PUBLICATION_NOT_FOUND` for unpublished entries. When one ref is an ancestor of the other the three-way diff degenerates to an exact two-way comparison — a commit vs its parent yields exactly that commit's changes, a draft vs `targetPublished` yields exactly the edits that are not live yet. Commit refs enforce the same collection + root scoping as branch refs.
- **`withAttribution` on `getDiff`:** every diff entry and tree annotation gains `attribution: { commitId, changedAt, changedBy, changedByUser? }`. Own-version changes attribute the commit that created the source version; pure position moves attribute the commit that actually repositioned the block (derived by walking the new parent's version history; omitted when the move arrived via a merge). `changedByUser` follows the `withUser`/`exposeColumns` rules.
- **`withChanges` on `getRootHistory`:** each commit entry gains `changes: { added, modified, deleted }` — computed as a version-id-level snapshot set-diff in a single SQL query per page (no properties loaded), intended for history badges. Merge and revert commits count absence-based deletions correctly (their snapshots carry no tombstones); merge commits diff against their first parent.
- Boolean query flags (`targetPublished`, `withAttribution`, `withChanges`) decode strictly over the wire — the string `'false'` means false.

New exported type: `ChangeAttribution`.
