---
'@createcms/react': patch
---

`Canvas.DragPreview` shows a moved block as a scaled-down copy of itself (resolved styles inline, so it looks the same over the frame and outside it; editor anchors, editable state, frames and media removed; blocks over 400 elements fall back to the label) and a new block's `previewImageUrl` above its label. `preview="label"` keeps the label chip; `data-content` says what the preview shows. Over a frame, the fixed preview follows the pointer outside the frame too.
