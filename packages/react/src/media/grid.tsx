import * as React from 'react';

import type { UseRenderComponentProps } from '../use-render';
import type {
  CollectionLayout,
  LayoutMode,
  LayoutOptions,
} from './core/layout';
import type { MediaStoreState } from './core/store';
import type { MediaAsset, MediaUploadEntry } from './core/types';

import { mergeProps, useRender } from '../use-render';
import { VISUALLY_HIDDEN } from './announcer';
import {
  type MediaUploadsStore,
  MediaUploadsStoreContext,
  useMediaContext,
  useMediaMessages,
} from './context';
import { writeAssetDrag } from './core/drag';
import { isTextInput } from './core/intake';
import { layout, navigate, navigationKeyOf, visibleRows } from './core/layout';
import {
  applyMarquee,
  autoScrollDelta,
  marqueeActivated,
  marqueeHits,
  marqueeModeOf,
  marqueeRect,
} from './core/marquee';
import { dragIds, isSelected } from './core/selection';
import { collectionAssets } from './core/store';
import { createLongPress, vibrateTick } from './core/touch';
import {
  createTypeAhead,
  isTypeAheadKey,
  matchTypeAhead,
} from './core/typeahead';
import { buildSrcSet, variantUrl } from './image';
import { useSelector } from './use-store';

// --- shared -------------------------------------------------------------------

export type MediaType = 'image' | 'video' | 'audio' | 'document' | 'other';

const DOCUMENT_TYPES =
  /^(application\/(pdf|msword|vnd\.(ms-|openxmlformats-|oasis\.)|rtf)|text\/)/;

/** Coarse group of a MIME type, surfaced as `data-type` on `Media.Item`. */
export function mediaTypeOf(mimeType: string): MediaType {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (DOCUMENT_TYPES.test(mimeType)) return 'document';
  return 'other';
}

/** The name shown and announced for an asset: its file name, else its slug. */
export function assetName(
  asset: Pick<MediaAsset, 'originalName' | 'slug'>,
): string {
  return asset.originalName || asset.slug;
}

type RenderProps<
  TElement extends React.ElementType,
  TState extends Record<string, unknown>,
> = Omit<UseRenderComponentProps<TElement, TState>, 'children'>;

const isApple = () =>
  typeof navigator !== 'undefined' &&
  /mac|iphone|ipad/i.test(navigator.platform ?? '');

/** Cmd on Apple platforms, Ctrl elsewhere. */
function toggleKey(event: { metaKey: boolean; ctrlKey: boolean }) {
  return isApple() ? event.metaKey : event.ctrlKey;
}

type Scroller = HTMLElement | Window;

function scrollParentOf(el: HTMLElement): Scroller {
  const view = el.ownerDocument.defaultView;
  if (!view) return window;
  let current: HTMLElement | null = el.parentElement;
  while (current) {
    const { overflowY } = view.getComputedStyle(current);
    if (overflowY === 'auto' || overflowY === 'scroll') return current;
    current = current.parentElement;
  }
  return view;
}

function isWindow(scroller: Scroller): scroller is Window {
  return !('getBoundingClientRect' in scroller);
}

/** The part of the collection in view: offset from the grid top and height. */
function viewportOf(grid: HTMLElement, scroller: Scroller) {
  const top = grid.getBoundingClientRect().top;
  if (isWindow(scroller)) {
    return { start: -top, height: scroller.innerHeight, clientTop: 0 };
  }
  const box = scroller.getBoundingClientRect();
  return {
    start: box.top - top,
    height: scroller.clientHeight,
    clientTop: box.top,
  };
}

function scrollBy(scroller: Scroller, dy: number) {
  if (isWindow(scroller)) scroller.scrollBy(0, dy);
  else scroller.scrollTop += dy;
}

// --- grid context ---------------------------------------------------------------

type GridContextValue = {
  layout: CollectionLayout;
  ids: string[];
  focusId: string | null;
  multiselectable: boolean;
  draggable: boolean;
  onAction?: (asset: MediaAsset) => void;
  cellStyle: (index: number) => React.CSSProperties;
  sizes: (index: number) => string;
  eagerIds: ReadonlySet<string>;
};

const GridContext = React.createContext<GridContextValue | null>(null);

type CellContextValue = { index: number; rowIndex: number; colIndex: number };
const CellContext = React.createContext<CellContextValue | null>(null);

// --- Media.Grid -----------------------------------------------------------------

type GridState = {
  status: MediaStoreState['collection']['status'];
  layout: LayoutMode;
  empty: boolean;
  virtualized: boolean;
};

