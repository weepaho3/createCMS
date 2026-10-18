---
'@createcms/react': minor
---

`richText` values are ProseMirror (Tiptap) JSON (`RichTextDoc`) instead of
HTML strings. `/editor/core` adds the rich text model with
`validateRichText` (allowed nodes and marks per field, link URL schemes,
structure), `richTextToPlainText`, `richTextToHtml` (escaped, no raw HTML),
`walkText`, and `htmlToRichText` for pasted, imported or stored HTML with a
loss report. `Editor.Root richText` takes a `RichTextAdapter`; without one
`richText` fields show their formatted text read-only. `RichTextStatic`
renders a value without an editor, also from `/editor/render`.
