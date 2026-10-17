---
'@createcms/core': minor
---

The media optimizer never blocks an upload. `optimizeImage` resolves with the
untouched file and a `warning` (`optimize_unsupported`,
`optimize_skipped_provenance`, `optimize_mislabel`, `optimize_failed`)
instead of rejecting, files are optimized one at a time, and the upload path
falls back to the originals if the optimizer fails. Only JPEG, PNG and WebP
are re-encoded; GIF, SVG, ICO, HEIC, AVIF, animated WebP/APNG and files with
IPTC `DigitalSourceType` or a C2PA manifest are uploaded byte-identical. An
encode that returns another type is discarded, output names follow the
encoded format, a result is kept only if it is at most `keepIfSmallerRatio`
(default 0.9) of the input or the image was downscaled, and the default
quality is 82. The Safari WebP fallback is configured with
`webpEncoder: () => import('@jsquash/webp/encode')`, so bundlers emit the WASM
file; `@jsquash/webp` is no longer a peer dependency. Results report
`bytesBefore` and `bytesAfter`, and upload ledger entries carry them in
`optimize` (replacing `optimized` and `originalVariantId`). `useOptimize`
drops `error`.
