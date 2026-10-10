import type { CmsAssetListQuery } from '../editor/cms/types';
import type {
  MediaAsset,
  MediaAssetStatus,
  MediaBulkResult,
  MediaClient,
  MediaFolder,
  MediaLibraryState,
  MediaSelectionMode,
  MediaSortBy,
  MediaSortDirection,
} from './types';

export const SEARCH_DEBOUNCE_MS = 250;
export const UNKNOWN_FOLDER_NAME = '…';
export const MAX_PAGE_SIZE = 100;

export type MediaStoreActions = {
  /** Lists folders and the first page of assets of the current folder; drops the result if a newer request started. */
  load(): Promise<void>;
  /** Appends the next page of assets; no-op without a cursor or while a list request is in flight. A failed `load` clears the cursor. */
  loadMore(): Promise<void>;
  /** `load()` with a limit that covers every asset currently shown. */
  refresh(): Promise<void>;
  /** Enters `folder` (`null` is the root), resets search, selection and cursor, then loads. */
  navigate(folder: MediaFolder | null): void;
  /** Sets `search` immediately and reloads after `SEARCH_DEBOUNCE_MS`. */
  setSearch(value: string): void;
  /** Resets the cursor and reloads. */
  setSort(sortBy: MediaSortBy, sortDirection: MediaSortDirection): void;
  select(id: string): void;
  toggle(id: string): void;
  clearSelection(): void;
  archive(ids: string[]): Promise<MediaBulkResult>;
  move(ids: string[], folderId: string | null): Promise<MediaBulkResult>;
  setStatus(ids: string[], status: MediaAssetStatus): Promise<MediaBulkResult>;
  createFolder(name: string): Promise<MediaFolder>;
  /** Resets `mutation` to `idle`. */
  clearMutationError(): void;
  /** Cancels the pending search reload and invalidates in-flight list requests. */
  dispose(): void;
};

export type MediaStore = {
  subscribe(listener: () => void): () => void;
  getState(): MediaLibraryState;
  readonly selection: MediaSelectionMode;
  readonly actions: MediaStoreActions;
};

export type CreateMediaStoreOptions = {
  client: MediaClient;
  defaultFolderId?: string | null;
  pageSize?: number;
  selection?: MediaSelectionMode;
};

const IDLE_MUTATION: MediaLibraryState['mutation'] = {
  status: 'idle',
  error: null,
  skipped: [],
};

function pruneSelection(selected: string[], assets: MediaAsset[]): string[] {
  if (selected.length === 0) return selected;
  const present = new Set(assets.map((asset) => asset.id));
  const kept = selected.filter((id) => present.has(id));
  return kept.length === selected.length ? selected : kept;
}

/**
 * Framework-free media library state: one folder level (subfolders plus a
 * paged asset list), breadcrumb path, search, sort, selection and the
 * status of the last bulk mutation. `getState()` returns a new object per
 * change. List requests carry a ticket; a response whose ticket is no
 * longer current is dropped.
 */
