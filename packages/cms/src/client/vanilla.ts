import type {
  CMSClientInstance,
  CMSClientOptions,
  CMSClientPlugin,
} from './types';

import { buildClient } from './build';
import { getClientConfig, type ClientConfig } from './config';

/**
 * Creates a type-safe vanilla CMS client with plugin support.
 *
 * Plugin `init` functions run asynchronously on creation. The returned
 * client is usable immediately — API calls will await init completion
 * transparently.
 *
 * Plugin atom hooks are exposed as raw nanostores atoms. For React components,
 * use `createCMSClient` from `@createcms/core/react` instead.
 *
 * Call it directly for a plugin-less client. **With plugins, use the curried
 * `()(...)` form** — the empty `()` is what infers each plugin's action types
 * (the direct call widens them to the generic `CMSClientPlugin[]`):
 *
 * ```ts
 * const client = createCMSClient<typeof cms>()({
 *   baseURL: '/api/cms',
 *   plugins: [mediaOptimizeClient()],
 * });
 *
 * const roots = await client.pages.listRoots();
 * ```
 */
export function createCMSClient<TCMS = unknown>(
  options: CMSClientOptions & { plugins?: CMSClientPlugin[] },
): CMSClientInstance<TCMS, CMSClientPlugin[]>;

export function createCMSClient<TCMS = unknown>(): <
  const TPlugins extends CMSClientPlugin[] = CMSClientPlugin[],
>(
  options: CMSClientOptions & { plugins?: TPlugins },
) => CMSClientInstance<TCMS, TPlugins>;

export function createCMSClient<TCMS = unknown>(
  options?: CMSClientOptions & { plugins?: CMSClientPlugin[] },
) {
  if (options) {
    return createVanillaClient<TCMS, CMSClientPlugin[]>(options);
  }
  return <const TPlugins extends CMSClientPlugin[] = CMSClientPlugin[]>(
    opts: CMSClientOptions & { plugins?: TPlugins },
  ) => createVanillaClient<TCMS, TPlugins>(opts);
}

function createVanillaClient<TCMS, TPlugins extends CMSClientPlugin[]>(
  options: CMSClientOptions & { plugins?: TPlugins },
): CMSClientInstance<TCMS, TPlugins> {
  let resolved: ClientConfig | null = null;
  const configPromise = getClientConfig(options).then((cfg) => {
    resolved = cfg;
    return cfg;
  });

  let realClient: CMSClientInstance<TCMS, TPlugins> | null = null;

  return new Proxy({} as CMSClientInstance<TCMS, TPlugins>, {
    get(_target, prop: string) {
      if (realClient) return (realClient as any)[prop];

      if (resolved) {
        realClient = buildClient<TCMS, TPlugins>(
          resolved,
          resolved.pluginsAtoms.uploadAssets,
        );
        return (realClient as any)[prop];
      }

      return new Proxy(
        {},
        {
          get(_t, method: string) {
            return async (...args: unknown[]) => {
              const cfg = await configPromise;
              if (!realClient)
                realClient = buildClient<TCMS, TPlugins>(
                  cfg,
                  cfg.pluginsAtoms.uploadAssets,
                );
              const ns = (realClient as any)[prop];
              if (typeof ns === 'function') return ns(...args);
              if (ns && typeof ns[method] === 'function')
                return ns[method](...args);
              return ns?.[method];
            };
          },
        },
      );
    },
  });
}
