import type { FilterState } from './filter';

/**
 * Selection over an ordered collection with OS conventions: a click
 * replaces, Cmd/Ctrl toggles, Shift replaces the previous range from the
 * anchor (Finder), Shift+Cmd/Ctrl adds a range. `allMatching` selects every
 * asset of a query on the server, loaded or not, minus `except`.
 */

export type SelectionMode = 'none' | 'single' | 'multiple';

export type AllMatching = { query: FilterState; except: string[] };

export type SelectionState = {
  mode: SelectionMode;
  /** Selected ids in selection order (loaded ids only under `allMatching`). */
  selected: string[];
  /** Where ranges start. */
  anchor: string | null;
  /** The far end of the last Shift range, replaced by the next one. */
  rangeEnd: string | null;
  /** The keyboard focus (cursor), independent of the selection. */
  focus: string | null;
  allMatching: AllMatching | null;
};

export type SelectionModifiers = {
  /** Shift. */
  range?: boolean;
  /** Cmd on Apple platforms, Ctrl elsewhere. */
  toggle?: boolean;
};

export function createSelection(mode: SelectionMode): SelectionState {
  return {
    mode,
    selected: [],
    anchor: null,
    rangeEnd: null,
    focus: null,
    allMatching: null,
  };
}

function rangeOf(
  order: readonly string[],
  from: string,
  to: string,
): string[] | null {
  const a = order.indexOf(from);
  const b = order.indexOf(to);
  if (a === -1 || b === -1) return null;
  return order.slice(Math.min(a, b), Math.max(a, b) + 1);
}

