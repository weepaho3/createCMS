import * as React from 'react';

import type { MediaStoreState } from './core/store';

import { shallowEqual } from '../editor/binding';
import { useMediaContext } from './context';

export type ReadableStore<S> = {
  subscribe(listener: () => void): () => void;
  getState(): S;
};

type Memo<S, T> = {
  state: S;
  selector: (state: S) => T;
  selected: T;
};

/**
 * Subscribes a component to `selector(store.getState())`. The snapshot is
 * cached per (state object, selector); when a recomputed value is `isEqual`
 * to the previous one the previous reference is returned, so object/array
 * selectors never loop and the component re-renders only when its slice
 * changed. Requires `getState()` to return a new object per change.
 */
export function useSelector<S, T>(
  store: ReadableStore<S>,
  selector: (state: S) => T,
  isEqual: (a: T, b: T) => boolean = shallowEqual,
): T {
  const memo = React.useRef<Memo<S, T> | null>(null);
  const getSnapshot = (): T => {
    const state = store.getState();
    const cached = memo.current;
    if (cached && cached.state === state && cached.selector === selector) {
      return cached.selected;
    }
    const next = selector(state);
    if (cached && isEqual(cached.selected, next)) {
      memo.current = { state, selector, selected: cached.selected };
      return cached.selected;
    }
    memo.current = { state, selector, selected: next };
    return next;
  };
  const subscribe = React.useCallback(
    (listener: () => void) => store.subscribe(listener),
    [store],
  );
  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Subscribes to a slice of the enclosing `Media.Root` store. Selectors
 * should be stable (module level or `useCallback`); results are compared
 * shallowly unless `isEqual` is given.
 */
export function useMediaStore<T>(
  selector: (state: MediaStoreState) => T,
  isEqual?: (a: T, b: T) => boolean,
): T {
  const { store } = useMediaContext('useMediaStore');
  return useSelector(store, selector, isEqual);
}
