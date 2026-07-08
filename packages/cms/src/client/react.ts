import type { ReadableAtom } from 'nanostores';

import type {
  CMSClientInstance,
  CMSClientOptions,
  CMSClientPlugin,
} from './types';

import { buildClient } from './build';
import { getClientConfigSync, runPluginInit } from './config';
import { useStore } from './react-store';

/**
 * Creates a type-safe React CMS client with plugin support.
 *
 * Plugin `init` functions run asynchronously on creation. The returned
 * client is usable immediately — API calls will await init completion
 * transparently.
 *
 * Atom hooks are wrapped in `useStore()` so they work as React hooks:
 *
 * ```tsx
 * import { createCMSClient } from '@createcms/core/react';
 *
 * // Preferred: curried call preserves full plugin type inference
 * const client = createCMSClient<typeof cms>()({
 *   baseURL: '/api/cms',
 *   plugins: [mediaOptimizeClient()],
 * });
 *
 * // Also works: single call (plugin types inferred only when TCMS is omitted)
 * const client2 = createCMSClient({
 *   baseURL: '/api/cms',
 *   plugins: [mediaOptimizeClient()],
 * });
 *
 * function MyComponent() {
 *   const upload = client.media.useUploadAssets();
 * }
 * ```
 */
// TPlugins is INFERRED from `options.plugins`, default `[]` (not `CMSClientPlugin[]`)
// so a no-plugins client never gets a `Record<string,unknown>` action index
// signature (which would make `client.anyTypo` type-check). See vanilla.ts.
export function createCMSClient<
  TCMS = unknown,
  const TPlugins extends CMSClientPlugin[] = [],
>(
  options: CMSClientOptions & { plugins?: TPlugins },
): CMSClientInstance<TCMS, TPlugins>;

export function createCMSClient<TCMS = unknown>(): <
  const TPlugins extends CMSClientPlugin[] = [],
>(
  options: CMSClientOptions & { plugins?: TPlugins },
) => CMSClientInstance<TCMS, TPlugins>;

export function createCMSClient<TCMS = unknown>(
  options?: CMSClientOptions & { plugins?: CMSClientPlugin[] },
) {
  if (options) {
    const config = getClientConfigSync(options);
    runPluginInit(options, config);
    return buildClient<CMSClientInstance<TCMS, CMSClientPlugin[]>>(config, {
      useUploadAssets: () =>
        useStore(config.pluginsAtoms.uploadAssets as ReadableAtom),
    });
  }
  return <const TPlugins extends CMSClientPlugin[] = []>(
    opts: CMSClientOptions & { plugins?: TPlugins },
  ): CMSClientInstance<TCMS, TPlugins> => {
    const config = getClientConfigSync(opts);
    runPluginInit(opts, config);
    return buildClient<CMSClientInstance<TCMS, TPlugins>>(config, {
      useUploadAssets: () =>
        useStore(config.pluginsAtoms.uploadAssets as ReadableAtom),
    });
  };
}

export { useStore } from './react-store';
