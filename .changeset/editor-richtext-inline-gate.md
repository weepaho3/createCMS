---
'@createcms/react': minor
---

`Canvas.InlineText` no longer edits `richText` fields. The glass writes back
plain text, so an inline edit dropped the value's markup. A click on a
`richText` field now selects the block and focuses its form control, and a
development build logs `[editor:E001]` once. `isInlineEditableKind('richText')`
returns `false`, and empty `richText` fields no longer get the zero-width
placeholder in the canvas render.
