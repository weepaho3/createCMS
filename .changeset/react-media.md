---
'@createcms/react': patch
---

New `@createcms/react/media` entry: a headless media library primitive.
`Media.Root` owns a store over `cmsClient.media` (folders, paged assets,
search, sort, selection, bulk mutations); `Media.Grid`, `Media.Item`,
`Media.Thumbnail`, `Media.Breadcrumbs`, `Media.Crumb`, `Media.FolderList`,
`Media.Folder`, `Media.Search`, `Media.LoadMore`, `Media.Empty`,
`Media.Error` and `Media.MutationError` render unstyled elements with
`data-*` state; `Media.Dropzone` and the `Media.Upload*` parts wrap the
client's upload ledger with accessible progress and announcements. Hooks:
`useMediaLibrary`, `useMediaSelection`, `useMediaUploads`, `useMediaAsset`.
