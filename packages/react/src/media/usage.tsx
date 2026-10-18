'use client';

import * as React from 'react';

import type { UseRenderComponentProps } from '../use-render';
import type {
  MediaClient,
  MediaUsageItem,
  MediaUsageOccurrence,
  MediaUsagePage,
  MediaUsageScope,
} from './core/types';

export type {
  MediaUsageItem,
  MediaUsageOccurrence,
  MediaUsagePage,
  MediaUsageScope,
};

import { mergeProps, useRender } from '../use-render';
import { useMediaMessages } from './context';

// --- data ---------------------------------------------------------------------

/** Builds the editor link of one usage. */
export type EditorHrefAdapter = {
  build(target: {
    rootId: string;
    collection: string;
    branchId: string | null;
    blockId: string;
    path: string;
    /** `alt` opens the block with the alt-text field focused. */
    focus?: 'alt';
  }): string;
};

/**
 * Links into the createCMS editor:
 * `<base>/<collection>/<rootId>?block=...&path=...&branch=...&focus=alt`.
 */
export function createEditorHrefAdapter(base = '/editor'): EditorHrefAdapter {
  return {
    build({ rootId, collection, branchId, blockId, path, focus }) {
      const params = new URLSearchParams({ block: blockId, path });
      if (branchId) params.set('branch', branchId);
      if (focus) params.set('focus', focus);
      return `${base.replace(/\/$/, '')}/${encodeURIComponent(collection)}/${encodeURIComponent(rootId)}?${params}`;
    },
  };
}

export type UseAssetUsagesState = {
  status: 'idle' | 'loading' | 'loadingMore' | 'error';
  error: unknown;
  total: MediaUsagePage['total'] | null;
  items: MediaUsageItem[];
  hasMore: boolean;
  scope: MediaUsageScope;
  missingAlt: boolean;
  setScope: (scope: MediaUsageScope) => void;
  setMissingAlt: (missingAlt: boolean) => void;
  loadMore: () => void;
  reload: () => void;
};

/**
 * Where `assetId` is used, page by page (`getAssetUsages`). Changing the
 * scope or the missing-alt filter starts over; `reload` refetches (call it
 * after a replace or an edit).
 */
export function useAssetUsages(
  client: Pick<MediaClient, 'getAssetUsages'>,
  options: {
    assetId: string;
    scope?: MediaUsageScope;
    missingAlt?: boolean;
    limit?: number;
  },
): UseAssetUsagesState {
  const [scope, setScope] = React.useState<MediaUsageScope>(
    options.scope ?? 'live',
  );
  const [missingAlt, setMissingAlt] = React.useState(
    options.missingAlt ?? false,
  );
  const [version, setVersion] = React.useState(0);
  const [state, setState] = React.useState<{
    status: UseAssetUsagesState['status'];
    error: unknown;
    total: MediaUsagePage['total'] | null;
    items: MediaUsageItem[];
    cursor: string | null;
  }>({ status: 'idle', error: null, total: null, items: [], cursor: null });
  const request = React.useRef(0);
  const { assetId, limit } = options;

  const fetchPage = React.useCallback(
    async (cursor: string | null) => {
      if (!client.getAssetUsages) {
        throw new Error('This media client has no getAssetUsages');
      }
      return (await client.getAssetUsages({
        query: {
          assetId,
          scope,
          missingAlt: missingAlt ? 'true' : undefined,
          cursor: cursor ?? undefined,
          limit,
        },
      })) as MediaUsagePage;
    },
    [client, assetId, scope, missingAlt, limit],
  );

  React.useEffect(() => {
    const id = ++request.current;
    setState({
      status: 'loading',
      error: null,
      total: null,
      items: [],
      cursor: null,
    });
    fetchPage(null).then(
      (page) => {
        if (id !== request.current) return;
        setState({
          status: 'idle',
          error: null,
          total: page.total,
          items: page.items,
          cursor: page.nextCursor,
        });
      },
      (error: unknown) => {
        if (id !== request.current) return;
        setState((s) => ({ ...s, status: 'error', error }));
      },
    );
  }, [fetchPage, version]);

  const loadMore = React.useCallback(() => {
    if (!state.cursor || state.status !== 'idle') return;
    const id = request.current;
    setState((s) => ({ ...s, status: 'loadingMore' }));
    fetchPage(state.cursor).then(
      (page) => {
        if (id !== request.current) return;
        setState((s) => ({
          status: 'idle',
          error: null,
          total: page.total,
          items: [...s.items, ...page.items],
          cursor: page.nextCursor,
        }));
      },
      (error: unknown) => {
        if (id !== request.current) return;
        setState((s) => ({ ...s, status: 'error', error }));
      },
    );
  }, [fetchPage, state.cursor, state.status]);

  return {
    status: state.status,
    error: state.error,
    total: state.total,
    items: state.items,
    hasMore: state.cursor !== null,
    scope,
    missingAlt,
    setScope,
    setMissingAlt,
    loadMore,
    reload: React.useCallback(() => setVersion((v) => v + 1), []),
  };
}