type MarqueeState = {
  x: number;
  y: number;
  width: number;
  height: number;
} | null;
const MarqueeContext = React.createContext<MarqueeState>(null);

export type MediaGridProps = RenderProps<'div', GridState> &
  Omit<LayoutOptions, 'mode' | 'rtl'> & {
    /** Renders one asset (usually a `Media.Item`). */
    children: (asset: MediaAsset) => React.ReactNode;
    /** Renders an upload in flight (usually a `Media.UploadTile`); omit to hide them. */
    renderUpload?: (entry: MediaUploadEntry) => React.ReactNode;
    /** Enter or double click on an item. */
    onAction?: (asset: MediaAsset) => void;
    /** Mounts only the rows in view from this many items on. @default 200 */
    virtualizeFrom?: number;
    /** Rows mounted beyond the viewport. @default 2 */
    overscan?: number;
    /** Rubber-band selection on empty space (pointer only, multiple selection). @default true */
    marquee?: boolean;
    /** Items can be dragged to folders, the editor or the desktop. @default true */
    draggable?: boolean;
    /** Loads the next page when the end is a viewport away (opt-in). */
    autoLoad?: boolean;
  };

const selectGrid = (state: MediaStoreState) => ({
  collection: state.collection,
  selection: state.selection,
  layout: state.ui.layout,
  viewportWidth: state.ui.viewport.width,
  currentFolder: state.folders.currentId,
});

/** The geometry of the collection for the current viewport and layout mode. */
export function useGridLayout(
  options: Omit<LayoutOptions, 'mode'> = {},
): CollectionLayout {
  const { store } = useMediaContext('useGridLayout');
  const {
    collection,
    layout: mode,
    viewportWidth,
  } = useSelector(store, selectGrid);
  const assets = React.useMemo(
    () => collectionAssets({ collection } as MediaStoreState),
    [collection],
  );
  return React.useMemo(
    () => layout({ width: viewportWidth }, assets, { ...options, mode }),
    // Options are plain values; compare them by content.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [assets, mode, viewportWidth, JSON.stringify(options)],
  );
}

/**
 * The asset collection as an APG grid: `role="grid"` with `row` and
 * `gridcell` elements placed from the layout engine (cells are absolutely
 * positioned; the grid gets the content height). Arrow keys follow the
 * layout, Shift extends from the anchor, Cmd/Ctrl moves without selecting,
 * Space toggles, Cmd/Ctrl+A selects all loaded items, Escape clears, Enter
 * calls `onAction`, typing jumps by name. From `virtualizeFrom` items on
 * only the rows in view (plus `overscan`) are mounted; the focused item
 * always is.
 */
