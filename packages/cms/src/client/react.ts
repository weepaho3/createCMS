'use client';

import type { ReadableAtom } from 'nanostores';

import { useMemo } from 'react';

import type {
  CMSClientInstance,
  CMSClientOptions,
  CMSClientPlugin,
  CMSMediaUploadOptions,
  CMSMediaUploadState,
} from './types';

import { buildClient } from './build';
import {
  type ClientConfig,
  getClientConfigSync,
  runPluginInit,
} from './config';
import {
  type CMSMediaReplaceState,
  createMediaReplaceAtom,
} from './media-upload';
import { useStore } from './react-store';

// Adds the browser-callable replace-asset hook to the client's `media`
// namespace, mirroring `WithMedia<T>` in types.ts.
type WithReplaceAsset<T> = T extends { media: infer M }
  ? Omit<T, 'media'> & {
      media: M & { useReplaceAsset: () => CMSMediaReplaceState };
    }
  : T & { media: { useReplaceAsset: () => CMSMediaReplaceState } };

// Shared-store key the media-optimize plugin publishes its auto-optimizer
// under. Kept as a literal (not imported) so the React entry never statically
// pulls in the plugin's canvas/WebP code. Must match `UPLOAD_OPTIMIZER_KEY`
// in plugins/media-optimize/index.ts.
const UPLOAD_OPTIMIZER_KEY = 'media-optimize:uploadOptimizer';

type UploadOptimizer = {
  enabled: boolean;
  optimize: (files: File[]) => Promise<File[]>;
};

// Per-call opt-out: pass `{ optimize: false }` to skip auto-optimization even
// when the media-optimize plugin is installed and enabled.
type UploadOptions = CMSMediaUploadOptions & { optimize?: boolean };

/**
 * React `useUploadAssets` hook. Wraps the raw media-upload atom so that, when
 * the `media-optimize` plugin is installed and enabled, files are optimized on
 * the client before signing/upload. Opt out per call with
 * `upload(files, { optimize: false })`; without the plugin the original bytes
 * are uploaded unchanged.
 */
function makeUseUploadAssets(config: ClientConfig): () => CMSMediaUploadState {
  return () => {
    const state = useStore(
      config.pluginsAtoms.uploadAssets as ReadableAtom<CMSMediaUploadState>,
    );

    const wrappedUpload = useMemo(() => {
      const baseUpload = state.upload;
      return async (files: File[], options?: UploadOptions): Promise<void> => {
        const optimizer = (
          config.pluginsAtoms[UPLOAD_OPTIMIZER_KEY] as
            | ReadableAtom<UploadOptimizer>
            | undefined
        )?.get();

        const shouldOptimize =
          !!optimizer && optimizer.enabled && options?.optimize !== false;

        const finalFiles = shouldOptimize
          ? await optimizer.optimize(files)
          : files;

        return baseUpload(finalFiles, options);
      };
      // `state.upload` is set once by the atom factory, so this memo holds
      // for the component's lifetime.
    }, [state.upload]);

    return { ...state, upload: wrappedUpload as CMSMediaUploadState['upload'] };
  };
}

/**
 * React `useReplaceAsset` hook, backed by a `CMSMediaReplaceState` atom
 * created once per client instance.
 */
function makeUseReplaceAsset(
  replaceAtom: ReadableAtom<CMSMediaReplaceState>,
): () => CMSMediaReplaceState {
  return () => useStore(replaceAtom);
}

/**
 * Creates a type-safe React CMS client with plugin support.
 *
 * Plugin `init` functions run asynchronously in the background on creation
 * for side effects only. The client is built synchronously and is usable
 * immediately: the config is ready before init completes, so calls do not
 * block on it.
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
// TPlugins is inferred from `options.plugins` with default `[]` (not
// `CMSClientPlugin[]`): a no-plugins client then has an empty action set
// instead of a `Record<string,unknown>` index signature, which would let
// `client.anyTypo` type-check. See vanilla.ts.
export function createCMSClient<
  TCMS = unknown,
  const TPlugins extends CMSClientPlugin[] = [],
>(
  options: CMSClientOptions & { plugins?: TPlugins },
): WithReplaceAsset<CMSClientInstance<TCMS, TPlugins>>;

export function createCMSClient<TCMS = unknown>(): <
  const TPlugins extends CMSClientPlugin[] = [],
>(
  options: CMSClientOptions & { plugins?: TPlugins },
) => WithReplaceAsset<CMSClientInstance<TCMS, TPlugins>>;

export function createCMSClient<TCMS = unknown>(
  options?: CMSClientOptions & { plugins?: CMSClientPlugin[] },
) {
  if (options) {
    const config = getClientConfigSync(options);
    runPluginInit(options, config).catch((err) =>
      console.error('[cms] plugin init failed:', err),
    );
    const replaceAtom = createMediaReplaceAtom(config.$fetch);
    return buildClient<
      WithReplaceAsset<CMSClientInstance<TCMS, CMSClientPlugin[]>>
    >(config, {
      useUploadAssets: makeUseUploadAssets(config),
      useReplaceAsset: makeUseReplaceAsset(replaceAtom),
    });
  }
  return <const TPlugins extends CMSClientPlugin[] = []>(
    opts: CMSClientOptions & { plugins?: TPlugins },
  ): WithReplaceAsset<CMSClientInstance<TCMS, TPlugins>> => {
    const config = getClientConfigSync(opts);
    runPluginInit(opts, config).catch((err) =>
      console.error('[cms] plugin init failed:', err),
    );
    const replaceAtom = createMediaReplaceAtom(config.$fetch);
    return buildClient<WithReplaceAsset<CMSClientInstance<TCMS, TPlugins>>>(
      config,
      {
        useUploadAssets: makeUseUploadAssets(config),
        useReplaceAsset: makeUseReplaceAsset(replaceAtom),
      },
    );
  };
}

export { useStore } from './react-store';
