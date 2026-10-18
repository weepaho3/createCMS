import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from '@testing-library/react';
// @vitest-environment happy-dom
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MediaStore } from './core/store';
import type { MediaAsset, MediaFolder } from './core/types';

import { createMediaStore } from './core/store';
import {
  Bulk,
  Filter,
  Folder,
  Intake,
  Media,
  Selection,
  useIntakePaste,
} from './index';
import {
  makeAsset,
  makeClient,
  makeEntry,
  makeFolder,
  makeUploadState,
} from './test-fixtures';

afterEach(cleanup);

function assets(count: number): MediaAsset[] {
  return Array.from({ length: count }, (_, i) =>
    makeAsset({
      id: `a${i + 1}`,
      originalName: `photo-${String(i + 1).padStart(2, '0')}.png`,
      width: 1600,
      height: 1200,
      size: 2048,
    }),
  );
}

function setup(
  options: {
    count?: number;
    folders?: MediaFolder[];
    selection?: 'none' | 'single' | 'multiple';
    client?: ReturnType<typeof makeClient>;
    width?: number;
    children?: React.ReactNode;
    gridProps?: Partial<React.ComponentProps<typeof Media.Grid>>;
  } = {},
) {
  const list = assets(options.count ?? 7);
  const folders = options.folders ?? [];
  const client =
    options.client ??
    makeClient({
      listAssets: vi.fn(async () => ({
        assets: list,
        total: list.length,
        hasMore: false,
        nextCursor: null,
      })),
      listFolders: vi.fn(
        async (args?: { query?: { parentFolderId?: string } }) => ({
          folders: folders.filter(
            (f) => f.parentId === (args?.query?.parentFolderId ?? null),
          ),
        }),
      ),
    });
  const store = createMediaStore({
    client,
    selection: options.selection ?? 'multiple',
  });
  const view = render(
    <Media.Root client={client} store={store}>
      <Media.Grid
        data-testid="grid"
        minCell={150}
        gap={10}
        {...options.gridProps}
      >
        {(asset) => (
          <Media.Item key={asset.id} asset={asset}>
            <Selection.Checkbox />
            <Media.Thumbnail />
            {asset.originalName}
          </Media.Item>
        )}
      </Media.Grid>
      {options.children}
    </Media.Root>,
  );
  return { ...view, store, client, list };
}

async function ready(store: MediaStore, width = 500) {
  await act(async () => {
    await store.dispatch({ type: 'init' });
    await store.dispatch({ type: 'setViewport', width, height: 800 });
  });
}

