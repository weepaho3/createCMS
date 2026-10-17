import type { WritableAtom } from 'nanostores';

import { atom } from 'nanostores';

import type {
  CMSClientPlugin,
  CMSClientStore,
  CMSFetch,
} from '../../client/types';
import type {
  OptimizedUpload,
  UploadOptimizer,
} from '../../client/upload-optimizer';
import type { CodecLoaders } from './pipeline/codecs';
import type { OptimizeHost } from './pipeline/host';
import type { OriginalPolicy } from './pipeline/policy';
import type { PdfModule } from './pipeline/posters';
import type { OptimizeOutput, OptimizeSettings } from './pipeline/process';

import { UPLOAD_OPTIMIZER_KEY } from '../../client/upload-optimizer';
import { detectIOS, workerConcurrency } from './pipeline/budget';
import { createOptimizeHost } from './pipeline/host';
import { DEFAULT_SETTINGS } from './pipeline/process';
import { useOptimize } from './use-optimize';

export type {
  CodecLoaders,
  EncoderModule,
  HeicDecoderModule,
  OptimizeSupport,
} from './pipeline/codecs';
export { detectOptimizeSupport } from './pipeline/codecs';
export type { OriginalPolicy } from './pipeline/policy';
export type { PdfModule } from './pipeline/posters';
export type {
  OptimizeOutput,
  OptimizeSettings,
  OptimizeWarning,
  OptimizeWarningCode,
  Rendition,
} from './pipeline/process';
export { useOptimize, useOptimizeSupport } from './use-optimize';
export type { OptimizeState } from './use-optimize';
export { UPLOAD_OPTIMIZER_KEY } from '../../client/upload-optimizer';
export type { UploadOptimizer } from '../../client/upload-optimizer';

const PLUGIN_ID = 'media-optimize' as const;

/**
 * Config of {@link mediaOptimizeClient}. Every field is optional; the
 * defaults keep the original (GPS removed), produce WebP renditions at 320,
 * 640, 1280 and 1920 px, a ThumbHash placeholder and the provenance hints.
 */
export type MediaOptimizeClientConfig = {
  /** `false` registers no auto-optimizer: uploads send the bytes untouched. @default true */
  enabled?: boolean;
  /** What becomes of the original: kept, replaced by a master, or replaced by the largest WebP. @default 'keep' */
  original?: OriginalPolicy;
  /** Above this, `keep` becomes `master`. @default 40 */
  maxOriginalMegapixels?: number;
  /** Above this many bytes, `keep` becomes `master`. @default 25 MiB */
  maxOriginalBytes?: number;
  /** Longest edge of a master. @default 4096 */
  masterLongEdge?: number;
  renditions?: {
    /** @default [320, 640, 1280, 1920] */
    widths?: number[];
    /** AVIF is added only with `avif.enabled`. @default ['webp'] */
    formats?: ('webp' | 'avif')[];
    /** Also a JPEG at 1280 px for clients without WebP. @default false */
    legacyJpeg?: boolean;
  };
  /** Per-format quality (1 to 100). @default { webp: 82, jpeg: 78, avif: 62, master: 90 } */
  quality?: Partial<OptimizeSettings['quality']>;
  avif?: { enabled?: boolean; speed?: number; maxWidth?: number };
  /** A re-encoded master that needed no downscale must be at most this fraction of the source. @default 0.9 */
  keepIfSmallerRatio?: number;
  /** Remove GPS from the uploaded bytes. @default true */
  stripGps?: boolean;
  /** Keep EXIF Artist and Copyright when removing GPS. @default true */
  keepCopyright?: boolean;
  /** @default 'thumbhash' */
  placeholder?: 'thumbhash' | false;
  /** Files optimized at once; `'auto'` is `min(2, cores / 2)`, 1 on iOS or with 4 GiB or less. @default 'auto' */
  concurrency?: number | 'auto';
  /** Time budget per megapixel on top of 3 s per file. @default 1500 */
  timeoutMsPerMegapixel?: number;
  /** Read IPTC and C2PA provenance, and write it back into re-encodes as XMP. */
  provenance?: { read?: boolean; writeBack?: boolean };
  /** WASM codec loaders (WebP for Safari, mozjpeg, AVIF, HEIC). */
  codecs?: CodecLoaders;
  /** pdf.js loader for PDF posters. */
  pdf?: () => Promise<PdfModule>;
  /** Creates an optimization worker (see `serveOptimizeWorker`); without it, optimization runs in the page. */
  worker?: () => Worker;
};

