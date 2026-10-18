---
'@createcms/core': patch
'@createcms/react': patch
---

Opt-in JPEG XL renditions. The media optimize plugin encodes JPEG XL
renditions next to WebP with `jxl: { enabled: true }` and a `codecs.jxl`
loader (`@jsquash/jxl/encode`), up to `jxl.maxWidth` (1920) at quality 80.
The server accepts `jxl` variant keys, sniffs JPEG XL (bare codestream and
container) and reads its size from the SizeHeader to check renditions; the
asset endpoint takes `format=jxl`. `Media.Picture` and `getAssetImage` offer
a JPEG XL `<source>` before AVIF and WebP where one exists; WebP stays the
fallback.