describe('Media.Grid', () => {
  it('is an APG grid of rows and gridcells from the layout', async () => {
    const { store, getByTestId, getAllByRole } = setup();
    await ready(store);
    const grid = getByTestId('grid');
    expect(grid.getAttribute('role')).toBe('grid');
    expect(grid.getAttribute('aria-label')).toBe('Assets');
    expect(grid.getAttribute('aria-multiselectable')).toBe('true');
    expect(grid.getAttribute('aria-colcount')).toBe('3');
    expect(grid.getAttribute('aria-rowcount')).toBe('3');
    const rows = getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(rows[1].getAttribute('aria-rowindex')).toBe('2');
    const cells = getAllByRole('gridcell');
    expect(cells).toHaveLength(7);
    expect(cells[4].getAttribute('aria-colindex')).toBe('2');
    expect(cells[0].getAttribute('aria-label')).toBe('photo-01.png');
    const description = document.getElementById(
      cells[0].getAttribute('aria-describedby')!,
    );
    expect(description?.textContent).toBe('Image, 1,600 by 1,200 pixels, 2 kB');
    expect(cells[4].style.left).toBe('170px');
  });

  it('moves the focus a row up and down and clamps into a short last row', async () => {
    const { store, getAllByRole } = setup();
    await ready(store);
    const cells = () => getAllByRole('gridcell');
    act(() => cells()[1].focus());
    fireEvent.keyDown(cells()[1], { key: 'ArrowDown' });
    await waitFor(() =>
      expect(document.activeElement?.getAttribute('aria-label')).toBe(
        'photo-05.png',
      ),
    );
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    await waitFor(() =>
      expect(document.activeElement?.getAttribute('aria-label')).toBe(
        'photo-07.png',
      ),
    );
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    await waitFor(() =>
      expect(document.activeElement?.getAttribute('aria-label')).toBe(
        'photo-04.png',
      ),
    );
    expect(cells().filter((c) => c.tabIndex === 0)).toHaveLength(1);
    expect(store.getState().selection.selected).toEqual([]);
  });

  it('extends with Shift+Arrow, toggles with Space and selects all with Ctrl+A', async () => {
    const { store, getAllByRole } = setup();
    await ready(store);
    const cells = getAllByRole('gridcell');
    fireEvent.click(cells[0]);
    fireEvent.keyDown(cells[0], { key: 'ArrowRight', shiftKey: true });
    fireEvent.keyDown(cells[0], { key: 'ArrowRight', shiftKey: true });
    expect(store.getState().selection.selected).toEqual(['a1', 'a2', 'a3']);
    fireEvent.keyDown(cells[0], { key: ' ' });
    expect(store.getState().selection.selected).toEqual(['a1', 'a2']);
    fireEvent.keyDown(cells[0], { key: 'a', ctrlKey: true, metaKey: true });
    expect(store.getState().selection.selected).toHaveLength(7);
    fireEvent.keyDown(cells[0], { key: 'Escape' });
    expect(store.getState().selection.selected).toEqual([]);
  });

  it('selects like Finder with modifier clicks and toggles with the visible checkbox', async () => {
    const { store, getAllByRole } = setup();
    await ready(store);
    const cells = getAllByRole('gridcell');
    fireEvent.click(cells[1]);
    fireEvent.click(cells[4], { shiftKey: true });
    expect(store.getState().selection.selected).toEqual([
      'a2',
      'a3',
      'a4',
      'a5',
    ]);
    fireEvent.click(cells[2], { shiftKey: true });
    expect(store.getState().selection.selected).toEqual(['a2', 'a3']);
    const checkbox = getAllByRole('checkbox', {
      name: 'Select photo-07.png',
    })[0];
    fireEvent.click(checkbox);
    expect(store.getState().selection.selected).toEqual(['a2', 'a3', 'a7']);
    expect(cells[6].getAttribute('aria-selected')).toBe('true');
  });

  it('jumps by type-ahead and calls onAction on Enter', async () => {
    const onAction = vi.fn();
    const { store, getAllByRole } = setup({ gridProps: { onAction } });
    await ready(store);
    const cells = getAllByRole('gridcell');
    act(() => cells[0].focus());
    fireEvent.keyDown(cells[0], { key: 'p' });
    await waitFor(() => expect(store.getState().selection.focus).toBe('a2'));
    fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
    expect(onAction).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a2' }),
    );
  });

  it('mounts only the rows in view plus overscan from the virtualization threshold', async () => {
    const { store, getAllByRole } = setup({ count: 600 });
    await ready(store);
    const rows = getAllByRole('row');
    expect(rows.length).toBeGreaterThan(2);
    expect(rows.length).toBeLessThan(15);
    expect(getAllByRole('gridcell').length).toBeLessThanOrEqual(
      rows.length * 3,
    );
  });

  it('loads thumbnails from the 320 rendition with dimensions and empty alt', async () => {
    const asset = makeAsset({
      id: 'r1',
      width: 2000,
      height: 1000,
      status: 'private',
      url: null,
      metadata: { dominantColor: '#336699' },
      variants: [
        { variantKey: 'w320.webp', width: 320, height: 160, size: 1 },
        { variantKey: 'w640.webp', width: 640, height: 320, size: 1 },
      ],
    });
    const client = makeClient({
      listAssets: vi.fn(async () => ({
        assets: [asset],
        total: 1,
        hasMore: false,
        nextCursor: null,
      })),
    });
    const { store, container } = setup({ client });
    await ready(store);
    const img = container.querySelector('img')!;
    expect(img.getAttribute('src')).toBe(
      '/api/cms/media/asset/r1?w=320&format=webp',
    );
    expect(img.getAttribute('srcset')).toContain('w=640&format=webp 640w');
    expect(img.getAttribute('alt')).toBe('');
    expect(img.getAttribute('width')).toBe('2000');
    expect(img.getAttribute('loading')).toBe('eager');
    expect(img.style.backgroundColor).toBeTruthy();
    expect(img.hasAttribute('data-placeholder')).toBe(true);
    fireEvent.load(img);
    expect(img.hasAttribute('data-loaded')).toBe(true);
    expect(img.style.backgroundColor).toBe('');
  });

  it('shows uploads in flight as tiles with a revoked object URL preview', async () => {
    const revoke = vi.fn();
    const create = vi.fn(() => 'blob:preview');
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const uploads = makeUploadState({
      isUploading: true,
      files: [
        makeEntry({
          id: 'u1',
          name: 'new.png',
          status: 'uploading',
          progress: 0.5,
        }),
      ],
    });
    const client = makeClient({
      useUploadAssets: vi.fn(() => uploads),
      listAssets: vi.fn(async () => ({
        assets: assets(2),
        total: 2,
        hasMore: false,
        nextCursor: null,
      })),
    });
    const { store, getAllByRole, container } = setup({
      client,
      gridProps: {
        renderUpload: (entry) => (
          <Media.UploadTile key={entry.id}>
            <Media.UploadPreview />
          </Media.UploadTile>
        ),
      },
    });
    await ready(store);
    const cells = getAllByRole('gridcell');
    expect(cells[0].getAttribute('aria-label')).toBe('new.png, uploading 50%');
    expect(cells[0].getAttribute('data-status')).toBe('uploading');
    const preview = container.querySelector('img[src="blob:preview"]')!;
    fireEvent.load(preview);
    expect(revoke).toHaveBeenCalledWith('blob:preview');
  });
});

