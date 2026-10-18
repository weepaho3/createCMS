# media-optimize

Client plugin that prepares files in the browser before upload: lossless GPS
removal, AI provenance read before any re-encode (and written back into
re-encodes as XMP), allowlisted EXIF facts, a ThumbHash placeholder, the
original policy (`keep`, `master`, `discard`) and WebP renditions at 320, 640,
1280 and 1920 px that the upload queue uploads as variants. PDFs, videos and
animated images get a poster, audio a waveform. Nothing here ever blocks an
upload: a failure leaves the original plus a warning.

```ts
import { mediaOptimizeClient } from '@createcms/core/plugins/media-optimize';

mediaOptimizeClient({
  worker: () =>
    new Worker(new URL('./optimize.worker.ts', import.meta.url), {
      type: 'module',
    }),
  codecs: { webp: () => import('@jsquash/webp/encode') },
});
```

```ts
// optimize.worker.ts
import { serveOptimizeWorker } from '@createcms/core/plugins/media-optimize/worker';

serveOptimizeWorker({ codecs: { webp: () => import('@jsquash/webp/encode') } });
```

Layout:

- `pipeline/process.ts`: the pipeline (`processFile`) against a `PipelineEnv`.
- `pipeline/codecs.ts`: the browser environment and the codec loaders.
- `pipeline/host.ts`: workers, concurrency, time budgets, crash recovery.
- `pipeline/policy.ts`, `budget.ts`, `detect.ts`, `exif.ts`: pure decisions.
- `pipeline/posters.ts`: PDF, video and audio descriptions (page context).
- `container/`: lossless byte edits of JPEG, PNG and WebP (GPS, XMP).
- `worker.ts`: `serveOptimizeWorker` for the host's worker module.

Tests: `test/*.test.ts` run in Node against a fake `PipelineEnv`;
`test/pipeline.engine.test.ts` runs the real codecs in Chromium, Firefox and
WebKit (`bun run test:engines` in `packages/cms`), including the jSquash
WebP path where the canvas cannot encode WebP.

Options and behaviour: https://createcms.dev/docs/plugins/media-optimize
