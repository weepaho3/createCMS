import type {
  CMSClientOptions,
  CMSClientPlugin,
  CMSVanillaClientInstance,
} from './types';

import { buildClient } from './build';
import { getClientConfigSync, runPluginInit } from './config';

/**
 * Creates a type-safe vanilla CMS client with plugin support.
 *
 * Plugin `init` functions run asynchronously in the background on creation
 * for side effects only. The client is built synchronously and is usable
 * immediately: the config is ready before init completes, so calls do not
 * block on it.
 *
 * The media upload queue is exposed as a raw nanostores atom at
 * `client.media.uploadState` (`upload`, `replace`, `abort`, `retry`,
 * `pause`, `resume` are on its value). For React components, use `createCMSClient` from
 * `@createcms/core/react` instead.
 *
 * ```ts
 * const client = createCMSClient<typeof cms>({
 *   baseURL: '/api/cms',
 *   plugins: [mediaOptimizeClient()],
 * });
 *
 * const roots = await client.pages.listRoots();
 * client.media.uploadState.subscribe(state => console.log(state.files));
 * ```
 */
// TPlugins is inferred from `options.plugins` and defaults to `[]` (not
// `CMSClientPlugin[]`): a wide default would intersect a
// `Record<string,unknown>` index signature into the client via
// InferPluginActions, making `client.anyTypo` type-check.
export function createCMSClient<
  TCMS = unknown,
  const TPlugins extends CMSClientPlugin[] = [],
>(
  options: CMSClientOptions & { plugins?: TPlugins },
): CMSVanillaClientInstance<TCMS, TPlugins>;

export function createCMSClient<TCMS = unknown>(): <
  const TPlugins extends CMSClientPlugin[] = [],
>(
  options: CMSClientOptions & { plugins?: TPlugins },
) => CMSVanillaClientInstance<TCMS, TPlugins>;

export function createCMSClient<TCMS = unknown>(
  options?: CMSClientOptions & { plugins?: CMSClientPlugin[] },
) {
  if (options) {
    return createVanillaClient<TCMS, CMSClientPlugin[]>(options);
  }
  return <const TPlugins extends CMSClientPlugin[] = []>(
    opts: CMSClientOptions & { plugins?: TPlugins },
  ) => createVanillaClient<TCMS, TPlugins>(opts);
}

function createVanillaClient<TCMS, TPlugins extends CMSClientPlugin[]>(
  options: CMSClientOptions & { plugins?: TPlugins },
): CMSVanillaClientInstance<TCMS, TPlugins> {
  // Built synchronously like the React client so direct members such as
  // `client.media.uploadState` are real atoms immediately, which is what
  // makes subscribe-at-startup work.
  const config = getClientConfigSync(options);
  runPluginInit(options, config).catch((err) =>
    console.error('[cms] plugin init failed:', err),
  );
  return buildClient<CMSVanillaClientInstance<TCMS, TPlugins>>(config, {
    uploadState: config.pluginsAtoms.uploadAssets,
  });
}