describe('collection parts', () => {
  it('explains empty states and loads more with an announcement', async () => {
    const client = makeClient({
      listAssets: vi
        .fn()
        .mockResolvedValueOnce({
          assets: assets(2),
          total: 4,
          hasMore: true,
          nextCursor: 'c',
        })
        .mockResolvedValueOnce({
          assets: assets(4).slice(2),
          total: null,
          hasMore: false,
          nextCursor: null,
        }),
    });
    const { store, getByRole, queryByRole } = setup({
      client,
      children: (
        <>
          <Media.LoadMore />
          <Media.Empty data-testid="empty" />
        </>
      ),
    });
    await ready(store);
    fireEvent.click(getByRole('button', { name: 'Load more' }));
    await waitFor(() =>
      expect(getByRole('status').textContent).toBe(
        '2 more assets loaded, 4 of 4',
      ),
    );
    expect(queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('marks an empty folder and a filter without results differently', async () => {
    const client = makeClient({
      listAssets: vi.fn(async () => ({
        assets: [],
        total: 0,
        hasMore: false,
        nextCursor: null,
      })),
    });
    const { store, getByTestId } = setup({
      client,
      children: <Media.Empty data-testid="empty" />,
    });
    await ready(store);
    expect(getByTestId('empty').getAttribute('data-empty-reason')).toBe(
      'folder-empty',
    );
    expect(getByTestId('empty').textContent).toBe('This folder is empty.');
    await act(async () => {
      await store.dispatch({ type: 'setFilter', filter: { kinds: ['video'] } });
    });
    expect(getByTestId('empty').getAttribute('data-empty-reason')).toBe(
      'no-results',
    );
  });
});

describe('selection and bulk parts', () => {
  function bulkUi(confirm = vi.fn(async () => true)) {
    return (
      <>
        <Selection.Count data-testid="count" />
        <Selection.SelectAllMatching />
        <Bulk.Bar>
          {(actions) =>
            actions.map(({ action }) => (
              <Bulk.Action
                key={action.id}
                action={action.id}
                confirm={confirm}
              />
            ))
          }
        </Bulk.Bar>
        <Bulk.Outcome>
          {({ message, undo }) => (
            <p data-testid="outcome">
              {message}
              {undo ? (
                <button type="button" onClick={undo}>
                  undo
                </button>
              ) : null}
            </p>
          )}
        </Bulk.Outcome>
      </>
    );
  }

  it('archives the selection, focuses the next item and offers undo', async () => {
    const restoreAssets = vi.fn(
      async ({ body }: { body: { assetIds?: string[] } }) => ({
        restoredIds: body.assetIds ?? [],
        skipped: [],
      }),
    );
    const list = assets(4);
    const client = makeClient({
      listAssets: vi.fn(async () => ({
        assets: list,
        total: 4,
        hasMore: false,
        nextCursor: null,
      })),
      restoreAssets,
    });
    const confirm = vi.fn(async () => true);
    const { store, getAllByRole, getByRole, getByTestId } = setup({
      client,
      children: bulkUi(confirm),
    });
    await ready(store);
    fireEvent.click(getAllByRole('gridcell')[1]);
    expect(getByTestId('count').textContent).toBe('1 selected');
    const archive = getByRole('button', { name: 'Archive' });
    const makePublic = getByRole('button', { name: 'Make public' });
    expect(makePublic.getAttribute('data-disabled-reason')).toBe('all-public');
    expect(makePublic.getAttribute('aria-disabled')).toBe('true');
    await act(async () => {
      fireEvent.click(archive);
    });
    await waitFor(() =>
      expect(getByTestId('outcome').textContent).toContain('1 asset archived.'),
    );
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'archive', count: 1 }),
    );
    expect(store.getState().collection.ids).toEqual(['a1', 'a3', 'a4']);
    await waitFor(() =>
      expect(document.activeElement?.getAttribute('aria-label')).toBe(
        'photo-03.png',
      ),
    );
    fireEvent.click(getByRole('button', { name: 'undo' }));
    await waitFor(() =>
      expect(restoreAssets).toHaveBeenCalledWith({
        body: { assetIds: ['a2'] },
      }),
    );
  });

  it('offers select all matching when the server has more than loaded', async () => {
    const client = makeClient({
      listAssets: vi.fn(async () => ({
        assets: assets(3),
        total: 312,
        hasMore: true,
        nextCursor: 'x',
      })),
    });
    const { store, getAllByRole, getByRole, getByTestId } = setup({
      client,
      children: bulkUi(),
    });
    await ready(store);
    fireEvent.click(getAllByRole('gridcell')[0]);
    fireEvent.click(getByRole('button', { name: 'Select all 312' }));
    expect(getByTestId('count').textContent).toBe('All 312 selected');
    await act(async () => {
      fireEvent.click(getByRole('button', { name: 'Archive' }));
    });
    expect(client.archiveAssets).toHaveBeenCalledWith({
      body: { allMatching: { query: { unfiled: true }, except: [] } },
    });
  });

  it('shows registered custom actions', async () => {
    const { store, getAllByRole, getByRole } = setup({ children: bulkUi() });
    await ready(store);
    const run = vi.fn(async () => ({ ok: true as const }));
    act(() => {
      store.registries.assetActions.register({
        id: 'dam',
        label: 'Send to DAM',
        canExecute: () => true,
        run,
      });
    });
    fireEvent.click(getAllByRole('gridcell')[0]);
    await act(async () => {
      fireEvent.click(getByRole('button', { name: 'Send to DAM' }));
    });
    expect(run).toHaveBeenCalled();
  });
});

