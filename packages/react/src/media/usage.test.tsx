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

import type { MediaUsagePage } from './usage';

import {
  UsageCount,
  UsageEmpty,
  UsageExternalItem,
  UsageExternalList,
  UsageItem,
  UsageList,
  UsageLoadMore,
  UsageMissingAltFilter,
  UsageOccurrence,
  UsageRoot,
  UsageScopeSwitch,
  createEditorHrefAdapter,
  useAssetUsageCounts,
} from './usage';

afterEach(cleanup);

const item = (rootId: string, altState: string | null) => ({
  rootId,
  collection: 'pages',
  title: `Page ${rootId}`,
  storedSlug: rootId,
  status: 'published' as const,
  via: null,
  occurrences: [
    {
      branchId: 'brn_1',
      branchName: 'main',
      blockId: `blk_${rootId}`,
      propertyKey: 'src',
      path: '/src',
      matchedBy: 'schema',
      altState,
      revisionId: null,
    },
  ],
});

function client(pages: MediaUsagePage[]) {
  let call = 0;
  return {
    getAssetUsages: vi.fn(
      async () => pages[Math.min(call++, pages.length - 1)],
    ),
  };
}

function Panel({ c }: { c: ReturnType<typeof client> }) {
  return (
    <UsageRoot client={c} assetId="ast_1">
      <UsageCount />
      <UsageScopeSwitch />
      <UsageMissingAltFilter />
      <UsageList>
        {(entry) => (
          <UsageItem>
            {entry.title}
            {entry.occurrences.map((o) => (
              <UsageOccurrence key={o.blockId} occurrence={o}>
                {o.propertyKey}
              </UsageOccurrence>
            ))}
          </UsageItem>
        )}
      </UsageList>
      <UsageEmpty />
      <UsageLoadMore />
    </UsageRoot>
  );
}

describe('Usage parts', () => {
  it('lists usages with counts, links and paging', async () => {
    const c = client([
      {
        total: { roots: 2, occurrences: 2, hiddenRoots: 1 },
        items: [item('a', 'missing')],
        nextCursor: 'next',
      },
      {
        total: { roots: 2, occurrences: 2, hiddenRoots: 1 },
        items: [item('b', 'present')],
        nextCursor: null,
      },
    ]);
    const { getByRole, getAllByRole, findByText, queryByRole } = render(
      <Panel c={c} />,
    );

    const region = getByRole('region', { name: 'Usage' });
    expect(region.getAttribute('data-scope')).toBe('live');
    await findByText('Used on 2 pages 1 more page you cannot see');

    const link = getByRole('link', { name: 'src' });
    expect(link.getAttribute('href')).toBe(
      '/editor/pages/a?block=blk_a&path=%2Fsrc&branch=brn_1&focus=alt',
    );
    expect(link.getAttribute('data-alt-state')).toBe('missing');
    expect(getAllByRole('listitem')[0].getAttribute('data-status')).toBe(
      'published',
    );

    fireEvent.click(getByRole('button', { name: 'Show more' }));
    await waitFor(() => expect(getAllByRole('listitem')).toHaveLength(2));
    expect(c.getAssetUsages).toHaveBeenLastCalledWith({
      query: expect.objectContaining({ cursor: 'next' }),
    });
    expect(queryByRole('button', { name: 'Show more' })).toBeNull();
  });

  it('refetches for another scope and the missing-alt filter', async () => {
    const c = client([
      {
        total: { roots: 0, occurrences: 0, hiddenRoots: 0 },
        items: [],
        nextCursor: null,
      },
    ]);
    const { getByRole, findByText } = render(<Panel c={c} />);
    await findByText('Not used anywhere');

    fireEvent.change(getByRole('combobox', { name: 'Show usage in' }), {
      target: { value: 'published' },
    });
    await waitFor(() =>
      expect(c.getAssetUsages).toHaveBeenLastCalledWith({
        query: expect.objectContaining({ scope: 'published' }),
      }),
    );
    fireEvent.click(getByRole('checkbox', { name: 'Only without alt text' }));
    await waitFor(() =>
      expect(c.getAssetUsages).toHaveBeenLastCalledWith({
        query: expect.objectContaining({ missingAlt: 'true' }),
      }),
    );
  });
});

describe('Usage external group', () => {
  it('lists usages outside content and marks the blocking ones', async () => {
    const c = client([
      {
        total: { roots: 0, occurrences: 0, hiddenRoots: 0 },
        items: [],
        nextCursor: null,
        external: [
          {
            consumer: 'seo-settings',
            url: null,
            registeredAt: null,
            blocking: true,
          },
          {
            consumer: 'newsletter',
            url: 'https://news.example.com/october',
            registeredAt: '2026-10-18T10:00:00.000Z',
            blocking: false,
          },
        ],
      },
    ]);
    const view = render(
      <UsageRoot client={c} assetId="ast_1">
        <UsageExternalList>
          {(usage) => <UsageExternalItem key={usage.consumer} usage={usage} />}
        </UsageExternalList>
        <UsageEmpty />
      </UsageRoot>,
    );
    const list = await view.findByRole('list', {
      name: 'Used outside the CMS',
    });
    const entries = list.querySelectorAll('li');
    expect(entries[0].hasAttribute('data-blocking')).toBe(true);
    expect(entries[0].textContent).toBe(
      'seo-settings (Keeps the asset from being archived)',
    );
    expect(
      view.getByRole('link', { name: 'newsletter' }).getAttribute('href'),
    ).toBe('https://news.example.com/october');
    expect(view.queryByText('Not used anywhere')).toBeNull();
  });
});

describe('createEditorHrefAdapter', () => {
  it('builds editor links under a base', () => {
    expect(
      createEditorHrefAdapter('/admin/').build({
        rootId: 'rot_1',
        collection: 'blog posts',
        branchId: null,
        blockId: 'blk_1',
        path: '/gallery/2',
      }),
    ).toBe('/admin/blog%20posts/rot_1?block=blk_1&path=%2Fgallery%2F2');
  });
});

describe('useAssetUsageCounts', () => {
  it('batches the requests of one frame into one call', async () => {
    const c = {
      getAssetUsageCounts: vi.fn(
        async ({ body }: { body: { assetIds: string[] } }) => ({
          counts: Object.fromEntries(
            body.assetIds.map((id) => [id, { roots: id.length, published: 0 }]),
          ),
        }),
      ),
    };
    function Badge({ id }: { id: string }) {
      const counts = useAssetUsageCounts(c, [id]);
      return <span>{counts[id]?.roots ?? '-'}</span>;
    }
    const { findByText } = render(
      <>
        <Badge id="a" />
        <Badge id="bb" />
      </>,
    );
    await findByText('2');
    await findByText('1');
    await act(async () => {});
    expect(c.getAssetUsageCounts).toHaveBeenCalledTimes(1);
    expect(c.getAssetUsageCounts.mock.calls[0][0].body.assetIds.sort()).toEqual(
      ['a', 'bb'],
    );
  });
});
