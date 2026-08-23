import type { WritableAtom } from 'nanostores';

import { atom, onMount } from 'nanostores';

import type { CMSFetch, CMSQueryState } from './types';

const isServer = () => typeof window === 'undefined';

export interface CMSQueryOptions {
  method?: string;
  query?: Record<string, unknown>;
}

/**
 * Creates a reactive query atom that fetches data from a CMS endpoint.
 * Subscribes to one or more signal atoms and refetches when they toggle.
 * Returns a nanostores `WritableAtom`, framework-agnostic, not a React hook.
 */
export function createCMSQuery<T = unknown>(
  signals: WritableAtom<boolean> | WritableAtom<boolean>[],
  path: string,
  $fetch: CMSFetch,
  options?: CMSQueryOptions | (() => CMSQueryOptions),
): WritableAtom<CMSQueryState<T>> {
  const value = atom<CMSQueryState<T>>({
    data: null,
    error: null,
    isPending: true,
    isRefetching: false,
    refetch: () => fetchData(),
  });

  const fetchData = async () => {
    const current = value.get();
    value.set({
      ...current,
      isPending: current.data === null,
      isRefetching: current.data !== null,
      error: null,
    });

    try {
      const opts = typeof options === 'function' ? options() : options;
      const data = (await $fetch(path, {
        method: opts?.method ?? 'GET',
        query: opts?.query,
      })) as T;

      value.set({
        data,
        error: null,
        isPending: false,
        isRefetching: false,
        refetch: () => fetchData(),
      });
    } catch (error) {
      value.set({
        ...value.get(),
        error,
        isPending: false,
        isRefetching: false,
      });
    }
  };

  const signalList = Array.isArray(signals) ? signals : [signals];

  // Runs only while the query atom has subscribers. Use the unsubscribe
  // returned by each `listen`, never `atom.off()`: off() removes every
  // listener on the (often shared) signal atom and would break other
  // queries subscribed to it.
  onMount(value, () => {
    if (!isServer()) void fetchData();

    const unsubscribers = signalList.map((signal) =>
      signal.listen(() => {
        if (!isServer()) void fetchData();
      }),
    );

    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  });

  return value;
}
