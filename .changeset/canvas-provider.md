---
'@createcms/react': patch
---

`Canvas.Provider` lets chrome outside the canvas start drag sessions:
`Canvas.PaletteItem`, `Canvas.DragHandle` and `Canvas.DragPreview` now work
anywhere under a shared provider (for example a shell sidebar), and each
`Canvas.Root` resolves drops while the pointer is over its own surface.
Without a provider nothing changes; `Canvas.Root` creates the session itself.
