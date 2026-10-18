import * as React from 'react';

import type { UseRenderComponentProps } from '../use-render';
import type {
  AssetProvenance,
  AssetVisibility,
  FilterState,
  MediaKind,
} from './core/filter';
import type { MediaStoreState } from './core/store';
import type { MediaFacets } from './core/types';

import { mergeProps, useRender } from '../use-render';
import { useMediaContext, useMediaMessages } from './context';
import { isAbortError } from './core/errors';
import {
  activeFilterCount,
  DEFAULT_FILTER,
  filterToQuery,
} from './core/filter';
import { useSelector } from './use-store';

const selectFilter = (state: MediaStoreState) => state.collection.query;

export type MediaFilter = {
  filter: FilterState;
  /** Filters beyond folder, sort and search text. */
  active: number;
  /** Merges `patch`; `debounce` for text typed in a field. */
  set: (patch: Partial<FilterState>, options?: { debounce?: boolean }) => void;
  /** Keeps folder and sort, drops every other filter. */
  clear: () => void;
};

/** The filter of the enclosing `Media.Root` and its setters. */
export function useMediaFilter(): MediaFilter {
  const { store } = useMediaContext('useMediaFilter');
  const filter = useSelector(store, selectFilter, Object.is);
  return React.useMemo(
    () => ({
      filter,
      active: activeFilterCount(filter),
      set: (patch, options) =>
        void store.dispatch({
          type: 'setFilter',
          filter: patch,
          debounce: options?.debounce,
        }),
      clear: () => {
        const kept: FilterState = { ...DEFAULT_FILTER, sort: filter.sort };
        if (filter.folderId !== undefined) kept.folderId = filter.folderId;
        if (filter.unfiled) kept.unfiled = true;
        void store.dispatch({ type: 'setFilter', replace: true, filter: kept });
      },
    }),
    [filter, store],
  );
}

/**
 * Counts per kind, provenance and visibility for the current filter
 * (`getAssetFacets`), refetched immediately on every filter change; a
 * stale request is aborted. `null` while loading or without the endpoint.
 */
export function useMediaFacets(): MediaFacets | null {
  const { store } = useMediaContext('useMediaFacets');
  const filter = useSelector(store, selectFilter, Object.is);
  const [facets, setFacets] = React.useState<MediaFacets | null>(null);
  React.useEffect(() => {
    if (!store.client.getAssetFacets) return;
    const controller = new AbortController();
    store.client
      .getAssetFacets({
        query: filterToQuery(filter),
        signal: controller.signal,
      })
      .then((result) => {
        if (!controller.signal.aborted) setFacets(result);
      })
      .catch((error: unknown) => {
        if (!isAbortError(error)) setFacets(null);
      });
    return () => controller.abort();
  }, [filter, store]);
  return facets;
}

type ChipValue =
  | { dimension: 'kinds'; value: MediaKind }
  | { dimension: 'provenance'; value: AssetProvenance }
  | { dimension: 'visibility'; value: AssetVisibility }
  | { dimension: 'usage'; value: 'used' | 'unused' }
  | { dimension: 'missingAlt'; value: true };

type ChipState = { pressed: boolean; count: number | null };

export type FilterChipProps = Omit<
  UseRenderComponentProps<'button', ChipState>,
  'value'
> &
  ChipValue & {
    /** Counts from `useMediaFacets()`; omit to show no count. */
    facets?: MediaFacets | null;
  };

function chipActive(filter: FilterState, chip: ChipValue): boolean {
  switch (chip.dimension) {
    case 'kinds':
      return filter.kinds?.includes(chip.value) ?? false;
    case 'provenance':
      return filter.provenance?.includes(chip.value) ?? false;
    case 'visibility':
      return filter.visibility?.includes(chip.value) ?? false;
    case 'usage':
      return filter.usage === chip.value;
    case 'missingAlt':
      return filter.missingAlt === true;
  }
}

