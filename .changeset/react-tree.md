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
and type-ahead for other drag sources.

`Folder.Tree` and `Folder.Item` are built on it: dropping a folder into
itself or a descendant shows as blocked while dragging, and
`useFolderDropRules` exposes the folder drop rules. The `tree` registry item
styles the parts; `media-library` uses it for the folder tree.
