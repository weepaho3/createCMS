---
'@createcms/react': patch
---

`Canvas.DragPreview` follows the pointer with `translate3d` on a DOM ref
(coalesced to animation frames) instead of re-rendering React on every
`pointermove`.
