---
'@createcms/react': patch
---

Drag and drop polish. Outline row drags no longer select page text and mark the tree with `data-dragging`. In a frame surface the whole frame viewport takes drops (the page area below the last block drops into the root) and auto-scroll continues into the host page around a frame that grows with its content. Auto-scroll uses a narrower edge zone (15 %, at most 96 px) and eases in towards the edge. `Canvas.FieldRing` shows only while its block is selected and hides during a drag. New frame option `minHeight`.
