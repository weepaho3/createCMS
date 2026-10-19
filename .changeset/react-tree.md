---
'@createcms/react': patch
---

New `@createcms/react/tree`: a headless tree over flat rows (`Tree.Root`,
`Tree.Item`, `Tree.Toggle`, `Tree.DropIndicator`) with APG keys, type-ahead
and native drag and drop. Drops resolve to an instruction like in a file
tree: the edges of a row drop next to it, the middle into it, the end of a
subtree picks the level by the pointer's inline offset, empty space drops
into the root level. Ordered trees draw a line at the target level;
unordered trees mark the receiving node and its visible subtree, and a
refused target shows as blocked. The React-free kernel
`@createcms/react/tree/core` exports `dropInstruction`, keyboard navigation
and type-ahead for drag sources the tree does not see as native events. The
`tree` registry item styles the parts.
