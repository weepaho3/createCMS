---
'@createcms/react': minor
---

`Editor.Outline` is built on `@createcms/react/tree`: an APG tree over flat rows, rendered by a `children` callback with `Editor.OutlineItem row={row}`, plus `Editor.OutlineToggle` and `Editor.OutlineDropIndicator`. Blocks with several slots or a named one get a row per slot with their blocks one level below. Pointer drags resolve through `dropInstruction`: a line at the target level between rows, the receiving row marked for drops into it, and targets the placement rules refuse shown as blocked. Virtualized outlines pass `rows`, `range` and `reveal`. Focus alone no longer selects a block. `Tree.Root` gains `range` and `reveal` for virtualized lists.
