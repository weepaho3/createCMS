import type { WritableAtom } from 'nanostores';

import { atom } from 'nanostores';

import type {
  CMSClientPlugin,
  CMSClientStore,
  CMSFetch,
} from '../../client/types';
import type { UploadOptimizer } from '../../client/upload-optimizer';
import type { OptimizationConfig } from '../../core/types/s3';

import { annotateUpload } from '../../client/upload-annotations';
import { UPLOAD_OPTIMIZER_KEY } from '../../client/upload-optimizer';
import { optimizeFiles } from './optimize';
import { useOptimize } from './use-optimize';

export type {
  OptimizeResult,
  OptimizeWarning,
  OptimizeWarningCode,
} from './optimize';
export { optimizeFiles, optimizeImage } from './optimize';
export { useOptimize } from './use-optimize';
export type { OptimizeState } from './use-optimize';

const PLUGIN_ID = 'media-optimize' as const;

/**
 * Config accepted by {@link mediaOptimizeClient}. Extends the raw
 * {@link OptimizationConfig} with an `enabled` switch: when `false`, the plugin
 * registers no auto-optimizer, so `useUploadAssets().upload(...)` uploads the
 * original bytes untouched (callers can still call `useOptimize`/`optimizeImage`
 * manually). Defaults to `true`.
 */
export type MediaOptimizeClientConfig = OptimizationConfig & {
  enabled?: boolean;
};

export { UPLOAD_OPTIMIZER_KEY } from '../../client/upload-optimizer';
export type { UploadOptimizer } from '../../client/upload-optimizer';

/**
 * Optimizes a batch for upload: one file per input, annotated with its
 * outcome (`entry.optimize` in the upload ledger). A file whose optimization
 * fails is passed through unchanged with a warning.
 */
export async function optimizeForUpload(
  files: File[],
  config: OptimizationConfig,
): Promise<File[]> {
  const results = await optimizeFiles(files, config);
  return results.map((result) => {
    annotateUpload(result.file, {
      optimized: result.optimized,
      bytesBefore: result.bytesBefore,
      bytesAfter: result.bytesAfter,
      warnings: result.warning
        ? [{ code: result.warning.code, message: result.warning.message }]
        : [],
    });
    return result.file;
  });
}

/**
 * Client plugin that optimizes images before upload and adds the
 * `optimize` namespace.
 *
 * With the plugin installed, `cmsClient.media.useUploadAssets().upload(files)`
 * optimizes each image first (opt out per call with `{ optimize: false }`).
 * `cmsClient.optimize.useOptimize(file, config)` runs the same pipeline
 * without uploading.
 *
 * ```ts
 * import { mediaOptimizeClient } from '@createcms/core/plugins/media-optimize';
 *
 * const client = createCMSClient<typeof cms>()({
 *   baseURL: '/api/cms',
 *   plugins: [
 *     mediaOptimizeClient({
 *       compress: { quality: 82 },
 *       resize: { maxSize: 2000 },
 *       convert: { format: 'webp' },
 *       webpEncoder: () => import('@jsquash/webp/encode'),
 *     }),
 *   ],
 * });
 * ```
 */
export function mediaOptimizeClient(config: MediaOptimizeClientConfig) {
  const enabled = config.enabled !== false;

  return {
    id: PLUGIN_ID,

    // `getActions` runs synchronously while the client config is built and
    // receives the same store object that `client/react.ts` reads as
    // `config.pluginsAtoms`. Publishing the auto-optimizer here (rather than
    // in the async `init`, whose returned `context` is discarded) makes it
    // available before the first `upload(...)`.
    getActions: (_$fetch: CMSFetch, $store: CMSClientStore) => {
      $store.atoms[UPLOAD_OPTIMIZER_KEY] = atom<UploadOptimizer>({
        enabled,
        optimize: (files) => optimizeForUpload(files, config),
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
