---
'@createcms/core': patch
---

Image transform services for missing renditions. `media.transform` takes a
`TransformAdapter`; on a rendition miss the asset endpoint redirects a
public raster image to the adapter's signed URL (`x-cms-rendition:
transform`), only at allowlisted widths, formats and qualities and with the
format in the URL. The adapter's widths join `renditionWidths`.
`imgproxyTransform({ baseUrl, key, salt })` builds signed imgproxy URLs,
with focal-point crops for cover fits.
