import type { BulkAction } from './bulk';
import type { DetailDraft, DetailField } from './detail';
import type { FilterState } from './filter';
import type { FolderTreeState } from './folders';
import type { FocalPoint } from './image-edit';
import type { IntakeFile } from './intake';
import type { LayoutMode } from './layout';
import type { Registry } from './registry';
import type { SelectionModifiers, SelectionState } from './selection';
import type {
  MediaAsset,
  MediaAssetListQuery,
  MediaAssetStatus,
  MediaBulkTarget,
  MediaClient,
  MediaFolder,
  MediaRevision,
  MediaServerEvent,
  MediaUploadEntry,
} from './types';

import { assetPatch, detailValues, isDirty, setDraftField } from './detail';
import { errorCodeOf, isAbortError } from './errors';
import {
  DEFAULT_FILTER,
  filterToQuery,
  filtersEqual,
  isPlainFolderView,
  normalizeFilter,
  sortOfFilter,
} from './filter';
import {
  createFolderTree,
  loadExpanded,
  saveExpanded,
  setFolderChildren,
} from './folders';
import { folderOfPath } from './intake';
import { clampZoom, previewStep, rotateQuarter } from './preview';
import { createRegistry } from './registry';
import {
  clearSelection,
  createSelection,
  extendSelection,
  focusSelection,
  nextFocusAfterRemoval,
  reconcileSelection,
  selectAllLoaded,
  selectAllMatching,
  selectionClick,
  selectionCount,
  toggleSelection,
} from './selection';

export const SEARCH_DEBOUNCE_MS = 250;
export const MAX_PAGE_SIZE = 100;

// --- state --------------------------------------------------------------------

export type CollectionStatus =
  | 'idle'
  | 'loading'
  | 'refreshing'
  | 'appending'
  | 'error';

export type CollectionSlice = {
  query: FilterState;
  ids: string[];
  byId: Record<string, MediaAsset>;
  cursor: string | null;
  /** `null` until counted; appended pages do not count again. */
  total: number | null;
  status: CollectionStatus;
  error: unknown;
};

export type SelectionSlice = SelectionState & {
  /** Selected ids hidden by the current filter (with `keepHiddenSelection`). */
  hidden: number;
};

export type AssetPatch = {
  originalName?: string;
  metadata?: Record<string, unknown>;
  provenance?: MediaAsset['provenance'];
};

export type MediaStoreState = {
  collection: CollectionSlice;
  selection: SelectionSlice;
  folders: FolderTreeState;
  preview: {
    openId: string | null;
    /** The collection order when the preview opened (`n of total`). */
    ids: string[];
    zoom: number;
    pan: { x: number; y: number };
    rotation: 0 | 90 | 180 | 270;
  };
  detail: {
    assetId: string | null;
    /** The asset as last loaded or saved; the draft applies over it. */
    asset: MediaAsset | null;
    draft: DetailDraft;
    dirty: boolean;
    baseUpdatedAt: string | null;
    saving: boolean;
    error: unknown;
    /** The server's newer asset after a conflicting save. */
    conflict: MediaAsset | null;
    revisions: MediaRevision[] | null;
  };
  ui: {
    layout: LayoutMode;
    viewport: { width: number; height: number };
  };
  /** The last bulk change: what the server skipped and why. */
  mutation: {
    status: 'idle' | 'pending' | 'error';
    error: unknown;
    skipped: string[];
    skippedReasons: Record<string, string>;
  };
};

// --- events -------------------------------------------------------------------

export type MediaEvent =
  | { type: 'asset:uploaded'; asset: MediaAsset }
  | {
      type: 'asset:updated' | 'asset:replaced';
      assetId: string;
      revisionId?: string;
    }
  | {
      type: 'asset:moved';
      ids: string[];
      from: string | null;
      to: string | null;
    }
  | { type: 'asset:archived' | 'asset:restored'; ids: string[] }
  | { type: 'folder:changed'; folderId: string | null }
  | { type: 'selection:changed'; count: number };

export type MediaEventType = MediaEvent['type'];

// --- commands -----------------------------------------------------------------

export type MediaCommand =
  | {
      type: 'init';
      /** Starts with this filter (from the URL) instead of the initial one, without writing it back. */
      filter?: FilterState;
    }
  | { type: 'load' }
  | { type: 'loadMore' }
  | { type: 'refresh' }
  | {
      type: 'setFilter';
      /** Merged over the current filter unless `replace`. */
      filter: Partial<FilterState>;
      replace?: boolean;
      /** Waits `SEARCH_DEBOUNCE_MS` (typing in the search field). */
      debounce?: boolean;
      /** Does not report the change to `onFilterChange` (back and forward navigation). */
      silent?: boolean;
    }
  | { type: 'openFolder'; folderId: string | null }
  | { type: 'loadFolders'; parentId: string | null }
  | { type: 'expandFolder'; folderId: string }
  | { type: 'collapseFolder'; folderId: string }
  | { type: 'select'; id: string; modifiers?: SelectionModifiers }
  | { type: 'toggleSelection'; id: string }
  | { type: 'extendSelection'; id: string }
  | { type: 'focus'; id: string }
  | { type: 'setSelection'; selection: SelectionState }
  | { type: 'selectAll' }
  | { type: 'selectAllMatching' }
  | { type: 'clearSelection' }
  | { type: 'move'; ids?: string[]; folderId: string | null }
  | { type: 'archive'; ids?: string[]; force?: boolean }
  | { type: 'restore'; ids: string[] }
  | { type: 'setVisibility'; ids?: string[]; status: MediaAssetStatus }
  | {
      type: 'setProvenance';
      ids?: string[];
      provenance: NonNullable<MediaAsset['provenance']>;
    }
  | { type: 'updateAsset'; id: string; patch: AssetPatch }
  | { type: 'createFolder'; name: string; parentId?: string | null }
  | { type: 'renameFolder'; folderId: string; name: string }
  | { type: 'moveFolder'; folderId: string; parentId: string | null }
  | {
      type: 'deleteFolder';
      folderId: string;
      mode?: 'empty-only' | 'move-to-parent' | 'archive-contents';
      dryRun?: boolean;
    }
  | {
      type: 'receive';
      files: (File | IntakeFile)[];
      folderId?: string | null;
      /** Recreates the relative folder structure below `folderId`. */
      recreateFolders?: boolean;
    }
  | { type: 'assetUploaded'; id: string }
  | { type: 'openPreview'; id: string }
  | { type: 'closePreview' }
  | { type: 'previewStep'; delta: 1 | -1 }
  | { type: 'previewZoom'; zoom: number; pan?: { x: number; y: number } }
  | { type: 'previewRotate' }
  | { type: 'openDetail'; id: string }
  | { type: 'closeDetail' }
  | { type: 'setDetailField'; field: DetailField; value: unknown }
  | { type: 'resetDetail' }
  | { type: 'saveDetail' }
  /** After a conflict: `mine` saves the draft over the newer asset, `theirs` drops it. */
  | { type: 'resolveDetailConflict'; keep: 'mine' | 'theirs' }
  | { type: 'setFocalPoint'; id: string; focal: FocalPoint | null }
  | { type: 'loadRevisions'; id: string }
  | { type: 'setCurrentRevision'; id: string; revisionId: string }
  | { type: 'setLayout'; layout: LayoutMode }
  | { type: 'setViewport'; width: number; height: number }
  | { type: 'clearMutationError' };

