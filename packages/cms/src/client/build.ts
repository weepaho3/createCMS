import type { ClientConfig } from './config';

import { createDynamicPathProxy } from './proxy';

/**
 * Shared client assembly for the vanilla and React entrypoints. The caller
 * supplies the `media` namespace (vanilla: `{ uploadState: <raw atom> }`,
 * React: `{ useUploadAssets: () => useStore(...) }`), so this module never
 * imports React and stays out of the vanilla bundle.
 *
 * The `as TInstance` cast normalizes the loosely-typed routes object to the
 * concrete instance type supplied by the caller (`CMSClientInstance` for
 * React, `CMSVanillaClientInstance` for vanilla).
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
