import * as React from 'react';

import type { Announce } from './core/announcer';
import type { FilterUrlAdapter } from './core/filter';
import type { LayoutMode } from './core/layout';
import type { SelectionMode } from './core/selection';
import type { MediaStore } from './core/store';
import type { MediaAsset, MediaClient, MediaUploadEntry } from './core/types';

import { useLiveRegions } from './announcer';
import {
  MediaContext,
  MediaMessagesContext,
  MediaUploadsContext,
} from './context';
import {
  batchPoliteness,
  createDebouncedAnnouncer,
  createProgressAnnouncer,
} from './core/announcer';
import { registerBuiltInBulkActions } from './core/bulk';
import { errorCodeOf } from './core/errors';
import { createMediaStore } from './core/store';
import {
  createMediaFormatters,
  type MediaMessagesInput,
  mediaErrorMessage,
  mergeMediaMessages,
} from './messages';

export type MediaRootProps = {
  /** `cmsClient.media`. Read once at mount; remount with `key` to swap clients. */
  client: MediaClient;
  /** A store created outside (shared with other surfaces); the root then neither creates nor disposes one. */
  store?: MediaStore;
  /** Folder to open first (`null` = root level). Read once at mount. */
  defaultFolderId?: string | null;
  /** Mirrors the filter in the URL (`createHistoryFilterAdapter()`); read once at mount. */
  filterUrl?: FilterUrlAdapter;
  /** Read once at mount. */
  selection?: SelectionMode;
  /** Keep selected ids a filter hides (and count them). Read once at mount. */
  keepHiddenSelection?: boolean;
  /** Assets per page, 1-100 (default 40). Read once at mount. */
  pageSize?: number;
  /** Initial layout mode (`grid`, `justified`, `masonry`, `list`). */
  layout?: LayoutMode;
  /** `localStorage` key of the expanded folders; `false` keeps them in memory only. */
  expandedStorageKey?: string | false;
  /** After every change of the selected ids. */
  onSelectionChange?: (ids: string[]) => void;
  /** Fallback `src` of `Media.Thumbnail` without renditions (default `asset.deliveryUrl`). */
  assetUrl?: (asset: MediaAsset) => string;
  /** Speaks through another live region (the editor's announcer) instead of the root's own. */
  announce?: Announce;
  /** Partial catalog merged over `defaultMediaMessages`. */
  messages?: MediaMessagesInput;
  /** BCP 47 locale for sizes, dates, numbers and plurals (default: runtime locale). */
  locale?: string;
  children?: React.ReactNode;
};

const defaultAssetUrl = (asset: MediaAsset): string => asset.deliveryUrl;

function browserStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** The URL filter; without a folder in the URL, `defaultFolderId` is opened. */
function initialFilter(
  adapter: FilterUrlAdapter,
  defaultFolderId: string | null,
) {
  const filter = adapter.read();
  return filter.folderId === undefined && !filter.unfiled
    ? { ...filter, folderId: defaultFolderId }
    : filter;
}

function isFinal(entry: MediaUploadEntry) {
  return (
    entry.status === 'success' ||
    entry.status === 'error' ||
    entry.status === 'aborted'
  );
}

/**
 * Provider-only root: renders the two live regions and no other DOM. It
 * creates the media store once (or uses `store`), opens the start folder,
 * hands the client's upload function to the store, inserts finished
 * uploads into the collection without a reload, keeps the URL in sync with
 * `filterUrl` and announces upload progress, selection changes and results.
 */
