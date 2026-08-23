import * as React from 'react';

import type { EditorStore, EditorStoreState } from './store';

import { useEditorContext } from './context';

/** Selects a slice of the store; may also read memoised store facts (`store.isDirty()`). */
export type EditorSelector<T> = (
  state: EditorStoreState,
  store: EditorStore,
) => T;

/**
 * Shallow structural equality: same reference, or plain objects/arrays whose
 * own enumerable entries are `Object.is`-equal. Primitives compare by
 * `Object.is`.
 */
export function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (
    typeof a !== 'object' ||
    typeof b !== 'object' ||
    a === null ||
    b === null ||
    Array.isArray(a) !== Array.isArray(b)
  ) {
    return false;
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  for (const key of keys) {
    if (
      !Object.prototype.hasOwnProperty.call(right, key) ||
      !Object.is(left[key], right[key])
    ) {
      return false;
    }
  }
  return true;
}

type Memo<T> = {
  state: EditorStoreState;
  selector: EditorSelector<T>;
  selected: T;
};

/**
 * Subscribes a component to `selector(state, store)`. The snapshot is cached
 * per (state object, selector) and, when a recomputed value is `isEqual` to
 * the previous one, the previous reference is returned, so object/array
 * selectors never loop and the component re-renders only when its slice
 * changed. `store.getState()` returns a new object per change, so the cache
 * key is exact.
 */
export function useStoreSelector<T>(
  store: EditorStore,
  selector: EditorSelector<T>,
  isEqual: (a: T, b: T) => boolean = shallowEqual,
): T {
  const memo = React.useRef<Memo<T> | null>(null);
  const getSnapshot = (): T => {
    const state = store.getState();
    const cached = memo.current;
    if (cached && cached.state === state && cached.selector === selector) {
      return cached.selected;
    }
    const next = selector(state, store);
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

/** `useStoreSelector` against the store of the enclosing `Editor.Root`. */
export function useEditorSelector<T>(
  selector: EditorSelector<T>,
  isEqual?: (a: T, b: T) => boolean,
): T {
  const { store } = useEditorContext('useEditorSelector');
  return useStoreSelector(store, selector, isEqual);
}

/** The store of the enclosing `Editor.Root` (imperative access, no subscription). */
export function useEditorStore(): EditorStore {
  return useEditorContext('useEditorStore').store;
}