// --- counts ---------------------------------------------------------------------

type Counts = Record<string, { roots: number; published: number }>;

type CountBatcher = {
  cache: Map<string, Counts[string]>;
  pending: Set<string>;
  listeners: Set<() => void>;
  scheduled: boolean;
};

const batchers = new WeakMap<object, Map<MediaUsageScope, CountBatcher>>();

function batcherFor(
  client: Pick<MediaClient, 'getAssetUsageCounts'>,
  scope: MediaUsageScope,
): CountBatcher {
  let byScope = batchers.get(client);
  if (!byScope) {
    byScope = new Map();
    batchers.set(client, byScope);
  }
  let batcher = byScope.get(scope);
  if (!batcher) {
    batcher = {
      cache: new Map(),
      pending: new Set(),
      listeners: new Set(),
      scheduled: false,
    };
    byScope.set(scope, batcher);
  }
  return batcher;
}

function scheduleFrame(callback: () => void) {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(callback);
  } else {
    queueMicrotask(callback);
  }
}

function requestCounts(
  client: Pick<MediaClient, 'getAssetUsageCounts'>,
  scope: MediaUsageScope,
  batcher: CountBatcher,
  ids: string[],
) {
  for (const id of ids) {
    if (!batcher.cache.has(id)) batcher.pending.add(id);
  }
  if (batcher.scheduled || batcher.pending.size === 0) return;
  batcher.scheduled = true;
  scheduleFrame(() => {
    batcher.scheduled = false;
    const batch = [...batcher.pending].slice(0, 200);
    for (const id of batch) batcher.pending.delete(id);
    if (batch.length === 0 || !client.getAssetUsageCounts) return;
    void client
      .getAssetUsageCounts({ body: { assetIds: batch, scope } })
      .then(({ counts }) => {
        for (const id of batch) {
          batcher.cache.set(id, counts[id] ?? { roots: 0, published: 0 });
        }
        for (const listener of batcher.listeners) listener();
        if (batcher.pending.size > 0) requestCounts(client, scope, batcher, []);
      });
  });
}

/**
 * Usage counts of `assetIds` for grid badges. Requests of every component
 * in one frame go out as one `getAssetUsageCounts` call per client and
 * scope; results are kept until `invalidateAssetUsageCounts`.
 */
export function useAssetUsageCounts(
  client: Pick<MediaClient, 'getAssetUsageCounts'>,
  assetIds: string[],
  scope: MediaUsageScope = 'live',
): Counts {
  const batcher = batcherFor(client, scope);
  const key = assetIds.join(',');
  React.useEffect(() => {
    requestCounts(client, scope, batcher, key ? key.split(',') : []);
  }, [client, scope, batcher, key]);
  const subscribe = React.useCallback(
    (listener: () => void) => {
      batcher.listeners.add(listener);
      return () => batcher.listeners.delete(listener);
    },
    [batcher],
  );
  const snapshot = React.useRef<{ key: string; counts: Counts } | null>(null);
  return React.useSyncExternalStore(subscribe, () => {
    const counts: Counts = {};
    let complete = true;
    for (const id of assetIds) {
      const value = batcher.cache.get(id);
      if (value) counts[id] = value;
      else complete = false;
    }
    const signature = `${key}|${complete}|${Object.values(counts)
      .map((c) => `${c.roots}.${c.published}`)
      .join(',')}`;
    if (snapshot.current?.key !== signature) {
      snapshot.current = { key: signature, counts };
    }
    return snapshot.current.counts;
  });
}

/** Drops the cached counts of `assetIds` (all when omitted) for `client`. */
export function invalidateAssetUsageCounts(
  client: Pick<MediaClient, 'getAssetUsageCounts'>,
  assetIds?: string[],
): void {
  for (const batcher of batchers.get(client)?.values() ?? []) {
    if (assetIds) for (const id of assetIds) batcher.cache.delete(id);
    else batcher.cache.clear();
    for (const listener of batcher.listeners) listener();
  }
}