export function MediaRoot({
  client,
  store: externalStore,
  defaultFolderId = null,
  filterUrl,
  selection = 'none',
  keepHiddenSelection,
  pageSize = 40,
  layout,
  expandedStorageKey = 'createcms.media.expanded',
  onSelectionChange,
  assetUrl = defaultAssetUrl,
  announce: externalAnnounce,
  messages,
  locale,
  children,
}: MediaRootProps) {
  const clientRef = React.useRef(client);
  const uploads = clientRef.current.useUploadAssets();
  const live = useLiveRegions();
  const announce = externalAnnounce ?? live.announce;

  const catalog = React.useMemo(
    () => ({
      messages: mergeMediaMessages(messages),
      format: createMediaFormatters(locale),
    }),
    [messages, locale],
  );
  const catalogRef = React.useRef(catalog);
  catalogRef.current = catalog;

  const storeRef = React.useRef<MediaStore | null>(externalStore ?? null);
  if (storeRef.current === null) {
    storeRef.current = createMediaStore({
      client: clientRef.current,
      defaultFolderId,
      pageSize,
      selection,
      keepHiddenSelection,
      layout,
      expandedStorage:
        expandedStorageKey === false
          ? undefined
          : { storage: browserStorage(), key: expandedStorageKey },
      onFilterChange: filterUrl
        ? (filter, mode) => filterUrl.write(filter, mode)
        : undefined,
    });
  }
  const store = storeRef.current;
  const ownsStore = externalStore === undefined;
  const defaultFolderIdRef = React.useRef(defaultFolderId);

  const callbacksRef = React.useRef({ onSelectionChange, assetUrl, announce });
  React.useLayoutEffect(() => {
    callbacksRef.current = { onSelectionChange, assetUrl, announce };
  });

  store.setUploader(uploads.upload);

  // The URL is read after mount: the server render cannot see it, and
  // reading it during render would not match the hydrated markup.
  const filterUrlRef = React.useRef(filterUrl);
  React.useEffect(() => {
    const unregister = registerBuiltInBulkActions(store);
    const adapter = filterUrlRef.current;
    if (ownsStore) {
      void store.dispatch(
        adapter
          ? {
              type: 'init',
              filter: initialFilter(adapter, defaultFolderIdRef.current),
            }
          : { type: 'init' },
      );
    }
    return () => {
      unregister();
      if (ownsStore) store.dispose();
    };
  }, [store, ownsStore]);

  // Back and forward restore the filter of that history entry.
  React.useEffect(() => {
    if (!filterUrl?.subscribe) return;
    return filterUrl.subscribe(() => {
      void store.dispatch({
        type: 'setFilter',
        filter: filterUrl.read(),
        replace: true,
        silent: true,
      });
    });
  }, [filterUrl, store]);

  // Selection: report every change, announce the settled count.
  React.useEffect(() => {
    const speak = createDebouncedAnnouncer((message) =>
      callbacksRef.current.announce(message),
    );
    let previous = store.getState().selection.selected;
    const offState = store.subscribe(() => {
      const next = store.getState().selection.selected;
      if (next === previous) return;
      previous = next;
      callbacksRef.current.onSelectionChange?.(next);
    });
    const offEvent = store.on('selection:changed', ({ count }) => {
      const { messages: m, format } = catalogRef.current;
      const { selection: current, collection } = store.getState();
      speak(
        count === 0
          ? m.selection.cleared
          : current.allMatching ||
              (collection.total !== null &&
                count === collection.total &&
                count > 1)
            ? m.selection.all({ count }, format)
            : m.selection.count({ count }, format),
      );
    });
    return () => {
      speak.cancel();
      offState();
      offEvent();
    };
  }, [store]);

  // Uploads: insert finished assets, announce the batch.
  const seen = React.useRef(new Map<string, MediaUploadEntry['status']>());
  const progress = React.useMemo(
    () =>
      createProgressAnnouncer((message, politeness) =>
        callbacksRef.current.announce(message, politeness),
      ),
    [],
  );
  const batch = React.useRef<{ total: number } | null>(null);
  React.useEffect(() => {
    const { messages: m, format } = catalogRef.current;
    const entries = uploads.files.filter(
      (entry) => entry.parentId === undefined,
    );
    for (const entry of entries) {
      const before = seen.current.get(entry.id);
      seen.current.set(entry.id, entry.status);
      if (before === entry.status || !isFinal(entry)) continue;
      if (
        entry.status === 'success' &&
        entry.kind === 'create' &&
        entry.result
      ) {
        void store.dispatch({ type: 'assetUploaded', id: entry.result.id });
      }
      if (entry.status === 'error') {
        callbacksRef.current.announce(
          m.upload.entryFailed(
            {
              name: entry.name,
              reason: mediaErrorMessage(
                m,
                entry.error?.code ?? errorCodeOf(entry.error),
              ),
            },
            format,
          ),
        );
      }
    }
    const active = entries.filter((entry) => !isFinal(entry));
    if (uploads.isUploading && active.length > 0) {
      if (!batch.current) {
        batch.current = { total: entries.length };
        progress.start(m.upload.started({ count: active.length }, format));
      }
      progress.update(uploads.progress.fraction * 100, Date.now(), (percent) =>
        m.upload.progress(
          {
            done: entries.filter((entry) => entry.status === 'success').length,
            total: entries.length,
            percent,
          },
          format,
        ),
      );
    } else if (batch.current && !uploads.isUploading) {
      const done = entries.filter((entry) => entry.status === 'success').length;
      const failed = entries.filter((entry) => entry.status === 'error').length;
      progress.end(
        m.upload.finished({ done, total: entries.length, failed }, format),
        batchPoliteness(failed, done + failed),
      );
      batch.current = null;
    }
  }, [
    uploads.files,
    uploads.isUploading,
    uploads.progress.fraction,
    store,
    progress,
  ]);

  const value = React.useMemo(
    () => ({
      store,
      assetUrl: (asset: MediaAsset) => callbacksRef.current.assetUrl(asset),
      announce: (message: string, politeness?: 'polite' | 'assertive') =>
        callbacksRef.current.announce(message, politeness),
    }),
    [store],
  );

  return (
    <MediaContext.Provider value={value}>
      <MediaMessagesContext.Provider value={catalog}>
        <MediaUploadsContext.Provider value={uploads}>
          {children}
          {externalAnnounce ? null : live.regions}
        </MediaUploadsContext.Provider>
      </MediaMessagesContext.Provider>
    </MediaContext.Provider>
  );
}