describe('folder parts', () => {
  const folders = [
    makeFolder({ id: 'f1', name: 'Products', folderCount: 1 }),
    makeFolder({ id: 'f2', name: 'Press', folderCount: 0 }),
    makeFolder({ id: 'f11', name: 'Shoes', parentId: 'f1', folderCount: 0 }),
  ];

  function tree() {
    return (
      <Folder.Tree data-testid="tree">
        {(row) => (
          <Folder.Item row={row}>
            <Folder.Toggle />
            {row.name}
            <Folder.Rename />
          </Folder.Item>
        )}
      </Folder.Tree>
    );
  }

  it('is an APG tree with lazy children and keyboard expansion', async () => {
    const { store, getAllByRole, client } = setup({
      folders,
      children: tree(),
    });
    await ready(store);
    const items = () => getAllByRole('treeitem');
    expect(items().map((i) => i.textContent)).toEqual(['Products', 'Press']);
    expect(items()[0].getAttribute('aria-level')).toBe('1');
    expect(items()[0].getAttribute('aria-setsize')).toBe('2');
    expect(items()[1].getAttribute('aria-posinset')).toBe('2');
    expect(items()[0].getAttribute('aria-expanded')).toBe('false');
    expect(items()[1].hasAttribute('aria-expanded')).toBe(false);
    act(() => items()[0].focus());
    await act(async () => {
      fireEvent.keyDown(items()[0], { key: 'ArrowRight' });
    });
    await waitFor(() =>
      expect(items().map((i) => i.textContent)).toEqual([
        'Products',
        'Shoes',
        'Press',
      ]),
    );
    expect(client.listFolders).toHaveBeenCalledWith({
      query: { parentFolderId: 'f1' },
    });
    fireEvent.keyDown(items()[0], { key: 'ArrowRight' });
    await waitFor(() =>
      expect(document.activeElement?.textContent).toBe('Shoes'),
    );
    expect(items()[1].getAttribute('aria-level')).toBe('2');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    await waitFor(() =>
      expect(document.activeElement?.textContent).toBe('Products'),
    );
  });

  it('renames inline with F2 and keeps a name conflict inline', async () => {
    const renameFolder = vi
      .fn()
      .mockRejectedValueOnce({ code: 'FOLDER_NAME_TAKEN' })
      .mockResolvedValueOnce({
        folder: { id: 'f2', name: 'Press kit', parentId: null },
      });
    const client = makeClient({
      listAssets: vi.fn(async () => ({
        assets: [],
        total: 0,
        hasMore: false,
        nextCursor: null,
      })),
      listFolders: vi.fn(
        async (args?: { query?: { parentFolderId?: string } }) => ({
          folders: folders.filter(
            (f) => f.parentId === (args?.query?.parentFolderId ?? null),
          ),
        }),
      ),
      renameFolder,
    });
    const { store, getAllByRole, getByRole } = setup({
      client,
      children: tree(),
    });
    await ready(store);
    act(() => getAllByRole('treeitem')[1].focus());
    fireEvent.keyDown(getAllByRole('treeitem')[1], { key: 'F2' });
    const input = getByRole('textbox', {
      name: 'Folder name',
    }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Products' } });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(
      document.querySelector('[data-folder-name-error]')?.textContent,
    ).toBe('A folder with this name already exists here.');
    fireEvent.change(input, { target: { value: 'Press kit' } });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    expect(renameFolder).toHaveBeenLastCalledWith({
      body: { folderId: 'f2', name: 'Press kit' },
    });
  });

  it('collapses deep breadcrumbs and resolves the full path of a start folder', async () => {
    const chain = ['A', 'B', 'C', 'D', 'E'].map((name, i, all) =>
      makeFolder({ id: name, name, parentId: i === 0 ? null : all[i - 1] }),
    );
    const client = makeClient({
      listAssets: vi.fn(async () => ({
        assets: [],
        total: 0,
        hasMore: false,
        nextCursor: null,
      })),
      getFolderPath: vi.fn(async () => ({ path: chain })),
    });
    const store = createMediaStore({ client, defaultFolderId: 'E' });
    const { getByTestId } = render(
      <Media.Root client={client} store={store}>
        <Media.Breadcrumbs data-testid="crumbs">
          {({ head, overflow, tail }) => (
            <>
              {head.map((f) => (
                <Media.Crumb key={f.id} folder={f} />
              ))}
              <span data-testid="overflow">
                {overflow.map((f) => f.name).join('/')}
              </span>
              {tail.map((f) => (
                <Media.Crumb key={f.id} folder={f} />
              ))}
            </>
          )}
        </Media.Breadcrumbs>
      </Media.Root>,
    );
    await act(async () => {
      await store.dispatch({ type: 'init' });
    });
    const crumbs = getByTestId('crumbs');
    expect(crumbs.textContent).toBe('AB/CDE');
    expect(crumbs.querySelector('[aria-current="page"]')?.textContent).toBe(
      'E',
    );
    expect(crumbs.textContent).not.toContain('…');
  });
});

