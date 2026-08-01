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
import { useStore } from './react-store';

// Shared-store key the media-optimize plugin publishes its auto-optimizer
// under. Kept as a literal (not imported) so the React entry never statically
// pulls in the plugin's canvas/WebP code. Must match
// `UPLOAD_OPTIMIZER_KEY` in `plugins/media-optimize/index.ts`.
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
 * the client BEFORE signing/upload — by default, no manual `optimizeImage`
 * call required. Opt out per call with `upload(files, { optimize: false })`.
 * When the plugin is absent, behavior is unchanged (original bytes uploaded).
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
      // `state.upload` is a stable reference (set once by the atom factory), so
      // this memoizes to a single wrapped function across renders.
    }, [state.upload]);

    return { ...state, upload: wrappedUpload as CMSMediaUploadState['upload'] };
  };
}

/**
 * Creates a type-safe React CMS client with plugin support.
 *
 * Plugin `init` functions run asynchronously in the background on creation
 * for side effects only. The client is built synchronously and is usable
 * immediately — the config is ready before init completes, so calls do not
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
// TPlugins is INFERRED from `options.plugins`, default `[]` (not `CMSClientPlugin[]`)
// so a no-plugins client never gets a `Record<string,unknown>` action index
// signature (which would make `client.anyTypo` type-check). See vanilla.ts.
export function createCMSClient<
  TCMS = unknown,
  const TPlugins extends CMSClientPlugin[] = [],
>(
  options: CMSClientOptions & { plugins?: TPlugins },
): CMSClientInstance<TCMS, TPlugins>;

export function createCMSClient<TCMS = unknown>(): <
  const TPlugins extends CMSClientPlugin[] = [],
>(
  options: CMSClientOptions & { plugins?: TPlugins },
) => CMSClientInstance<TCMS, TPlugins>;

export function createCMSClient<TCMS = unknown>(
  options?: CMSClientOptions & { plugins?: CMSClientPlugin[] },
) {
  if (options) {
    const config = getClientConfigSync(options);
    runPluginInit(options, config).catch((err) =>
      console.error('[cms] plugin init failed:', err),
    );
    return buildClient<CMSClientInstance<TCMS, CMSClientPlugin[]>>(config, {
      useUploadAssets: makeUseUploadAssets(config),
    });
  }
  return <const TPlugins extends CMSClientPlugin[] = []>(
    opts: CMSClientOptions & { plugins?: TPlugins },
  ): CMSClientInstance<TCMS, TPlugins> => {
    const config = getClientConfigSync(opts);
    runPluginInit(opts, config).catch((err) =>
      console.error('[cms] plugin init failed:', err),
    );
    return buildClient<CMSClientInstance<TCMS, TPlugins>>(config, {
      useUploadAssets: makeUseUploadAssets(config),
    });
  };
}

export { useStore } from './react-store';
