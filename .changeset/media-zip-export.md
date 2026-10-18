---
'@createcms/core': minor
'@createcms/react': minor
---

Server-written ZIP archives for large downloads. `createZipExport({ assetIds
| allMatching, name, flatten, manifest })` writes a STORE archive of up to
10,000 assets to `exports/<id>/` in 8 MiB parts, with the same names,
folder structure and `manifest.csv` as a browser download. Each stored
part is a checkpoint: `media.runExport` runs the export in the background
and the pruning pass continues any export a platform stopped early, then
deletes archives 24 hours after they finished. `getZipExport` reports the
progress and signs the download once the archive is ready,
`listZipExports` and `deleteZipExport` list and cancel; realtime gets
`media.export.ready` and `media.export.failed`. Three unfinished exports
per actor; the new error code `EXPORT_NOT_FOUND`. The React download queue
uses the server export from 500 files on, on iOS, and when the browser can
neither stream to a file nor hold the archive in memory.
