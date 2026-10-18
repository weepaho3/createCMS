import * as React from 'react';

import type { FilterState } from './core/filter';
import type { LayoutMode } from './core/layout';
import type {
  CollectionSlice,
  MediaCommand,
  MediaEvent,
  MediaEventType,
  MediaStore,
  MediaStoreState,
} from './core/store';
import type { MediaAsset, MediaFolder, MediaUploadState } from './core/types';

import { useMediaContext, useMediaUploadsContext } from './context';
import { collectionAssets, currentFolders } from './core/store';
import { useSelector } from './use-store';

export type MediaLibrary = {
  state: MediaStoreState;
  dispatch: MediaStore['dispatch'];
  /** The loaded assets in order. */
  assets: MediaAsset[];
  /** The subfolders of the open folder. */
  folders: MediaFolder[];
  openFolder: (folderId: string | null) => void;
  setFilter: (patch: Partial<FilterState>) => void;
  setLayout: (layout: LayoutMode) => void;
  refresh: () => void;
};

const identity = (state: MediaStoreState) => state;

/**
 * The whole store state of the enclosing `Media.Root` with `dispatch` and
 * shortcuts for the common commands. Re-renders on every change; prefer
 * `useMediaStore(selector)` for narrow subscriptions.
 */
export function useMediaLibrary(): MediaLibrary {
  const { store } = useMediaContext('useMediaLibrary');
  const state = useSelector(store, identity, Object.is);
  return React.useMemo(() => {
    const run = (command: MediaCommand) => void store.dispatch(command);
    return {
      state,
      dispatch: store.dispatch,
      assets: collectionAssets(state),
      folders: currentFolders(state),
      openFolder: (folderId) => run({ type: 'openFolder', folderId }),
      setFilter: (filter) => run({ type: 'setFilter', filter }),
      setLayout: (layout) => run({ type: 'setLayout', layout }),
      refresh: () => run({ type: 'refresh' }),
    };
  }, [state, store]);
}

const selectCollection = (state: MediaStoreState) => state.collection;

/** The collection slice: query, ids, assets by id, cursor, total and status. */
export function useMediaCollection(): CollectionSlice & {
  assets: MediaAsset[];
} {
  const { store } = useMediaContext('useMediaCollection');
  const collection = useSelector(store, selectCollection, Object.is);
  return React.useMemo(
    () => ({
      ...collection,
      assets: collectionAssets({ collection } as MediaStoreState),
    }),
    [collection],
  );
}

/** The upload state of the client passed to `Media.Root` (`client.useUploadAssets()`). */
export function useMediaUploads(): MediaUploadState {
  return useMediaUploadsContext('useMediaUploads');
}

/** One loaded asset by id, or `null` when the collection does not hold it. */
export function useMediaAsset(id: string): MediaAsset | null {
  const { store } = useMediaContext('useMediaAsset');
  const selector = React.useCallback(
    (state: MediaStoreState): MediaAsset | null =>
      state.collection.byId[id] ?? null,
    [id],
  );
  return useSelector(store, selector, Object.is);
}

/**
 * Subscribes to a store event (`asset:replaced`, `selection:changed`, ...)
 * for as long as the component is mounted.
 */
export function useMediaEvent<K extends MediaEventType>(
  type: K,
  listener: (event: Extract<MediaEvent, { type: K }>) => void,
): void {
  const { store } = useMediaContext('useMediaEvent');
  const ref = React.useRef(listener);
  ref.current = listener;
  React.useEffect(
    () => store.on(type, (event) => ref.current(event)),
    [store, type],
  );
}
