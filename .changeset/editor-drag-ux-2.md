---
'@createcms/react': patch
---

Canvas chrome over a frame: starting inline text editing no longer scrolls the page to the top. A host-layer `Canvas.BlockToolbar` moves inside the block when the page's scroll containers hide the space above it. `Canvas.DragPreview` is as tall as its content instead of the dragged block, flips above the pointer at the bottom edge, and in a host-layer overlay over a frame is fixed in the host page, so no scroll container clips it or grows with it.