export function MediaGrid(props: MediaGridProps) {
  const {
    children,
    renderUpload,
    onAction,
    virtualizeFrom = 200,
    overscan = 2,
    marquee = true,
    draggable = true,
    autoLoad = false,
    gap,
    minCell,
    aspect,
    targetRowHeight,
    listRowHeight,
    render,
    ...rest
  } = props;
  const { store, announce } = useMediaContext('Media.Grid');
  const { messages, format } = useMediaMessages();
  const uploadsStore = React.useContext(MediaUploadsStoreContext);
  const {
    collection,
    selection,
    layout: mode,
    viewportWidth,
    currentFolder,
  } = useSelector(store, selectGrid);
  const ref = React.useRef<HTMLDivElement | null>(null);
  const scrollerRef = React.useRef<Scroller | null>(null);
  const [scroll, setScroll] = React.useState({ start: 0, height: 0 });
  const rtl = useIsRtl(ref);

  const assets = React.useMemo(
    () => collectionAssets({ collection } as MediaStoreState),
    [collection],
  );
  // Only the ids of uploads in view: a primitive snapshot, so progress
  // ticks (a new upload state each time) do not re-render the grid.
  const uploadKey = React.useSyncExternalStore(
    uploadsStore?.subscribe ?? noSubscription,
    () => (renderUpload ? uploadIdsInView(uploadsStore, currentFolder) : ''),
    () => '',
  );
  const uploadIds = React.useMemo(
    () => (uploadKey ? uploadKey.split('\n') : []),
    [uploadKey],
  );

  const items = React.useMemo(
    () => [
      ...uploadIds.map((id) => ({
        id: `upload:${id}`,
        width: null,
        height: null,
      })),
      ...assets,
    ],
    [uploadIds, assets],
  );
  const ids = React.useMemo(() => items.map((item) => item.id), [items]);
  const geometry = React.useMemo(
    () =>
      layout({ width: viewportWidth }, items, {
        mode,
        gap,
        minCell,
        aspect,
        targetRowHeight,
        listRowHeight,
        rtl,
      }),
    [
      items,
      mode,
      viewportWidth,
      gap,
      minCell,
      aspect,
      targetRowHeight,
      listRowHeight,
      rtl,
    ],
  );

  // Viewport size and scroll position.
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const scroller = scrollParentOf(el);
    scrollerRef.current = scroller;
    const measure = () => {
      const view = viewportOf(el, scroller);
      setScroll((current) =>
        current.start === view.start && current.height === view.height
          ? current
          : { start: view.start, height: view.height },
      );
    };
    const resize = () => {
      void store.dispatch({
        type: 'setViewport',
        width: el.clientWidth,
        height: viewportOf(el, scroller).height,
      });
      measure();
    };
    resize();
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
    observer?.observe(el);
    const target: Scroller = scroller;
    target.addEventListener('scroll', measure, { passive: true });
    return () => {
      observer?.disconnect();
      target.removeEventListener('scroll', measure);
    };
  }, [store]);

  const focusId =
    selection.focus !== null && ids.includes(selection.focus)
      ? selection.focus
      : (selection.selected.find((id) => ids.includes(id)) ?? ids[0] ?? null);
  const focusIndex = focusId === null ? -1 : ids.indexOf(focusId);

  const virtualized = items.length >= virtualizeFrom;
  const [firstRow, lastRow] = virtualized
    ? visibleRows(geometry, scroll.start, scroll.height || 800, overscan)
    : [0, geometry.rows.length - 1];
  const mountedRows = geometry.rows.filter(
    (row) =>
      (row.index >= firstRow && row.index <= lastRow) ||
      (focusIndex !== -1 && row.index === geometry.rowOf[focusIndex]),
  );

  // Rows starting in the first viewport load eagerly; the rest lazily.
  const eagerIds = React.useMemo(() => {
    const eager = new Set<string>();
    const fold = scroll.height || 800;
    for (const row of geometry.rows) {
      if (row.top > fold) break;
      for (const i of row.items) eager.add(ids[i]);
    }
    return eager;
  }, [geometry, ids, scroll.height]);

  // Auto-load (opt-in): a viewport before the end.
  React.useEffect(() => {
    if (!autoLoad || collection.cursor === null || collection.status !== 'idle')
      return;
    if (
      geometry.totalHeight - (scroll.start + scroll.height) <
      (scroll.height || 800)
    ) {
      void store.dispatch({ type: 'loadMore' }).then(() => {
        const { ids: loaded, total } = store.getState().collection;
        announce(
          messages.grid.loadedMore(
            {
              count: loaded.length - collection.ids.length,
              loaded: loaded.length,
              total,
            },
            format,
          ),
        );
      });
    }
  });

  // Keyboard focus follows `selection.focus`.
  const pendingFocus = React.useRef(false);
  React.useEffect(() => {
    const el = ref.current;
    if (!el || focusId === null) return;
    const active = el.ownerDocument.activeElement;
    const lost = active === el.ownerDocument.body || active === null;
    if (!pendingFocus.current && !(lost && el.dataset.hadFocus === 'true'))
      return;
    pendingFocus.current = false;
    const cell = el.querySelector<HTMLElement>(
      `[data-cell-id="${CSS.escape(focusId)}"]`,
    );
    cell?.focus({ preventScroll: true });
    const rect = geometry.rects[focusIndex];
    const scroller = scrollerRef.current;
    if (rect && scroller) {
      const view = viewportOf(el, scroller);
      if (rect.y < view.start) scrollBy(scroller, rect.y - view.start);
      else if (rect.y + rect.height > view.start + view.height) {
        scrollBy(scroller, rect.y + rect.height - view.start - view.height);
      }
    }
  });

  const typeAhead = React.useRef(createTypeAhead());
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (isTextInput(event.target) || ids.length === 0) return;
    const state = store.getState();
    const from = focusIndex === -1 ? 0 : focusIndex;
    const toggle = toggleKey(event);
    const key = navigationKeyOf(event.key, toggle);
    if (key) {
      event.preventDefault();
      const next =
        ids[
          navigate(geometry, from, key, { rtl, viewportHeight: scroll.height })
        ];
      pendingFocus.current = true;
      if (next.startsWith('upload:')) {
        void store.dispatch({ type: 'focus', id: next });
      } else if (event.shiftKey && state.selection.mode === 'multiple') {
        void store.dispatch({ type: 'extendSelection', id: next });
      } else {
        void store.dispatch({ type: 'focus', id: next });
      }
      return;
    }
    const id = ids[from];
    const asset = id ? state.collection.byId[id] : undefined;
    if (event.key === ' ' && !event.altKey) {
      event.preventDefault();
      if (asset) void store.dispatch({ type: 'toggleSelection', id: asset.id });
    } else if (event.key === ' ' && event.altKey) {
      event.preventDefault();
      if (asset) void store.dispatch({ type: 'openPreview', id: asset.id });
    } else if (event.key === 'Enter') {
      if (asset && onAction) {
        event.preventDefault();
        onAction(asset);
      }
    } else if ((event.key === 'a' || event.key === 'A') && toggle) {
      event.preventDefault();
      void store.dispatch({ type: 'selectAll' });
    } else if (event.key === 'Escape') {
      if (state.selection.selected.length > 0 || state.selection.allMatching) {
        event.preventDefault();
        void store.dispatch({ type: 'clearSelection' });
      }
    } else if (
      isTypeAheadKey(event.key, {
        ctrl: event.ctrlKey,
        meta: event.metaKey,
        alt: event.altKey,
      })
    ) {
      const search = typeAhead.current.push(event.key, event.timeStamp);
      const labels = ids.map((itemId) => {
        const item = state.collection.byId[itemId];
        return item ? assetName(item) : '';
      });
      const match = matchTypeAhead(labels, from, search);
      if (match !== -1) {
        pendingFocus.current = true;
        void store.dispatch({ type: 'focus', id: ids[match] });
      }
    }
  };

  const marqueeState = useMarqueeGesture({
    enabled: marquee && selection.mode === 'multiple',
    gridRef: ref,
    scrollerRef,
    geometry,
    ids,
  });

  const cellStyle = React.useCallback(
    (index: number): React.CSSProperties => {
      const rect = geometry.rects[index];
      const row = geometry.rows[geometry.rowOf[index]];
      return {
        position: 'absolute',
        left: rect.x,
        top: rect.y - row.top,
        width: rect.width,
        height: rect.height,
      };
    },
    [geometry],
  );
  const sizes = React.useCallback(
    (index: number) =>
      `${Math.max(1, Math.round(geometry.rects[index]?.width ?? 320))}px`,
    [geometry],
  );

  const value = React.useMemo<GridContextValue>(
    () => ({
      layout: geometry,
      ids,
      focusId,
      multiselectable: selection.mode === 'multiple',
      draggable,
      onAction,
      cellStyle,
      sizes,
      eagerIds,
    }),
    [
      geometry,
      ids,
      focusId,
      selection.mode,
      draggable,
      onAction,
      cellStyle,
      sizes,
      eagerIds,
    ],
  );

  const status = collection.status;
  const rowCount = collection.cursor === null ? geometry.rows.length : -1;

  const element = useRender({
    defaultTagName: 'div',
    render,
    state: {
      status,
      layout: mode,
      empty: items.length === 0,
      virtualized,
    } satisfies GridState,
    props: mergeProps<'div'>(
      {
        ref,
        role: 'grid',
        'aria-label': messages.grid.label,
        'aria-multiselectable':
          selection.mode === 'multiple' ? true : undefined,
        'aria-rowcount': rowCount,
        'aria-colcount': geometry.columns,
        'aria-busy':
          status === 'loading' ||
          status === 'refreshing' ||
          status === 'appending'
            ? true
            : undefined,
        onKeyDown: handleKeyDown,
        onFocus: () => {
          if (ref.current) ref.current.dataset.hadFocus = 'true';
        },
        onBlur: (event: React.FocusEvent<HTMLDivElement>) => {
          if (
            ref.current &&
            !ref.current.contains(event.relatedTarget as Node | null) &&
            event.relatedTarget !== null
          ) {
            ref.current.dataset.hadFocus = 'false';
          }
        },
        style: { position: 'relative', height: geometry.totalHeight },
      },
      rest,
      {
        children: mountedRows.map((row) => (
          <div
            key={row.index}
            role="row"
            aria-rowindex={row.index + 1}
            style={{
              position: 'absolute',
              top: row.top,
              left: 0,
              width: '100%',
              height: row.height,
            }}
          >
            {row.items.map((index, col) => {
              const id = ids[index];
              const uploadId = id.startsWith('upload:')
                ? id.slice('upload:'.length)
                : null;
              const asset = uploadId ? null : collection.byId[id];
              return (
                <CellContext.Provider
                  key={id}
                  value={{ index, rowIndex: row.index, colIndex: col }}
                >
                  {uploadId && renderUpload ? (
                    <UploadSlot
                      id={uploadId}
                      store={uploadsStore}
                      render={renderUpload}
                    />
                  ) : asset ? (
                    children(asset)
                  ) : null}
                </CellContext.Provider>
              );
            })}
          </div>
        )),
      },
    ),
  });

  return (
    <GridContext.Provider value={value}>
      <MarqueeContext.Provider value={marqueeState}>
        {element}
      </MarqueeContext.Provider>
    </GridContext.Provider>
  );
}

