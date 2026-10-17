---
'@createcms/core': minor
---

Folders keep `path` and `depth`, so moving a subtree is one update and
`getFolderPath` returns the breadcrumbs of a folder opened by id.
`renameFolder` is new; names are unique among live siblings, root folders
included (`FOLDER_NAME_TAKEN`). `listFolders` reports `assetCount` and
`assetCountRecursive`. `deleteFolder` moves folders to the trash and takes
`mode` (`empty-only`, `move-to-parent`, `archive-contents`) and `dryRun`;
folder rows are never deleted by cascade.
