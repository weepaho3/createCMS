---
'@createcms/react': patch
---

`Canvas.Root` renders into an iframe with `surface="frame"`: a real viewport
for media queries and e-mail widths, fixed or fitted widths with
`transform: scale()`, an auto height with a feedback-loop guard, head markup
and body attributes patched without reloads, host stylesheets mirrored in,
and an `emailFrame` preset. Blocks, rings, inline text, shortcuts, the
clipboard and drag and drop work across the frame edge; `Canvas.Overlay
layer="host"` draws chrome that may leave the frame, and `useSurface` maps
coordinates. `Editor.FramePreview` selection works in WebKit, which runs no
listeners in a frame sandboxed without scripts: clicks arrive through a
shield in the host page there.
