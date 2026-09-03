---
'@createcms/react': patch
---

`Canvas.DragHandle` anchors to the selected block unless it is inside
`Canvas.BlockToolbar`. Overlay chrome pins inside the visible block when
`side="top"` would clip under `Canvas.Overlay` `overflow: hidden`, so the
first-block drag handle stays hittable. Drag gestures still start while
inline text is focused, and the preview keeps `translate3d` updates
off-canvas.
