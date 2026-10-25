---
'@createcms/react': minor
---

Canvas content is locked: `Canvas.Root` renders blocks in an `inert`
`data-editor-content` wrapper, so links, forms, inputs and embeds inside
blocks take no clicks, focus or keys in the editor. Hover, selection, the
context menu, drop targets and click-to-edit resolve blocks and fields from
their measured boxes instead of the event target. In-place editors lift the
lock while they run; `useEditableField` starts on a click instead of hover.
