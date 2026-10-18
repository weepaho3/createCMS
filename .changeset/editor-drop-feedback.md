---
'@createcms/react': patch
---

Drags show where they land and what they carry: `Canvas.DropTargetRing`
outlines the target container, `Canvas.DragPreview` shows the block label,
a text excerpt and the count of a multi-selection beside the pointer, and
dropped blocks carry `data-dropped` for a short flash. `Editor.Outline` rows
drag too: reorder above or below a row, nest into its middle (collapsed
rows open after a moment), or move out one level by dragging left.
