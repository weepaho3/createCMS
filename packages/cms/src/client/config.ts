import type { WritableAtom } from 'nanostores';

import { createClient as createBetterCallClient } from 'better-call/client';
import { atom } from 'nanostores';

import type {
  CMSAtomListener,
  CMSClientOptions,
  CMSClientStore,
  CMSFetch,
} from './types';

import { CMSClientError } from './error';
import { createMediaUploadAtom } from './media-upload';
import { createStore } from './store';

export interface ClientConfig {
  $fetch: CMSFetch;
  $store: CMSClientStore;
  pluginsActions: Record<string, unknown>;
  pluginsAtoms: Record<string, WritableAtom<unknown>>;
  pluginPathMethods: Record<string, string>;
  atomListeners: CMSAtomListener[];
  $ERROR_CODES: Record<string, { status: number; message: string }>;
}

/**
 * Builds the client config synchronously. Atoms, actions, listeners and
 * error codes are available immediately so React hooks work from the
 * first render. Plugin `init` (async) is NOT called here — use
 * `runPluginInit` afterwards.
 */
export function getClientConfigSync(options: CMSClientOptions): ClientConfig {
  const plugins = options.plugins ?? [];

  const betterCallClient = createBetterCallClient({
    baseURL: options.baseURL,
  });

  const $fetch: CMSFetch = async (path, opts) => {
    const res = await betterCallClient(path as any, opts as any);
    if (res.error) throw new CMSClientError(res.error);
    return res.data;
  };

  const pluginsAtoms: Record<string, WritableAtom<unknown>> = {
    $mediaSignal: atom(false),
    uploadAssets: createMediaUploadAtom($fetch) as WritableAtom<unknown>,
  };
  const pluginPathMethods: Record<string, string> = {};
  const atomListeners: CMSAtomListener[] = [
    { matcher: (path) => path.startsWith('/media/'), signal: '$mediaSignal' },
  ];

  const $store = createStore(pluginsAtoms);

  for (const plugin of plugins) {
    if (plugin.pathMethods) {
      Object.assign(pluginPathMethods, plugin.pathMethods);
    }
    if (plugin.atomListeners) {
      atomListeners.push(...plugin.atomListeners);
    }
  }

  let pluginsActions: Record<string, unknown> = {};
  for (const plugin of plugins) {
    if (plugin.getActions) {
      pluginsActions = {
        ...pluginsActions,
        ...plugin.getActions($fetch, $store, options.baseURL),
      };
    }
  }

  const $ERROR_CODES: Record<string, { status: number; message: string }> = {};
  for (const plugin of plugins) {
    if (plugin.$ERROR_CODES) {
      Object.assign($ERROR_CODES, plugin.$ERROR_CODES);
    }
  }

  return {
    $fetch,
    $store,
    pluginsActions,
    pluginsAtoms,
    pluginPathMethods,
    atomListeners,
    $ERROR_CODES,
  };
}

/**
 * Runs async plugin `init` functions sequentially. Call this after
 * `getClientConfigSync` — the config is already usable before init
 * completes, so React hooks work immediately.
 */
export async function runPluginInit(
  options: CMSClientOptions,
  config: ClientConfig,
): Promise<void> {
  const plugins = options.plugins ?? [];
  for (const plugin of plugins) {
    // init runs for its side effects. (Client plugins surface state via
    // getActions/atoms, which already close over their own config — there is
    // no shared client context to populate, so any returned `context` is
    // intentionally not collected.)
    await plugin.init?.(config.$fetch, config.$store);
  }
}

/**
 * Async convenience wrapper — builds config and runs plugin init.
 * Used by the vanilla (non-React) client where hooks aren't a concern.
 */
export async function getClientConfig(
  options: CMSClientOptions,
): Promise<ClientConfig> {
  const config = getClientConfigSync(options);
  await runPluginInit(options, config);
  return config;
}