/** The writing direction of the grid (`dir` inherited from the document). */
function useIsRtl(ref: React.RefObject<HTMLElement | null>): boolean {
  const [rtl, setRtl] = React.useState(false);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const dir = el.closest('[dir]')?.getAttribute('dir');
    setRtl(dir === 'rtl');
  }, [ref]);
  return rtl;
}

// --- marquee ----------------------------------------------------------------------

function useMarqueeGesture(options: {
  enabled: boolean;
  gridRef: React.RefObject<HTMLDivElement | null>;
  scrollerRef: React.RefObject<Scroller | null>;
  geometry: CollectionLayout;
  ids: string[];
}): MarqueeState {
  const { store, announce } = useMediaContext('Media.Grid');
  const { messages, format } = useMediaMessages();
  const [rect, setRect] = React.useState<MarqueeState>(null);
  const latest = React.useRef(options);
  latest.current = options;

  React.useEffect(() => {
    const grid = options.gridRef.current;
    if (!grid || !options.enabled) return;
    let start: { x: number; y: number } | null = null;
    let pointer = { x: 0, y: 0 };
    let active = false;
    let mode = marqueeModeOf({});
    let base = store.getState().selection;
    let frame = 0;
    let bandSince = 0;

    const toContent = (clientX: number, clientY: number) => {
      const box = grid.getBoundingClientRect();
      return { x: clientX - box.left, y: clientY - box.top };
    };

    const update = () => {
      if (!start) return;
      const current = toContent(pointer.x, pointer.y);
      if (!active && !marqueeActivated(start, current)) return;
      active = true;
      const band = marqueeRect(start, current);
      setRect(band);
      const { geometry, ids } = latest.current;
      const hits = marqueeHits(geometry, ids, band).filter(
        (id) => !id.startsWith('upload:'),
      );
      void store.dispatch({
        type: 'setSelection',
        selection: applyMarquee(base, hits, mode),
      });
    };

    const tick = (time: number) => {
      const scroller = latest.current.scrollerRef.current;
      if (!start || !scroller) return;
      const box = isWindow(scroller)
        ? { top: 0, height: scroller.innerHeight }
        : {
            top: scroller.getBoundingClientRect().top,
            height: scroller.clientHeight,
          };
      const delta = autoScrollDelta(
        pointer.y,
        box.top,
        box.height,
        bandSince ? time - bandSince : 0,
      );
      if (delta !== 0) {
        if (!bandSince) bandSince = time;
        scrollBy(scroller, delta);
        update();
      } else {
        bandSince = 0;
      }
      frame = requestAnimationFrame(tick);
    };

    const onMove = (event: PointerEvent) => {
      pointer = { x: event.clientX, y: event.clientY };
      update();
    };
    const onUp = () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (active) {
        const count = store.getState().selection.selected.length;
        announce(messages.selection.count({ count }, format));
      }
      start = null;
      active = false;
      setRect(null);
    };
    const onDown = (event: PointerEvent) => {
      // Empty space only: a press on an item selects or drags it instead.
      if (event.button !== 0 || event.pointerType === 'touch') return;
      if ((event.target as Element).closest('[role="gridcell"]')) return;
      start = toContent(event.clientX, event.clientY);
      pointer = { x: event.clientX, y: event.clientY };
      base = store.getState().selection;
      mode = marqueeModeOf({ range: event.shiftKey, toggle: toggleKey(event) });
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
      frame = requestAnimationFrame(tick);
    };
    grid.addEventListener('pointerdown', onDown);
    return () => {
      grid.removeEventListener('pointerdown', onDown);
      onUp();
    };
  }, [options.enabled, options.gridRef, store, announce, messages, format]);

  return rect;
}