function union(base: readonly string[], add: readonly string[]): string[] {
  const seen = new Set(base);
  const out = [...base];
  for (const id of add) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

export function isSelected(state: SelectionState, id: string): boolean {
  if (state.allMatching) return !state.allMatching.except.includes(id);
  return state.selected.includes(id);
}

/** Selected assets, counting the unloaded ones of `allMatching` from `total`. */
export function selectionCount(
  state: SelectionState,
  total: number | null,
): number {
  if (state.allMatching && total !== null) {
    return Math.max(0, total - state.allMatching.except.length);
  }
  return state.selected.length;
}

/** A click (or Enter) on `id`. */
export function selectionClick(
  state: SelectionState,
  order: readonly string[],
  id: string,
  modifiers: SelectionModifiers = {},
): SelectionState {
  if (state.mode === 'none') return { ...state, focus: id };
  if (state.mode === 'single') {
    const deselect = modifiers.toggle && state.selected[0] === id;
    return {
      ...state,
      selected: deselect ? [] : [id],
      anchor: id,
      rangeEnd: null,
      focus: id,
      allMatching: null,
    };
  }
  if (modifiers.range && state.anchor !== null) {
    const range = rangeOf(order, state.anchor, id);
    if (range) {
      let base: readonly string[];
      if (modifiers.toggle) {
        base = state.selected;
      } else {
        // Keep what was selected before the previous Shift range.
        const previous = state.rangeEnd
          ? rangeOf(order, state.anchor, state.rangeEnd)
          : null;
        const drop = new Set(previous ?? []);
        base = state.selected.filter(
          (entry) => !drop.has(entry) && entry !== state.anchor,
        );
      }
      return {
        ...state,
        selected: union(base, range),
        rangeEnd: id,
        focus: id,
        allMatching: null,
      };
    }
  }
  if (modifiers.toggle) return toggleSelection(state, id);
  return {
    ...state,
    selected: [id],
    anchor: id,
    rangeEnd: null,
    focus: id,
    allMatching: null,
  };
}

/** Space, a checkbox or Cmd/Ctrl-click: toggles `id` and makes it the anchor. */
export function toggleSelection(
  state: SelectionState,
  id: string,
): SelectionState {
  if (state.mode === 'none') return state;
  if (state.allMatching) {
    const { except } = state.allMatching;
    const nextExcept = except.includes(id)
      ? except.filter((entry) => entry !== id)
      : [...except, id];
    return {
      ...state,
      selected: nextExcept.includes(id)
        ? state.selected.filter((entry) => entry !== id)
        : union(state.selected, [id]),
      allMatching: { ...state.allMatching, except: nextExcept },
      anchor: id,
      rangeEnd: null,
      focus: id,
    };
  }
  const selected = state.selected.includes(id)
    ? state.selected.filter((entry) => entry !== id)
    : state.mode === 'single'
      ? [id]
      : [...state.selected, id];
  return { ...state, selected, anchor: id, rangeEnd: null, focus: id };
}

/** Moves the cursor without touching the selection (Cmd/Ctrl+Arrow). */
export function focusSelection(
  state: SelectionState,
  id: string,
): SelectionState {
  return state.focus === id ? state : { ...state, focus: id };
}

/** Shift+Arrow: extends from the anchor to `id` like a Shift-click. */
export function extendSelection(
  state: SelectionState,
  order: readonly string[],
  id: string,
): SelectionState {
  if (state.mode !== 'multiple') return selectionClick(state, order, id);
  if (state.anchor === null) {
    const start = state.focus ?? id;
    return selectionClick(
      { ...state, anchor: start, selected: union(state.selected, [start]) },
      order,
      id,
      { range: true },
    );
  }
  return selectionClick(state, order, id, { range: true });
}

/** Cmd/Ctrl+A: every loaded id. */
export function selectAllLoaded(
  state: SelectionState,
  order: readonly string[],
): SelectionState {
  if (state.mode !== 'multiple') return state;
  return { ...state, selected: [...order], rangeEnd: null, allMatching: null };
}

/** Every asset matching `query` on the server, including unloaded pages. */
export function selectAllMatching(
  state: SelectionState,
  query: FilterState,
  loaded: readonly string[],
): SelectionState {
  if (state.mode !== 'multiple') return state;
  return {
    ...state,
    selected: [...loaded],
    rangeEnd: null,
    allMatching: { query, except: [] },
  };
}

export function clearSelection(state: SelectionState): SelectionState {
  if (state.selected.length === 0 && state.allMatching === null) return state;
  return {
    ...state,
    selected: [],
    anchor: null,
    rangeEnd: null,
    allMatching: null,
  };
}

/**
 * The selection after the visible ids changed (a filter, a folder, a
 * removal). Hidden ids are dropped unless `keepHidden`; `hidden` counts the
 * selected ids that are not visible. `allMatching` ends when its query is
 * no longer the current one.
 */
export function reconcileSelection(
  state: SelectionState,
  visible: readonly string[],
  options: {
    keepHidden?: boolean;
    query?: FilterState;
    sameQuery?: boolean;
  } = {},
): { state: SelectionState; hidden: number } {
  const present = new Set(visible);
  const hiddenIds = state.selected.filter((id) => !present.has(id));
  let next = state;
  if (state.allMatching && options.sameQuery === false) {
    next = { ...next, allMatching: null };
  } else if (state.allMatching) {
    next = {
      ...next,
      selected: union(
        next.selected,
        visible.filter((id) => !state.allMatching!.except.includes(id)),
      ),
    };
  }
  if (!options.keepHidden && hiddenIds.length > 0) {
    const drop = new Set(hiddenIds);
    next = {
      ...next,
      selected: next.selected.filter((id) => !drop.has(id)),
      anchor: next.anchor && drop.has(next.anchor) ? null : next.anchor,
      rangeEnd: next.rangeEnd && drop.has(next.rangeEnd) ? null : next.rangeEnd,
    };
  }
  if (next.focus !== null && !present.has(next.focus)) {
    next = { ...next, focus: null };
  }
  return {
    state: next,
    hidden: options.keepHidden ? hiddenIds.length : 0,
  };
}

/** What a bulk endpoint receives for the selection. */
export type BulkTarget = { assetIds: string[] } | { allMatching: AllMatching };

export function bulkTarget(state: SelectionState): BulkTarget {
  return state.allMatching
    ? { allMatching: state.allMatching }
    : { assetIds: [...state.selected] };
}

/**
 * The ids a drag carries: the selection when `id` is part of it, otherwise
 * `id` alone (the selection stays as it is).
 */
export function dragIds(state: SelectionState, id: string): string[] {
  return isSelected(state, id) && state.selected.length > 0
    ? [...state.selected]
    : [id];
}

/**
 * The id to focus after `removed` left `order`: the next remaining one,
 * else the previous one, else `null` (focus the collection).
 */
export function nextFocusAfterRemoval(
  order: readonly string[],
  removed: readonly string[],
  focus: string | null,
): string | null {
  const gone = new Set(removed);
  const start = focus === null ? -1 : order.indexOf(focus);
  if (focus !== null && !gone.has(focus)) return focus;
  if (start === -1) return order.find((id) => !gone.has(id)) ?? null;
  for (let i = start + 1; i < order.length; i++) {
    if (!gone.has(order[i])) return order[i];
  }
  for (let i = start - 1; i >= 0; i--) {
    if (!gone.has(order[i])) return order[i];
  }
  return null;
}
