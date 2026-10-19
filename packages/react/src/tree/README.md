# @createcms/react/tree

A headless tree over flat rows: `Tree.Root` (APG keys, type-ahead, one tab
stop, native drag and drop), `Tree.Item`, `Tree.Toggle` and
`Tree.DropIndicator`. Rows are siblings in the DOM; indentation comes from
`--tree-indent` and `--tree-level`.

Drops resolve through `dropInstruction` in `@createcms/react/tree/core`
(React-free): the edges of a row drop next to it, the middle into it, the
end of a subtree picks the level by the pointer's inline offset, empty
space drops into the root level. Ordered trees draw a line at the target
level; unordered trees mark the receiving node and its visible subtree
(`data-drop-target`, `data-drop-within`). A refused target shows as
`data-drop-blocked` and is never redirected.

Reference:
`apps/docs/content/docs/reference/react-tree.mdx`.