describe('filter parts', () => {
  it('toggles chips with facet counts and searches with a debounce', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const getAssetFacets = vi.fn(async () => ({
      kinds: { image: 7, video: 2 },
      provenance: {},
      visibility: {},
    }));
    const client = makeClient({
      listAssets: vi.fn(async () => ({
        assets: assets(2),
        total: 2,
        hasMore: false,
        nextCursor: null,
      })),
      getAssetFacets,
    });
    const { store, getByRole } = setup({
      client,
      children: (
        <>
          <Media.Search />
          <Filter.Chip
            dimension="kinds"
            value="video"
            facets={{ kinds: { video: 2 }, provenance: {}, visibility: {} }}
          />
          <Filter.Clear />
        </>
      ),
    });
    await ready(store);
    const chip = getByRole('button', { name: 'Videos (2)' });
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    await act(async () => {
      fireEvent.click(chip);
    });
    expect(store.getState().collection.query.kinds).toEqual(['video']);
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    const calls = (client.listAssets as ReturnType<typeof vi.fn>).mock.calls
      .length;
    fireEvent.change(getByRole('searchbox'), { target: { value: 'ha' } });
    expect(
      (client.listAssets as ReturnType<typeof vi.fn>).mock.calls.length,
    ).toBe(calls);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(260);
    });
    expect(
      (client.listAssets as ReturnType<typeof vi.fn>).mock.calls.length,
    ).toBe(calls + 1);
    await act(async () => {
      fireEvent.click(getByRole('button', { name: 'Clear filters' }));
    });
    expect(store.getState().collection.query).toEqual({
      sort: 'created_desc',
      folderId: null,
    });
    vi.useRealTimers();
  });
});

