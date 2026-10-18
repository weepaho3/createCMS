---
'@createcms/react': patch
---

File-manager behaviour for the media library. `Media.Grid` takes
`spaceAction="preview"` to open the preview with Space (Alt+Space toggles).
`useFolderDrop` takes `edges: { parentId }`, so the top and bottom edge of a
target drop next to it, and reports `position`. Tree items use it
(`data-drop-position`), the tree takes drops outside its rows into the root,
and the open crumb accepts drops. Folders are draggable only when the client
can move them. The `media-library` registry item shows the selected asset's
preview and details in a side column from 1280 px and in a sheet below,
opens the preview with Space, and marks the selection like a file manager.
