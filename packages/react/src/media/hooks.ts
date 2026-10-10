import * as React from 'react';

import type { MediaStoreActions } from './store';
import type {
  MediaAsset,
  MediaLibraryState,
  MediaSelectionMode,
  MediaUploadState,
} from './types';

import { useMediaContext, useMediaUploadsContext } from './context';
import { useSelector } from './use-store';

export type MediaLibrary = MediaLibraryState & MediaStoreActions;

const identity = (state: MediaLibraryState): MediaLibraryState => state;

/**
 * The whole library state merged with the store actions. Re-renders on
 * every state change; use `useMediaSelection` or `useMediaAsset` for
 * narrower subscriptions.
 */
export function useMediaLibrary(): MediaLibrary {
  const { store } = useMediaContext('useMediaLibrary');
  const state = useSelector(store, identity, Object.is);
  return React.useMemo(() => ({ ...state, ...store.actions }), [state, store]);
}

export type MediaSelection = {
  selected: string[];
  select: (id: string) => void;
  toggle: (id: string) => void;
  clear: () => void;
  mode: MediaSelectionMode;
};

const selectSelected = (state: MediaLibraryState): string[] => state.selected;

/** The selected asset ids and the selection actions of the enclosing `Media.Root`. */
export function useMediaSelection(): MediaSelection {
  const { store, selection } = useMediaContext('useMediaSelection');
  const selected = useSelector(store, selectSelected);
  return React.useMemo(
    () => ({
      selected,
      select: store.actions.select,
      toggle: store.actions.toggle,
      clear: store.actions.clearSelection,
      mode: selection,
    }),
    [selected, store, selection],
  );
}

/** The upload state of the client passed to `Media.Root` (`client.useUploadAssets()`). */
export function useMediaUploads(): MediaUploadState {
  return useMediaUploadsContext('useMediaUploads');
}

/** One listed asset by id, or `null` when the current page does not contain it. */
export function useMediaAsset(id: string): MediaAsset | null {
  const { store } = useMediaContext('useMediaAsset');
  const selector = React.useCallback(
    (state: MediaLibraryState): MediaAsset | null =>
      state.assets.find((asset) => asset.id === id) ?? null,
    [id],
  );
  return useSelector(store, selector, Object.is);
}
