---
'@createcms/core': minor
---

`richText` properties store ProseMirror (Tiptap) JSON (`RichTextDoc`)
instead of HTML strings, with `marks`, `nodes` and `inline` per property
and `minLength`/`maxLength` counted on the plain text. Every write path
validates values (`RICH_TEXT_INVALID` for disallowed formatting or unsafe
link URLs). `RichText` and `renderRichText` render values without
`dangerouslySetInnerHTML`, `RichTextDiff` renders word-level diffs
(`richTextDiff` replaces `textDiff`), and `richTextToHtml` /
`richTextToPlainText` cover e-mail and string contexts. Variables, internal
link marks, templates and search work inside rich text. `migrateRichText`
(and `admin.migrateRichText`) converts stored HTML once.
