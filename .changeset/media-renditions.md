---
'@createcms/core': minor
---

Renditions: `createSignedRendition` and `commitRendition` upload a variant
by its `variantKey`, checking its format and width (`RENDITION_MISMATCH`)
and returning an existing one instead of a duplicate. The asset endpoint
snaps `?w=` to `renditionWidths`, serves the exact or next larger
rendition, says which in `x-cms-rendition`, calls `onRenditionMiss` when it
falls back to the original, and answers `RENDITION_NOT_FOUND` with
`strict=true`. `completeUpload` stores width, height and provenance (IPTC
`DigitalSourceType`, C2PA) read from the uploaded bytes and accepts
descriptive `hints`. `onPurge` also runs after a replace, an archive and a
new rendition. `placeholderDataUrl` renders a ThumbHash for SSR.
