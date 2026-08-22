import type { ReadableAtom } from 'nanostores';

import type {
  CMSClientOptions,
  CMSClientPlugin,
  CMSVanillaClientInstance,
} from './types';

import { buildClient } from './build';
import { getClientConfigSync, runPluginInit } from './config';
import {
  type CMSMediaReplaceState,
  createMediaReplaceAtom,
} from './media-upload';

// Adds the browser-callable replace-asset atom to the client's `media`
// namespace, mirroring `WithMediaAtom<T>` in types.ts.
type WithReplaceState<T> = T extends { media: infer M }
  ? Omit<T, 'media'> & {
      media: M & { replaceState: ReadableAtom<CMSMediaReplaceState> };
    }
  : T & { media: { replaceState: ReadableAtom<CMSMediaReplaceState> } };

/**
 * Creates a type-safe vanilla CMS client with plugin support.
 *
 * Plugin `init` functions run asynchronously in the background on creation
 * for side effects only. The client is built synchronously and is usable
 * immediately: the config is ready before init completes, so calls do not
 * block on it.
 *
 * Media upload state is exposed as a raw nanostores atom at
 * `client.media.uploadState`. For React components, use `createCMSClient` from
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
): WithReplaceState<CMSVanillaClientInstance<TCMS, TPlugins>>;

export function createCMSClient<TCMS = unknown>(): <
  const TPlugins extends CMSClientPlugin[] = [],
>(
  options: CMSClientOptions & { plugins?: TPlugins },
) => WithReplaceState<CMSVanillaClientInstance<TCMS, TPlugins>>;

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
): WithReplaceState<CMSVanillaClientInstance<TCMS, TPlugins>> {
  // Built synchronously like the React client so direct members such as
  // `client.media.uploadState` are real atoms immediately, which is what
  // makes subscribe-at-startup work.
  const config = getClientConfigSync(options);
  runPluginInit(options, config).catch((err) =>
    console.error('[cms] plugin init failed:', err),
  );
  const replaceAtom = createMediaReplaceAtom(config.$fetch);
  return buildClient<
    WithReplaceState<CMSVanillaClientInstance<TCMS, TPlugins>>
  >(config, {
    uploadState: config.pluginsAtoms.uploadAssets,
    replaceState: replaceAtom,
  });
}