// --- parts ----------------------------------------------------------------------

type UsageContextValue = UseAssetUsagesState & {
  editorHref: EditorHrefAdapter;
};

const UsageContext = React.createContext<UsageContextValue | null>(null);
const UsageItemContext = React.createContext<MediaUsageItem | null>(null);

function useUsageContext(name: string): UsageContextValue {
  const value = React.useContext(UsageContext);
  if (!value)
    throw new Error(`${name} must be used within a Usage.Root component.`);
  return value;
}

type RenderProps<
  TElement extends React.ElementType,
  TState extends Record<string, unknown>,
> = Omit<UseRenderComponentProps<TElement, TState>, 'children'>;

export type UsageRootProps = RenderProps<'section', Record<string, never>> & {
  client: Pick<MediaClient, 'getAssetUsages'>;
  assetId: string;
  scope?: MediaUsageScope;
  missingAlt?: boolean;
  /** Roots per page. @default 20 */
  limit?: number;
  /** @default createEditorHrefAdapter() */
  editorHref?: EditorHrefAdapter;
  children?: React.ReactNode;
};

/**
 * A labelled region with the usages of `assetId`: provides the query state
 * (`useAssetUsages`) to the `Usage` parts. `data-scope` and `data-loading`
 * reflect the query.
 */
export function UsageRoot(props: UsageRootProps) {
  const {
    client,
    assetId,
    scope,
    missingAlt,
    limit,
    editorHref,
    render,
    children,
    ...rest
  } = props;
  const { messages } = useMediaMessages();
  const usages = useAssetUsages(client, { assetId, scope, missingAlt, limit });
  const adapter = React.useMemo(
    () => editorHref ?? createEditorHrefAdapter(),
    [editorHref],
  );
  const value = React.useMemo(
    () => ({ ...usages, editorHref: adapter }),
    [usages, adapter],
  );
  const element = useRender({
    defaultTagName: 'section',
    render,
    props: mergeProps<'section'>(
      {
        'aria-label': messages.usage.title,
        'aria-busy': usages.status === 'loading' || undefined,
        'data-scope': usages.scope,
        'data-loading': usages.status === 'loading' ? '' : undefined,
      },
      rest,
      { children },
    ),
  });
  return <UsageContext.Provider value={value}>{element}</UsageContext.Provider>;
}

export type UsageCountProps = RenderProps<'p', Record<string, never>>;

/** "Used on N pages", plus the roots outside the caller's scope. */
export function UsageCount(props: UsageCountProps) {
  const { render, ...rest } = props;
  const { total } = useUsageContext('Usage.Count');
  const { messages, format } = useMediaMessages();
  const text = total
    ? [
        messages.usage.count({ roots: total.roots }, format),
        total.hiddenRoots > 0
          ? messages.usage.hiddenRoots({ count: total.hiddenRoots }, format)
          : null,
      ]
        .filter(Boolean)
        .join(' ')
    : null;
  const element = useRender({
    defaultTagName: 'p',
    render,
    props: mergeProps<'p'>({ 'aria-live': 'polite' }, rest, { children: text }),
  });
  return text ? element : null;
}

export type UsageScopeSwitchProps = RenderProps<
  'select',
  Record<string, never>
>;

/** A `select` of the scopes `live`, `published` and `history`. */
export function UsageScopeSwitch(props: UsageScopeSwitchProps) {
  const { render, ...rest } = props;
  const { scope, setScope } = useUsageContext('Usage.ScopeSwitch');
  const { messages } = useMediaMessages();
  const element = useRender({
    defaultTagName: 'select',
    render,
    props: mergeProps<'select'>(
      {
        'aria-label': messages.usage.scopeLabel,
        value: scope,
        onChange: (event: React.ChangeEvent<HTMLSelectElement>) =>
          setScope(event.target.value as MediaUsageScope),
      },
      rest,
      {
        children: (['live', 'published', 'history'] as const).map((value) => (
          <option key={value} value={value}>
            {messages.usage.scope[value]}
          </option>
        )),
      },
    ),
  });
  return element;
}

export type UsageMissingAltFilterProps = RenderProps<
  'label',
  Record<string, never>
>;