/** The pipeline settings for `config`, with every default filled in. */
export function resolveOptimizeSettings(
  config: MediaOptimizeClientConfig = {},
): OptimizeSettings {
  const avif = config.avif?.enabled === true;
  const formats = (config.renditions?.formats ?? ['webp']).filter(
    (f) => f !== 'avif' || avif,
  );
  if (avif && !formats.includes('avif')) formats.push('avif');
  return {
    ...DEFAULT_SETTINGS,
    original: config.original ?? DEFAULT_SETTINGS.original,
    maxOriginalMegapixels:
      config.maxOriginalMegapixels ?? DEFAULT_SETTINGS.maxOriginalMegapixels,
    maxOriginalBytes:
      config.maxOriginalBytes ?? DEFAULT_SETTINGS.maxOriginalBytes,
    masterLongEdge: config.masterLongEdge ?? DEFAULT_SETTINGS.masterLongEdge,
    renditionWidths:
      config.renditions?.widths ?? DEFAULT_SETTINGS.renditionWidths,
    renditionFormats: formats,
    avifMaxWidth: config.avif?.maxWidth ?? DEFAULT_SETTINGS.avifMaxWidth,
    legacyJpeg: config.renditions?.legacyJpeg ?? false,
    quality: { ...DEFAULT_SETTINGS.quality, ...config.quality },
    keepIfSmallerRatio:
      config.keepIfSmallerRatio ?? DEFAULT_SETTINGS.keepIfSmallerRatio,
    stripGps: config.stripGps ?? true,
    keepCopyright: config.keepCopyright ?? true,
    placeholder: config.placeholder !== false,
    provenance: {
      read: config.provenance?.read ?? true,
      writeBack: config.provenance?.writeBack ?? true,
    },
  };
}

function concurrencyFor(config: MediaOptimizeClientConfig): number {
  if (typeof config.concurrency === 'number') {
    return Math.max(1, config.concurrency);
  }
  const nav =
    typeof navigator === 'undefined'
      ? undefined
      : (navigator as Navigator & { deviceMemory?: number });
  return workerConcurrency({
    hardwareConcurrency: nav?.hardwareConcurrency,
    deviceMemory: nav?.deviceMemory,
    isIOS: detectIOS(nav),
  });
}

/** The upload-ready result of one pipeline run. */
function toUpload(output: OptimizeOutput): OptimizedUpload {
  return {
    file: output.file,
    renditions: output.renditions,
    hints: output.hints,
    info: {
      optimized: output.optimized,
      bytesBefore: output.bytesBefore,
      bytesAfter: output.bytesAfter,
      warnings: output.warnings,
    },
  };
}

/**
 * Optimizes one file for upload: the raster pipeline (in a worker when
 * `config.worker` is set), then posters and media facts for PDFs, videos and
 * audio in the page.
 */
export function createUploadProcessor(
  config: MediaOptimizeClientConfig = {},
  host?: OptimizeHost,
): (file: File) => Promise<OptimizedUpload> {
  const settings = resolveOptimizeSettings(config);
  const optimizeHost =
    host ??
    createOptimizeHost({
      createWorker: config.worker,
      codecs: config.codecs,
      concurrency: concurrencyFor(config),
      msPerMegapixel: config.timeoutMsPerMegapixel ?? 1500,
    });

  return async (file) => {
    const output = await optimizeHost.run(file, settings);
    const type = file.type;
    if (
      type === 'application/pdf' ||
      type.startsWith('video/') ||
      type.startsWith('audio/')
    ) {
      const [{ describeMedia }, { createBrowserEnv }] = await Promise.all([
        import('./pipeline/posters'),
        import('./pipeline/codecs'),
      ]);
      const media = await describeMedia(file, type, {
        env: createBrowserEnv(config.codecs),
        pdf: config.pdf,
        quality: settings.quality.webp,
      });
      if (media) {
        output.renditions.push(...media.renditions);
        output.warnings.push(...media.warnings);
        output.hints.metadata.media = {
          ...output.hints.metadata.media,
          ...media.media,
        };
        output.optimized ||= media.renditions.length > 0;
      }
    }
    return toUpload(output);
  };
}

/**
 * Client plugin that optimizes files before upload and adds the `optimize`
 * namespace.
 *
 * With the plugin installed, `cmsClient.media.useUploadAssets().upload(files)`
 * runs every file through the pipeline (opt out per call with
 * `{ optimize: false }`): the asset gets the original (GPS removed) and its
 * WebP renditions are uploaded as variants once the asset exists.
 *
 * ```ts
 * import { mediaOptimizeClient } from '@createcms/core/plugins/media-optimize';
 *
 * const client = createCMSClient<typeof cms>()({
 *   baseURL: '/api/cms',
 *   plugins: [
 *     mediaOptimizeClient({
 *       codecs: { webp: () => import('@jsquash/webp/encode') },
 *     }),
 *   ],
 * });
 * ```
 */
export function mediaOptimizeClient(config: MediaOptimizeClientConfig = {}) {
  const enabled = config.enabled !== false;
  let processor: ((file: File) => Promise<OptimizedUpload>) | undefined;

  return {
    id: PLUGIN_ID,

    // `getActions` runs synchronously while the client config is built and
    // receives the same store object that `client/config.ts` reads as
    // `pluginsAtoms`. Publishing the auto-optimizer here (rather than in the
    // async `init`, whose returned `context` is discarded) makes it available
    // before the first `upload(...)`.
    getActions: (_$fetch: CMSFetch, $store: CMSClientStore) => {
      $store.atoms[UPLOAD_OPTIMIZER_KEY] = atom<UploadOptimizer>({
        enabled,
        process: (file) => {
          processor ??= createUploadProcessor(config);
          return processor(file);
        },
      }) as WritableAtom<unknown>;

      return {
        optimize: {
          useOptimize: (
            input: File | File[],
            overrideConfig?: MediaOptimizeClientConfig,
          ) => useOptimize(input, overrideConfig ?? config),
        },
      };
    },

    atomListeners: [
      {
        matcher: (path: string) => path.startsWith('/media/createSignedUpload'),
        signal: '$mediaSignal' as const,
      },
    ],
  } satisfies CMSClientPlugin;
}
