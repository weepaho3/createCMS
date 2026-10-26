---
'@createcms/react': patch
---

`Editor.FramePreview` draws selection and hover rings over a readable frame
(`data-editor-selection-ring`, `data-editor-hover-ring`, both with
`data-editor-frame-ring`), and hovering a block in the frame writes
`store.hover`. `rings={false}` turns the rings off.
