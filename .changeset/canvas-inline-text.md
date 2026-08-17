---
'@createcms/react': patch
---

`Canvas.InlineText` overlays a contentEditable glass on string and
richText fields. Field lookup is scoped to the canvas host and the
own block. Empty fields keep a zero-width display placeholder that
is never stored.
