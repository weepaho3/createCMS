---
'@createcms/core': patch
---

`BlocksRenderer` with `edit="preview"` hands blocks with `allowChildren` a
`children` slot anchor in `edit.slot.children` (`data-editor-slot`), so an
HTML preview can map a click on the children area back to its block.
`EditProps` has the optional `slot` entry.
