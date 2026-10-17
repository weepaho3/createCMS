---
'@createcms/core': minor
---

The media-optimize plugin runs a rendition pipeline, in a worker
(`serveOptimizeWorker`) or in the page: magic-byte type detection, IPTC and
C2PA provenance read before any re-encode and written back as XMP, lossless
GPS removal that keeps XMP, ICC and C2PA byte-identical, allowlisted EXIF
facts, a ThumbHash placeholder and dominant colour, the original policy
(`keep`, `master`, `discard`), and WebP renditions at 320, 640, 1280 and
1920 px (AVIF and a legacy JPEG opt-in). Codecs (WebP for Safari, mozjpeg,
AVIF, HEIC) load lazily through `codecs`. PDFs, videos and animated images
get a poster, audio a waveform. The upload queue uploads the renditions as
child entries after the asset exists and offers `regenerateRenditions`.
