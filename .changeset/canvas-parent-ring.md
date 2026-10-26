---
'@createcms/react': patch
---

`Canvas.ParentRing` outlines the ancestors of the primary selection (the
container it sits in), one ring per ancestor up to `depth` (default 1),
never the root, with `data-editor-parent-ring` and `data-depth`.