export type MediaMarqueeProps = RenderProps<'div', Record<string, never>>;

/** The rubber band while a marquee runs (absolutely positioned in the grid); nothing otherwise. */
export function MediaMarquee(props: MediaMarqueeProps) {
  const { render, ...rest } = props;
  const rect = React.useContext(MarqueeContext);
  const element = useRender({
    defaultTagName: 'div',
    render,
    props: mergeProps<'div'>(
      {
        'aria-hidden': true,
        'data-marquee': '',
        style: rect
          ? {
              position: 'absolute',
              left: rect.x,
              top: rect.y,
              width: rect.width,
              height: rect.height,
              pointerEvents: 'none',
            }
          : undefined,
      },
      rest,
    ),
  });
  return rect ? element : null;
}

// --- Media.Item -----------------------------------------------------------------

type ItemState = {
  selected: boolean;
  focused: boolean;
  assetStatus: string;
  type: MediaType;
  provenance: string;
  /** `pending` while the malware scan runs, `failed` after it found malware. */
  processingState: 'pending' | 'ready' | 'failed';
};

export type ItemContextValue = { asset: MediaAsset; selected: boolean };

const ItemContext = React.createContext<ItemContextValue | null>(null);

/** The asset of the enclosing `Media.Item`; throws outside one. */
export function useMediaItemContext(componentName: string): ItemContextValue {
  const value = React.useContext(ItemContext);
  if (value === null) {
    throw new Error(
      `${componentName} must be used within a Media.Item component.`,
    );
  }
  return value;
}

