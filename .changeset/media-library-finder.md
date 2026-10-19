---
'@createcms/react': patch
---

File-manager behaviour for the media library. `Media.Grid` takes
`spaceAction="preview"` to open the preview with Space (Alt+Space toggles).
The open crumb accepts drops. Folders are draggable only when the client can
move them. The `media-library` registry item shows the selected asset's
preview and details in a side column from 1280 px and in a responsive
dialog below (a side drawer, a bottom drawer with swipe on phones),
opens the preview with Space, and marks the selection like a file manager.
