import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CmsAssetListResult } from '../editor/cms/types';

import { MAX_PAGE_SIZE, SEARCH_DEBOUNCE_MS, createMediaStore } from './store';
import {
  deferred,
  flush,
  makeAsset,
  makeAssets,
  makeClient,
  makeFolder,
} from './test-fixtures';

afterEach(() => {
  vi.useRealTimers();
});

function listResult(
  overrides: Partial<CmsAssetListResult> = {},
): CmsAssetListResult {
  return {
    assets: [makeAsset()],
    total: 1,
    hasMore: false,
    nextCursor: null,
    ...overrides,
  };
}

describe('createMediaStore', () => {
  it('drops a stale list response', async () => {
    const first = deferred<CmsAssetListResult>();
    const second = deferred<CmsAssetListResult>();
    const client = makeClient({
      listAssets: vi
        .fn()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise),
    });
    const store = createMediaStore({ client });

    void store.actions.load();
    void store.actions.load();
    expect(store.getState().status).toBe('loading');

    second.resolve(listResult({ assets: makeAssets(2, 'new_'), total: 2 }));
    await flush();
    expect(store.getState().assets.map((a) => a.id)).toEqual([
      'new_1',
      'new_2',
    ]);
    expect(store.getState().status).toBe('idle');

    first.resolve(listResult({ assets: makeAssets(1, 'old_') }));
    await flush();
    expect(store.getState().assets.map((a) => a.id)).toEqual([
      'new_1',
      'new_2',
    ]);
  });

  it('queries the root level as unfiled and a folder by id', async () => {
    const client = makeClient();
    const store = createMediaStore({ client, pageSize: 20 });
    await store.actions.load();
    expect(client.listFolders).toHaveBeenLastCalledWith({ query: {} });
    expect(client.listAssets).toHaveBeenLastCalledWith({
      query: {
        unfiled: true,
        sortBy: 'createdAt',
        sortDirection: 'desc',
        limit: 20,
      },
    });

    store.actions.navigate(makeFolder({ id: 'fld_a' }));
    await flush();
    expect(client.listFolders).toHaveBeenLastCalledWith({
      query: { parentFolderId: 'fld_a' },
    });
    expect(client.listAssets).toHaveBeenLastCalledWith({
      query: {
        folderId: 'fld_a',
        sortBy: 'createdAt',
        sortDirection: 'desc',
        limit: 20,
      },
    });
  });

  it('navigate pushes children, truncates on a path entry and resets search and selection', async () => {
    const client = makeClient();
    const store = createMediaStore({ client, selection: 'multiple' });
    await store.actions.load();
    const a = makeFolder({ id: 'fld_a' });
    const b = makeFolder({ id: 'fld_b', parentId: 'fld_a' });
    const c = makeFolder({ id: 'fld_c', parentId: 'fld_b' });

    store.actions.navigate(a);
    store.actions.navigate(b);
    store.actions.navigate(c);
    await flush();
    expect(store.getState().folderId).toBe('fld_c');
    expect(store.getState().path.map((f) => f.id)).toEqual([
      'fld_a',
      'fld_b',
      'fld_c',
    ]);

    store.actions.select('ast_1');
    store.actions.setSearch('hero');
    expect(store.getState().selected).toEqual(['ast_1']);
    expect(store.getState().search).toBe('hero');

    store.actions.navigate(a);
    await flush();
    expect(store.getState().folderId).toBe('fld_a');
    expect(store.getState().path.map((f) => f.id)).toEqual(['fld_a']);
    expect(store.getState().search).toBe('');
    expect(store.getState().selected).toEqual([]);

    store.actions.navigate(null);
    await flush();
    expect(store.getState().folderId).toBeNull();
    expect(store.getState().path).toEqual([]);
  });

  it('navigating from an unknown starting folder into a child keeps a placeholder ancestor', async () => {
    const client = makeClient();
    const store = createMediaStore({ client, defaultFolderId: 'fld_x' });
    await store.actions.load();
    const child = makeFolder({ id: 'fld_y', parentId: 'fld_x' });

    store.actions.navigate(child);
    await flush();
    expect(store.getState().folderId).toBe('fld_y');
    expect(store.getState().path).toEqual([
      { id: 'fld_x', name: '…', parentId: null },
      child,
    ]);

    const placeholder = store.getState().path[0]!;
    store.actions.navigate(placeholder);
    await flush();
    expect(store.getState().folderId).toBe('fld_x');
    expect(store.getState().path).toEqual([placeholder]);

    const elsewhere = makeFolder({ id: 'fld_z', parentId: 'fld_other' });
    store.actions.navigate(elsewhere);
    await flush();
    expect(store.getState().path).toEqual([elsewhere]);
  });

  it('clamps pageSize to 1..MAX_PAGE_SIZE', async () => {
    const limitOf = async (pageSize: number) => {
      const client = makeClient();
      await createMediaStore({ client, pageSize }).actions.load();
      return client.listAssets.mock.calls[0]?.[0]?.query?.limit;
    };
    expect(await limitOf(0)).toBe(1);
    expect(await limitOf(-5)).toBe(1);
    expect(await limitOf(Number.NaN)).toBe(1);
    expect(await limitOf(40)).toBe(40);
    expect(await limitOf(1000)).toBe(MAX_PAGE_SIZE);
  });

  it('starts at defaultFolderId with an empty path', () => {
    const store = createMediaStore({
      client: makeClient(),
      defaultFolderId: 'fld_x',
    });
    expect(store.getState().folderId).toBe('fld_x');
    expect(store.getState().path).toEqual([]);
  });

  it('loadMore appends and passes the cursor', async () => {
    const client = makeClient({
      listAssets: vi
        .fn()
        .mockResolvedValueOnce(
          listResult({
            assets: makeAssets(2),
            total: 3,
            hasMore: true,
            nextCursor: 'c1',
          }),
        )
        .mockResolvedValueOnce(
          listResult({ assets: [makeAsset({ id: 'ast_3' })], total: 3 }),
        ),
    });
    const store = createMediaStore({ client, pageSize: 2 });
    await store.actions.load();
    expect(store.getState().nextCursor).toBe('c1');

    const pending = store.actions.loadMore();
    expect(store.getState().status).toBe('loadingMore');
    await pending;
    expect(client.listAssets).toHaveBeenLastCalledWith({
      query: {
        unfiled: true,
        sortBy: 'createdAt',
        sortDirection: 'desc',
        limit: 2,
        cursor: 'c1',
      },
    });
    expect(store.getState().assets.map((a) => a.id)).toEqual([
      'ast_1',
      'ast_2',
      'ast_3',
    ]);
    expect(store.getState().nextCursor).toBeNull();
    expect(store.getState().status).toBe('idle');

    await store.actions.loadMore();
    expect(client.listAssets).toHaveBeenCalledTimes(2);
  });

  it('refresh asks for at least the assets already shown', async () => {
    const client = makeClient({
      listAssets: vi.fn(async () =>
        listResult({ assets: makeAssets(5), total: 5 }),
      ),
    });
    const store = createMediaStore({ client, pageSize: 2 });
    await store.actions.load();
    await store.actions.refresh();
    expect(client.listAssets.mock.calls[1]?.[0]?.query?.limit).toBe(5);
  });

  it('archive resolves with skipped ids from the client and refreshes', async () => {
    const client = makeClient({
      archiveAssets: vi.fn(async () => ({
        archived: 1,
        archivedIds: ['ast_1'],
        skipped: ['ast_2'],
      })),
    });
    const store = createMediaStore({ client });
    await store.actions.load();
    expect(client.listAssets).toHaveBeenCalledTimes(1);

    const result = await store.actions.archive(['ast_1', 'ast_2']);
    expect(result).toEqual({ ids: ['ast_1'], skipped: ['ast_2'] });
    expect(store.getState().mutation).toEqual({
      status: 'idle',
      error: null,
      skipped: ['ast_2'],
    });
    expect(client.listAssets).toHaveBeenCalledTimes(2);
  });

  it('a rejected archive sets mutation.error and leaves the list state alone', async () => {
    const failure = new Error('in use');
    const client = makeClient({
      archiveAssets: vi.fn(async () => {
        throw failure;
      }),
    });
    const store = createMediaStore({ client });
    await store.actions.load();

    await expect(store.actions.archive(['ast_1'])).rejects.toBe(failure);
    expect(store.getState().mutation.status).toBe('error');
    expect(store.getState().mutation.error).toBe(failure);
    expect(store.getState().status).toBe('idle');
    expect(store.getState().error).toBeNull();
    expect(client.listAssets).toHaveBeenCalledTimes(1);

    store.actions.clearMutationError();
    expect(store.getState().mutation.status).toBe('idle');
  });

  it('move, setStatus and createFolder resolve with the client result', async () => {
    const client = makeClient();
    const store = createMediaStore({ client });
    store.actions.navigate(makeFolder({ id: 'fld_a' }));
    await flush();

    await expect(store.actions.move(['ast_1'], null)).resolves.toEqual({
      ids: ['ast_1'],
      skipped: [],
    });
    expect(client.moveAssets).toHaveBeenCalledWith({
      body: { assetIds: ['ast_1'], folderId: null },
    });

    await expect(
      store.actions.setStatus(['ast_1'], 'private'),
    ).resolves.toEqual({ ids: ['ast_1'], skipped: [] });

    const folder = await store.actions.createFolder('Images');
    expect(folder.name).toBe('Images');
    expect(client.createFolder).toHaveBeenCalledWith({
      body: { name: 'Images', parentFolderId: 'fld_a' },
    });
  });

  it('prunes the selection after a refresh that no longer contains an id', async () => {
    const client = makeClient({
      listAssets: vi
        .fn()
        .mockResolvedValueOnce(listResult({ assets: makeAssets(2), total: 2 }))
        .mockResolvedValueOnce(
          listResult({ assets: [makeAsset({ id: 'ast_2' })], total: 1 }),
        ),
    });
    const store = createMediaStore({ client, selection: 'multiple' });
    await store.actions.load();
    store.actions.toggle('ast_1');
    store.actions.toggle('ast_2');
    expect(store.getState().selected).toEqual(['ast_1', 'ast_2']);

    await store.actions.refresh();
    expect(store.getState().selected).toEqual(['ast_2']);
  });

  it('selection modes: single replaces, multiple toggles, none ignores', () => {
    const single = createMediaStore({
      client: makeClient(),
      selection: 'single',
    });
    single.actions.select('a');
    single.actions.select('b');
    expect(single.getState().selected).toEqual(['b']);
    single.actions.toggle('b');
    expect(single.getState().selected).toEqual([]);

    const multiple = createMediaStore({
      client: makeClient(),
      selection: 'multiple',
    });
    multiple.actions.select('a');
    multiple.actions.toggle('b');
    multiple.actions.toggle('a');
    expect(multiple.getState().selected).toEqual(['b']);
    multiple.actions.clearSelection();
    expect(multiple.getState().selected).toEqual([]);

    const none = createMediaStore({ client: makeClient() });
    none.actions.select('a');
    none.actions.toggle('a');
    expect(none.getState().selected).toEqual([]);
  });

  it('setSearch debounces the reload and dispose cancels it', async () => {
    vi.useFakeTimers();
    const client = makeClient();
    const store = createMediaStore({ client });

    store.actions.setSearch('h');
    store.actions.setSearch('he');
    expect(store.getState().search).toBe('he');
    expect(client.listAssets).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    expect(client.listAssets).toHaveBeenCalledTimes(1);
    expect(client.listAssets.mock.calls[0]?.[0]?.query?.search).toBe('he');

    store.actions.setSearch('her');
    store.actions.dispose();
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    expect(client.listAssets).toHaveBeenCalledTimes(1);
  });

  it('a failed load clears the cursor so loadMore does not append to the old list', async () => {
    const client = makeClient({
      listAssets: vi
        .fn()
        .mockResolvedValueOnce(
          listResult({
            assets: makeAssets(2),
            hasMore: true,
            nextCursor: 'c1',
          }),
        )
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValue(listResult({ assets: makeAssets(1, 'next_') })),
    });
    const store = createMediaStore({ client });
    await store.actions.load();
    expect(store.getState().nextCursor).toBe('c1');

    await store.actions.refresh();
    expect(store.getState().status).toBe('error');
    expect(store.getState().nextCursor).toBeNull();

    await store.actions.loadMore();
    expect(client.listAssets).toHaveBeenCalledTimes(2);
    expect(store.getState().assets.map((a) => a.id)).toEqual([
      'ast_1',
      'ast_2',
    ]);
  });

  it('setSearch and setSort clear the cursor before reloading', async () => {
    vi.useFakeTimers();
    const client = makeClient({
      listAssets: vi.fn(async () =>
        listResult({ hasMore: true, nextCursor: 'c1' }),
      ),
    });
    const store = createMediaStore({ client });
    await store.actions.load();
    expect(store.getState().nextCursor).toBe('c1');

    store.actions.setSearch('hero');
    expect(store.getState().nextCursor).toBeNull();
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    expect(store.getState().nextCursor).toBe('c1');

    store.actions.setSort('slug', 'asc');
    expect(store.getState().nextCursor).toBeNull();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getState().nextCursor).toBe('c1');
    expect(
      client.listAssets.mock.calls.every(([arg]) => !arg?.query?.cursor),
    ).toBe(true);
  });

  it('a rejected list sets status error and a later load recovers', async () => {
    const failure = new Error('offline');
    const client = makeClient({
      listAssets: vi
        .fn()
        .mockRejectedValueOnce(failure)
        .mockResolvedValueOnce(listResult()),
    });
    const store = createMediaStore({ client });
    await store.actions.load();
    expect(store.getState().status).toBe('error');
    expect(store.getState().error).toBe(failure);

    await store.actions.load();
    expect(store.getState().status).toBe('idle');
    expect(store.getState().error).toBeNull();
  });
});
