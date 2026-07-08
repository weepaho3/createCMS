import type {
  CMSClientPlugin,
  CMSClientStore,
  CMSFetch,
} from '../../client/types';
import type { OptimizationConfig } from '../../core/types/s3';

import { useOptimize } from './use-optimize';

export type { OptimizeResult } from './optimize';
export { optimizeImage } from './optimize';
export { useOptimize } from './use-optimize';
export type { OptimizeState } from './use-optimize';

const PLUGIN_ID = 'media-optimize' as const;

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
export function mediaOptimizeClient(config: OptimizationConfig) {
  return {
    id: PLUGIN_ID,

    async init(_$fetch: CMSFetch, _$store: CMSClientStore) {
      return {
        context: {
          [`${PLUGIN_ID}:config`]: config,
        },
      };
    },

    getActions: () => ({
      optimize: {
        useOptimize: (
          input: File | File[],
          overrideConfig?: OptimizationConfig,
        ) => useOptimize(input, overrideConfig ?? config),
      },
    }),

    atomListeners: [
      {
        matcher: (path: string) => path.startsWith('/media/createSignedUpload'),
        signal: '$mediaSignal' as const,
      },
    ],
  } satisfies CMSClientPlugin;
}