export function createMediaStore({
  client,
  defaultFolderId = null,
  pageSize: requestedPageSize = 40,
  selection = 'none',
}: CreateMediaStoreOptions): MediaStore {
  const pageSize = Math.min(
    Math.max(Math.floor(requestedPageSize) || 1, 1),
    MAX_PAGE_SIZE,
  );
  let state: MediaLibraryState = {
    folderId: defaultFolderId,
    path: [],
    folders: [],
    assets: [],
    total: 0,
    nextCursor: null,
    search: '',
    sortBy: 'createdAt',
    sortDirection: 'desc',
    status: 'idle',
    error: null,
    mutation: IDLE_MUTATION,
    selected: [],
  };
  const listeners = new Set<() => void>();
  let ticket = 0;
  let searchTimer: ReturnType<typeof setTimeout> | null = null;

  const setState = (patch: Partial<MediaLibraryState>): void => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };

  const clearSearchTimer = (): void => {
    if (searchTimer !== null) {
      clearTimeout(searchTimer);
      searchTimer = null;
    }
  };

  const assetQuery = (
    limit: number,
    cursor: string | null,
  ): CmsAssetListQuery => {
    const query: CmsAssetListQuery = {
      sortBy: state.sortBy,
      sortDirection: state.sortDirection,
      limit,
    };
    if (state.folderId) query.folderId = state.folderId;
    else query.unfiled = true;
    if (state.search) query.search = state.search;
    if (cursor) query.cursor = cursor;
    return query;
  };

  const loadWithLimit = async (limit: number): Promise<void> => {
    const current = ++ticket;
    setState({ status: 'loading', error: null });
    try {
      const folderQuery = state.folderId
        ? { parentFolderId: state.folderId }
        : {};
      const [folderResult, assetResult] = await Promise.all([
        client.listFolders({ query: folderQuery }),
        client.listAssets({ query: assetQuery(limit, null) }),
      ]);
      if (current !== ticket) return;
      setState({
        folders: folderResult.folders,
        assets: assetResult.assets,
        total: assetResult.total,
        nextCursor: assetResult.hasMore ? assetResult.nextCursor : null,
        status: 'idle',
        error: null,
        selected: pruneSelection(state.selected, assetResult.assets),
      });
    } catch (error) {
      if (current !== ticket) return;
      setState({ status: 'error', error, nextCursor: null });
    }
  };

  const load = (): Promise<void> => loadWithLimit(pageSize);

  const loadMore = async (): Promise<void> => {
    const cursor = state.nextCursor;
    if (
      cursor === null ||
      state.status === 'loading' ||
      state.status === 'loadingMore'
    ) {
      return;
    }
    const current = ++ticket;
    setState({ status: 'loadingMore', error: null });
    try {
      const result = await client.listAssets({
        query: assetQuery(pageSize, cursor),
      });
      if (current !== ticket) return;
      setState({
        assets: [...state.assets, ...result.assets],
        total: result.total,
        nextCursor: result.hasMore ? result.nextCursor : null,
        status: 'idle',
        error: null,
      });
    } catch (error) {
      if (current !== ticket) return;
      setState({ status: 'error', error });
    }
  };

  const refresh = (): Promise<void> =>
    loadWithLimit(
      Math.min(Math.max(state.assets.length, pageSize), MAX_PAGE_SIZE),
    );

  const navigate = (folder: MediaFolder | null): void => {
    clearSearchTimer();
    let path: MediaFolder[];
    if (folder === null) {
      path = [];
    } else {
      const index = state.path.findIndex((entry) => entry.id === folder.id);
      if (index !== -1) {
        path = state.path.slice(0, index + 1);
      } else if (folder.parentId === state.folderId) {
        // A starting folder opened by id is not in `path`; keep it as the
        // placeholder entry `Media.Breadcrumbs` renders for it.
        const base =
          state.folderId !== null &&
          state.path[state.path.length - 1]?.id !== state.folderId
            ? [
                ...state.path,
                {
                  id: state.folderId,
                  name: UNKNOWN_FOLDER_NAME,
                  parentId: null,
                },
              ]
            : state.path;
        path = [...base, folder];
      } else {
        path = [folder];
      }
    }
    setState({
      folderId: folder === null ? null : folder.id,
      path,
      search: '',
      selected: [],
      nextCursor: null,
    });
    void load();
  };

  const setSearch = (value: string): void => {
    clearSearchTimer();
    setState({ search: value, nextCursor: null });
    searchTimer = setTimeout(() => {
      searchTimer = null;
      void load();
    }, SEARCH_DEBOUNCE_MS);
  };

  const setSort = (
    sortBy: MediaSortBy,
    sortDirection: MediaSortDirection,
  ): void => {
    setState({ sortBy, sortDirection, nextCursor: null });
    void load();
  };

  const select = (id: string): void => {
    if (selection === 'none') return;
    if (selection === 'single') {
      if (state.selected.length === 1 && state.selected[0] === id) return;
      setState({ selected: [id] });
      return;
    }
    if (state.selected.includes(id)) return;
    setState({ selected: [...state.selected, id] });
  };

  const toggle = (id: string): void => {
    if (selection === 'none') return;
    if (state.selected.includes(id)) {
      setState({ selected: state.selected.filter((entry) => entry !== id) });
      return;
    }
    setState({
      selected: selection === 'single' ? [id] : [...state.selected, id],
    });
  };

  const clearSelection = (): void => {
    if (state.selected.length === 0) return;
    setState({ selected: [] });
  };

  const mutate = async <R>(
    call: () => Promise<R>,
    skippedOf: (result: R) => string[],
  ): Promise<R> => {
    setState({ mutation: { status: 'pending', error: null, skipped: [] } });
    let result: R;
    try {
      result = await call();
    } catch (error) {
      setState({ mutation: { status: 'error', error, skipped: [] } });
      throw error;
    }
    setState({
      mutation: { status: 'idle', error: null, skipped: skippedOf(result) },
    });
    await refresh();
    return result;
  };

  const archive = async (ids: string[]): Promise<MediaBulkResult> => {
    const result = await mutate(
      () => client.archiveAssets({ body: { assetIds: ids } }),
      (r) => r.skipped,
    );
    return { ids: result.archivedIds, skipped: result.skipped };
  };

  const move = async (
    ids: string[],
    folderId: string | null,
  ): Promise<MediaBulkResult> => {
    const result = await mutate(
      () => client.moveAssets({ body: { assetIds: ids, folderId } }),
      (r) => r.skipped,
    );
    return { ids: result.movedIds, skipped: result.skipped };
  };

  const setStatus = async (
    ids: string[],
    status: MediaAssetStatus,
  ): Promise<MediaBulkResult> => {
    const result = await mutate(
      () => client.updateAssetsStatus({ body: { assetIds: ids, status } }),
      (r) => r.skipped,
    );
    return { ids: result.updatedIds, skipped: result.skipped };
  };

  const createFolder = async (name: string): Promise<MediaFolder> => {
    const parentFolderId = state.folderId;
    const result = await mutate(
      () =>
        client.createFolder({
          body: parentFolderId ? { name, parentFolderId } : { name },
        }),
      () => [],
    );
    return result.folder;
  };

  const clearMutationError = (): void => {
    if (state.mutation.status === 'idle') return;
    setState({ mutation: IDLE_MUTATION });
  };

  const dispose = (): void => {
    clearSearchTimer();
    ticket++;
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getState: () => state,
    selection,
    actions: {
      load,
      loadMore,
      refresh,
      navigate,
      setSearch,
      setSort,
      select,
      toggle,
      clearSelection,
      archive,
      move,
      setStatus,
      createFolder,
      clearMutationError,
      dispose,
    },
  };
}
