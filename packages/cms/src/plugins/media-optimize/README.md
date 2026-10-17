# Media Optimize Plugin

Client-side image optimization for `@createcms/core`. Resizes, compresses and converts images to WebP in the browser before they are uploaded. Optimization never blocks an upload: a file that cannot be optimized is uploaded unchanged.

> ⚠️ **Work in progress, not production-ready.** Part of [createCMS](https://github.com/weepaho3/createCMS), which is pre-1.0 and has **not been tested in production**. APIs may change.

## Installation

Included in `@createcms/core`, available from the `@createcms/core/plugins/media-optimize` export. Safari cannot encode WebP from a canvas; to convert there, install the WASM encoder and pass a loader (see `webpEncoder` below):

```bash
npm install @jsquash/webp
```

## Usage

With the plugin installed, `client.media.useUploadAssets().upload(files)` optimizes every image before signing. Opt out per call with `upload(files, { optimize: false })`.

```tsx
import { createCMSClient } from '@createcms/core/react';
import { mediaOptimizeClient } from '@createcms/core/plugins/media-optimize';

const client = createCMSClient<typeof cms>()({
  baseURL: '/api/cms',
  plugins: [
    mediaOptimizeClient({
      compress: { quality: 82 },
      resize: { maxSize: 2000 },
      convert: { format: 'webp' },
      webpEncoder: () => import('@jsquash/webp/encode'),
    }),
  ],
});
```

Each upload ledger entry carries the outcome in `entry.optimize` (`optimized`, `bytesBefore`, `bytesAfter`, `warnings`). Outside production, warnings are also logged with `console.warn`.

To optimize without uploading, use `client.optimize.useOptimize(file, overrideConfig?)` in React, or the standalone `optimizeImage(file, config)` / `optimizeFiles(files, config)`.

## Configuration

All options are optional. Without `resize`, `compress` and `convert` the plugin changes nothing.

| Option                  | Type                               | Default | Description                                                                                                                             |
| ----------------------- | ---------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`               | `boolean`                          | `true`  | `false` registers no auto-optimizer; `upload(...)` then sends the original bytes.                                                       |
| `compress.quality`      | `number`                           | `82`    | JPEG/WebP encode quality, 1-100. Also used when only `resize` or `convert` is set. PNG ignores it.                                      |
| `resize.maxSize`        | `number`                           | none    | Downscale so neither side exceeds this many pixels. Without it, images keep their dimensions.                                           |
| `convert.format`        | `'webp'`                           | none    | Encode the output as WebP.                                                                                                              |
| `convert.storeOriginal` | `boolean`                          | `false` | `optimizeImage` also returns `originalVariant`, a resized copy in the input format. The auto-upload path uploads only the primary file. |
| `keepIfSmallerRatio`    | `number`                           | `0.9`   | Without a downscale, the re-encoded file is used only if it is at most this fraction of the input size.                                 |
| `webpEncoder`           | `() => Promise<WebpEncoderModule>` | none    | WebP encoder for browsers without native canvas WebP encoding. Loaded only after the native probe fails.                                |

## What gets optimized

Only `image/jpeg`, `image/png` and `image/webp` are re-encoded. These are uploaded byte-identical:

- Non-image files.
- SVG, GIF, ICO, BMP, AVIF, TIFF, HEIC/HEIF and any other image type.
- Animated WebP (`VP8X` animation flag or `ANIM` chunk) and APNG (`acTL` chunk).
- Files whose first 256 KB contain an IPTC `DigitalSourceType` XMP property or a C2PA manifest (JUMBF box labelled `c2pa`). A canvas re-encode drops all metadata, including these provenance markers.

Files are processed one at a time, so only one decoded bitmap is held in memory.

## Warnings

`optimizeImage` never rejects. When a file is uploaded unchanged for a reason other than "not an image" or "not smaller", its result carries a `warning`:

| Code                          | Meaning                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------- |
| `optimize_unsupported`        | Excluded format, animated image, or WebP output in a browser without an encoder.      |
| `optimize_skipped_provenance` | The file carries IPTC `DigitalSourceType` or a C2PA manifest.                         |
| `optimize_mislabel`           | The encoder produced another type than requested (canvas falls back to PNG silently). |
| `optimize_failed`             | Decoding, importing the fallback encoder, loading its WASM binary or encoding threw.  |

## How it works

1. Check the type, provenance markers and animation chunks; skip if any rule applies.
2. Decode into an `HTMLCanvasElement`, downscaled to `resize.maxSize` if set.
3. Encode to WebP (`convert`) or the input type at `compress.quality`. WebP uses native `canvas.toBlob` where supported, otherwise `webpEncoder`.
4. Verify the encoded blob has the requested type.
5. Keep the result only if the image was downscaled or the result is at most `keepIfSmallerRatio` of the input.
6. Name and type the output after the encoded format (`photo.jpg` becomes `photo.webp`).

## Plugin lifecycle

| Hook            | Purpose                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------- |
| `getActions`    | Publishes the auto-optimizer on the client store and exposes `client.optimize.useOptimize`. |
| `atomListeners` | Listens for `createSignedUpload` calls and triggers `$mediaSignal` for cache invalidation.  |

## Exports

Available from `@createcms/core/plugins/media-optimize`:

| Export                | Type       | Description                                                     |
| --------------------- | ---------- | --------------------------------------------------------------- |
| `mediaOptimizeClient` | `function` | Plugin factory.                                                 |
| `optimizeImage`       | `function` | Optimizes one `File`; never rejects.                            |
| `optimizeFiles`       | `function` | Optimizes files sequentially; one result per input.             |
| `optimizeForUpload`   | `function` | `optimizeFiles` plus the ledger annotation, as used by uploads. |
| `useOptimize`         | `function` | React hook behind `client.optimize.useOptimize`.                |
| `OptimizeResult`      | `type`     | Return type of `optimizeImage`.                                 |
| `OptimizeWarning`     | `type`     | `{ code, file, message }`.                                      |
| `OptimizeState`       | `type`     | State returned by `useOptimize`.                                |
