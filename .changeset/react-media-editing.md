---
'@createcms/react': minor
---

Media library editing modules: `Preview.*` (modal preview with zoom, pan,
rotation, stepping, swipe gestures and neighbour preloading), `Detail.*`
(file name, description, rights and origin with optimistic concurrency and a
conflict choice, facts, versions), `FocalPoint.*` and `Crop.*` (focal point
and per-use crop with presets), `ImageField.*` (alt text, decorative switch,
caption and accepted-only alt suggestions per use), `Picker.*` with
`openMediaPicker` and `MediaPickerHost` (constraints lock assets with a
reason), `Upload.*` (retry, cancel, pause, duplicate decision per entry,
`useUploadsPending`), `Download.*` with archive downloads streamed into a
ZIP in the browser, `Intake.Camera`, and long press to select on touch. The
React-free logic (preview, detail, image edit, image field, picker,
downloads, ZIP writer, touch) is in `@createcms/react/media/core`.

BREAKING CHANGE: `Media.UploadList`, `Media.UploadItem`,
`Media.UploadProgress`, `Media.UploadAbort` and `Media.UploadClear` are
`Upload.List`, `Upload.Item`, `Upload.Progress`, `Upload.Cancel` and
`Upload.Clear`.
