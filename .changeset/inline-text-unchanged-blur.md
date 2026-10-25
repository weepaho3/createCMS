---
'@createcms/react': patch
---

`Canvas.InlineText` no longer writes the field when an inline edit ends with the stored value unchanged. Clicking into a text field and leaving it (blur, Enter, or Escape with `discardOnEscape`) without typing keeps the document clean and adds no undo step, and typing then leaving the field is a single undo step.