/** A checkbox that shows only usages without alt text. */
export function UsageMissingAltFilter(props: UsageMissingAltFilterProps) {
  const { render, ...rest } = props;
  const { missingAlt, setMissingAlt } = useUsageContext(
    'Usage.MissingAltFilter',
  );
  const { messages } = useMediaMessages();
  const element = useRender({
    defaultTagName: 'label',
    render,
    props: mergeProps<'label'>(rest, {
      children: (
        <>
          <input
            type="checkbox"
            checked={missingAlt}
            onChange={(event) => setMissingAlt(event.target.checked)}
          />
          {messages.usage.missingAlt}
        </>
      ),
    }),
  });
  return element;
}

export type UsageListProps = RenderProps<'ul', Record<string, never>> & {
  children: (item: MediaUsageItem) => React.ReactNode;
};

/** The roots using the asset as a `ul`, in collection order. */
export function UsageList(props: UsageListProps) {
  const { render, children, ...rest } = props;
  const { items } = useUsageContext('Usage.List');
  const element = useRender({
    defaultTagName: 'ul',
    render,
    props: mergeProps<'ul'>(rest, {
      children: items.map((item) => (
        <UsageItemContext.Provider key={item.rootId} value={item}>
          {children(item)}
        </UsageItemContext.Provider>
      )),
    }),
  });
  return element;
}

export type UsageItemProps = RenderProps<'li', Record<string, never>> & {
  children?: React.ReactNode;
};

/** One root as an `li`, with `data-status` (`published`, `scheduled`, `draft`). */
export function UsageItem(props: UsageItemProps) {
  const { render, children, ...rest } = props;
  const item = React.useContext(UsageItemContext);
  if (!item) throw new Error('Usage.Item must be used within Usage.List.');
  return useRender({
    defaultTagName: 'li',
    render,
    props: mergeProps<'li'>({ 'data-status': item.status }, rest, {
      children,
    }),
  });
}

export type UsageOccurrenceProps = RenderProps<'a', Record<string, never>> & {
  occurrence: MediaUsageOccurrence;
  children?: React.ReactNode;
};

/**
 * A link into the editor at one occurrence (`EditorHrefAdapter`); an image
 * usage without alt text opens with the alt field focused. `data-alt-state`
 * carries the alt-text state.
 */
export function UsageOccurrence(props: UsageOccurrenceProps) {
  const { render, occurrence, children, ...rest } = props;
  const item = React.useContext(UsageItemContext);
  const { editorHref } = useUsageContext('Usage.Occurrence');
  if (!item)
    throw new Error('Usage.Occurrence must be used within Usage.List.');
  const href = editorHref.build({
    rootId: item.rootId,
    collection: item.collection,
    branchId: occurrence.branchId,
    blockId: occurrence.blockId,
    path: occurrence.path,
    focus: occurrence.altState === 'missing' ? 'alt' : undefined,
  });
  return useRender({
    defaultTagName: 'a',
    render,
    props: mergeProps<'a'>(
      { href, 'data-alt-state': occurrence.altState ?? undefined },
      rest,
      { children },
    ),
  });
}

export type UsageEmptyProps = RenderProps<'p', Record<string, never>> & {
  children?: React.ReactNode;
};

/** Renders once the query finished without any usage. */
export function UsageEmpty(props: UsageEmptyProps) {
  const { render, children, ...rest } = props;
  const { status, items } = useUsageContext('Usage.Empty');
  const { messages } = useMediaMessages();
  const element = useRender({
    defaultTagName: 'p',
    render,
    props: mergeProps<'p'>(rest, {
      children: children ?? messages.usage.empty,
    }),
  });
  return status === 'idle' && items.length === 0 ? element : null;
}

export type UsageLoadMoreProps = RenderProps<
  'button',
  Record<string, never>
> & {
  children?: React.ReactNode;
};

/** A button that loads the next page; absent when there is none. */
export function UsageLoadMore(props: UsageLoadMoreProps) {
  const { render, children, ...rest } = props;
  const { hasMore, loadMore, status } = useUsageContext('Usage.LoadMore');
  const { messages } = useMediaMessages();
  const element = useRender({
    defaultTagName: 'button',
    render,
    props: mergeProps<'button'>(
      {
        type: 'button',
        onClick: loadMore,
        disabled: status === 'loadingMore',
      },
      rest,
      { children: children ?? messages.usage.loadMore },
    ),
  });
  return hasMore ? element : null;
}

/** Reads the `Usage.Root` state in custom parts. */
export function useUsage(): UseAssetUsagesState {
  return useUsageContext('useUsage');
}
