'use client';

import type { ReadableAtom } from 'nanostores';

import { useCallback, useRef, useSyncExternalStore } from 'react';

/**
 * React hook that subscribes to a nanostores atom via `useSyncExternalStore`.
 * Re-renders the component when the atom value changes.
 */
export function useStore<T>(store: ReadableAtom<T>): T {
  const snapshotRef = useRef(store.get());

  const subscribe = useCallback(
    (onChange: () => void) => {
      const emitChange = (value: T) => {
        if (snapshotRef.current === value) return;
        snapshotRef.current = value;
        onChange();
      };
      emitChange(store.get());
      return store.listen(emitChange);
    },
    [store],
  );

  const getSnapshot = () => snapshotRef.current;

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
