---
'@createcms/react': patch
---

`richText` fields edit in place on the canvas through `Editor.Root
richText`: a click mounts the editor on the field element with the caret at
the click point and the formatting kept, edits write the field live as one
undo step per typing run, and Escape, leaving the field or a drag ends the
session. `Canvas.InlineRichTextToolbar` puts the session's formatting
buttons into `Canvas.BlockToolbar`, where they keep the editor's focus, also
over a frame. Hovering a field starts loading a lazy rich text editor.
