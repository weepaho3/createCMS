import * as React from 'react';

import type { UseRenderComponentProps } from '../use-render';
import type { MediaStore } from './store';
import type {
  MediaAsset,
  MediaClient,
  MediaFolder as MediaFolderRecord,
  MediaLibraryState,
  MediaListStatus,
  MediaSelectionMode,
} from './types';

import { shallowEqual } from '../editor/binding';
import { mergeProps, useRender } from '../use-render';
import {
  MediaContext,
  MediaMessagesContext,
  MediaUploadsContext,
  useMediaContext,
  useMediaMessages,
} from './context';
import {
  createMediaFormatters,
  type MediaMessagesInput,
  mergeMediaMessages,
} from './messages';
import { UNKNOWN_FOLDER_NAME, createMediaStore } from './store';
import { useSelector } from './use-store';

// --- Media.Root -------------------------------------------------------------

export type MediaRootProps = {
  /** `cmsClient.media`. Read once at mount; remount with `key` to swap clients. */
  client: MediaClient;
  /** Folder to open first (`null` = root). Read once at mount. */
  defaultFolderId?: string | null;
  /** Read once at mount. */
  selection?: MediaSelectionMode;
  /** Assets per page, 1–100 (default 40). Read once at mount. */
  pageSize?: number;
  /** After every change of the selected ids. */
  onSelectionChange?: (ids: string[]) => void;
  /** `src` for `Media.Thumbnail` (default `asset.url`). */
  assetUrl?: (asset: MediaAsset) => string;
  /** Partial catalog merged over `defaultMediaMessages`. */
  messages?: MediaMessagesInput;
  /** BCP 47 locale for sizes, dates, numbers and plurals (default: runtime locale). */
  locale?: string;
  children?: React.ReactNode;
};

const defaultAssetUrl = (asset: MediaAsset): string => asset.url;

/**
 * Provider-only root: renders no DOM element, creates the media store once,
 * lists the starting folder on mount, calls `client.useUploadAssets()` and
 * re-lists when an upload batch settles. `onSelectionChange` and `assetUrl`
 * are read fresh on every call.
 */
export function MediaRoot({
  client,
  defaultFolderId = null,
  selection = 'none',
  pageSize = 40,
  onSelectionChange,
  assetUrl = defaultAssetUrl,
  messages,
  locale,
  children,
}: MediaRootProps) {
  const clientRef = React.useRef(client);
  const uploads = clientRef.current.useUploadAssets();

  const storeRef = React.useRef<MediaStore | null>(null);
  if (storeRef.current === null) {
    storeRef.current = createMediaStore({
      client: clientRef.current,
      defaultFolderId,
      pageSize,
      selection,
    });
  }
  const store = storeRef.current;

  const callbacksRef = React.useRef({ onSelectionChange, assetUrl });
  React.useLayoutEffect(() => {
    callbacksRef.current = { onSelectionChange, assetUrl };
  });

  React.useEffect(() => {
    void store.actions.load();
    return () => {
      store.actions.dispose();
    };
  }, [store]);

  React.useEffect(() => {
    let previous = store.getState().selected;
    return store.subscribe(() => {
      const next = store.getState().selected;
      if (shallowEqual(previous, next)) return;
      previous = next;
      callbacksRef.current.onSelectionChange?.(next);
    });
  }, [store]);

  const wasUploading = React.useRef(false);
  React.useEffect(() => {
    const settled = wasUploading.current && !uploads.isUploading;
    wasUploading.current = uploads.isUploading;
    if (!settled) return;
    const timer = setTimeout(() => {
      void store.actions.refresh();
    }, 0);
    return () => clearTimeout(timer);
  }, [uploads.isUploading, store]);

  const value = React.useMemo(
    () => ({
      store,
      selection: store.selection,
      assetUrl: (asset: MediaAsset) => callbacksRef.current.assetUrl(asset),
    }),
    [store],
  );

  const catalog = React.useMemo(
    () => ({
      messages: mergeMediaMessages(messages),
      format: createMediaFormatters(locale),
    }),
    [messages, locale],
  );

  return (
    <MediaContext.Provider value={value}>
      <MediaMessagesContext.Provider value={catalog}>
        <MediaUploadsContext.Provider value={uploads}>
          {children}
        </MediaUploadsContext.Provider>
      </MediaMessagesContext.Provider>
    </MediaContext.Provider>
  );
}

