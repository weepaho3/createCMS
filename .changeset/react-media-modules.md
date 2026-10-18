---
'@createcms/react': minor
---

Media library modules: `@createcms/react/media/core` is a React-free kernel
with a store of slices, commands, typed events and registries (sources, file
hooks, asset actions, preview renderers), a layout engine for grid,
justified, masonry and list with 2D navigation, an OS-style selection with
server-side select all, marquee geometry, a URL-serializable `FilterState`,
folder drop traversal and drag payloads. `Media.Grid` is an APG grid with
virtualization, keyboard navigation, type-ahead and marquee; thumbnails load
renditions with placeholders; uploads show as tiles. New parts:
`Selection.*`, `Bulk.*` (actions with confirmation and undo), `Folder.*` (an
APG tree with lazy children, inline create and rename), `Filter.*` (chips
with facet counts), `Intake.*` (drop zone, window overlay, file and folder
inputs, paste) and drag and drop between items, folders, the editor and the
desktop. `Media.Root` announces uploads, selections and results.
