---
'@createcms/core': patch
---

`GET /media/asset/:id?download=true` now redirects to a signed object URL
(valid for one hour) with `response-content-disposition=attachment` bound into
the signature, so the browser downloads the file; the `Content-Disposition`
header previously set on the `302` was ignored. Types outside raster images
(PNG, JPEG, GIF, WebP, AVIF), video, audio and PDF are always served through
that signed download redirect, so an allowed SVG or HTML asset never renders
inline from the gate. New `signGetObject` in the S3 utils.
