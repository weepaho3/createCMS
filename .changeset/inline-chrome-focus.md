---
'@createcms/react': minor
---

In-place rich text editing on the canvas keeps running while focus is in
the editing chrome: `Canvas.BlockToolbar` and anything marked
`data-editor-inline-chrome`, like a link popover opened from it. Keyboard
users can Tab into the block toolbar without ending the session.
