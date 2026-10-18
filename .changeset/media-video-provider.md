---
'@createcms/core': patch
'@createcms/react': patch
---

Streaming providers for long videos. `media.video` takes a
`VideoProviderAdapter` with thresholds (`minDurationMs`, default 60 s;
`minBytes` when the duration is unknown). The pruning pass hands public,
ready video originals above them to the provider, polls it until the
stream is ready and keeps only its ids and URLs in `metadata.stream`,
which clients cannot write; replaced bytes are ingested again and purged or
reclaimed assets are deleted at the provider. `muxVideo({ tokenId,
tokenSecret })` implements Mux with public playback. `Media.Video` plays
the provider's HLS stream (with `attachHls` for hls.js) and falls back to
the file.
