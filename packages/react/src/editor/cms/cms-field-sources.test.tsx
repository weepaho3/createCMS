// @vitest-environment happy-dom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  CmsAssetListItem,
  CmsCollectionRootsClient,
  CmsMediaUploadState,
  UseCmsFieldSourcesClient,
} from './types';

import { linkLabel, referenceLabel } from './field-sources';
import { useCmsFieldSources } from './use-cms-field-sources';
import { useVariableSuggest } from './use-variable-suggest';

afterEach(cleanup);

const VARIABLE_PATTERN = /\{\{(\w*)$/;

function makeAsset(
  overrides: Partial<CmsAssetListItem> = {},
): CmsAssetListItem {
  return {
    id: 'ast_1',
    slug: 'hero',
    mimeType: 'image/png',
    size: 100,
    objectKey: 'assets/hero.png',
    url: 'https://cdn.test/assets/hero.png',
    status: 'public',
    folderId: null,
    variantOf: null,
    uploadedBy: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeClient(
  overrides: Partial<
    UseCmsFieldSourcesClient & { pages: CmsCollectionRootsClient }
  > = {},
): UseCmsFieldSourcesClient & { pages: CmsCollectionRootsClient } {
  const uploadState: CmsMediaUploadState = {
    isUploading: false,
    isAborted: false,
    files: [],
    totalProgress: 0,
    error: null,
    upload: vi.fn(async () => {}),
    abort: vi.fn(),
    reset: vi.fn(),
  };

  return {
    media: {
      listAssets: vi.fn(async () => ({
        assets: [makeAsset()],
        total: 1,
        hasMore: false,
        nextCursor: null,
      })),
      getAssets: vi.fn(async () => ({ assets: [] })),
      useUploadAssets: vi.fn(() => uploadState),
    },
    variables: {
      list: vi.fn(async () => ({
        variables: [
          { key: 'brandName', value: 'Acme', description: 'Brand' },
          { key: 'siteName', value: 'Site' },
        ],
        total: 2,
        hasMore: false,
      })),
    },
    templates: {
      getTemplateDefaults: vi.fn(async () => ({
        defaults: { headline: 'Hi' },
      })),
    },
    pages: {
      listRoots: vi.fn(async () => ({
        roots: [
          {
            id: 'root_1',
            slug: 'home',
            properties: { title: 'Home' },
          },
        ],
        total: 1,
        hasMore: false,
      })),
      getRoot: vi.fn(async () => ({
        id: 'root_1',
        slug: 'home',
        properties: { title: 'Home' },
      })),
      getRootBySlug: vi.fn(async () => ({
        id: 'root_1',
        slug: 'home',
        properties: { title: 'Home' },
      })),
    },
    ...overrides,
  };
}

function renderSources(client: UseCmsFieldSourcesClient = makeClient()) {
  return renderHook(() => useCmsFieldSources(client));
}

describe('useCmsFieldSources assets.list', () => {
  it('calls listAssets with the query envelope', async () => {
    const client = makeClient({
      media: {
        listAssets: vi.fn(async () => ({
          assets: [makeAsset({ id: 'ast_1' })],
          total: 1,
          hasMore: true,
          nextCursor: 'c2',
        })),
        getAssets: vi.fn(async () => ({ assets: [] })),
      },
    });
    const { result } = renderSources(client);

    const payload = await act(async () =>
      result.current.assets.list({ limit: 20, cursor: 'c1' }),
    );

    expect(client.media.listAssets).toHaveBeenCalledWith({
      query: { limit: 20, cursor: 'c1' },
    });
    expect(payload.nextCursor).toBe('c2');
  });

  it('caches list results for equivalent queries', async () => {
    const client = makeClient();
    const { result } = renderSources(client);

    await act(async () => {
      await result.current.assets.list({ limit: 20, offset: 0 });
    });
    await act(async () => {
      await result.current.assets.list({ offset: 0, limit: 20 });
    });

    expect(client.media.listAssets).toHaveBeenCalledTimes(1);
  });

  it('shares one in-flight list call for the same query', async () => {
    let resolve!: (value: {
      assets: CmsAssetListItem[];
      total: number;
      hasMore: boolean;
      nextCursor: string | null;
    }) => void;
    const deferred = new Promise<{
      assets: CmsAssetListItem[];
      total: number;
      hasMore: boolean;
      nextCursor: string | null;
    }>((res) => {
      resolve = res;
    });

    const client = makeClient({
      media: {
        listAssets: vi.fn(() => deferred),
        getAssets: vi.fn(async () => ({ assets: [] })),
      },
    });
    const { result } = renderSources(client);

    await act(async () => {
      const first = result.current.assets.list({ limit: 20 });
      const second = result.current.assets.list({ limit: 20 });
      expect(client.media.listAssets).toHaveBeenCalledTimes(1);
      resolve({
        assets: [makeAsset()],
        total: 1,
        hasMore: false,
        nextCursor: null,
      });
      await Promise.all([first, second]);
    });
  });
});

describe('useCmsFieldSources assets.get', () => {
  it('uses the list cache without calling getAssets', async () => {
    const client = makeClient({
      media: {
        listAssets: vi.fn(async () => ({
          assets: [makeAsset({ id: 'ast_1' })],
          total: 1,
          hasMore: false,
          nextCursor: null,
        })),
        getAssets: vi.fn(async () => ({ assets: [] })),
      },
    });
    const { result } = renderSources(client);

    await act(async () => {
      await result.current.assets.list({ limit: 20 });
    });
    const assets = await act(async () => result.current.assets.get(['ast_1']));

    expect(client.media.getAssets).not.toHaveBeenCalled();
    expect(assets).toHaveLength(1);
    expect(assets[0]?.id).toBe('ast_1');
  });

  it('fetches missing ids and returns an empty list when omitted', async () => {
    const client = makeClient({
      media: {
        listAssets: vi.fn(async () => ({
          assets: [],
          total: 0,
          hasMore: false,
          nextCursor: null,
        })),
        getAssets: vi.fn(async () => ({ assets: [] })),
      },
    });
    const { result } = renderSources(client);

    const assets = await act(async () =>
      result.current.assets.get(['ast_missing']),
    );

    expect(client.media.getAssets).toHaveBeenCalledWith({
      query: { ids: ['ast_missing'] },
    });
    expect(assets).toEqual([]);
  });

  it('returns [] without calling getAssets for an empty id list', async () => {
    const client = makeClient();
    const { result } = renderSources(client);

    const assets = await act(async () => result.current.assets.get([]));

    expect(client.media.getAssets).not.toHaveBeenCalled();
    expect(assets).toEqual([]);
  });

  it('returns assets in request order', async () => {
    const client = makeClient({
      media: {
        listAssets: vi.fn(async () => ({
          assets: [],
          total: 0,
          hasMore: false,
          nextCursor: null,
        })),
        getAssets: vi.fn(async () => ({
          assets: [
            makeAsset({ id: 'ast_1', slug: 'one' }),
            makeAsset({ id: 'ast_2', slug: 'two' }),
          ],
        })),
      },
    });
    const { result } = renderSources(client);

    const assets = await act(async () =>
      result.current.assets.get(['ast_2', 'ast_1']),
    );

    expect(assets.map((asset) => asset.id)).toEqual(['ast_2', 'ast_1']);
  });
});

describe('useCmsFieldSources client ref', () => {
  it('keeps the first client when the prop identity changes', async () => {
    const first = makeClient();
    const second = makeClient();
    const { result, rerender } = renderHook(
      ({ client }) => useCmsFieldSources(client),
      { initialProps: { client: first } },
    );

    await act(async () => {
      await result.current.assets.list({ limit: 10 });
    });
    expect(first.media.listAssets).toHaveBeenCalledTimes(1);
    expect(second.media.listAssets).not.toHaveBeenCalled();

    rerender({ client: second });
    await act(async () => {
      await result.current.assets.list({ limit: 10 });
    });
    expect(second.media.listAssets).not.toHaveBeenCalled();
  });
});

describe('useCmsFieldSources roots', () => {
  it('calls listRoots with the query envelope', async () => {
    const client = makeClient();
    const { result } = renderSources(client);

    await act(async () => {
      await result.current.roots.list('pages', { limit: 10, offset: 0 });
    });

    expect(client.pages.listRoots).toHaveBeenCalledWith({
      query: { limit: 10, offset: 0 },
    });
  });

  it('uses the list cache for get and fetches unlisted ids', async () => {
    const client = makeClient();
    const { result } = renderSources(client);

    await act(async () => {
      await result.current.roots.list('pages', { limit: 10 });
    });
    await act(async () => {
      await result.current.roots.get('pages', 'root_1');
    });
    expect(client.pages.getRoot).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.roots.get('pages', 'root_2');
    });
    expect(client.pages.getRoot).toHaveBeenCalledWith({
      query: { rootId: 'root_2' },
    });
  });

  it('calls getRootBySlug with slug and parentRootId', async () => {
    const client = makeClient();
    const { result } = renderSources(client);

    await act(async () => {
      await result.current.roots.bySlug('pages', 'home', 'parent_1');
    });

    expect(client.pages.getRootBySlug).toHaveBeenCalledWith({
      query: { slug: 'home', parentRootId: 'parent_1' },
    });
  });

  it('throws for reserved and missing collection namespaces', async () => {
    const client = makeClient();
    const { result } = renderSources(client);

    await expect(
      act(async () => result.current.roots.list('media', { limit: 10 })),
    ).rejects.toThrow('not a collection namespace');

    await expect(
      act(async () => result.current.roots.list('unknown', { limit: 10 })),
    ).rejects.toThrow('not available');
  });
});

describe('useCmsFieldSources variables and templates', () => {
  it('calls variables.list with the query envelope', async () => {
    const client = makeClient();
    const { result } = renderSources(client);

    await act(async () => {
      await result.current.variables.list({ search: 'br' });
    });

    expect(client.variables.list).toHaveBeenCalledWith({
      query: { search: 'br' },
    });
  });

  it('calls getTemplateDefaults and returns defaults', async () => {
    const client = makeClient();
    const { result } = renderSources(client);

    const defaults = await act(async () =>
      result.current.templates.defaults('pages', 'hero'),
    );

    expect(client.templates!.getTemplateDefaults).toHaveBeenCalledWith({
      query: { collection: 'pages', blockType: 'hero' },
    });
    expect(defaults).toEqual({ headline: 'Hi' });
  });

  it('throws when templates is missing', async () => {
    const client = makeClient({ templates: undefined });
    const { result } = renderSources(client);

    await expect(
      act(async () => result.current.templates.defaults('pages', 'hero')),
    ).rejects.toThrow('templates is not available');
  });
});

describe('field source labels', () => {
  it('resolves external links without roots', async () => {
    const client = makeClient();
    const { result } = renderSources(client);

    const label = await linkLabel(
      { kind: 'external', url: 'https://x.test' },
      result.current,
    );

    expect(label).toBe('https://x.test');
    expect(client.pages.getRoot).not.toHaveBeenCalled();
  });

  it('resolves internal links through roots.get', async () => {
    const client = makeClient();
    const { result } = renderSources(client);

    const label = await linkLabel(
      { kind: 'internal', collection: 'pages', rootId: 'root_1' },
      result.current,
    );

    expect(label).toBe('Home');
  });

  it('falls back to rootId when getRoot rejects', async () => {
    const client = makeClient({
      pages: {
        listRoots: vi.fn(async () => ({
          roots: [],
          total: 0,
          hasMore: false,
        })),
        getRoot: vi.fn(async () => {
          throw new Error('ROOT_NOT_FOUND');
        }),
        getRootBySlug: vi.fn(async () => ({
          id: 'root_1',
          properties: {},
        })),
      },
    });
    const { result } = renderSources(client);

    const label = await referenceLabel('pages', 'missing', result.current);
    expect(label).toBe('missing');
  });
});

describe('useVariableSuggest', () => {
  it('loads variables and filters by prefix', async () => {
    const client = makeClient();
    const { result: sourcesResult } = renderSources(client);
    const { result } = renderHook(() =>
      useVariableSuggest(sourcesResult.current),
    );

    await waitFor(() => {
      expect(result.current.getItems('br')).toHaveLength(1);
    });

    const items = result.current.getItems('br');
    expect(items[0]?.insertText).toBe('{{brandName}}');
    expect(items[0]?.key).toBe('brandName');
    expect(result.current.getItems('')).toHaveLength(2);
    expect(VARIABLE_PATTERN.exec('Hello {{bra')?.[1]).toBe('bra');
  });
});

describe('useCmsFieldSources assets.useUpload', () => {
  it('returns the upload hook state from media.useUploadAssets', () => {
    const uploadState: CmsMediaUploadState = {
      isUploading: true,
      isAborted: false,
      files: [],
      totalProgress: 50,
      error: null,
      upload: vi.fn(async () => {}),
      abort: vi.fn(),
      reset: vi.fn(),
    };
    const useUploadAssets = vi.fn(() => uploadState);
    const client = makeClient({
      media: {
        listAssets: vi.fn(async () => ({
          assets: [],
          total: 0,
          hasMore: false,
          nextCursor: null,
        })),
        getAssets: vi.fn(async () => ({ assets: [] })),
        useUploadAssets,
      },
    });
    const { result: sourcesResult } = renderSources(client);
    const { result: uploadResult } = renderHook(() =>
      sourcesResult.current.assets.useUpload(),
    );

    expect(useUploadAssets).toHaveBeenCalled();
    expect(uploadResult.current).toBe(uploadState);
  });
});
