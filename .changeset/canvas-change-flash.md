---
'@createcms/react': patch
---

Blocks that undo, redo or a remote client insert, move or change carry
`data-flashed` for 700 ms after the canvas renders them, like `data-dropped`
after a drop; local edits never flash.