describe('intake parts', () => {
  function drag(type: string, target: EventTarget, types = ['Files']) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, {
      dataTransfer: {
        types,
        items: [{ kind: 'file', type: 'image/png' }],
        dropEffect: 'none',
      },
    });
    act(() => {
      target.dispatchEvent(event);
    });
  }

  it('shows a window overlay without flickering over children and accepts drops during uploads', async () => {
    const upload = vi.fn(async () => [makeEntry({ status: 'success' })]);
    const uploads = makeUploadState({ isUploading: true, upload });
    const client = makeClient({ useUploadAssets: vi.fn(() => uploads) });
    const { store, getByTestId } = setup({
      client,
      children: (
        <Intake.Dropzone data-testid="zone">
          <span data-testid="child">child</span>
        </Intake.Dropzone>
      ),
    });
    await ready(store);
    const zone = getByTestId('zone');
    drag('dragenter', window);
    expect(zone.getAttribute('data-drag-over')).toBe('window');
    drag('dragenter', window);
    drag('dragleave', window);
    expect(zone.getAttribute('data-drag-over')).toBe('window');
    fireEvent.dragEnter(zone, {
      dataTransfer: {
        types: ['Files'],
        items: [{ kind: 'file', type: 'image/png' }],
      },
    });
    fireEvent.dragEnter(getByTestId('child'), {
      dataTransfer: { types: ['Files'], items: [] },
    });
    fireEvent.dragLeave(getByTestId('child'), {
      dataTransfer: { types: ['Files'] },
    });
    expect(zone.getAttribute('data-drag-over')).toBe('zone');
    expect(zone.hasAttribute('data-drag-accept')).toBe(true);
    const file = new File(['x'], 'drop.png', { type: 'image/png' });
    await act(async () => {
      fireEvent.drop(zone, {
        dataTransfer: { types: ['Files'], files: [file], items: [] },
      });
    });
    await waitFor(() => expect(upload).toHaveBeenCalledWith([file], undefined));
    drag('drop', window);
    expect(zone.hasAttribute('data-drag-over')).toBe(false);
  });

  it('renames pasted screenshots and leaves text fields alone', async () => {
    const upload = vi.fn(async () => []);
    const client = makeClient({
      useUploadAssets: vi.fn(() => makeUploadState({ upload })),
    });
    function Paste() {
      useIntakePaste('document');
      return <input aria-label="caption" />;
    }
    const { store, getByRole } = setup({ client, children: <Paste /> });
    await ready(store);
    const screenshot = new File(['x'], 'image.png', { type: 'image/png' });
    const paste = (target: EventTarget) => {
      const event = new Event('paste', { bubbles: true, cancelable: true });
      Object.assign(event, { clipboardData: { files: [screenshot] } });
      act(() => {
        target.dispatchEvent(event);
      });
    };
    paste(getByRole('textbox', { name: 'caption' }));
    expect(upload).not.toHaveBeenCalled();
    paste(document.body);
    await waitFor(() => expect(upload).toHaveBeenCalled());
    const [files] = upload.mock.calls[0] as unknown as [File[]];
    expect(files[0].name).toMatch(/^pasted-\d{4}-\d{2}-\d{2}-\d{6}\.png$/);
  });
});
