import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
// @vitest-environment happy-dom
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MediaRootProps } from './components';

import {
  MediaBreadcrumbs,
  MediaCrumb,
  MediaEmpty,
  MediaError,
  MediaFolder,
  MediaFolderList,
  MediaGrid,
  MediaItem,
  MediaLoadMore,
  MediaMutationError,
  MediaRoot,
  MediaSearch,
  MediaThumbnail,
  mediaTypeOf,
} from './components';
import { useMediaContext } from './context';
import {
  flush,
  makeAsset,
  makeAssets,
  makeClient,
  makeFolder,
} from './test-fixtures';

afterEach(cleanup);

function listOf(count: number) {
  return vi.fn(async () => listResult(count));
}

function listResult(
  count: number,
  extra: { hasMore?: boolean; nextCursor?: string | null } = {},
) {
  return {
    assets: makeAssets(count),
    total: count,
    hasMore: extra.hasMore ?? false,
    nextCursor: extra.nextCursor ?? null,
  };
}

function Library(
  props: Partial<MediaRootProps> & { client: MediaRootProps['client'] },
) {
  return (
    <MediaRoot {...props}>
      <MediaBreadcrumbs>
        {(path) => (
          <>
            <MediaCrumb folder={null} />
            {path.map((folder) => (
              <MediaCrumb key={folder.id} folder={folder} />
            ))}
          </>
        )}
      </MediaBreadcrumbs>
      <MediaSearch />
      <MediaFolderList>
        {(folder) => <MediaFolder key={folder.id} folder={folder} />}
      </MediaFolderList>
      <MediaGrid data-testid="grid">
        {(asset) => (
          <MediaItem key={asset.id} asset={asset}>
            <MediaThumbnail fallback={<span>file</span>} />
            {asset.slug}
          </MediaItem>
        )}
      </MediaGrid>
      <MediaLoadMore>More</MediaLoadMore>
      <MediaEmpty>Nothing here</MediaEmpty>
      <MediaError>
        {({ error, retry }) => (
          <>
            <span>{String(error)}</span>
            <button type="button" onClick={retry}>
              Retry
            </button>
          </>
        )}
      </MediaError>
      <MediaMutationError>
        {({ error, dismiss }) => (
          <>
            <span>{`mutation: ${String(error)}`}</span>
            <button type="button" onClick={dismiss}>
              Dismiss
            </button>
          </>
        )}
      </MediaMutationError>
    </MediaRoot>
  );
}

