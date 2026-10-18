import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MediaEvent } from './store';
import type {
  MediaAsset,
  MediaAssetListQuery,
  MediaClient,
  MediaFolder,
  MediaServerEvent,
} from './types';

import { archiveAction, bulkContext, registerBuiltInBulkActions } from './bulk';
import {
  collectionAssets,
  createMediaStore,
  currentFolders,
  emptyReason,
} from './store';

function asset(id: string, overrides: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id,
    slug: id,
    mimeType: 'image/png',
    size: 100,
    objectKey: `${id}/a.png`,
    url: null,
    deliveryUrl: `/api/cms/media/asset/${id}`,
    status: 'private',
    folderId: null,
    variantOf: null,
    uploadedBy: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
};
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fakeClient() {
  const library = new Map<string, MediaAsset>();
  for (let i = 1; i <= 5; i++) library.set(`a${i}`, asset(`a${i}`));
  const folders: MediaFolder[] = [
    { id: 'f1', name: 'Products', parentId: null, folderCount: 1 },
    { id: 'f2', name: 'Shoes', parentId: 'f1', folderCount: 0 },
  ];
  let serverListener: ((event: MediaServerEvent) => void) | null = null;
  const client = {
    listAssets: vi.fn(
      async (args?: { query?: MediaAssetListQuery; signal?: AbortSignal }) => {
        const query = args?.query ?? {};
        const all = [...library.values()].filter((a) =>
          query.unfiled
            ? a.folderId === null
            : query.folderId
              ? a.folderId === query.folderId
              : true,
        );
        const start = query.cursor ? Number(query.cursor) : 0;
        const page = all.slice(start, start + (query.limit ?? 20));
        const end = start + page.length;
        return {
          assets: page,
          total: query.includeTotal === false ? null : all.length,
          hasMore: end < all.length,
          nextCursor: end < all.length ? String(end) : null,
        };
      },
    ),
    listFolders: vi.fn(
      async (args?: { query?: { parentFolderId?: string } }) => ({
        folders: folders.filter(
          (f) => f.parentId === (args?.query?.parentFolderId ?? null),
        ),
      }),
    ),
    createFolder: vi.fn(
      async ({ body }: { body: { name: string; parentFolderId?: string } }) => {
        const folder = {
          id: `new_${body.name}`,
          name: body.name,
          parentId: body.parentFolderId ?? null,
        };
        folders.push(folder);
        return { folder };
      },
    ),
    moveAssets: vi.fn(
      async ({
        body,
      }: {
        body: { assetIds?: string[]; folderId: string | null };
      }) => {
        for (const id of body.assetIds ?? [])
          library.set(id, { ...library.get(id)!, folderId: body.folderId });
        return {
          moved: body.assetIds?.length ?? 0,
          movedIds: body.assetIds ?? [],
          skipped: [],
        };
      },
    ),
    archiveAssets: vi.fn(
      async ({ body }: { body: { assetIds?: string[] } }) => {
        const archivedIds = (body.assetIds ?? []).filter((id) => id !== 'a2');
        for (const id of archivedIds) library.delete(id);
        const skipped = (body.assetIds ?? []).filter((id) => id === 'a2');
        return {
          archived: archivedIds.length,
          archivedIds,
          skipped,
          skippedReasons: Object.fromEntries(
            skipped.map((id) => [id, 'in_use']),
          ),
        };
      },
    ),
    updateAssetsStatus: vi.fn(
      async ({ body }: { body: { assetIds?: string[] } }) => ({
        updated: body.assetIds?.length ?? 0,
        updatedIds: body.assetIds ?? [],
        skipped: [],
      }),
    ),
    restoreAssets: vi.fn(
      async ({ body }: { body: { assetIds?: string[] } }) => {
        for (const id of body.assetIds ?? []) library.set(id, asset(id));
        return { restoredIds: body.assetIds ?? [], skipped: [] };
      },
    ),
    getAssets: vi.fn(async ({ query }: { query: { ids: string[] } }) => ({
      assets: query.ids.flatMap((id) =>
        library.has(id) ? [library.get(id)!] : [],
      ),
    })),
    getFolderPath: vi.fn(async ({ query }: { query: { folderId: string } }) => {
      const path: MediaFolder[] = [];
      let current = folders.find((f) => f.id === query.folderId) ?? null;
      while (current) {
        path.unshift(current);
        current = folders.find((f) => f.id === current!.parentId) ?? null;
      }
      return { path };
    }),
    subscribe: vi.fn((listener: (event: MediaServerEvent) => void) => {
      serverListener = listener;
      return () => {
        serverListener = null;
      };
    }),
    useUploadAssets: () => {
      throw new Error('not in a component');
    },
  };
  return {
    client: client as unknown as MediaClient,
    mocks: client,
    library,
    folders,
    serverEvent: (event: MediaServerEvent) => serverListener?.(event),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('media store', () => {
  it('loads folders, the full path of a deep start folder and the first page', async () => {
    const { client, library } = fakeClient();
    library.set('s1', asset('s1', { folderId: 'f2' }));
    const store = createMediaStore({
      client,
      defaultFolderId: 'f2',
      pageSize: 2,
    });
    await store.dispatch({ type: 'init' });
    const state = store.getState();
    expect(state.folders.path).toEqual(['f1', 'f2']);
    expect(state.folders.expanded).toContain('f1');
    expect(state.collection.ids).toEqual(['s1']);
    expect(state.collection.query.folderId).toBe('f2');
  });

  it('keeps old results while a filter loads and drops stale responses', async () => {
    const { client, mocks } = fakeClient();
    const store = createMediaStore({ client, pageSize: 2 });
    await store.dispatch({ type: 'load' });
    expect(store.getState().collection.ids).toEqual(['a1', 'a2']);

    const slow = deferred<Awaited<ReturnType<MediaClient['listAssets']>>>();
    const signals: (AbortSignal | undefined)[] = [];
    mocks.listAssets.mockImplementationOnce(async (args) => {
      signals.push(args?.signal);
      return slow.promise;
    });
    const first = store.dispatch({
      type: 'setFilter',
      filter: { kinds: ['image'] },
    });
    expect(store.getState().collection.status).toBe('refreshing');
    expect(store.getState().collection.ids).toEqual(['a1', 'a2']);
    const second = store.dispatch({
      type: 'setFilter',
      filter: { kinds: ['video'] },
    });
    expect(signals[0]?.aborted).toBe(true);
    slow.resolve({
      assets: [asset('stale')],
      total: 1,
      hasMore: false,
      nextCursor: null,
    });
    await Promise.all([first, second]);
    expect(store.getState().collection.ids).not.toContain('stale');
    expect(store.getState().collection.status).toBe('idle');
  });

  it('appends pages without counting again', async () => {
    const { client, mocks } = fakeClient();
    const store = createMediaStore({ client, pageSize: 2 });
    await store.dispatch({ type: 'load' });
    await store.dispatch({ type: 'loadMore' });
    await store.dispatch({ type: 'loadMore' });
    expect(store.getState().collection.ids).toEqual([
      'a1',
      'a2',
      'a3',
      'a4',
      'a5',
    ]);
    expect(store.getState().collection.total).toBe(5);
    expect(store.getState().collection.cursor).toBeNull();
    expect(mocks.listAssets.mock.calls[1][0]?.query?.includeTotal).toBe(false);
  });

  it('debounces typing in the search field', async () => {
    vi.useFakeTimers();
    const { client, mocks } = fakeClient();
    const store = createMediaStore({ client });
    const filters: string[] = [];
    const typed = createMediaStore({
      client,
      onFilterChange: (filter, mode) => filters.push(`${filter.q}:${mode}`),
    });
    void typed.dispatch({
      type: 'setFilter',
      filter: { q: 'h' },
      debounce: true,
    });
    void typed.dispatch({
      type: 'setFilter',
      filter: { q: 'ha' },
      debounce: true,
    });
    expect(mocks.listAssets).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(250);
    expect(mocks.listAssets).toHaveBeenCalledTimes(1);
    expect(mocks.listAssets.mock.calls[0][0]?.query?.q).toBe('ha');
    expect(filters).toEqual(['h:replace', 'ha:replace']);
    store.dispose();
  });

  it('moves optimistically, focuses the next item and undoes per origin folder', async () => {
    const { client, library } = fakeClient();
    const store = createMediaStore({
      client,
      selection: 'multiple',
      filter: { sort: 'created_desc', folderId: null },
    });
    await store.dispatch({ type: 'load' });
    await store.dispatch({ type: 'select', id: 'a2' });
    await store.dispatch({
      type: 'select',
      id: 'a3',
      modifiers: { range: true },
    });
    const events: MediaEvent[] = [];
    store.on('asset:moved', (event) => events.push(event));
    const result = await store.dispatch({ type: 'move', folderId: 'f1' });
    expect(result.ok).toBe(true);
    expect(store.getState().collection.ids).toEqual(['a1', 'a4', 'a5']);
    expect(store.getState().selection.focus).toBe('a4');
    expect(events).toEqual([
      { type: 'asset:moved', ids: ['a2', 'a3'], from: null, to: 'f1' },
    ]);
    expect(library.get('a2')?.folderId).toBe('f1');
    if (!result.ok || !result.undo) throw new Error('expected undo');
    await result.undo();
    expect(library.get('a2')?.folderId).toBeNull();
  });

  it('rolls back an optimistic archive on failure and keeps skipped assets', async () => {
    const { client, mocks } = fakeClient();
    const store = createMediaStore({ client, selection: 'multiple' });
    await store.dispatch({ type: 'load' });
    mocks.archiveAssets.mockRejectedValueOnce({ code: 'NETWORK_ERROR' });
    const failed = await store.dispatch({ type: 'archive', ids: ['a1'] });
    expect(failed).toMatchObject({ ok: false, code: 'NETWORK_ERROR' });
    expect(store.getState().collection.ids).toContain('a1');
    expect(store.getState().mutation.status).toBe('error');

    const done = await store.dispatch({ type: 'archive', ids: ['a1', 'a2'] });
    expect(done.ok && done.skipped).toEqual(['a2']);
    expect(store.getState().collection.ids).toEqual(['a2', 'a3', 'a4', 'a5']);
    expect(store.getState().mutation.skippedReasons).toEqual({ a2: 'in_use' });
    if (!done.ok || !done.undo) throw new Error('expected undo');
    await done.undo();
    expect(mocks.restoreAssets).toHaveBeenCalledWith({
      body: { assetIds: ['a1'] },
    });
  });

  it('sends allMatching to bulk endpoints when everything is selected', async () => {
    const { client, mocks } = fakeClient();
    const store = createMediaStore({
      client,
      selection: 'multiple',
      pageSize: 2,
      filter: { sort: 'created_desc', folderId: null },
    });
    await store.dispatch({ type: 'load' });
    await store.dispatch({ type: 'selectAllMatching' });
    await store.dispatch({ type: 'toggleSelection', id: 'a2' });
    await store.dispatch({ type: 'setVisibility', status: 'public' });
    expect(mocks.updateAssetsStatus).toHaveBeenCalledWith({
      body: {
        allMatching: { query: { unfiled: true }, except: ['a2'] },
        status: 'public',
      },
    });
  });

  it('reconciles server events and lets other modules react to asset:replaced', async () => {
    const { client, library, serverEvent } = fakeClient();
    const store = createMediaStore({ client });
    await store.dispatch({ type: 'load' });
    const replaced = vi.fn();
    store.on('asset:replaced', replaced);
    library.set('a1', asset('a1', { originalName: 'new.png' }));
    serverEvent({
      type: 'media.asset.replaced',
      assetId: 'a1',
      revisionId: 'r1',
    });
    await vi.waitFor(() => expect(replaced).toHaveBeenCalled());
    expect(store.getState().collection.byId.a1.originalName).toBe('new.png');
    expect(replaced).toHaveBeenCalledWith({
      type: 'asset:replaced',
      assetId: 'a1',
      revisionId: 'r1',
    });
    serverEvent({ type: 'media.asset.archived', assetId: 'a3' });
    await vi.waitFor(() =>
      expect(store.getState().collection.ids).not.toContain('a3'),
    );
    store.dispose();
  });

  it('inserts an uploaded asset at the top without reloading', async () => {
    const { client, mocks, library } = fakeClient();
    const store = createMediaStore({
      client,
      filter: { sort: 'created_desc', folderId: null },
    });
    await store.dispatch({ type: 'load' });
    library.set('up', asset('up'));
    const calls = mocks.listAssets.mock.calls.length;
    await store.dispatch({ type: 'assetUploaded', id: 'up' });
    expect(store.getState().collection.ids[0]).toBe('up');
    expect(mocks.listAssets.mock.calls.length).toBe(calls);
  });

  it('recreates a dropped folder structure parents first and runs file hooks', async () => {
    const { client, mocks } = fakeClient();
    const store = createMediaStore({ client });
    const uploads: [string[], string | undefined][] = [];
    store.setUploader(async (files, options) => {
      uploads.push([files.map((f) => f.name), options?.folderId]);
      return [];
    });
    store.registries.fileHooks.register({
      id: 'drop-txt',
      transform: (files) => files.filter((f) => !f.file.name.endsWith('.txt')),
    });
    const file = (name: string) => new File(['x'], name);
    await store.dispatch({
      type: 'receive',
      folderId: 'f1',
      recreateFolders: true,
      files: [
        { file: file('a.jpg'), relativePath: 'Trip/a.jpg' },
        { file: file('b.jpg'), relativePath: 'Trip/Day 1/b.jpg' },
        { file: file('note.txt'), relativePath: 'Trip/note.txt' },
      ],
    });
    expect(mocks.createFolder.mock.calls.map((c) => c[0].body)).toEqual([
      { name: 'Trip', parentFolderId: 'f1' },
      { name: 'Day 1', parentFolderId: 'new_Trip' },
    ]);
    expect(uploads).toEqual([
      [['a.jpg'], 'new_Trip'],
      [['b.jpg'], 'new_Day 1'],
    ]);
  });

  it('emits selection:changed, persists expanded folders and reports empty reasons', async () => {
    const { client } = fakeClient();
    const values = new Map<string, string>();
    const storage = {
      getItem: (k: string) => values.get(k) ?? null,
      setItem: (k: string, v: string) => void values.set(k, v),
    };
    const store = createMediaStore({
      client,
      selection: 'multiple',
      expandedStorage: { storage, key: 'x' },
    });
    const counts: number[] = [];
    store.on('selection:changed', (event) => counts.push(event.count));
    await store.dispatch({ type: 'init' });
    await store.dispatch({ type: 'selectAll' });
    await store.dispatch({ type: 'clearSelection' });
    expect(counts).toEqual([5, 0]);
    await store.dispatch({ type: 'expandFolder', folderId: 'f1' });
    expect(values.get('x')).toBe('["f1"]');
    expect(currentFolders(store.getState()).map((f) => f.id)).toEqual(['f1']);
    await store.dispatch({ type: 'openFolder', folderId: 'f2' });
    expect(emptyReason(store.getState())).toBe('folder-empty');
    await store.dispatch({
      type: 'setFilter',
      filter: { kinds: ['video'], folderId: 'f2' },
    });
    expect(emptyReason(store.getState())).toBe('no-results');
  });

  it('runs registered bulk actions through canExecute and the store', async () => {
    const { client } = fakeClient();
    const store = createMediaStore({ client, selection: 'multiple' });
    registerBuiltInBulkActions(store);
    await store.dispatch({ type: 'load' });
    expect(archiveAction.canExecute(bulkContext(store))).toBe('empty');
    await store.dispatch({ type: 'select', id: 'a4' });
    const context = bulkContext(store);
    expect(archiveAction.canExecute(context)).toBe(true);
    expect(store.registries.assetActions.list().map((a) => a.id)).toContain(
      'archive',
    );
    await store.registries.assetActions.get('archive')!.run(context);
    expect(collectionAssets(store.getState()).map((a) => a.id)).not.toContain(
      'a4',
    );
    store.registries.assetActions.register({
      id: 'custom',
      label: 'Send to DAM',
      canExecute: () => true,
      run: async () => ({ ok: true }),
    });
    expect(store.registries.assetActions.list().map((a) => a.id)).toContain(
      'custom',
    );
  });
});
