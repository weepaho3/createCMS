'use client';

import { useEffect, useMemo, useState } from 'react';

import type { MediaOptimizeClientConfig } from './index';
import type { OptimizeSupport } from './pipeline/codecs';
import type { OptimizeOutput } from './pipeline/process';

import { detectOptimizeSupport } from './pipeline/codecs';
import { createOptimizeHost } from './pipeline/host';

export type OptimizeState = {
  results: OptimizeOutput[] | null;
  isOptimizing: boolean;
};

const INITIAL_STATE: OptimizeState = { results: null, isOptimizing: false };

/**
 * Runs the optimization pipeline on `input` without uploading (a preview of
 * what an upload would send). Re-runs when the files or the config change;
 * a stale run never overwrites a newer one.
 *
 * ```tsx
 * const { results, isOptimizing } = cmsClient.optimize.useOptimize(file);
 * ```
 */
export function useOptimize(
  input: File | File[] | null | undefined,
  config: MediaOptimizeClientConfig = {},
): OptimizeState {
  const files = useMemo(
    () => (input ? (Array.isArray(input) ? input : [input]) : []),
    [input],
  );
  const [state, setState] = useState<OptimizeState>(INITIAL_STATE);

  useEffect(() => {
    if (files.length === 0 || config.enabled === false) {
      setState(INITIAL_STATE);
      return;
    }
    let current = true;
    setState({ results: null, isOptimizing: true });
    void (async () => {
      const { resolveOptimizeSettings } = await import('./index');
      const host = createOptimizeHost({
        createWorker: config.worker,
        codecs: config.codecs,
        concurrency: 1,
        msPerMegapixel: config.timeoutMsPerMegapixel ?? 1500,
      });
      const settings = resolveOptimizeSettings(config);
      const results: OptimizeOutput[] = [];
      for (const file of files) results.push(await host.run(file, settings));
      host.dispose();
      if (current) setState({ results, isOptimizing: false });
    })();
    return () => {
      current = false;
    };
  }, [files, config]);

  return state;
}

/**
 * Which optimization steps this browser can run with `codecs`: worker,
 * WebP (native or WASM), JPEG (mozjpeg or canvas), AVIF and HEIC. `null`
 * until detected.
 */
export function useOptimizeSupport(
  config: Pick<MediaOptimizeClientConfig, 'codecs'> = {},
): OptimizeSupport | null {
  const [support, setSupport] = useState<OptimizeSupport | null>(null);
  useEffect(() => {
    let current = true;
    void detectOptimizeSupport(config.codecs).then((value) => {
      if (current) setSupport(value);
    });
    return () => {
      current = false;
    };
  }, [config.codecs]);
  return support;
}
