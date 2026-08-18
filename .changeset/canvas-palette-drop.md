---
'@createcms/react': patch
---

`Canvas.PaletteItem` can be dragged even when the current selection cannot host the type. A click after a palette drop does not insert a second block. Pointer drag binds move/up/cancel on the document so a reorder does not stay latched to the cursor when the handle loses the pointer.