function toggled(filter: FilterState, chip: ChipValue): Partial<FilterState> {
  const flip = <T extends string>(list: T[] | undefined, value: T) =>
    list?.includes(value)
      ? list.filter((item) => item !== value)
      : [...(list ?? []), value];
  switch (chip.dimension) {
    case 'kinds':
      return { kinds: flip(filter.kinds, chip.value) };
    case 'provenance':
      return { provenance: flip(filter.provenance, chip.value) };
    case 'visibility':
      return { visibility: flip(filter.visibility, chip.value) };
    case 'usage':
      return { usage: filter.usage === chip.value ? undefined : chip.value };
    case 'missingAlt':
      return { missingAlt: filter.missingAlt ? undefined : true };
  }
}

/**
 * A toggle `button` (`aria-pressed`) for one filter value, labelled from
 * the catalog with its facet count. Toggling pushes a history entry.
 */
export function FilterChip(props: FilterChipProps) {
  const { dimension, value, facets, render, children, ...rest } = props;
  const chip = { dimension, value } as ChipValue;
  const { messages, format } = useMediaMessages();
  const { filter, set } = useMediaFilter();
  const pressed = chipActive(filter, chip);
  const label =
    chip.dimension === 'kinds'
      ? messages.filter.kind[chip.value]
      : chip.dimension === 'provenance'
        ? messages.filter.provenance[chip.value]
        : chip.dimension === 'visibility'
          ? messages.visibility[chip.value]
          : chip.dimension === 'usage'
            ? messages.filter.usage[chip.value]
            : messages.filter.missingAlt;
  const count =
    facets &&
    (chip.dimension === 'kinds' ||
      chip.dimension === 'provenance' ||
      chip.dimension === 'visibility')
      ? ((facets[chip.dimension] as Record<string, number>)[chip.value] ?? 0)
      : null;
  return useRender({
    defaultTagName: 'button',
    render,
    state: { pressed, count } satisfies ChipState,
    props: mergeProps<'button'>(
      {
        type: 'button',
        'aria-pressed': pressed,
        onClick: () => set(toggled(filter, chip)),
        children: children ?? messages.filter.chip({ label, count }, format),
      },
      rest,
    ),
  });
}

export type FilterClearProps = UseRenderComponentProps<
  'button',
  { active: number }
>;

/** Drops every filter except folder and sort; rendered only while one is active. */
export function FilterClear(props: FilterClearProps) {
  const { render, children, ...rest } = props;
  const { messages } = useMediaMessages();
  const { active, filter, clear } = useMediaFilter();
  const shown = active > 0 || !!filter.q;
  const element = useRender({
    defaultTagName: 'button',
    render,
    state: { active },
    props: mergeProps<'button'>(
      {
        type: 'button',
        onClick: clear,
        children: children ?? messages.filter.clear,
      },
      rest,
    ),
  });
  return shown ? element : null;
}

const selectScope = (state: MediaStoreState) => ({
  q: state.collection.query.q,
  folderId: state.collection.query.folderId,
  recursive: state.collection.query.recursive,
  name:
    state.folders.currentId !== null
      ? (state.folders.nodes[state.folders.currentId]?.name ?? null)
      : null,
});

export type FilterScopeProps = Omit<
  UseRenderComponentProps<'p'>,
  'children'
> & {
  /** Renders the "all folders" switch; `searchAll` widens the search. */
  children?: (args: {
    label: string;
    searchAll: () => void;
    allLabel: string;
  }) => React.ReactNode;
};

/**
 * While searching inside a folder: "Searching in Products" and a switch
 * to search every folder. Nothing otherwise.
 */
export function FilterScope(props: FilterScopeProps) {
  const { render, children, ...rest } = props;
  const { store } = useMediaContext('Filter.Scope');
  const { messages, format } = useMediaMessages();
  const { q, folderId, name } = useSelector(store, selectScope);
  const label = messages.filter.searchIn(
    { folder: name ?? messages.folder.root },
    format,
  );
  const searchAll = () =>
    void store.dispatch({
      type: 'setFilter',
      filter: { folderId: undefined, unfiled: undefined, recursive: undefined },
    });
  const element = useRender({
    defaultTagName: 'p',
    render,
    props: mergeProps<'p'>(rest, {
      children: children
        ? children({ label, searchAll, allLabel: messages.filter.allFolders })
        : label,
    }),
  });
  return q && folderId !== undefined ? element : null;
}
