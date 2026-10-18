---
'@createcms/react': patch
---

The canvas measures only what it shows: rings, toolbars and handles track
their rects, kept current by one shared observer set, one frame of reads
and a 100 ms poll, while other rects are measured on demand. Rings handle
`display: contents`, overflow clipping (with `data-clamped-*` edges), sticky
and fixed blocks and transforms, carry `data-state`, `data-kind` and position
variables, and no longer drift when a positioned canvas scrolls. New parts:
`Canvas.Label` with a breadcrumb, `Canvas.EmptySlot` and
`Canvas.SpacingOverlay`; `Canvas.InsertButton` appears after a short rest,
and `Canvas.BlockToolbar` flags when it flips or the canvas scrolls.
