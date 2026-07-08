import type { WritableAtom } from 'nanostores';

import { atom } from 'nanostores';

import type {
  CMSClientPlugin,
  CMSClientStore,
  CMSFetch,
} from '../../client/types';
import type { OptimizationConfig } from '../../core/types/s3';

import { optimizeImage } from './optimize';
import { useOptimize } from './use-optimize';

export type { OptimizeResult } from './optimize';
export { optimizeImage } from './optimize';
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

/**
 * Shared-store key under which the plugin publishes its auto-optimizer so the
 * React `useUploadAssets` upload path can pick it up and optimize by default.
 * The React client (`client/react.ts`) reads this exact key — keep the two in
 * sync. Absent key ⇒ plugin not installed ⇒ uploads are untouched.
 */
export const UPLOAD_OPTIMIZER_KEY = `${PLUGIN_ID}:uploadOptimizer` as const;

/**
 * Descriptor published on the shared client store. `optimize` runs the
 * configured client-side pipeline over a batch and returns the files to
 * actually upload (primary optimized variants).
 */
export type UploadOptimizer = {
  enabled: boolean;
  optimize: (files: File[]) => Promise<File[]>;
};

/**
 * Client plugin that adds image optimization under its own namespace.
 *
 * Exposes `cmsClient.optimize.useOptimize(file, config)` for client-side
 * image optimization. Optimized files can then be passed to
 * `cmsClient.media.useUploadAssets().upload(files)`.
 *
 * ```ts
 * import { mediaOptimizeClient } from '@createcms/core/plugins/media-optimize';
 *
 * const client = createCMSClient<typeof cms>({
 *   baseURL: '/api/cms',
 *   plugins: [
 *     mediaOptimizeClient({
 *       compress: { quality: 90 },
 *       resize: { maxSize: 2000 },
 *       convert: { format: 'webp', storeOriginal: true },
 *     }),
 *   ],
 * });
 *
 * // In a component:
 * const { results, isOptimizing } = client.optimize.useOptimize(file, config);
 * ```
 */
export function mediaOptimizeClient(config: MediaOptimizeClientConfig) {
  const enabled = config.enabled !== false;

  return {
    id: PLUGIN_ID,

    // `getActions` runs synchronously while the client config is built, and
    // receives the SAME store object that `client/react.ts` reads as
    // `config.pluginsAtoms`. Publishing the auto-optimizer here (rather than in
    // the async `init`, whose returned `context` is discarded — see
    // client/config.ts) makes it available before the first `upload(...)`.
    getActions: (_$fetch: CMSFetch, $store: CMSClientStore) => {
      $store.atoms[UPLOAD_OPTIMIZER_KEY] = atom<UploadOptimizer>({
        enabled,
        optimize: async (files) => {
          const results = await Promise.all(
            files.map((file) => optimizeImage(file, config)),
          );
          return results.map((r) => r.file);
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
