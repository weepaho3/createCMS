# Media Optimize Plugin

Client-side image optimization for `@createcms/core`. Resizes, compresses, and converts images to WebP **before** uploading — reducing bandwidth and storage costs without any server-side processing.

> ⚠️ **Work in progress — not production-ready.** Part of [createCMS](https://github.com/weepaho3/createCMS), which is pre-1.0 and has **not been tested in production**. APIs may change.

## Installation

Included in `@createcms/core`, available from the `@createcms/core/plugins/media-optimize` export. No additional packages are required unless you need WebP support in browsers that lack native encoding (e.g. older Safari):

```bash
# Optional: WebP fallback for browsers without native encoding
npm install @jsquash/webp
```

## Usage

The plugin adds an `optimize` namespace to the client. You optimize files explicitly, then hand the results to the standard upload pipeline:

```tsx
import { createCMSClient } from '@createcms/core/react';
import { mediaOptimizeClient } from '@createcms/core/plugins/media-optimize';

const client = createCMSClient<typeof cms>({
  baseURL: '/api/cms',
  plugins: [
    mediaOptimizeClient({
      compress: { quality: 90 },
      resize: { maxSize: 2000 },
      convert: { format: 'webp', storeOriginal: true },
    }),
  ],
});

function Uploader({ file }: { file: File }) {
  // Optimize on the client (default config comes from the plugin;
  // pass a second arg to override per-call).
  const { results, isOptimizing } = client.optimize.useOptimize(file);

  const upload = client.media.useUploadAssets();
  // ...pass the optimized files to upload.upload(...)
}
```

For a one-off, framework-agnostic optimization without the hook, use the standalone `optimizeImage(file, config)`.

## Configuration

All options are optional. Omit a section to disable that optimization step.

### `compress`

| Option    | Type     | Default | Description              |
| --------- | -------- | ------- | ------------------------ |
| `quality` | `number` | `80`    | JPEG/PNG quality, 1-100. |

### `resize`

| Option    | Type     | Default | Description                                                   |
| --------- | -------- | ------- | ------------------------------------------------------------- |
| `maxSize` | `number` | `2000`  | Maximum width or height in pixels. Aspect ratio is preserved. |

### `convert`

| Option          | Type      | Default | Description                                                                                                                                    |
| --------------- | --------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `format`        | `'webp'`  | --      | Target format. Only `'webp'` is currently supported.                                                                                           |
| `storeOriginal` | `boolean` | `false` | When `true`, also produces a copy in the original format (resized + compressed but not converted). Useful for clients that don't support WebP. |

## Plugin lifecycle

This plugin uses the CMS **client** plugin system (`CMSClientPlugin`):

| Hook            | Purpose                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------ |
| `init`          | Stores the optimization config in the shared client context as `media-optimize:config`.    |
| `getActions`    | Exposes the `optimize.useOptimize(input, overrideConfig?)` action under `client.optimize`. |
| `atomListeners` | Listens for `createSignedUpload` calls and triggers `$mediaSignal` for cache invalidation. |

Optimization runs entirely in the browser and is best-effort: on failure (WebP
encoding unavailable, no canvas 2D context, etc.) it throws a plain `Error` that
`optimize.useOptimize` surfaces as a string in `state.error` — the original file
is uploaded unoptimized. There are no plugin error codes.

## How it works

When you call `optimize.useOptimize(files)` (or `optimizeImage(file, config)`), each image file is:

1. Loaded into an `HTMLCanvasElement`.
2. Resized if either dimension exceeds `maxSize` (aspect ratio preserved).
3. Encoded at the configured `quality`.
4. Encoded as WebP if `convert.format` is set (native `canvas.toBlob` or `@jsquash/webp` fallback).
5. Optionally duplicated in the original format if `storeOriginal` is enabled.

The optimized files are returned to you; you then pass them to `client.media.useUploadAssets().upload(...)`. Non-image files (PDFs, videos, etc.) pass through unchanged.

## Exports

Available from `@createcms/core/plugins/media-optimize`:

| Export                | Type       | Description                                      |
| --------------------- | ---------- | ------------------------------------------------ |
| `mediaOptimizeClient` | `function` | Plugin factory — pass your `OptimizationConfig`. |
| `optimizeImage`       | `function` | Standalone function to optimize a single `File`. |
| `useOptimize`         | `function` | React hook used by the `optimize` action.        |
| `OptimizeResult`      | `type`     | Return type of `optimizeImage`.                  |
| `OptimizeState`       | `type`     | State returned by `useOptimize`.                 |

## Browser support

- **WebP encoding**: native `canvas.toBlob('image/webp')` where available (Chrome, Edge, Firefox); falls back to `@jsquash/webp` (WASM) if installed; throws a descriptive error if neither is available.
- **Canvas API**: requires `document.createElement('canvas')` — works in all modern browsers.