export type MediaItemProps = UseRenderComponentProps<'div', ItemState> & {
  asset: MediaAsset;
};

let dragPreviewCount = 0;

/**
 * One asset of `Media.Grid` as a `gridcell`: named by its file name, with
 * its type, dimensions and size as description. A click replaces the
 * selection, Cmd/Ctrl-click toggles, Shift-click selects the range from
 * the anchor; a double click calls the grid's `onAction`. Dragging carries
 * the selection (or this item alone when it is not selected) as
 * `application/x-createcms-asset+json`, with `text/uri-list` and a
 * download for public assets.
 */
export function MediaItem(props: MediaItemProps) {
  const { asset, render, children, ...rest } = props;
  const { store } = useMediaContext('Media.Item');
  const { messages, format } = useMediaMessages();
  const grid = React.useContext(GridContext);
  const cell = React.useContext(CellContext);
  const selected = useSelector(
    store,
    React.useCallback(
      (state: MediaStoreState) => isSelected(state.selection, asset.id),
      [asset.id],
    ),
    Object.is,
  );
  const descriptionId = `${React.useId()}-facts`;
  const focused = grid?.focusId === asset.id;
  const name = assetName(asset);

  // A touch long press toggles the item into the selection; the click that
  // follows the release must not replace that selection again.
  const [longPress] = React.useState(() =>
    createLongPress(() => {
      vibrateTick();
      void store.dispatch({
        type: 'select',
        id: asset.id,
        modifiers: { range: false, toggle: true },
      });
    }),
  );
  React.useEffect(() => () => longPress.cancel(), [longPress]);

  const onClick = (event: React.MouseEvent) => {
    if (longPress.consumeClick()) return;
    void store.dispatch({
      type: 'select',
      id: asset.id,
      modifiers: { range: event.shiftKey, toggle: toggleKey(event) },
    });
  };

  const onDragStart = (event: React.DragEvent) => {
    const state = store.getState();
    const ids = dragIds(state.selection, asset.id);
    const dragged = ids.flatMap((id) =>
      state.collection.byId[id] ? [state.collection.byId[id]] : [],
    );
    writeAssetDrag(
      event.dataTransfer,
      dragged.map((item) => ({
        id: item.id,
        mimeType: item.mimeType,
        name: assetName(item),
        url: item.url ? item.url : null,
      })),
    );
    if (dragged.length > 1 && typeof document !== 'undefined') {
      const preview = document.createElement('div');
      preview.textContent = messages.move.dragCount(
        { count: dragged.length },
        format,
      );
      preview.setAttribute('data-drag-preview', String(++dragPreviewCount));
      Object.assign(preview.style, {
        position: 'fixed',
        top: '-1000px',
        left: '-1000px',
        padding: '4px 8px',
        maxWidth: '280px',
      });
      document.body.append(preview);
      event.dataTransfer.setDragImage(preview, 16, 16);
      setTimeout(() => preview.remove(), 0);
    }
  };

  const itemValue = React.useMemo(
    () => ({ asset, selected }),
    [asset, selected],
  );

  const element = useRender({
    defaultTagName: 'div',
    render,
    state: {
      selected,
      focused,
      assetStatus: asset.status,
      type: mediaTypeOf(asset.mimeType),
      provenance: asset.provenance ?? 'unknown',
      processingState: asset.processingState ?? 'ready',
    } satisfies ItemState,
    props: mergeProps<'div'>(
      {
        role: 'gridcell',
        'aria-selected': selected,
        'aria-colindex': cell ? cell.colIndex + 1 : undefined,
        'aria-label': name,
        'aria-describedby': descriptionId,
        tabIndex: focused ? 0 : -1,
        'data-cell-id': asset.id,
        style: cell && grid ? grid.cellStyle(cell.index) : undefined,
        draggable: grid?.draggable ?? false,
        onDragStart: grid?.draggable ? onDragStart : undefined,
        onClick,
        onPointerDown: (event: React.PointerEvent) =>
          longPress.down(event.clientX, event.clientY, event.pointerType),
        onPointerMove: (event: React.PointerEvent) =>
          longPress.move(event.clientX, event.clientY),
        onPointerUp: () => longPress.up(),
        onPointerCancel: () => longPress.cancel(),
        onContextMenu: (event: React.MouseEvent) => {
          // Touch browsers open the context menu on the same long press.
          if (longPress.fired()) event.preventDefault();
        },
        onDoubleClick: () => grid?.onAction?.(asset),
        onFocus: () => {
          if (store.getState().selection.focus !== asset.id) {
            void store.dispatch({ type: 'focus', id: asset.id });
          }
        },
      },
      rest,
      {
        children: (
          <>
            {children}
            <span id={descriptionId} style={VISUALLY_HIDDEN}>
              {messages.grid.describe(
                {
                  type: messages.type[mediaTypeOf(asset.mimeType)],
                  width: asset.width ?? null,
                  height: asset.height ?? null,
                  size: asset.size,
                },
                format,
              )}
            </span>
          </>
        ),
      },
    ),
  });

  return (
    <ItemContext.Provider value={itemValue}>{element}</ItemContext.Provider>
  );
}