// --- Shared ------------------------------------------------------------------

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

type RenderProps<
  TElement extends React.ElementType,
  TState extends Record<string, unknown>,
> = Omit<UseRenderComponentProps<TElement, TState>, 'children'>;

// --- Media.Grid ---------------------------------------------------------------

type GridState = { status: MediaListStatus; empty: boolean };

type GridContextValue = {
  listbox: boolean;
  /** Id of the option with `tabIndex=0`; always one of the listed assets. */
  activeId: string | null;
  setActiveId: (id: string) => void;
};

const GridContext = React.createContext<GridContextValue | null>(null);

export type MediaGridProps = RenderProps<'ul', GridState> & {
  children: (asset: MediaAsset) => React.ReactNode;
};

const selectGrid = (state: MediaLibraryState) => ({
  status: state.status,
  assets: state.assets,
  firstSelected: state.selected[0] ?? null,
});

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  );
}

function moveFocus(container: HTMLElement, key: string): boolean {
  const options = Array.from(
    container.querySelectorAll<HTMLElement>('[role="option"]'),
  );
  if (options.length === 0) return false;
  const focused = document.activeElement;
  const current = options.findIndex((option) => option.contains(focused));
  let next: number;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      next = Math.min(current + 1, options.length - 1);
      break;
    case 'ArrowLeft':
    case 'ArrowUp':
      next = Math.max(current - 1, 0);
      break;
    case 'Home':
      next = 0;
      break;
    case 'End':
      next = options.length - 1;
      break;
    default:
      return false;
  }
  options[next]?.focus();
  return true;
}

/**
 * The asset list of the current folder. `role="listbox"` with roving focus
 * and arrow-key navigation when `Media.Root` has a selection mode, a plain
 * `role="list"` otherwise. `children` renders one asset.
 */
export function MediaGrid(props: MediaGridProps) {
  const { children, render, ...rest } = props;
  const { store, selection } = useMediaContext('Media.Grid');
  const { status, assets, firstSelected } = useSelector(store, selectGrid);
  const listbox = selection !== 'none';
  const [focusedId, setActiveId] = React.useState<string | null>(null);

  const hasAsset = (id: string | null): id is string =>
    id !== null && assets.some((asset) => asset.id === id);
  const activeId = hasAsset(focusedId)
    ? focusedId
    : hasAsset(firstSelected)
      ? firstSelected
      : (assets[0]?.id ?? null);
  const gridValue = React.useMemo<GridContextValue>(
    () => ({ listbox, activeId, setActiveId }),
    [listbox, activeId],
  );

  const handleKeyDown = (event: React.KeyboardEvent<HTMLUListElement>) => {
    if (!listbox || isEditable(event.target)) return;
    if (moveFocus(event.currentTarget, event.key)) event.preventDefault();
  };

  const element = useRender({
    defaultTagName: 'ul',
    render,
    state: { status, empty: assets.length === 0 } satisfies GridState,
    props: mergeProps<'ul'>(
      {
        role: listbox ? 'listbox' : 'list',
        'aria-multiselectable': listbox ? selection === 'multiple' : undefined,
        onKeyDown: listbox ? handleKeyDown : undefined,
      },
      rest,
      { children: assets.map((asset) => children(asset)) },
    ),
  });

  return (
    <GridContext.Provider value={gridValue}>{element}</GridContext.Provider>
  );
}

