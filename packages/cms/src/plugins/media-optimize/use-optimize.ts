'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import type { OptimizationConfig } from '../../core/types/s3';
import type { OptimizeResult } from './optimize';

import { optimizeFiles } from './optimize';

/**
 * Config accepted by {@link useOptimize}: the raw {@link OptimizationConfig}
 * plus an `enabled` switch. When `enabled` is `false`, files pass through
 * untouched (`optimized: false`) without running the canvas/WebP pipeline.
 */
export type UseOptimizeConfig = OptimizationConfig & { enabled?: boolean };

export type OptimizeState = {
  results: OptimizeResult[] | null;
  isOptimizing: boolean;
};

const INITIAL_STATE: OptimizeState = {
  results: null,
  isOptimizing: false,
};

/**
 * React hook that optimizes image files on the client.
 *
 * Accepts a single `File` or `File[]` and an `OptimizationConfig`.
 * Runs `optimizeFiles` whenever the input files or the config change.
 * Files that cannot be optimized come back unchanged with `optimized: false`
 * and, for images, a `warning`.
 *
 * ```tsx
 * const { results, isOptimizing } = cmsClient.optimize.useOptimize(file, {
 *   compress: { quality: 80 },
 *   resize: { maxSize: 1200 },
 * });
 * ```
 */
export function useOptimize(
  input: File | File[],
  config: UseOptimizeConfig,
): OptimizeState {
  const [state, setState] = useState<OptimizeState>(INITIAL_STATE);
  const abortRef = useRef(false);
  const runIdRef = useRef(0);

  const inputArray = Array.isArray(input) ? input : [input];
  // Content key: a different array of the same length (but different files)
  // must still re-run the optimize effect, so key on file identity, not array
  // length.
  const filesKey = inputArray
    .map((f) => `${f.name}:${f.size}:${f.lastModified}`)
    .join('|');

  const files = useMemo(
    () => inputArray,
    // Stabilize on content: same files → same array reference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filesKey],
  );

  const configKey = JSON.stringify(config);
  const configRef = useRef(config);
  configRef.current = config;

  useEffect(() => {
    if (files.length === 0) {
      setState((prev) =>
        prev.results?.length === 0 && !prev.isOptimizing
          ? prev
          : { results: [], isOptimizing: false },
      );
      return;
    }

    abortRef.current = false;
    const currentRun = ++runIdRef.current;

    setState({ results: null, isOptimizing: true });

    const config = configRef.current;
    const run =
      config.enabled === false
        ? Promise.resolve(
            files.map<OptimizeResult>((file) => ({
              file,
              optimized: false,
              bytesBefore: file.size,
              bytesAfter: file.size,
            })),
          )
        : optimizeFiles(files, config);

    void run.then((results) => {
      if (abortRef.current || runIdRef.current !== currentRun) return;
      setState({ results, isOptimizing: false });
    });

    return () => {
      abortRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, configKey]);

  return state;
}