export type CommandResult<T = unknown> =
  | {
      ok: true;
      value?: T;
      /** Ids the server left alone (in use, out of scope). */
      skipped?: string[];
      /** Reverts the change where it is invertible. */
      undo?: () => Promise<CommandResult>;
    }
  | { ok: false; code: string; error: unknown };

// --- registries ---------------------------------------------------------------

/** An extra place to get files from (URL import, stock photos, a DAM). */
export type MediaSource = {
  id: string;
  label: string;
  /** Hands the chosen files to the store's intake. */
  open(context: {
    receive(files: (File | IntakeFile)[]): Promise<CommandResult>;
  }): void | Promise<void>;
};

/** Transforms files before they are queued (resize, rename, reject). */
export type MediaFileHook = {
  id: string;
  transform(files: IntakeFile[]): IntakeFile[] | Promise<IntakeFile[]>;
};

/** Renders an asset in the preview; `render` is framework specific. */
export type MediaPreviewRenderer<R = unknown> = {
  id: string;
  match(asset: MediaAsset): boolean;
  render: R;
};

export type MediaRegistries = {
  sources: Registry<MediaSource>;
  fileHooks: Registry<MediaFileHook>;
  assetActions: Registry<BulkAction>;
  previewRenderers: Registry<MediaPreviewRenderer>;
};

export type MediaUploader = (
  files: File[],
  options?: { folderId?: string },
) => Promise<MediaUploadEntry[]>;

export type MediaStore = {
  getState(): MediaStoreState;
  subscribe(listener: () => void): () => void;
  dispatch<T = unknown>(command: MediaCommand): Promise<CommandResult<T>>;
  on<K extends MediaEventType>(
    type: K,
    listener: (event: Extract<MediaEvent, { type: K }>) => void,
  ): () => void;
  /** Publishes an event to `on` listeners (uploads, plugins). */
  emit(event: MediaEvent): void;
  readonly registries: MediaRegistries;
  /** The upload function the `receive` command queues files with. */
  setUploader(upload: MediaUploader | null): void;
  readonly client: MediaClient;
  readonly pageSize: number;
  /** Cancels timers, in-flight requests and the server subscription; `init` resumes. */
  dispose(): void;
};

export type CreateMediaStoreOptions = {
  client: MediaClient;
  /** Folder to open (`null` = root level). */
  defaultFolderId?: string | null;
  /** The initial filter (from the URL); its folder wins over `defaultFolderId`. */
  filter?: FilterState;
  /** Assets per page, 1-100. @default 40 */
  pageSize?: number;
  selection?: SelectionState['mode'];
  /** Keep selected ids that a filter hides. */
  keepHiddenSelection?: boolean;
  layout?: LayoutMode;
  /** Persists the expanded folders (`localStorage`); errors are ignored. */
  expandedStorage?: {
    storage: {
      getItem(key: string): string | null;
      setItem(key: string, value: string): void;
    } | null;
    key?: string;
  };
  /** Called after every filter change (URL sync). */
  onFilterChange?: (filter: FilterState, mode: 'replace' | 'push') => void;
};

const EMPTY_DETAIL: MediaStoreState['detail'] = {
  assetId: null,
  asset: null,
  draft: {},
  dirty: false,
  baseUpdatedAt: null,
  saving: false,
  error: null,
  conflict: null,
  revisions: null,
};

const IDLE_MUTATION: MediaStoreState['mutation'] = {
  status: 'idle',
  error: null,
  skipped: [],
  skippedReasons: {},
};

function fail(error: unknown, fallback = 'UNKNOWN'): CommandResult<never> {
  return { ok: false, code: errorCodeOf(error) ?? fallback, error };
}

function toIntakeFile(file: File | IntakeFile): IntakeFile {
  return 'relativePath' in file ? file : { file, relativePath: file.name };
}

/**
 * The framework-free media library store: slices per module, typed events
 * and a command pipeline. Every change replaces the state object and the
 * changed slice, so selectors compare by reference. List requests are
 * aborted when a newer one starts.
 */