// --- Media.Item ---------------------------------------------------------------

type ItemState = { selected: boolean; assetStatus: string; type: MediaType };

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

export type MediaItemProps = UseRenderComponentProps<'li', ItemState> & {
  asset: MediaAsset;
};

/**
 * One asset of `Media.Grid`. Inside a listbox it is a `role="option"` that
 * selects on click, Enter and Space (single mode replaces, multiple mode
 * toggles) and takes part in the roving `tabIndex`.
 */
export function MediaItem(props: MediaItemProps) {
  const { asset, render, ...rest } = props;
  const { store, selection } = useMediaContext('Media.Item');
  const grid = React.useContext(GridContext);
  const selected = useSelector(
    store,
    React.useCallback(
      (state: MediaLibraryState) => state.selected.includes(asset.id),
      [asset.id],
    ),
    Object.is,
  );
  const listbox = grid?.listbox ?? false;

  const choose = () => {
    if (selection === 'multiple') store.actions.toggle(asset.id);
    else store.actions.select(asset.id);
  };

  const tabIndex = listbox ? (grid?.activeId === asset.id ? 0 : -1) : undefined;

  const itemValue = React.useMemo(
    () => ({ asset, selected }),
    [asset, selected],
  );

  const element = useRender({
    defaultTagName: 'li',
    render,
    state: {
      selected,
      assetStatus: asset.status,
      type: mediaTypeOf(asset.mimeType),
    } satisfies ItemState,
    props: mergeProps<'li'>(
      {
        role: listbox ? 'option' : undefined,
        'aria-selected': listbox ? selected : undefined,
        tabIndex,
        onClick: listbox ? choose : undefined,
        onKeyDown: listbox
          ? (event: React.KeyboardEvent<HTMLLIElement>) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                choose();
              }
            }
          : undefined,
        onFocus: listbox ? () => grid?.setActiveId(asset.id) : undefined,
      },
      rest,
    ),
  });

  return (
    <ItemContext.Provider value={itemValue}>{element}</ItemContext.Provider>
  );
}

// --- Media.Thumbnail ----------------------------------------------------------

type ThumbnailState = { loaded: boolean; error: boolean };

export type MediaThumbnailProps = UseRenderComponentProps<
  'img',
  ThumbnailState
> & {
  /** Rendered instead of the image for non-image assets. */
  fallback?: React.ReactNode;
};

/**
 * Lazy `img` of the enclosing `Media.Item`'s asset, `src` from the root's
 * `assetUrl`, `alt` defaulting to the slug. For non-image assets it renders
 * `fallback` (or nothing).
 */
export function MediaThumbnail(props: MediaThumbnailProps) {
  const { fallback = null, render, ...rest } = props;
  const { assetUrl } = useMediaContext('Media.Thumbnail');
  const { asset } = useMediaItemContext('Media.Thumbnail');
  const [loaded, setLoaded] = React.useState(false);
  const [error, setError] = React.useState(false);
  const isImage = mediaTypeOf(asset.mimeType) === 'image';

  const element = useRender({
    defaultTagName: 'img',
    render,
    state: { loaded, error } satisfies ThumbnailState,
    props: mergeProps<'img'>(
      {
        src: isImage ? assetUrl(asset) : undefined,
        alt: asset.slug,
        loading: 'lazy',
        decoding: 'async',
        onLoad: () => setLoaded(true),
        onError: () => setError(true),
      },
      rest,
    ),
  });

  if (!isImage) return <>{fallback}</>;
  return element;
}

// --- Media.Breadcrumbs / Media.Crumb --------------------------------------------

export type MediaBreadcrumbsProps = RenderProps<
  'nav',
  Record<string, never>
> & {
  /** Receives the folders below the root, current folder last. */
  children: (path: MediaFolderRecord[]) => React.ReactNode;
};

