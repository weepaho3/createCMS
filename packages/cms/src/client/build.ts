import type { ClientConfig } from './config';

import { createDynamicPathProxy } from './proxy';

/**
 * Shared client assembly for both the vanilla and React entrypoints. The only
 * thing that differs between them is the shape of the injected `media`
 * namespace:
 *  - vanilla passes `{ uploadState: <raw nanostores atom> }` (consumers call
 *    `.get()` / `.subscribe()` themselves);
 *  - React passes `{ useUploadAssets: () => useStore(uploadAssets) }` (a hook
 *    thunk).
 *
 * The `media` object is constructed by the caller so this module never imports
 * React — keeping it out of the vanilla bundle. The caller also supplies the
 * concrete instance type via `TInstance` (`CMSClientInstance` for React,
 * `CMSVanillaClientInstance` for vanilla); the `as TInstance` cast is the
 * single intentional escape hatch that normalizes the loosely-typed routes
 * object to the inferred public client type.
 */
export function buildClient<TInstance>(
  config: ClientConfig,
  media: Record<string, unknown>,
): TInstance {
  const {
    $fetch,
    $store,
    pluginsActions,
    pluginsAtoms,
    pathMethods,
    atomListeners,
    $ERROR_CODES,
  } = config;

  return createDynamicPathProxy(
    {
      media,
      ...pluginsActions,
      $fetch,
      $store,
      $ERROR_CODES,
    },
    $fetch,
    pathMethods,
    pluginsAtoms,
    atomListeners,
  ) as TInstance;
}