export function createMediaStore(options: CreateMediaStoreOptions): MediaStore {
  const { client } = options;
  const pageSize = Math.min(
    Math.max(Math.floor(options.pageSize ?? 40) || 1, 1),
    MAX_PAGE_SIZE,
  );
  const expandedKey =
    options.expandedStorage?.key ?? 'createcms.media.expanded';
  const initialFilter = normalizeFilter(
    options.filter ?? {
      ...DEFAULT_FILTER,
      folderId: options.defaultFolderId ?? null,
    },
  );
  const initialFolder =
    initialFilter.folderId === undefined ? null : initialFilter.folderId;

  let state: MediaStoreState = {
    collection: {
      query: initialFilter,
      ids: [],
      byId: {},
      cursor: null,
      total: null,
      status: 'idle',
      error: null,
    },
    selection: { ...createSelection(options.selection ?? 'none'), hidden: 0 },
    folders: {
      ...createFolderTree(initialFolder),
      expanded: loadExpanded(options.expandedStorage?.storage, expandedKey),
    },
    preview: {
      openId: null,
      ids: [],
      zoom: 1,
      pan: { x: 0, y: 0 },
      rotation: 0,
    },
    detail: EMPTY_DETAIL,
    ui: { layout: options.layout ?? 'grid', viewport: { width: 0, height: 0 } },
    mutation: IDLE_MUTATION,
  };

  const listeners = new Set<() => void>();
  const eventListeners = new Map<
    MediaEventType,
    Set<(event: MediaEvent) => void>
  >();
  let uploader: MediaUploader | null = null;
  let listController: AbortController | null = null;
  let listTicket = 0;
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const registries: MediaRegistries = {
    sources: createRegistry(),
    fileHooks: createRegistry(),
    assetActions: createRegistry(),
    previewRenderers: createRegistry(),
  };

  const notify = () => {
    for (const listener of listeners) listener();
  };

  const set = (patch: Partial<MediaStoreState>) => {
    const previousCount = selectionCount(
      state.selection,
      state.collection.total,
    );
    state = { ...state, ...patch };
    notify();
    const count = selectionCount(state.selection, state.collection.total);
    if (patch.selection && count !== previousCount) {
      emit({ type: 'selection:changed', count });
    }
  };

  const setCollection = (patch: Partial<CollectionSlice>) =>
    set({ collection: { ...state.collection, ...patch } });

  const setFolders = (folders: FolderTreeState) => {
    if (folders.expanded !== state.folders.expanded) {
      saveExpanded(
        options.expandedStorage?.storage,
        expandedKey,
        folders.expanded,
      );
    }
    set({ folders });
  };

  const emit = (event: MediaEvent) => {
    for (const listener of eventListeners.get(event.type) ?? []) {
      listener(event);
    }
  };

  const setSelection = (
    next: SelectionState,
    visible = state.collection.ids,
  ) => {
    const { state: reconciled, hidden } = reconcileSelection(next, visible, {
      keepHidden: options.keepHiddenSelection,
    });
    set({ selection: { ...reconciled, hidden } });
  };

  // --- collection -------------------------------------------------------------

  const listQuery = (limit: number, cursor: string | null) => {
    const query: MediaAssetListQuery = {
      ...filterToQuery(state.collection.query),
      ...sortOfFilter(state.collection.query.sort),
      limit,
      includeTotal: !cursor,
    };
    if (cursor) query.cursor = cursor;
    return query;
  };

  const fetchList = async (
    mode: 'replace' | 'append',
    limit: number,
  ): Promise<CommandResult> => {
    const cursor = mode === 'append' ? state.collection.cursor : null;
    if (mode === 'append' && cursor === null) return { ok: true };
    listController?.abort();
    const controller =
      typeof AbortController === 'undefined' ? null : new AbortController();
    listController = controller;
    const ticket = ++listTicket;
    const hasItems = state.collection.ids.length > 0;
    setCollection({
      status:
        mode === 'append' ? 'appending' : hasItems ? 'refreshing' : 'loading',
      error: null,
    });
    try {
      const request: Parameters<MediaClient['listAssets']>[0] = {
        query: listQuery(limit, cursor),
      };
      if (controller) request.signal = controller.signal;
      const result = await client.listAssets(request);
      if (ticket !== listTicket || disposed) return { ok: true };
      const byId: Record<string, MediaAsset> =
        mode === 'append' ? { ...state.collection.byId } : {};
      const ids = mode === 'append' ? [...state.collection.ids] : [];
      const seen = new Set(ids);
      for (const asset of result.assets) {
        byId[asset.id] = asset;
        if (!seen.has(asset.id)) {
          seen.add(asset.id);
          ids.push(asset.id);
        }
      }
      setCollection({
        ids,
        byId,
        cursor: result.hasMore ? result.nextCursor : null,
        total:
          mode === 'append' ? state.collection.total : (result.total ?? null),
        status: 'idle',
        error: null,
      });
      setSelection(state.selection, ids);
      return { ok: true, value: result.assets.length };
    } catch (error) {
      if (isAbortError(error) || ticket !== listTicket) return { ok: true };
      const failed: Partial<CollectionSlice> = { status: 'error', error };
      if (mode === 'replace') failed.cursor = null;
      setCollection(failed);
      return fail(error);
    } finally {
      if (listController === controller) listController = null;
    }
  };

  const load = () => fetchList('replace', pageSize);
  const loadMore = () => {
    const { status } = state.collection;
    if (status === 'appending' || status === 'loading')
      return Promise.resolve<CommandResult>({ ok: true });
    return fetchList('append', pageSize);
  };
  const refresh = () =>
    fetchList(
      'replace',
      Math.min(Math.max(state.collection.ids.length, pageSize), MAX_PAGE_SIZE),
    );

  const clearSearchTimer = () => {
    if (searchTimer !== null) clearTimeout(searchTimer);
    searchTimer = null;
  };

  const setFilter = (
    patch: Partial<FilterState>,
    replace = false,
    debounce = false,
    silent = false,
  ): Promise<CommandResult> => {
    const next = normalizeFilter(
      replace
        ? { ...DEFAULT_FILTER, ...patch }
        : { ...state.collection.query, ...patch },
    );
    if (filtersEqual(next, state.collection.query)) {
      return Promise.resolve({ ok: true });
    }
    const folderChanged = next.folderId !== state.collection.query.folderId;
    setCollection({ query: next, cursor: null });
    if (folderChanged) {
      const currentId = next.folderId ?? null;
      setFolders({ ...state.folders, currentId });
      void syncPath(currentId);
      emit({ type: 'folder:changed', folderId: currentId });
    }
    if (!silent) options.onFilterChange?.(next, debounce ? 'replace' : 'push');
    clearSearchTimer();
    if (!debounce) return load();
    return new Promise((resolve) => {
      searchTimer = setTimeout(() => {
        searchTimer = null;
        void load().then(resolve);
      }, SEARCH_DEBOUNCE_MS);
    });
  };

  // --- folders ----------------------------------------------------------------

  const loadFolders = async (
    parentId: string | null,
  ): Promise<CommandResult> => {
    const key = parentId ?? '';
    if (parentId !== null && !state.folders.loading.includes(key)) {
      setFolders({
        ...state.folders,
        loading: [...state.folders.loading, key],
      });
    }
    try {
      const { folders } = await client.listFolders({
        query: parentId ? { parentFolderId: parentId } : {},
      });
      setFolders({
        ...setFolderChildren(state.folders, parentId, folders),
        loading: state.folders.loading.filter((id) => id !== key),
      });
      return { ok: true, value: folders };
    } catch (error) {
      setFolders({
        ...state.folders,
        loading: state.folders.loading.filter((id) => id !== key),
      });
      return fail(error);
    }
  };

  /** Resolves the path of `folderId` from known nodes, else from the server. */
  const syncPath = async (folderId: string | null) => {
    if (folderId === null) {
      setFolders({ ...state.folders, path: [] });
      return;
    }
    const path: string[] = [];
    let current: string | null = folderId;
    while (current !== null) {
      const node: MediaFolder | undefined = state.folders.nodes[current];
      if (!node) break;
      path.unshift(current);
      current = node.parentId;
    }
    if (current === null) {
      setFolders({ ...state.folders, path });
      return;
    }
    setFolders({ ...state.folders, path: [folderId] });
    if (!client.getFolderPath) return;
    try {
      const { path: chain } = await client.getFolderPath({
        query: { folderId },
      });
      if (state.folders.currentId !== folderId) return;
      const nodes = { ...state.folders.nodes };
      for (const folder of chain) {
        nodes[folder.id] = {
          ...folder,
          children: nodes[folder.id]?.children ?? null,
        };
      }
      const ancestors = chain
        .map((folder) => folder.id)
        .filter((id) => id !== folderId);
      setFolders({
        ...state.folders,
        nodes,
        path: chain.map((folder) => folder.id),
        expanded: [...new Set([...state.folders.expanded, ...ancestors])],
      });
      // Preload one level along the path so the tree can show it.
      await Promise.all(
        ancestors
          .filter((id) => state.folders.nodes[id]?.children === null)
          .map((id) => loadFolders(id)),
      );
    } catch {
      // The breadcrumb keeps the folder itself; the listing still works.
    }
  };

  const openFolder = (folderId: string | null): Promise<CommandResult> => {
    set({
      selection: { ...clearSelection(state.selection), focus: null, hidden: 0 },
    });
    void loadFolders(folderId);
    return setFilter(
      {
        folderId,
        unfiled: undefined,
        recursive: undefined,
        q: undefined,
      },
      false,
    );
  };

  const reloadFolderLevels = async (...parents: (string | null)[]) => {
    const unique = [...new Set(parents)];
    await Promise.all(
      unique
        .filter(
          (id) => id === null || state.folders.nodes[id]?.children !== null,
        )
        .map((id) => loadFolders(id)),
    );
  };

  // --- mutations ----------------------------------------------------------------

  const targetIds = (ids?: string[]): string[] =>
    ids ??
    (state.selection.allMatching
      ? state.collection.ids.filter(
          (id) => !state.selection.allMatching!.except.includes(id),
        )
      : state.selection.selected);

  const bulkTarget = (ids?: string[]): MediaBulkTarget =>
    !ids && state.selection.allMatching
      ? {
          allMatching: {
            query: filterToQuery(state.selection.allMatching.query),
            except: state.selection.allMatching.except,
          },
        }
      : { assetIds: targetIds(ids) };

  /**
   * Runs a bulk call with an optimistic patch of the collection; the patch
   * is rolled back on failure and for the ids the server skipped.
   */
  const mutate = async <R>(
    optimistic: (collection: CollectionSlice) => CollectionSlice,
    call: () => Promise<R>,
    skippedOf: (result: R) => {
      skipped: string[];
      reasons?: Record<string, string>;
    },
  ): Promise<{ ok: true; result: R } | { ok: false; error: unknown }> => {
    const before = state.collection;
    setCollection(optimistic(before));
    set({ mutation: { ...IDLE_MUTATION, status: 'pending' } });
    try {
      const result = await call();
      const { skipped, reasons = {} } = skippedOf(result);
      if (skipped.length > 0) {
        // Skipped assets did not change: put them back where they were.
        const keep = new Set(skipped);
        const current = new Set(state.collection.ids);
        const known = new Set(before.ids);
        const byId = { ...state.collection.byId };
        for (const id of skipped) {
          if (before.byId[id]) byId[id] = before.byId[id];
        }
        setCollection({
          ids: [
            ...state.collection.ids.filter((id) => !known.has(id)),
            ...before.ids.filter((id) => current.has(id) || keep.has(id)),
          ],
          byId,
        });
      }
      set({
        mutation: {
          status: 'idle',
          error: null,
          skipped,
          skippedReasons: reasons,
        },
      });
      return { ok: true, result };
    } catch (error) {
      setCollection({
        ids: before.ids,
        byId: before.byId,
        total: before.total,
      });
      set({ mutation: { ...IDLE_MUTATION, status: 'error', error } });
      return { ok: false, error };
    }
  };

  const removeFromCollection =
    (ids: string[]) => (collection: CollectionSlice) => {
      const drop = new Set(ids);
      const removed = collection.ids.filter((id) => drop.has(id)).length;
      return {
        ...collection,
        ids: collection.ids.filter((id) => !drop.has(id)),
        total:
          collection.total === null
            ? null
            : Math.max(0, collection.total - removed),
      };
    };

  const patchAssets =
    (ids: string[], patch: Partial<MediaAsset>) =>
    (collection: CollectionSlice) => {
      const byId = { ...collection.byId };
      for (const id of ids) {
        if (byId[id]) byId[id] = { ...byId[id], ...patch };
      }
      return { ...collection, byId };
    };

  const afterRemoval = (order: string[], removed: string[]) => {
    const focus = nextFocusAfterRemoval(order, removed, state.selection.focus);
    const selection = clearSelection(state.selection);
    set({ selection: { ...selection, focus, hidden: 0 } });
  };

  const move = async (
    ids: string[] | undefined,
    folderId: string | null,
  ): Promise<CommandResult> => {
    const affected = targetIds(ids);
    const target = bulkTarget(ids);
    const origins = new Map<string, string | null>();
    for (const id of affected) {
      origins.set(id, state.collection.byId[id]?.folderId ?? null);
    }
    const query = state.collection.query;
    const leavesView =
      query.folderId !== undefined &&
      !query.recursive &&
      query.folderId !== folderId;
    const order = state.collection.ids;
    const outcome = await mutate(
      leavesView
        ? removeFromCollection(affected)
        : patchAssets(affected, { folderId }),
      () => client.moveAssets({ body: { ...target, folderId } }),
      (r) => ({ skipped: r.skipped }),
    );
    if (!outcome.ok) return fail(outcome.error);
    const moved = outcome.result.movedIds;
    if (leavesView) afterRemoval(order, moved);
    const from = query.folderId ?? null;
    emit({ type: 'asset:moved', ids: moved, from, to: folderId });
    void reloadFolderLevels(
      state.folders.currentId,
      folderId === null
        ? null
        : (state.folders.nodes[folderId]?.parentId ?? null),
    );
    const groups = new Map<string | null, string[]>();
    for (const id of moved) {
      const origin = origins.has(id) ? origins.get(id)! : from;
      groups.set(origin, [...(groups.get(origin) ?? []), id]);
    }
    return {
      ok: true,
      value: moved,
      skipped: outcome.result.skipped,
      undo: async () => {
        let last: CommandResult = { ok: true };
        for (const [origin, group] of groups) {
          last = await move(group, origin);
          if (!last.ok) return last;
        }
        return last;
      },
    };
  };

  const restore = async (ids: string[]): Promise<CommandResult> => {
    if (!client.restoreAssets) {
      return { ok: false, code: 'UNSUPPORTED', error: null };
    }
    const archivedView = !!state.collection.query.archived;
    const outcome = await mutate(
      archivedView ? removeFromCollection(ids) : (c) => c,
      () => client.restoreAssets!({ body: { assetIds: ids } }),
      (r) => ({ skipped: r.skipped }),
    );
    if (!outcome.ok) return fail(outcome.error);
    emit({ type: 'asset:restored', ids: outcome.result.restoredIds });
    if (!archivedView) void refresh();
    return {
      ok: true,
      value: outcome.result.restoredIds,
      skipped: outcome.result.skipped,
    };
  };

  const archive = async (
    ids: string[] | undefined,
    force?: boolean,
  ): Promise<CommandResult> => {
    const affected = targetIds(ids);
    const target = bulkTarget(ids);
    const order = state.collection.ids;
    const outcome = await mutate(
      removeFromCollection(affected),
      () =>
        client.archiveAssets({ body: force ? { ...target, force } : target }),
      (r) => ({ skipped: r.skipped, reasons: r.skippedReasons }),
    );
    if (!outcome.ok) return fail(outcome.error);
    const archived = outcome.result.archivedIds;
    afterRemoval(order, archived);
    emit({ type: 'asset:archived', ids: archived });
    void reloadFolderLevels(state.folders.currentId);
    return {
      ok: true,
      value: archived,
      skipped: outcome.result.skipped,
      undo: client.restoreAssets ? () => restore(archived) : undefined,
    };
  };

  const setVisibility = async (
    ids: string[] | undefined,
    status: MediaAssetStatus,
  ): Promise<CommandResult> => {
    const affected = targetIds(ids);
    const previous = new Map(
      affected.map((id) => [id, state.collection.byId[id]?.status]),
    );
    const outcome = await mutate(
      patchAssets(affected, { status }),
      () => client.updateAssetsStatus({ body: { ...bulkTarget(ids), status } }),
      (r) => ({ skipped: r.skipped }),
    );
    if (!outcome.ok) return fail(outcome.error);
    for (const id of outcome.result.updatedIds) {
      emit({ type: 'asset:updated', assetId: id });
    }
    const groups = new Map<string, string[]>();
    for (const id of outcome.result.updatedIds) {
      const was = previous.get(id);
      if (was === 'private' || was === 'public') {
        groups.set(was, [...(groups.get(was) ?? []), id]);
      }
    }
    return {
      ok: true,
      value: outcome.result.updatedIds,
      skipped: outcome.result.skipped,
      undo: async () => {
        let last: CommandResult = { ok: true };
        for (const [was, group] of groups) {
          last = await setVisibility(group, was as MediaAssetStatus);
          if (!last.ok) return last;
        }
        return last;
      },
    };
  };

  const updateAsset = async (
    id: string,
    patch: AssetPatch,
  ): Promise<CommandResult<MediaAsset>> => {
    const current = state.collection.byId[id];
    if (!client.updateAsset)
      return { ok: false, code: 'UNSUPPORTED', error: null };
    if (!current) return { ok: false, code: 'ASSET_NOT_FOUND', error: null };
    const before = state.collection;
    setCollection(patchAssets([id], patch as Partial<MediaAsset>)(before));
    try {
      const { asset } = await client.updateAsset({
        body: {
          assetId: id,
          patch,
          expectedUpdatedAt: new Date(current.updatedAt).toISOString(),
        },
      });
      setCollection({ byId: { ...state.collection.byId, [id]: asset } });
      emit({ type: 'asset:updated', assetId: id });
      return { ok: true, value: asset };
    } catch (error) {
      setCollection({
        byId: { ...state.collection.byId, [id]: before.byId[id] },
      });
      return fail(error);
    }
  };

  const setProvenance = async (
    ids: string[] | undefined,
    provenance: NonNullable<MediaAsset['provenance']>,
  ): Promise<CommandResult> => {
    const affected = targetIds(ids);
    const updated: string[] = [];
    for (const id of affected) {
      const result = await updateAsset(id, { provenance });
      if (!result.ok) return result;
      updated.push(id);
    }
    return { ok: true, value: updated };
  };

  // --- detail -------------------------------------------------------------------

  /** Replaces a loaded asset everywhere the store holds it. */
  const patchCollectionAsset = (asset: MediaAsset) => {
    if (state.collection.byId[asset.id]) {
      setCollection({ byId: { ...state.collection.byId, [asset.id]: asset } });
    }
    if (state.detail.asset?.id === asset.id && !state.detail.dirty) {
      set({
        detail: {
          ...state.detail,
          asset,
          baseUpdatedAt: new Date(asset.updatedAt).toISOString(),
        },
      });
    }
  };

  const openDetail = async (id: string): Promise<CommandResult> => {
    let asset = state.collection.byId[id] ?? null;
    set({
      detail: {
        ...EMPTY_DETAIL,
        assetId: id,
        asset,
        baseUpdatedAt: asset ? new Date(asset.updatedAt).toISOString() : null,
      },
    });
    if (!asset && client.getAssets) {
      try {
        const { assets } = await client.getAssets({ query: { ids: [id] } });
        asset = assets[0] ?? null;
      } catch (error) {
        if (state.detail.assetId === id)
          set({ detail: { ...state.detail, error } });
        return fail(error);
      }
      if (state.detail.assetId === id) {
        set({
          detail: {
            ...state.detail,
            asset,
            baseUpdatedAt: asset
              ? new Date(asset.updatedAt).toISOString()
              : null,
          },
        });
      }
    }
    return asset
      ? { ok: true, value: asset }
      : { ok: false, code: 'ASSET_NOT_FOUND', error: null };
  };

  /** The newer asset a conflict response carries (`data.asset`). */
  const conflictAsset = (error: unknown): MediaAsset | null => {
    const top = error as {
      data?: { asset?: MediaAsset };
      body?: { data?: { asset?: MediaAsset } };
    } | null;
    return top?.data?.asset ?? top?.body?.data?.asset ?? null;
  };

  const saveDetail = async (): Promise<CommandResult<MediaAsset>> => {
    const { asset, draft, baseUpdatedAt } = state.detail;
    if (!asset || !client.updateAsset)
      return { ok: false, code: 'UNSUPPORTED', error: null };
    const patch = assetPatch(asset, draft);
    if (!patch) {
      set({ detail: { ...state.detail, draft: {}, dirty: false } });
      return { ok: true, value: asset };
    }
    set({ detail: { ...state.detail, saving: true, error: null } });
    try {
      const { asset: saved } = await client.updateAsset({
        body: {
          assetId: asset.id,
          patch,
          expectedUpdatedAt:
            baseUpdatedAt ?? new Date(asset.updatedAt).toISOString(),
        },
      });
      set({
        detail: {
          ...state.detail,
          asset: saved,
          draft: {},
          dirty: false,
          saving: false,
          baseUpdatedAt: new Date(saved.updatedAt).toISOString(),
        },
      });
      patchCollectionAsset(saved);
      emit({ type: 'asset:updated', assetId: saved.id });
      return { ok: true, value: saved };
    } catch (error) {
      const code = errorCodeOf(error);
      set({
        detail: {
          ...state.detail,
          saving: false,
          error,
          conflict: code === 'ASSET_CONFLICT' ? conflictAsset(error) : null,
        },
      });
      return fail(error);
    }
  };

  // --- intake -------------------------------------------------------------------

  const receive = async (
    files: (File | IntakeFile)[],
    folderId: string | null | undefined,
    recreateFolders: boolean,
  ): Promise<CommandResult<MediaUploadEntry[]>> => {
    if (!uploader) return { ok: false, code: 'UNSUPPORTED', error: null };
    let items = files.map(toIntakeFile);
    for (const hook of registries.fileHooks.list()) {
      items = await hook.transform(items);
    }
    const base = folderId === undefined ? state.folders.currentId : folderId;
    const byFolder = new Map<string, IntakeFile[]>();
    for (const item of items) {
      const dir = recreateFolders ? folderOfPath(item.relativePath) : '';
      byFolder.set(dir, [...(byFolder.get(dir) ?? []), item]);
    }
    const folderIds = new Map<string, string | null>([['', base]]);
    if (recreateFolders) {
      const dirs = new Set<string>();
      for (const dir of byFolder.keys()) {
        const segments = dir.split('/').filter(Boolean);
        for (let i = 1; i <= segments.length; i++) {
          dirs.add(segments.slice(0, i).join('/'));
        }
      }
      // Parents first, so every folder is created inside its parent.
      const ordered = [...dirs].sort(
        (a, b) =>
          a.split('/').length - b.split('/').length || a.localeCompare(b),
      );
      for (const dir of ordered) {
        const parentId = folderIds.get(folderOfPath(dir)) ?? base;
        const name = dir.slice(dir.lastIndexOf('/') + 1);
        try {
          const { folder } = await client.createFolder({
            body: parentId ? { name, parentFolderId: parentId } : { name },
          });
          folderIds.set(dir, folder.id);
        } catch (error) {
          return fail(error);
        }
      }
      void reloadFolderLevels(base);
    }
    const entries: MediaUploadEntry[] = [];
    for (const [dir, group] of byFolder) {
      const target = folderIds.get(dir) ?? base;
      try {
        entries.push(
          ...(await uploader(
            group.map((item) => item.file),
            target ? { folderId: target } : undefined,
          )),
        );
      } catch (error) {
        return fail(error);
      }
    }
    return { ok: true, value: entries };
  };

  const assetUploaded = async (id: string): Promise<CommandResult> => {
    if (state.collection.byId[id]) return { ok: true };
    const query = state.collection.query;
    if (!client.getAssets || !isPlainFolderView(query)) {
      void refresh();
      return { ok: true };
    }
    try {
      const { assets } = await client.getAssets({ query: { ids: [id] } });
      const asset = assets[0];
      if (!asset) return { ok: true };
      emit({ type: 'asset:uploaded', asset });
      const inView =
        (query.folderId ?? null) === (asset.folderId ?? null) ||
        query.folderId === undefined;
      if (!inView || state.collection.byId[id]) return { ok: true };
      const newestFirst = query.sort === 'created_desc';
      if (!newestFirst) {
        void refresh();
        return { ok: true };
      }
      setCollection({
        ids: [id, ...state.collection.ids],
        byId: { ...state.collection.byId, [id]: asset },
        total:
          state.collection.total === null ? null : state.collection.total + 1,
      });
      return { ok: true, value: asset };
    } catch (error) {
      return fail(error);
    }
  };

  // --- server events --------------------------------------------------------------

  const reconcile = async (event: MediaServerEvent) => {
    if ('assetId' in event) {
      const { assetId } = event;
      switch (event.type) {
        case 'media.asset.archived':
        case 'media.asset.purged':
          if (
            state.collection.byId[assetId] &&
            !state.collection.query.archived
          ) {
            setCollection(removeFromCollection([assetId])(state.collection));
            setSelection(state.selection);
          }
          if (event.type === 'media.asset.archived') {
            emit({ type: 'asset:archived', ids: [assetId] });
          }
          return;
        case 'media.asset.created':
          await assetUploaded(assetId);
          return;
        case 'media.asset.updated':
        case 'media.asset.replaced':
        case 'media.asset.restored':
        case 'media.rendition.created': {
          if (
            (state.collection.byId[assetId] ||
              state.detail.asset?.id === assetId) &&
            client.getAssets
          ) {
            try {
              const { assets } = await client.getAssets({
                query: { ids: [assetId] },
              });
              if (assets[0]) patchCollectionAsset(assets[0]);
            } catch {
              // The next refresh catches up.
            }
          }
          if (event.type === 'media.asset.restored') {
            emit({ type: 'asset:restored', ids: [assetId] });
          } else {
            emit({
              type:
                event.type === 'media.asset.replaced'
                  ? 'asset:replaced'
                  : 'asset:updated',
              assetId,
              revisionId: event.revisionId,
            });
          }
        }
      }
      return;
    }
    const parent = state.folders.nodes[event.folderId]?.parentId ?? null;
    await reloadFolderLevels(null, parent, state.folders.currentId);
    emit({ type: 'folder:changed', folderId: event.folderId });
  };

  let unsubscribeServer: (() => void) | null = null;
  const subscribeServer = () => {
    if (unsubscribeServer || !client.subscribe) return;
    unsubscribeServer = client.subscribe((event) => {
      if (!disposed) void reconcile(event);
    });
  };
  subscribeServer();

  // --- dispatch ---------------------------------------------------------------------

  const dispatch = async (command: MediaCommand): Promise<CommandResult> => {
    const order = state.collection.ids;
    switch (command.type) {
      case 'init': {
        // A store disposed by an unmount (React StrictMode remounts) resumes.
        disposed = false;
        subscribeServer();
        if (command.filter) {
          const query = normalizeFilter(command.filter);
          const folderId = query.folderId ?? null;
          setCollection({ query, cursor: null });
          setFolders({
            ...state.folders,
            currentId: folderId,
            path: folderId ? [folderId] : [],
          });
        }
        const currentId = state.folders.currentId;
        await Promise.all([
          loadFolders(null),
          currentId ? loadFolders(currentId) : Promise.resolve(),
          syncPath(currentId),
        ]);
        await Promise.all(
          state.folders.expanded
            .filter(
              (id) =>
                state.folders.nodes[id] &&
                state.folders.nodes[id].children === null,
            )
            .map((id) => loadFolders(id)),
        );
        return load();
      }
      case 'load':
        return load();
      case 'loadMore':
        return loadMore();
      case 'refresh':
        return refresh();
      case 'setFilter':
        return setFilter(
          command.filter,
          command.replace,
          command.debounce,
          command.silent,
        );
      case 'openFolder':
        return openFolder(command.folderId);
      case 'loadFolders':
        return loadFolders(command.parentId);
      case 'expandFolder': {
        if (!state.folders.expanded.includes(command.folderId)) {
          setFolders({
            ...state.folders,
            expanded: [...state.folders.expanded, command.folderId],
          });
        }
        if (state.folders.nodes[command.folderId]?.children === null) {
          return loadFolders(command.folderId);
        }
        return { ok: true };
      }
      case 'collapseFolder':
        setFolders({
          ...state.folders,
          expanded: state.folders.expanded.filter(
            (id) => id !== command.folderId,
          ),
        });
        return { ok: true };
      case 'select':
        setSelection(
          selectionClick(state.selection, order, command.id, command.modifiers),
        );
        return { ok: true };
      case 'toggleSelection':
        setSelection(toggleSelection(state.selection, command.id));
        return { ok: true };
      case 'extendSelection':
        setSelection(extendSelection(state.selection, order, command.id));
        return { ok: true };
      case 'focus':
        set({
          selection: {
            ...focusSelection(state.selection, command.id),
            hidden: state.selection.hidden,
          },
        });
        return { ok: true };
      case 'setSelection':
        setSelection(command.selection);
        return { ok: true };
      case 'selectAll':
        setSelection(selectAllLoaded(state.selection, order));
        return { ok: true };
      case 'selectAllMatching':
        setSelection(
          selectAllMatching(state.selection, state.collection.query, order),
        );
        return { ok: true };
      case 'clearSelection':
        set({ selection: { ...clearSelection(state.selection), hidden: 0 } });
        return { ok: true };
      case 'move':
        return move(command.ids, command.folderId);
      case 'archive':
        return archive(command.ids, command.force);
      case 'restore':
        return restore(command.ids);
      case 'setVisibility':
        return setVisibility(command.ids, command.status);
      case 'setProvenance':
        return setProvenance(command.ids, command.provenance);
      case 'updateAsset':
        return updateAsset(command.id, command.patch);
      case 'createFolder': {
        const parentId =
          command.parentId === undefined
            ? state.folders.currentId
            : command.parentId;
        try {
          const { folder } = await client.createFolder({
            body: parentId
              ? { name: command.name, parentFolderId: parentId }
              : { name: command.name },
          });
          await loadFolders(parentId);
          emit({ type: 'folder:changed', folderId: folder.id });
          return { ok: true, value: folder };
        } catch (error) {
          return fail(error);
        }
      }
      case 'renameFolder': {
        if (!client.renameFolder)
          return { ok: false, code: 'UNSUPPORTED', error: null };
        const node = state.folders.nodes[command.folderId];
        try {
          const { folder } = await client.renameFolder({
            body: { folderId: command.folderId, name: command.name },
          });
          if (node) {
            setFolders({
              ...state.folders,
              nodes: {
                ...state.folders.nodes,
                [folder.id]: { ...node, name: folder.name },
              },
            });
          }
          void loadFolders(node?.parentId ?? null);
          emit({ type: 'folder:changed', folderId: folder.id });
          return { ok: true, value: folder };
        } catch (error) {
          return fail(error);
        }
      }
      case 'moveFolder': {
        if (!client.moveFolder)
          return { ok: false, code: 'UNSUPPORTED', error: null };
        const from = state.folders.nodes[command.folderId]?.parentId ?? null;
        try {
          const { folder } = await client.moveFolder({
            body: {
              folderId: command.folderId,
              newParentFolderId: command.parentId,
            },
          });
          await reloadFolderLevels(from, command.parentId);
          if (state.folders.path.includes(command.folderId)) {
            void syncPath(state.folders.currentId);
          }
          emit({ type: 'folder:changed', folderId: folder.id });
          return {
            ok: true,
            value: folder,
            undo: () =>
              dispatch({
                type: 'moveFolder',
                folderId: command.folderId,
                parentId: from,
              }),
          };
        } catch (error) {
          return fail(error);
        }
      }
      case 'deleteFolder': {
        if (!client.deleteFolder)
          return { ok: false, code: 'UNSUPPORTED', error: null };
        try {
          const body: Parameters<
            NonNullable<MediaClient['deleteFolder']>
          >[0]['body'] = {
            folderId: command.folderId,
          };
          if (command.mode) body.mode = command.mode;
          if (command.dryRun) body.dryRun = true;
          const result = await client.deleteFolder({ body });
          if (!command.dryRun) {
            const parent =
              state.folders.nodes[command.folderId]?.parentId ?? null;
            await loadFolders(parent);
            if (state.folders.path.includes(command.folderId)) {
              await openFolder(parent);
            } else {
              void refresh();
            }
            emit({ type: 'folder:changed', folderId: command.folderId });
          }
          return { ok: true, value: result, skipped: result.skipped };
        } catch (error) {
          return fail(error);
        }
      }
      case 'receive':
        return receive(
          command.files,
          command.folderId,
          command.recreateFolders ?? false,
        );
      case 'assetUploaded':
        return assetUploaded(command.id);
      case 'openPreview':
        set({
          preview: {
            openId: command.id,
            ids: state.collection.ids.includes(command.id)
              ? [...state.collection.ids]
              : [command.id],
            zoom: 1,
            pan: { x: 0, y: 0 },
            rotation: 0,
          },
        });
        return { ok: true };
      case 'closePreview':
        set({ preview: { ...state.preview, openId: null } });
        return { ok: true };
      case 'previewStep': {
        const { openId, ids } = state.preview;
        const next = openId ? previewStep(ids, openId, command.delta) : null;
        if (!next) return { ok: false, code: 'END', error: null };
        set({
          preview: {
            ...state.preview,
            openId: next,
            zoom: 1,
            pan: { x: 0, y: 0 },
            rotation: 0,
          },
        });
        return { ok: true, value: next };
      }
      case 'previewZoom': {
        const zoom = clampZoom(command.zoom);
        set({
          preview: {
            ...state.preview,
            zoom,
            pan:
              zoom === 1 ? { x: 0, y: 0 } : (command.pan ?? state.preview.pan),
          },
        });
        return { ok: true };
      }
      case 'previewRotate':
        set({
          preview: {
            ...state.preview,
            rotation: rotateQuarter(state.preview.rotation),
          },
        });
        return { ok: true };
      case 'openDetail':
        return openDetail(command.id);
      case 'closeDetail':
        set({ detail: EMPTY_DETAIL });
        return { ok: true };
      case 'setDetailField': {
        const { asset } = state.detail;
        if (!asset) return { ok: false, code: 'ASSET_NOT_FOUND', error: null };
        const draft = setDraftField(
          state.detail.draft,
          command.field,
          command.value,
        );
        set({
          detail: {
            ...state.detail,
            draft,
            dirty: isDirty(detailValues(asset), draft),
          },
        });
        return { ok: true };
      }
      case 'resetDetail':
        set({
          detail: { ...state.detail, draft: {}, dirty: false, error: null },
        });
        return { ok: true };
      case 'saveDetail':
        return saveDetail();
      case 'resolveDetailConflict': {
        const newer = state.detail.conflict;
        if (!newer) return { ok: true };
        if (command.keep === 'theirs') {
          set({
            detail: {
              ...state.detail,
              asset: newer,
              draft: {},
              dirty: false,
              conflict: null,
              error: null,
              baseUpdatedAt: new Date(newer.updatedAt).toISOString(),
            },
          });
          patchCollectionAsset(newer);
          return { ok: true };
        }
        set({
          detail: {
            ...state.detail,
            asset: newer,
            conflict: null,
            error: null,
            baseUpdatedAt: new Date(newer.updatedAt).toISOString(),
          },
        });
        return saveDetail();
      }
      case 'setFocalPoint': {
        if (!client.setFocalPoint)
          return { ok: false, code: 'UNSUPPORTED', error: null };
        try {
          const { asset } = await client.setFocalPoint({
            body: { assetId: command.id, focal: command.focal },
          });
          patchCollectionAsset(asset);
          emit({ type: 'asset:updated', assetId: command.id });
          return { ok: true, value: asset };
        } catch (error) {
          return fail(error);
        }
      }
      case 'loadRevisions': {
        if (!client.listRevisions)
          return { ok: false, code: 'UNSUPPORTED', error: null };
        try {
          const { revisions } = await client.listRevisions({
            query: { assetId: command.id },
          });
          if (state.detail.assetId === command.id)
            set({ detail: { ...state.detail, revisions } });
          return { ok: true, value: revisions };
        } catch (error) {
          return fail(error);
        }
      }
      case 'setCurrentRevision': {
        if (!client.setCurrentRevision)
          return { ok: false, code: 'UNSUPPORTED', error: null };
        try {
          const { asset } = await client.setCurrentRevision({
            body: { assetId: command.id, revisionId: command.revisionId },
          });
          patchCollectionAsset(asset);
          emit({
            type: 'asset:replaced',
            assetId: command.id,
            revisionId: command.revisionId,
          });
          if (state.detail.assetId === command.id)
            void dispatch({ type: 'loadRevisions', id: command.id });
          return { ok: true, value: asset };
        } catch (error) {
          return fail(error);
        }
      }
      case 'setLayout':
        if (state.ui.layout !== command.layout) {
          set({ ui: { ...state.ui, layout: command.layout } });
        }
        return { ok: true };
      case 'setViewport': {
        const { width, height } = state.ui.viewport;
        if (width !== command.width || height !== command.height) {
          set({
            ui: {
              ...state.ui,
              viewport: { width: command.width, height: command.height },
            },
          });
        }
        return { ok: true };
      }
      case 'clearMutationError':
        if (
          state.mutation.status !== 'idle' ||
          state.mutation.skipped.length > 0
        ) {
          set({ mutation: IDLE_MUTATION });
        }
        return { ok: true };
    }
  };

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispatch: dispatch as MediaStore['dispatch'],
    on(type, listener) {
      const bucket = eventListeners.get(type) ?? new Set();
      eventListeners.set(type, bucket);
      const wrapped = listener as (event: MediaEvent) => void;
      bucket.add(wrapped);
      return () => {
        bucket.delete(wrapped);
      };
    },
    emit,
    registries,
    setUploader(upload) {
      uploader = upload;
    },
    client,
    pageSize,
    dispose() {
      disposed = true;
      clearSearchTimer();
      listController?.abort();
      listTicket++;
      unsubscribeServer?.();
      unsubscribeServer = null;
    },
  };
}