const selectPath = (state: MediaLibraryState) => ({
  folderId: state.folderId,
  path: state.path,
});

/**
 * `nav` labelled `folder.path`. When the current folder was opened by
 * id without a known ancestry (`defaultFolderId`), `path` holds one entry
 * for it named `…`.
 */
export function MediaBreadcrumbs(props: MediaBreadcrumbsProps) {
  const { children, render, ...rest } = props;
  const { store } = useMediaContext('Media.Breadcrumbs');
  const { messages } = useMediaMessages();
  const { folderId, path } = useSelector(store, selectPath);
  const crumbs =
    folderId === null || path[path.length - 1]?.id === folderId
      ? path
      : [...path, { id: folderId, name: UNKNOWN_FOLDER_NAME, parentId: null }];

  return useRender({
    defaultTagName: 'nav',
    render,
    props: mergeProps<'nav'>({ 'aria-label': messages.folder.path }, rest, {
      children: children(crumbs),
    }),
  });
}

type CrumbState = { current: boolean };

export type MediaCrumbProps = UseRenderComponentProps<'button', CrumbState> & {
  /** The folder this crumb opens; `null` is the root. */
  folder: MediaFolderRecord | null;
};

const selectFolderId = (state: MediaLibraryState) => state.folderId;

/** A `button` that navigates to `folder`; `aria-current="page"` on the current one. */
export function MediaCrumb(props: MediaCrumbProps) {
  const { folder, render, children, ...rest } = props;
  const { store } = useMediaContext('Media.Crumb');
  const { messages } = useMediaMessages();
  const folderId = useSelector(store, selectFolderId, Object.is);
  const current = (folder?.id ?? null) === folderId;

  return useRender({
    defaultTagName: 'button',
    render,
    state: { current } satisfies CrumbState,
    props: mergeProps<'button'>(
      {
        type: 'button',
        'aria-current': current ? 'page' : undefined,
        onClick: () => store.actions.navigate(folder),
        children: children ?? (folder ? folder.name : messages.folder.root),
      },
      rest,
    ),
  });
}

// --- Media.FolderList / Media.Folder ----------------------------------------------

type FolderListState = { empty: boolean };

export type MediaFolderListProps = RenderProps<'ul', FolderListState> & {
  children: (folder: MediaFolderRecord) => React.ReactNode;
};

const selectFolders = (state: MediaLibraryState) => state.folders;

/** The subfolders of the current folder as a `ul`. */
export function MediaFolderList(props: MediaFolderListProps) {
  const { children, render, ...rest } = props;
  const { store } = useMediaContext('Media.FolderList');
  const folders = useSelector(store, selectFolders, Object.is);

  return useRender({
    defaultTagName: 'ul',
    render,
    state: { empty: folders.length === 0 } satisfies FolderListState,
    props: mergeProps<'ul'>(rest, {
      children: folders.map((folder) => children(folder)),
    }),
  });
}

export type MediaFolderProps = UseRenderComponentProps<'button'> & {
  folder: MediaFolderRecord;
};

/** A `button` that opens `folder`; `children` defaults to its name. */
export function MediaFolder(props: MediaFolderProps) {
  const { folder, render, children, ...rest } = props;
  const { store } = useMediaContext('Media.Folder');

  return useRender({
    defaultTagName: 'button',
    render,
    props: mergeProps<'button'>(
      {
        type: 'button',
        onClick: () => store.actions.navigate(folder),
        children: children ?? folder.name,
      },
      rest,
    ),
  });
}

// --- Media.Search ---------------------------------------------------------------

export type MediaSearchProps = UseRenderComponentProps<'input'>;

const selectSearch = (state: MediaLibraryState) => state.search;