// --- uploads in the grid ---------------------------------------------------------

const UploadEntryContext = React.createContext<MediaUploadEntry | null>(null);

type UploadTileState = { status: MediaUploadEntry['status'] };

export type MediaUploadTileProps = UseRenderComponentProps<
  'div',
  UploadTileState
>;

const noSubscription = () => () => {};

/** The ids of create uploads in flight in `folderId`, newline separated. */
function uploadIdsInView(
  store: MediaUploadsStore | null,
  folderId: string | null,
): string {
  return (store?.get()?.files ?? [])
    .filter(
      (entry) =>
        entry.kind === 'create' &&
        entry.parentId === undefined &&
        entry.status !== 'success' &&
        entry.status !== 'aborted' &&
        (entry.folderId ?? null) === folderId,
    )
    .map((entry) => entry.id)
    .join('\n');
}

/** One upload tile; subscribes to its own entry so only it follows progress. */
function UploadSlot(props: {
  id: string;
  store: MediaUploadsStore | null;
  render: (entry: MediaUploadEntry) => React.ReactNode;
}) {
  const { id, store, render } = props;
  const entry = React.useSyncExternalStore(
    store?.subscribe ?? noSubscription,
    () => store?.get()?.files.find((file) => file.id === id) ?? null,
    () => null,
  );
  if (!entry) return null;
  return (
    <UploadEntryContext.Provider value={entry}>
      {render(entry)}
    </UploadEntryContext.Provider>
  );
}

/**
 * A `gridcell` for an upload in flight (inside `Media.Grid`'s
 * `renderUpload`), with `data-status` and a name that includes the
 * progress. It is replaced by the asset once the upload finished.
 */
export function MediaUploadTile(props: MediaUploadTileProps) {
  const { render, ...rest } = props;
  const entry = React.useContext(UploadEntryContext);
  const grid = React.useContext(GridContext);
  const cell = React.useContext(CellContext);
  const { messages, format } = useMediaMessages();
  if (!entry)
    throw new Error(
      'Media.UploadTile must be rendered by Media.Grid renderUpload.',
    );
  const id = `upload:${entry.id}`;
  return useRender({
    defaultTagName: 'div',
    render,
    state: { status: entry.status } satisfies UploadTileState,
    props: mergeProps<'div'>(
      {
        role: 'gridcell',
        'aria-colindex': cell ? cell.colIndex + 1 : undefined,
        'aria-label': messages.grid.uploading(
          { name: entry.name, percent: Math.round(entry.progress * 100) },
          format,
        ),
        tabIndex: grid?.focusId === id ? 0 : -1,
        'data-cell-id': id,
        style: cell && grid ? grid.cellStyle(cell.index) : undefined,
      },
      rest,
    ),
  });
}

