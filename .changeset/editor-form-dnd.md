---
'@createcms/react': patch
---

`Canvas.DragHandle` anchors to the selected block unless it is inside
`Canvas.BlockToolbar`. Drag gestures still start while inline text is
focused, and the preview keeps `translate3d` updates off-canvas.