describe('Media.Grid / Media.Item', () => {
  it('renders one item per asset as a plain list without selection', async () => {
    const client = makeClient({ listAssets: listOf(3) });
    const { getByTestId, getAllByRole, queryAllByRole } = render(
      <Library client={client} />,
    );
    await waitFor(() => expect(getAllByRole('listitem')).toHaveLength(3));
    const grid = getByTestId('grid');
    expect(grid.getAttribute('role')).toBe('list');
    expect(grid.getAttribute('data-status')).toBe('idle');
    expect(grid.hasAttribute('data-empty')).toBe(false);
    expect(queryAllByRole('option')).toHaveLength(0);
    const item = getAllByRole('listitem')[0]!;
    expect(item.getAttribute('data-type')).toBe('image');
    expect(item.getAttribute('data-asset-status')).toBe('public');
    expect(item.hasAttribute('tabindex')).toBe(false);
  });

  it('single mode: click selects one option with aria-selected', async () => {
    const client = makeClient({ listAssets: listOf(3) });
    const onSelectionChange = vi.fn();
    const { getByTestId, getAllByRole } = render(
      <Library
        client={client}
        selection="single"
        onSelectionChange={onSelectionChange}
      />,
    );
    await waitFor(() => expect(getAllByRole('option')).toHaveLength(3));
    expect(getByTestId('grid').getAttribute('role')).toBe('listbox');
    expect(getByTestId('grid').getAttribute('aria-multiselectable')).toBe(
      'false',
    );
    const [first, second] = getAllByRole('option');
    expect(first!.getAttribute('tabindex')).toBe('0');
    expect(second!.getAttribute('tabindex')).toBe('-1');

    fireEvent.click(second!);
    expect(second!.getAttribute('aria-selected')).toBe('true');
    expect(second!.hasAttribute('data-selected')).toBe(true);
    expect(first!.getAttribute('aria-selected')).toBe('false');
    fireEvent.click(first!);
    expect(first!.getAttribute('aria-selected')).toBe('true');
    expect(second!.getAttribute('aria-selected')).toBe('false');
    expect(onSelectionChange).toHaveBeenLastCalledWith(['ast_1']);
  });

  it('multiple mode: Space toggles and aria-multiselectable is set', async () => {
    const client = makeClient({ listAssets: listOf(2) });
    const { getByTestId, getAllByRole } = render(
      <Library client={client} selection="multiple" />,
    );
    await waitFor(() => expect(getAllByRole('option')).toHaveLength(2));
    expect(getByTestId('grid').getAttribute('aria-multiselectable')).toBe(
      'true',
    );
    const [first, second] = getAllByRole('option');
    fireEvent.keyDown(first!, { key: ' ' });
    fireEvent.keyDown(second!, { key: 'Enter' });
    expect(first!.getAttribute('aria-selected')).toBe('true');
    expect(second!.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(first!, { key: ' ' });
    expect(first!.getAttribute('aria-selected')).toBe('false');
  });

  it('ArrowRight / End / Home move focus and the roving tabIndex', async () => {
    const client = makeClient({ listAssets: listOf(3) });
    const { getByTestId, getAllByRole } = render(
      <Library client={client} selection="single" />,
    );
    await waitFor(() => expect(getAllByRole('option')).toHaveLength(3));
    const grid = getByTestId('grid');
    const options = getAllByRole('option');
    options[0]!.focus();
    fireEvent.keyDown(grid, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(options[1]);
    expect(options[1]!.getAttribute('tabindex')).toBe('0');
    expect(options[0]!.getAttribute('tabindex')).toBe('-1');
    fireEvent.keyDown(grid, { key: 'End' });
    expect(document.activeElement).toBe(options[2]);
    fireEvent.keyDown(grid, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(options[1]);
    fireEvent.keyDown(grid, { key: 'Home' });
    expect(document.activeElement).toBe(options[0]);
  });

  it('thumbnails use assetUrl for images and the fallback otherwise', async () => {
    const client = makeClient({
      listAssets: vi.fn(async () => ({
        assets: [
          makeAsset({ id: 'img', slug: 'hero' }),
          makeAsset({ id: 'doc', mimeType: 'application/pdf' }),
        ],
        total: 2,
        hasMore: false,
        nextCursor: null,
      })),
    });
    const { getByRole, getByText } = render(
      <Library client={client} assetUrl={(a) => `/thumb/${a.id}`} />,
    );
    await waitFor(() => expect(getByRole('img')).toBeTruthy());
    const img = getByRole('img');
    expect(img.getAttribute('src')).toBe('/thumb/img');
    expect(img.getAttribute('alt')).toBe('hero');
    expect(img.getAttribute('loading')).toBe('lazy');
    fireEvent.load(img);
    expect(img.hasAttribute('data-loaded')).toBe(true);
    expect(getByText('file')).toBeTruthy();
  });
});

describe('Media.Breadcrumbs / Media.Crumb / Media.Folder', () => {
  it('navigates into folders and truncates the path on a crumb click', async () => {
    const a = makeFolder({ id: 'fld_a', name: 'A' });
    const b = makeFolder({ id: 'fld_b', name: 'B', parentId: 'fld_a' });
    const client = makeClient({
      listFolders: vi.fn(async ({ query } = {}) => ({
        folders:
          query?.parentFolderId === undefined
            ? [a]
            : query.parentFolderId === 'fld_a'
              ? [b]
              : [],
      })),
    });
    const { getByRole, getAllByRole, queryByRole } = render(
      <Library client={client} />,
    );
    const nav = getByRole('navigation');
    expect(nav.getAttribute('aria-label')).toBe('Folder path');

    await waitFor(() =>
      expect(getByRole('button', { name: 'A' })).toBeTruthy(),
    );
    fireEvent.click(getByRole('button', { name: 'A' }));
    await waitFor(() =>
      expect(getByRole('button', { name: 'B' })).toBeTruthy(),
    );
    fireEvent.click(getByRole('button', { name: 'B' }));
    await flush();

    const crumbs = () =>
      Array.from(nav.querySelectorAll('button')).map((el) => el.textContent);
    expect(crumbs()).toEqual(['Root', 'A', 'B']);
    const current = nav.querySelector('[aria-current="page"]');
    expect(current?.textContent).toBe('B');
    expect(current?.hasAttribute('data-current')).toBe(true);

    fireEvent.click(getAllByRole('button', { name: 'A' })[0]!);
    await flush();
    expect(crumbs()).toEqual(['Root', 'A']);
    expect(client.listFolders).toHaveBeenLastCalledWith({
      query: { parentFolderId: 'fld_a' },
    });

    fireEvent.click(getByRole('button', { name: 'Root' }));
    await flush();
    expect(crumbs()).toEqual(['Root']);
    expect(queryByRole('button', { name: 'B' })).toBeNull();
  });

  it('shows an unknown starting folder as …', async () => {
    const client = makeClient();
    const { getByRole } = render(
      <Library client={client} defaultFolderId="fld_x" />,
    );
    await flush();
    const nav = getByRole('navigation');
    const labels = Array.from(nav.querySelectorAll('button')).map(
      (el) => el.textContent,
    );
    expect(labels).toEqual(['Root', '…']);
    expect(nav.querySelector('[aria-current="page"]')?.textContent).toBe('…');
  });
});

describe('Media.Search / Media.LoadMore / Media.Empty', () => {
  it('search is controlled by the store', async () => {
    const client = makeClient();
    const { getByRole } = render(<Library client={client} />);
    const input = getByRole('searchbox') as HTMLInputElement;
    expect(input.getAttribute('aria-label')).toBe('Search assets');
    fireEvent.change(input, { target: { value: 'hero' } });
    expect(input.value).toBe('hero');
    await flush();
  });

  it('LoadMore is disabled without a cursor and enabled with one', async () => {
    const client = makeClient({ listAssets: listOf(1) });
    const { getByRole } = render(<Library client={client} />);
    await flush();
    const button = getByRole('button', { name: 'More' });
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(button.hasAttribute('data-has-more')).toBe(false);

    const paged = makeClient({
      listAssets: vi
        .fn()
        .mockResolvedValueOnce(
          listResult(2, { hasMore: true, nextCursor: 'c1' }),
        )
        .mockResolvedValueOnce(listResult(1)),
    });
    cleanup();
    const view = render(<Library client={paged} pageSize={2} />);
    await flush();
    const more = view.getByRole('button', { name: 'More' });
    expect(more.hasAttribute('disabled')).toBe(false);
    expect(more.hasAttribute('data-has-more')).toBe(true);
    fireEvent.click(more);
    await flush();
    expect(paged.listAssets).toHaveBeenCalledTimes(2);
    expect(view.getAllByRole('listitem')).toHaveLength(3);
    expect(more.hasAttribute('disabled')).toBe(true);
  });

  it('Empty renders only for an idle, empty listing', async () => {
    const client = makeClient({ listAssets: listOf(0) });
    const { queryByText, getByTestId } = render(<Library client={client} />);
    expect(queryByText('Nothing here')).toBeNull();
    await waitFor(() => expect(queryByText('Nothing here')).toBeTruthy());
    expect(getByTestId('grid').hasAttribute('data-empty')).toBe(true);
  });
});

describe('Media.Error / Media.MutationError', () => {
  it('shows a rejected list and retry reloads', async () => {
    const client = makeClient({
      listAssets: vi
        .fn()
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValueOnce(listResult(1)),
    });
    const { getByRole, queryByRole, getByText } = render(
      <Library client={client} />,
    );
    await waitFor(() => expect(getByRole('alert')).toBeTruthy());
    expect(getByText('Error: offline')).toBeTruthy();
    fireEvent.click(getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(queryByRole('alert')).toBeNull());
    expect(client.listAssets).toHaveBeenCalledTimes(2);
  });

  it('a rejected mutation shows MutationError but not Error', async () => {
    const client = makeClient({
      archiveAssets: vi.fn(async () => {
        throw new Error('in use');
      }),
    });
    let archive: ((ids: string[]) => Promise<unknown>) | null = null;
    function Probe() {
      const { store } = useMediaContext('Probe');
      archive = store.actions.archive;
      return null;
    }
    const { getByRole, queryByText, getByText } = render(
      <MediaRoot client={client}>
        <Probe />
        <MediaError>
          {({ error }) => <span>{`list: ${String(error)}`}</span>}
        </MediaError>
        <MediaMutationError>
          {({ error, dismiss }) => (
            <>
              <span>{`mutation: ${String(error)}`}</span>
              <button type="button" onClick={dismiss}>
                Dismiss
              </button>
            </>
          )}
        </MediaMutationError>
      </MediaRoot>,
    );
    await flush();
    await expect(archive!(['ast_1'])).rejects.toThrow('in use');
    await waitFor(() =>
      expect(getByText('mutation: Error: in use')).toBeTruthy(),
    );
    expect(queryByText(/^list:/)).toBeNull();
    fireEvent.click(getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(queryByText(/^mutation:/)).toBeNull());
  });
});

describe('mediaTypeOf', () => {
  it('groups MIME types', () => {
    expect(mediaTypeOf('image/webp')).toBe('image');
    expect(mediaTypeOf('video/mp4')).toBe('video');
    expect(mediaTypeOf('audio/ogg')).toBe('audio');
    expect(mediaTypeOf('application/pdf')).toBe('document');
    expect(mediaTypeOf('text/plain')).toBe('document');
    expect(mediaTypeOf('application/zip')).toBe('other');
  });
});
