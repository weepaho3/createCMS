'use client';

import type { ReadableAtom } from 'nanostores';

import { useMemo } from 'react';

import type {
  CMSClientInstance,
  CMSClientOptions,
  CMSClientPlugin,
  CMSMediaUploadFileState,
  CMSMediaUploadState,
} from './types';

import { buildClient } from './build';
import {
  type ClientConfig,
  getClientConfigSync,
  runPluginInit,
} from './config';
import { useStore } from './react-store';

/**
 * The replace entries of the client's upload queue, with the queue's
 * controls. Replaces run in the same queue as uploads, with the same
 * statuses, retries and progress.
 */
export type CMSMediaReplaceState = {
  /** Replace entries, oldest first. */
  entries: CMSMediaUploadFileState[];
  isReplacing: boolean;
  replace: CMSMediaUploadState['replace'];
  abort: CMSMediaUploadState['abort'];
  retry: CMSMediaUploadState['retry'];
};

// Adds the replace hook to the client's `media` namespace, mirroring
// `WithMedia<T>` in types.ts.
type WithReplaceAsset<T> = T extends { media: infer M }
  ? Omit<T, 'media'> & {
      media: M & { useReplaceAsset: () => CMSMediaReplaceState };
    }
  : T & { media: { useReplaceAsset: () => CMSMediaReplaceState } };

function queueOf(config: ClientConfig): ReadableAtom<CMSMediaUploadState> {
  return config.pluginsAtoms.uploadAssets as ReadableAtom<CMSMediaUploadState>;
}

/**
 * React `useUploadAssets` hook: the client's upload queue. The queue lives
 * as long as the client, so uploads keep running when the component that
 * started them unmounts. With the media-optimize plugin, images are
 * optimized before signing; opt out per call with
 * `upload(files, { optimize: false })`.
 */
function makeUseUploadAssets(config: ClientConfig): () => CMSMediaUploadState {
  const queue = queueOf(config);
  return () => useStore(queue);
}

/** React `useReplaceAsset` hook over the same queue. */
function makeUseReplaceAsset(config: ClientConfig): () => CMSMediaReplaceState {
  const queue = queueOf(config);
  return () => {
    const state = useStore(queue);
    return useMemo(() => {
      const entries = state.files.filter((entry) => entry.kind === 'replace');
      return {
        entries,
        isReplacing: entries.some(
          (entry) =>
            entry.status !== 'success' &&
            entry.status !== 'error' &&
            entry.status !== 'aborted',
        ),
        replace: state.replace,
        abort: state.abort,
        retry: state.retry,
      };
    }, [state]);
  };
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
 * function MyComponent() {
 *   const uploads = client.media.useUploadAssets();
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
  const build = <TPlugins extends CMSClientPlugin[]>(
    opts: CMSClientOptions & { plugins?: TPlugins },
  ): WithReplaceAsset<CMSClientInstance<TCMS, TPlugins>> => {
    const config = getClientConfigSync(opts);
    runPluginInit(opts, config).catch((err) =>
      console.error('[cms] plugin init failed:', err),
    );
    return buildClient<WithReplaceAsset<CMSClientInstance<TCMS, TPlugins>>>(
      config,
      {
        useUploadAssets: makeUseUploadAssets(config),
        useReplaceAsset: makeUseReplaceAsset(config),
      },
    );
  };
  if (options) return build(options);
  return <const TPlugins extends CMSClientPlugin[] = []>(
    opts: CMSClientOptions & { plugins?: TPlugins },
  ) => build(opts);
}

export { useStore } from './react-store';
export { takeInterruptedUploads } from './upload-queue';
