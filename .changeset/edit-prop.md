---
'@createcms/core': minor
---

Block components receive an `edit` prop with the editor anchors as plain
data (`edit.block`, `edit.field.<key>`, `edit.active`) — `NO_EDIT` outside an
editor, real `data-editor-block` / `data-editor-field` anchors when the
renderer is given `edit="preview"`. `BlockComponentProps.properties` is now
typed as an object (never `undefined`). Breaking for code that renders a
block component by hand: pass `edit={NO_EDIT}`.
