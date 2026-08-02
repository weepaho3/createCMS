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
// namespace, mirroring `WithMediaAtom<T>` in types.ts. Declared locally
// (rather than in the shared type-mapping utility) to keep Plan 007's client
// changes confined to media-upload.ts/react.ts/vanilla.ts.
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
 * immediately — the config is ready before init completes, so calls do not
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
// TPlugins is INFERRED from `options.plugins` and defaults to `[]` (not
// `CMSClientPlugin[]`): a wide default would intersect a `Record<string,unknown>`
// index signature into the client via InferPluginActions, making `client.anyTypo`
// type-check. `[]` gives an empty action set when no plugins are passed.
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
  // Build synchronously, exactly like the React client: `getClientConfigSync`
  // produces a fully-usable config — including the media upload atom — and
  // plugin `init` runs only for side effects (the config is usable before it
  // completes), so it need not block. This makes direct members like
  // `client.media.uploadState` available immediately; the previous async lazy
  // proxy left the atom unreachable (a function stub) until the first awaited
  // call resolved, defeating subscribe-at-startup.
  const config = getClientConfigSync(options);
  runPluginInit(options, config).catch((err) =>
    console.error('[cms] plugin init failed:', err),
  );
  // The replace atom (Plan 007 part A) is created directly here, mirroring
  // how the upload atom is created once in config.ts's `pluginsAtoms` — kept
  // local rather than threaded through `ClientConfig` to confine this change
  // to media-upload.ts/react.ts/vanilla.ts.
  const replaceAtom = createMediaReplaceAtom(config.$fetch);
  return buildClient<
    WithReplaceState<CMSVanillaClientInstance<TCMS, TPlugins>>
  >(config, {
    uploadState: config.pluginsAtoms.uploadAssets,
    replaceState: replaceAtom,
  });
}
