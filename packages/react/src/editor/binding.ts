import * as React from 'react';

import type {
  DocState,
  EditorStore,
  EphemeralState,
  SessionState,
} from './core/store';

import { useEditorContext } from './context';

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

type Memo<S, T> = {
  state: S;
  selector: (state: S, store: EditorStore) => T;
  selected: T;
};

/**
 * Subscribes a component to `selector(getState(), store)` on one channel.
 * The snapshot is cached per (state object, selector) and, when a
 * recomputed value is `isEqual` to the previous one, the previous reference
 * is returned, so object/array selectors never loop and the component
 * re-renders only when its slice changed. Every channel hands out a new
 * state object per change, so the cache key is exact.
 */
function useChannelSelector<S, T>(
  store: EditorStore,
  subscribe: (listener: () => void) => () => void,
  getState: () => S,
  selector: (state: S, store: EditorStore) => T,
  isEqual: (a: T, b: T) => boolean,
): T {
  const memo = React.useRef<Memo<S, T> | null>(null);
  const getSnapshot = (): T => {
    const state = getState();
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
  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Selects from the document scope; wakes only on document changes. */
export type DocSelector<T> = (state: DocState, store: EditorStore) => T;
/** Selects from the session scope (selection, focus, history, save). */
export type SessionSelector<T> = (state: SessionState, store: EditorStore) => T;
/** Selects from the ephemeral scope (hover). */
export type EphemeralSelector<T> = (
  state: EphemeralState,
  store: EditorStore,
) => T;

export function useStoreDocSelector<T>(
  store: EditorStore,
  selector: DocSelector<T>,
  isEqual: (a: T, b: T) => boolean = shallowEqual,
): T {
  return useChannelSelector(
    store,
    store.subscribeDoc,
    store.getDoc,
    selector,
    isEqual,
  );
}

export function useStoreSessionSelector<T>(
  store: EditorStore,
  selector: SessionSelector<T>,
  isEqual: (a: T, b: T) => boolean = shallowEqual,
): T {
  return useChannelSelector(
    store,
    store.subscribeSession,
    store.getSession,
    selector,
    isEqual,
  );
}

export function useStoreEphemeralSelector<T>(
  store: EditorStore,
  selector: EphemeralSelector<T>,
  isEqual: (a: T, b: T) => boolean = shallowEqual,
): T {
  return useChannelSelector(
    store,
    store.subscribeEphemeral,
    store.getEphemeral,
    selector,
    isEqual,
  );
}

/** A slice of the document scope of the enclosing `Editor.Root`. */
export function useDocSelector<T>(
  selector: DocSelector<T>,
  isEqual?: (a: T, b: T) => boolean,
): T {
  const { store } = useEditorContext('useDocSelector');
  return useStoreDocSelector(store, selector, isEqual);
}

/** A slice of the session scope of the enclosing `Editor.Root`. */
export function useSessionSelector<T>(
  selector: SessionSelector<T>,
  isEqual?: (a: T, b: T) => boolean,
): T {
  const { store } = useEditorContext('useSessionSelector');
  return useStoreSessionSelector(store, selector, isEqual);
}

/** A slice of the ephemeral scope of the enclosing `Editor.Root`. */
export function useEphemeralSelector<T>(
  selector: EphemeralSelector<T>,
  isEqual?: (a: T, b: T) => boolean,
): T {
  const { store } = useEditorContext('useEphemeralSelector');
  return useStoreEphemeralSelector(store, selector, isEqual);
}

/** The store of the enclosing `Editor.Root` (imperative access, no subscription). */
export function useEditorStore(): EditorStore {
  return useEditorContext('useEditorStore').store;
}