export type MediaUploadPreviewProps = UseRenderComponentProps<
  'img',
  { loaded: boolean }
>;

/**
 * A local preview of the uploading image (`URL.createObjectURL`), revoked
 * once it loaded or unmounted. Renders nothing for other types.
 */
export function MediaUploadPreview(props: MediaUploadPreviewProps) {
  const { render, ...rest } = props;
  const entry = React.useContext(UploadEntryContext);
  const [url, setUrl] = React.useState<string | null>(null);
  const [loaded, setLoaded] = React.useState(false);
  const file = entry?.file;
  React.useEffect(() => {
    if (
      !file ||
      !file.type.startsWith('image/') ||
      typeof URL.createObjectURL !== 'function'
    ) {
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  const element = useRender({
    defaultTagName: 'img',
    render,
    state: { loaded },
    props: mergeProps<'img'>(
      {
        src: url ?? undefined,
        alt: '',
        decoding: 'async',
        onLoad: () => {
          setLoaded(true);
          if (url) URL.revokeObjectURL(url);
        },
      },
      rest,
    ),
  });
  return url ? element : null;
}

// --- Media.Thumbnail --------------------------------------------------------------

type ThumbnailState = { loaded: boolean; error: boolean; placeholder: boolean };

export type MediaThumbnailProps = UseRenderComponentProps<
  'img',
  ThumbnailState
> & {
  /** Rendered instead of the image for non-image assets. */
  fallback?: React.ReactNode;
  /** Turns `metadata.placeholder.thumbhash` into a data URL (`placeholderDataUrl` from `@createcms/core`). */
  placeholderDataUrl?: (thumbhash: string) => string;
  /** Rendition width to load. @default 320 */
  width?: number;
};

/**
 * The image of the enclosing `Media.Item`: the smallest WebP rendition of
 * at least `width` (320 by default) through the asset endpoint, a `srcset`
 * of the existing renditions only and `sizes` from the grid cell; without
 * renditions the root's `assetUrl` (the gate path, never a private bucket
 * URL). Dimensions come from the asset; the first visible row loads
 * eagerly, the rest lazily. The ThumbHash (or the dominant colour) is the
 * background until the image loaded (`data-loaded`). `alt` is empty: the
 * grid cell carries the name.
 */
export function MediaThumbnail(props: MediaThumbnailProps) {
  const {
    fallback = null,
    placeholderDataUrl,
    width = 320,
    render,
    ...rest
  } = props;
  const { assetUrl } = useMediaContext('Media.Thumbnail');
  const { asset } = useMediaItemContext('Media.Thumbnail');
  const grid = React.useContext(GridContext);
  const cell = React.useContext(CellContext);
  const [loaded, setLoaded] = React.useState(false);
  const [error, setError] = React.useState(false);
  const isImage = mediaTypeOf(asset.mimeType) === 'image';

  const metadata = (asset.metadata ?? {}) as {
    placeholder?: { thumbhash?: string };
    dominantColor?: string;
  };
  const thumbhash = metadata.placeholder?.thumbhash;
  const placeholder =
    thumbhash && placeholderDataUrl ? placeholderDataUrl(thumbhash) : null;
  const background: React.CSSProperties = loaded
    ? {}
    : placeholder
      ? { backgroundImage: `url("${placeholder}")`, backgroundSize: 'cover' }
      : metadata.dominantColor
        ? { backgroundColor: metadata.dominantColor }
        : {};
  const srcSet = buildSrcSet(asset, 'webp');
  const src =
    variantUrl(asset, { w: width, format: 'webp' }) ?? assetUrl(asset);
  const eager = grid?.eagerIds.has(asset.id) ?? false;

  const element = useRender({
    defaultTagName: 'img',
    render,
    state: {
      loaded,
      error,
      placeholder: !loaded && (!!placeholder || !!metadata.dominantColor),
    } satisfies ThumbnailState,
    props: mergeProps<'img'>(
      {
        src,
        srcSet: srcSet || undefined,
        sizes: srcSet && cell && grid ? grid.sizes(cell.index) : undefined,
        width: asset.width ?? undefined,
        height: asset.height ?? undefined,
        alt: '',
        loading: eager ? 'eager' : 'lazy',
        decoding: 'async',
        style: background,
        onLoad: () => setLoaded(true),
        onError: () => setError(true),
      },
      rest,
    ),
  });

  if (!isImage) return <>{fallback}</>;
  return element;
}
