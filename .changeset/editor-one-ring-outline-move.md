---
'@createcms/react': patch
---

`Canvas.FieldRing` stays hidden when the focused field belongs to the
selected block, so SelectionRing is the single calm outline. Outline
rows can host `Canvas.DragHandle` under `Canvas.Provider` to reorder
without inserting a new sibling; dropping on an outline `treeitem`
resolves a same-parent move. `Canvas.DragPreview` is a compact
translate3d chip so the ghost stays visible under the cursor.
