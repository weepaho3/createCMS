import type { ClientConfig } from './config';
import type { CMSClientInstance, CMSClientPlugin } from './types';

import { createDynamicPathProxy } from './proxy';

/**
 * Shared client assembly for both the vanilla and React entrypoints. The only
 * thing that differs between them is how `media.useUploadAssets` is exposed:
 *  - vanilla passes the raw `uploadAssets` nanostores atom (consumers call
 *    `.get()` / `.subscribe()` themselves);
 *  - React passes a `() => useStore(uploadAssets)` hook thunk.
 *
 * That value is constructed by the caller and handed in as `unknown` so this
 * module never imports React — keeping it out of the vanilla bundle. The
 * `as CMSClientInstance` cast (present in both original builders) is the single
 * intentional escape hatch that normalizes the loosely-typed routes object to
 * the inferred public client type (`WithMedia` mandates
 * `useUploadAssets: () => MediaUploadState`).
 */
export function buildClient<TCMS, TPlugins extends CMSClientPlugin[]>(
  config: ClientConfig,
  useUploadAssets: unknown,
): CMSClientInstance<TCMS, TPlugins> {
  const {
    $fetch,
    $store,
    pluginsActions,
    pluginsAtoms,
    pluginPathMethods,
    atomListeners,
    $ERROR_CODES,
  } = config;

  return createDynamicPathProxy(
    {
      media: { useUploadAssets },
      ...pluginsActions,
      $fetch,
      $store,
      $ERROR_CODES,
    },
    $fetch,
    pluginPathMethods,
    pluginsAtoms,
    atomListeners,
  ) as CMSClientInstance<TCMS, TPlugins>;
}
