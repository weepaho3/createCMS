---
'@createcms/react': minor
---

Item actions and a trash view for the media library. `MediaMessages` gains
`action.more`, `action.preview`, `action.details`, `action.rename`,
`folder.trash` and `folder.trashHint`. The `media-library` registry item
gives every tile a `⋯` menu and the same menu on right click (preview,
details, rename, download, move, archive), acting on the whole selection
when the tile is part of it, and adds a trash under the folder tree that
lists archived assets of every folder with restore and delete permanently.
