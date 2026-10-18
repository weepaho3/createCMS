---
'@createcms/react': patch
---

`@createcms/react/editor/richtext` adds a Tiptap editor for `richText`
fields (Tiptap 3.32 as optional peer dependencies), with the field's
allowed formatting enforced on typing and paste, undo through the editor's
history, and `{{variable}}` completion. `lazyRichTextAdapter` keeps it out
of the initial bundle. `Editor.RichTextField`, `Editor.RichTextToolbar` and
`Editor.RichTextToolbarButton` build the form control; the createcms
adapter maps rich text options, reports `RICH_TEXT_INVALID` as field
errors, and converts HTML values stored before rich text became JSON when
it loads a document.
