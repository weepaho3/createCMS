---
'@createcms/react': patch
---

`Canvas.DragHandle`, `Canvas.PaletteItem`, `Canvas.DropIndicator` and
`Canvas.DragPreview` add pointer-events drag and drop on measured rects.
`resolveInsertAt` drives the drop target; `adjustMoveIndex` corrects
same-parent moves on commit.
