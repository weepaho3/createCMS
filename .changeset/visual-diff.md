---
'@createcms/core': patch
---

feat(diff): visual diff — precise change classification, property-level detail, and a renderable annotated tree

**BREAKING (pre-1.0): `getDiff` semantics and response shape changed.**

- **Identity-based `moved` (noise fix):** blocks are only flagged `moved` when they were reparented or are a true reorder outlier among surviving siblings (LIS-based). Siblings whose index merely shifted because another block was inserted/removed/moved around them are no longer flagged. Inserting one block among N siblings now yields exactly one diff entry (was N+2).
- **Truthful `childrenReordered`:** only set on a parent when the relative order of its surviving common children changed — never for pure child additions/removals.
- **Property-level detail:** modified entries carry `propertyChanges` (`{ path, kind: 'added' | 'removed' | 'changed', from, to }` with deep paths and array LCS alignment), `typeChange`, and word-level `textDiff` segments (`same`/`ins`/`del`) for `richText` properties (including list-of-richText items).
- **Slug changes are first-class:** a draft-slug change on the root yields `slugChange: { from, to }` instead of an opaque `modified`; the reserved `__slug` key no longer leaks into any returned version properties.
- **Annotated diff tree:** new `view` query param (`'list' | 'tree' | 'both'`, default `'both'`). The response is now `{ diff, tree, summary, sourceCommitId, targetCommitId, commonAncestorCommitId }` — `tree` is the draft tree with per-node `diff` annotations and deleted blocks re-inserted as ghost nodes at their old position (with their last content), directly renderable by the existing component maps. `summary` carries per-changeType counts.
- **React:** `BlocksRenderer` and `createContentRenderer` accept an opt-in `diff` prop that wraps changed blocks in `<div data-diff="added | deleted | modified | moved" data-diff-types data-diff-props>` (or a custom `wrap` callback). New helpers: `getBlockDiff(node)`, `diffSegmentsToHtml(segments)` for inline rich-text ins/del highlighting; `BlockComponentMap` is now exported.

New exported types: `ChangeType`, `PropertyChange`, `TextDiffSegment`, `MovedInfo`, `BlockChange`, `DiffSummary`, `BlockDiffAnnotation`, `AnnotatedBlockTreeNode`, `DiffView`.