/** The assets of the collection in order. */
export function collectionAssets(state: MediaStoreState): MediaAsset[] {
  const { ids, byId } = state.collection;
  const out: MediaAsset[] = [];
  for (const id of ids) {
    const asset = byId[id];
    if (asset) out.push(asset);
  }
  return out;
}

/** The subfolders of the open folder (root level when none is open). */
export function currentFolders(state: MediaStoreState): MediaFolder[] {
  const { currentId, nodes, roots } = state.folders;
  const ids = currentId === null ? roots : (nodes[currentId]?.children ?? null);
  return (ids ?? []).flatMap((id) => (nodes[id] ? [nodes[id]] : []));
}

/** Why the collection is empty, for `data-empty-reason`; `null` when it is not. */
export function emptyReason(
  state: MediaStoreState,
): 'folder-empty' | 'no-results' | 'error' | 'no-permission' | null {
  const { status, ids, error, query } = state.collection;
  if (status === 'error') {
    const code = errorCodeOf(error);
    return code === 'FORBIDDEN' ||
      code === 'UNAUTHORIZED' ||
      code === 'ASSET_ACCESS_DENIED'
      ? 'no-permission'
      : 'error';
  }
  if (status !== 'idle' || ids.length > 0) return null;
  if (!isPlainFolderView(query)) return 'no-results';
  return currentFolders(state).length > 0 ? null : 'folder-empty';
}