/** A controlled `input[type="search"]` bound to the store's debounced search. */
export function MediaSearch(props: MediaSearchProps) {
  const { render, ...rest } = props;
  const { store } = useMediaContext('Media.Search');
  const { messages } = useMediaMessages();
  const search = useSelector(store, selectSearch, Object.is);

  const element = useRender({
    defaultTagName: 'input',
    render,
    props: mergeProps<'input'>(
      {
        type: 'search',
        'aria-label': messages.search.label,
        value: search,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
          store.actions.setSearch(event.target.value),
      },
      rest,
    ),
  });
  return element;
}

// --- Media.LoadMore -------------------------------------------------------------

type LoadMoreState = { hasMore: boolean; loading: boolean };

export type MediaLoadMoreProps = UseRenderComponentProps<
  'button',
  LoadMoreState
>;

const selectLoadMore = (state: MediaLibraryState) => ({
  hasMore: state.nextCursor !== null,
  loading: state.status === 'loading' || state.status === 'loadingMore',
});

/** A `button` that appends the next page; `disabled` without a cursor or while loading. */
export function MediaLoadMore(props: MediaLoadMoreProps) {
  const { render, ...rest } = props;
  const { store } = useMediaContext('Media.LoadMore');
  const { hasMore, loading } = useSelector(store, selectLoadMore);

  return useRender({
    defaultTagName: 'button',
    render,
    state: { hasMore, loading } satisfies LoadMoreState,
    props: mergeProps<'button'>(
      {
        type: 'button',
        disabled: !hasMore || loading,
        onClick: () => void store.actions.loadMore(),
      },
      rest,
    ),
  });
}

// --- Media.Empty ----------------------------------------------------------------

export type MediaEmptyProps = UseRenderComponentProps<'div'>;

const selectEmpty = (state: MediaLibraryState) =>
  state.status === 'idle' &&
  state.assets.length === 0 &&
  state.folders.length === 0;

/** Rendered only when the listing is idle with neither folders nor assets. */
export function MediaEmpty(props: MediaEmptyProps) {
  const { render, ...rest } = props;
  const { store } = useMediaContext('Media.Empty');
  const empty = useSelector(store, selectEmpty, Object.is);
  const element = useRender({ defaultTagName: 'div', render, props: rest });
  return empty ? element : null;
}

// --- Media.Error / Media.MutationError ----------------------------------------------

export type MediaErrorProps = RenderProps<'div', Record<string, never>> & {
  children: (args: { error: unknown; retry: () => void }) => React.ReactNode;
};

const selectListError = (state: MediaLibraryState) => ({
  failed: state.status === 'error',
  error: state.error,
});

/** `div[role="alert"]` for a failed list request; `retry` reloads. */
export function MediaError(props: MediaErrorProps) {
  const { children, render, ...rest } = props;
  const { store } = useMediaContext('Media.Error');
  const { failed, error } = useSelector(store, selectListError);
  const element = useRender({
    defaultTagName: 'div',
    render,
    props: mergeProps<'div'>({ role: 'alert' }, rest, {
      children: failed
        ? children({ error, retry: () => void store.actions.load() })
        : null,
    }),
  });
  return failed ? element : null;
}

export type MediaMutationErrorProps = RenderProps<
  'div',
  Record<string, never>
> & {
  children: (args: { error: unknown; dismiss: () => void }) => React.ReactNode;
};

const selectMutationError = (state: MediaLibraryState) => ({
  failed: state.mutation.status === 'error',
  error: state.mutation.error,
});

/** `div[role="alert"]` for a rejected bulk mutation; `dismiss` resets it. */
export function MediaMutationError(props: MediaMutationErrorProps) {
  const { children, render, ...rest } = props;
  const { store } = useMediaContext('Media.MutationError');
  const { failed, error } = useSelector(store, selectMutationError);
  const element = useRender({
    defaultTagName: 'div',
    render,
    props: mergeProps<'div'>({ role: 'alert' }, rest, {
      children: failed
        ? children({ error, dismiss: store.actions.clearMutationError })
        : null,
    }),
  });
  return failed ? element : null;
}
