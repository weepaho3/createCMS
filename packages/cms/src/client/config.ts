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
import { CMS_ERRORS } from './errors-data.generated';
import { createMediaUploadAtom } from './media-upload';
import { createStore } from './store';

export interface ClientConfig {
  $fetch: CMSFetch;
  $store: CMSClientStore;
  pluginsActions: Record<string, unknown>;
  pluginsAtoms: Record<string, WritableAtom<unknown>>;
  pathMethods: Record<string, string>;
  atomListeners: CMSAtomListener[];
  $ERROR_CODES: Record<string, { status: number; message: string }>;
}

/**
 * Builds the client config synchronously: atoms, actions, listeners and
 * error codes are available immediately, so React hooks work from the first
 * render. Plugin `init` (async) is not called here; use `runPluginInit`.
 */
export function getClientConfigSync(options: CMSClientOptions): ClientConfig {
  const plugins = options.plugins ?? [];

  const betterCallClient = createBetterCallClient({
    baseURL: options.baseURL,
  });

  const $fetch: CMSFetch = async (path, opts) => {
    let res: Awaited<ReturnType<typeof betterCallClient>>;
    try {
      res = await betterCallClient(path as any, opts as any);
    } catch (err) {
      // Transport failure (offline / DNS / CORS) rejects with a raw TypeError,
      // bypassing the `res.error` envelope. Wrap it so the documented
      // `err instanceof CMSClientError` idiom holds; `status: 0` marks a
      // request that never reached the server (err-14).
      if (err instanceof CMSClientError) throw err;
      throw new CMSClientError({
        status: 0,
        statusText: 'Network Error',
        code: 'NETWORK_ERROR',
        message: err instanceof Error ? err.message : 'Network request failed',
      });
    }
    if (res.error) throw new CMSClientError(res.error);
    return res.data;
  };

  const pluginsAtoms: Record<string, WritableAtom<unknown>> = {
    $mediaSignal: atom(false),
    uploadAssets: createMediaUploadAtom($fetch) as WritableAtom<unknown>,
  };
  // POST endpoints callable with no/optional body: the proxy's body-presence
  // heuristic would otherwise dispatch GET and 404. Endpoints with a required
  // body are inferred correctly, so collection routes need nothing here.
  // `options.pathMethods` (a server `cms.$pathMethods`) extends this for
  // collection + plugin endpoints; drift-guarded by the search suite.
  const pathMethods: Record<string, string> = {
    '/admin/reindexSearch': 'POST',
    '/admin/runPruning': 'POST',
    '/notifications/markNotificationsRead': 'POST',
    '/notifications/markNotificationsUnread': 'POST',
    ...options.pathMethods,
  };
  const atomListeners: CMSAtomListener[] = [
    { matcher: (path) => path.startsWith('/media/'), signal: '$mediaSignal' },
  ];

  const $store = createStore(pluginsAtoms);

  for (const plugin of plugins) {
    if (plugin.pathMethods) {
      Object.assign(pathMethods, plugin.pathMethods);
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

  const $ERROR_CODES: Record<string, { status: number; message: string }> = {
    ...CMS_ERRORS,
  };
  for (const plugin of plugins) {
    if (!plugin.$ERROR_CODES) continue;
    for (const key of Object.keys(plugin.$ERROR_CODES)) {
      if (key in $ERROR_CODES) {
        // Warn instead of letting the last writer win silently (err-16).
        console.warn(
          `[cms] client plugin "${plugin.id}" error code "${key}" shadows an existing code`,
        );
      }
    }
    Object.assign($ERROR_CODES, plugin.$ERROR_CODES);
  }

  return {
    $fetch,
    $store,
    pluginsActions,
    pluginsAtoms,
    pathMethods,
    atomListeners,
    $ERROR_CODES,
  };
}

/**
 * Runs async plugin `init` functions sequentially, after
 * `getClientConfigSync`: the config is usable before init completes.
 */
export async function runPluginInit(
  options: CMSClientOptions,
  config: ClientConfig,
): Promise<void> {
  const plugins = options.plugins ?? [];
  for (const plugin of plugins) {
    // init runs for its side effects only: client plugins surface state via
    // getActions/atoms, which already close over their own config, so a
    // returned `context` is intentionally not collected.
    await plugin.init?.(config.$fetch, config.$store);
  }
}

/**
 * Async convenience wrapper building the config and running plugin init.
 * Used by the vanilla (non-React) client, where hooks aren't a concern.
 */
export async function getClientConfig(
  options: CMSClientOptions,
): Promise<ClientConfig> {
  const config = getClientConfigSync(options);
  await runPluginInit(options, config);
  return config;
}
