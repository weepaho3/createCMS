---
'@createcms/react': patch
---

`Canvas.BlockToolbar` and `Canvas.InsertButton` sit on the overlay.
`resolveInsertAt` / `useInsertTarget` pick a line or box insert from
measured rects and the parent layout flow.
