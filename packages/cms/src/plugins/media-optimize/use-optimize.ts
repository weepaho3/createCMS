'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import type { OptimizationConfig } from '../../core/types/s3';
import type { OptimizeResult } from './optimize';

import { optimizeImage } from './optimize';

export type OptimizeState = {
  results: OptimizeResult[] | null;
  isOptimizing: boolean;
  error: string | null;
};

const INITIAL_STATE: OptimizeState = {
  results: null,
  isOptimizing: false,
  error: null,
};

/**
 * React hook that optimizes image files on the client.
 *
 * Accepts a single `File` or `File[]` and an `OptimizationConfig`.
 * Runs `optimizeImage` automatically whenever the input reference changes.
 * Non-image files pass through with `optimized: false`.
 *
 * ```tsx
 * const { results, isOptimizing, error } = cmsClient.optimize.useOptimize(file, {
 *   compress: { quality: 80 },
 *   resize: { maxSize: 1200 },
 * });
 * ```
 */
export function useOptimize(
  input: File | File[],
  config: OptimizationConfig,
): OptimizeState {
  const [state, setState] = useState<OptimizeState>(INITIAL_STATE);
  const abortRef = useRef(false);
  const runIdRef = useRef(0);

  const inputArray = Array.isArray(input) ? input : [input];
  // Content key: a different array of the SAME length (but different files) must
  // still re-run the optimize effect, so key on file identity, not array length.
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
          : { results: [], isOptimizing: false, error: null },
      );
      return;
    }

    abortRef.current = false;
    const currentRun = ++runIdRef.current;

    setState({ results: null, isOptimizing: true, error: null });

    Promise.all(files.map((file) => optimizeImage(file, configRef.current)))
      .then((results) => {
        if (abortRef.current || runIdRef.current !== currentRun) return;
        setState({ results, isOptimizing: false, error: null });
      })
      .catch((err) => {
        if (abortRef.current || runIdRef.current !== currentRun) return;
        setState({
          results: null,
          isOptimizing: false,
          error: err instanceof Error ? err.message : 'Optimization failed',
        });
      });

    return () => {
      abortRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, configKey]);

  return state;
}
