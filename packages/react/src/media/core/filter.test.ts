import { describe, expect, it } from 'vitest';

import type { FilterState } from './filter';

import {
  ASSET_PROVENANCES,
  DEFAULT_FILTER,
  FILTER_SORTS,
  MEDIA_KINDS,
  activeFilterCount,
  createHistoryFilterAdapter,
  createMemoryFilterAdapter,
  encodeFilter,
  filterToQuery,
  formatSizeParam,
  normalizeFilter,
  parseFilter,
  parseSizeParam,
  sortOfFilter,
} from './filter';

/** Deterministic pseudo-random numbers (mulberry32). */
function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomFilter(next: () => number): FilterState {
  const pick = <T>(items: readonly T[]) =>
    items[Math.floor(next() * items.length)];
  const some = <T>(items: readonly T[]) => items.filter(() => next() < 0.4);
  const maybe = <T>(value: T) => (next() < 0.5 ? value : undefined);
  const folder = next();
  return {
    sort: pick(FILTER_SORTS),
    q: maybe(pick(['hamburg', 'Hafen & Kräne', 'a,b', '50% off', 'x y'])),
    kinds: some(MEDIA_KINDS),
    mime: some(['image/*', 'application/pdf', 'video/mp4']),
    folderId: folder < 0.3 ? undefined : folder < 0.5 ? null : 'fld_abc',
    recursive: maybe(true),
    unfiled: next() < 0.1 ? true : undefined,
    provenance: some(ASSET_PROVENANCES),
    visibility: some(['private', 'public'] as const),
    processingState: some(['pending', 'ready', 'failed'] as const),
    uploadedBy: some(['usr_1', 'usr_2']),
    createdFrom: maybe('2026-01-01'),
    createdTo: maybe('2026-10-14T10:15:00Z'),
    sizeMin: maybe(pick([0, 1024, 5 * 1024 ** 2, 1500])),
    sizeMax: maybe(pick([5 * 1024 ** 2, 2 * 1024 ** 3, 777])),
    widthMin: maybe(pick([1, 1920])),
    heightMin: maybe(pick([1, 1080])),
    orientation: maybe(pick(['landscape', 'portrait', 'square'] as const)),
    usage: maybe(pick(['used', 'unused'] as const)),
    usageScope: maybe(pick(['published', 'live'] as const)),
    missingAlt: maybe(true),
    expiringWithinDays: maybe(pick([7, 30])),
    archived: maybe(true),
  };
}

describe('FilterState URL encoding', () => {
  it('round trips random filters', () => {
    const next = rng(42);
    for (let i = 0; i < 500; i++) {
      const filter = normalizeFilter(randomFilter(next));
      expect(parseFilter(encodeFilter(filter))).toEqual(filter);
    }
  });

  it('uses short keys', () => {
    expect(
      encodeFilter({
        sort: 'created_desc',
        q: 'hamb',
        kinds: ['image', 'video'],
        sizeMin: 0,
        sizeMax: 5 * 1024 ** 2,
        usage: 'unused',
        folderId: 'fld_1',
        createdFrom: '2026-01-01',
        createdTo: '2026-02-01',
      }),
    ).toBe(
      'q=hamb&type=image%2Cvideo&folder=fld_1&from=2026-01-01&to=2026-02-01&size=0-5mb&usage=unused',
    );
    expect(encodeFilter({ sort: 'name_asc', folderId: null })).toBe(
      'folder=root&sort=name_asc',
    );
  });

  it('ignores unknown keys and invalid values', () => {
    expect(
      parseFilter(
        '?type=image,bogus&prov=ai_generated,nope&size=abc-5mb&w=-3&sort=random&orient=diagonal&utm_source=x&from=yesterday',
      ),
    ).toEqual({
      sort: 'created_desc',
      kinds: ['image'],
      provenance: ['ai_generated'],
      sizeMax: 5 * 1024 ** 2,
    });
  });

  it('normalizes impossible combinations', () => {
    expect(
      normalizeFilter({
        sort: 'created_desc',
        q: '  ',
        kinds: [],
        unfiled: true,
        folderId: 'fld_1',
        recursive: true,
        usageScope: 'published',
      }),
    ).toEqual({ sort: 'created_desc', unfiled: true });
    expect(
      normalizeFilter({
        sort: 'created_desc',
        folderId: null,
        recursive: true,
      }),
    ).toEqual({
      sort: 'created_desc',
      folderId: null,
    });
  });

  it('parses size units', () => {
    expect(parseSizeParam('5mb')).toBe(5 * 1024 ** 2);
    expect(parseSizeParam('1.5GB')).toBe(Math.round(1.5 * 1024 ** 3));
    expect(parseSizeParam('300')).toBe(300);
    expect(parseSizeParam('5 parsecs')).toBeUndefined();
    expect(formatSizeParam(1024)).toBe('1kb');
    expect(formatSizeParam(1500)).toBe('1500');
  });

  it('counts active filters beyond folder, sort and text', () => {
    expect(activeFilterCount(DEFAULT_FILTER)).toBe(0);
    expect(
      activeFilterCount({
        sort: 'size_desc',
        folderId: 'f',
        q: 'x',
        kinds: ['image'],
        missingAlt: true,
      }),
    ).toBe(2);
  });
});

describe('filter adapters', () => {
  it('keeps the picker filter in memory', () => {
    const adapter = createMemoryFilterAdapter();
    adapter.write({ sort: 'name_asc', q: 'x' }, 'push');
    expect(adapter.read()).toEqual({ sort: 'name_asc', q: 'x' });
  });

  it('writes the URL with replace while typing and push otherwise, keeping foreign params', () => {
    const calls: [string, string][] = [];
    const win = {
      location: {
        search: '?tab=media&q=old',
        pathname: '/admin',
        hash: '#top',
      },
      history: {
        state: null,
        pushState: (_: unknown, __: string, url?: string) => {
          calls.push(['push', url ?? '']);
          win.location.search = (url ?? '')
            .replace(/^[^?]*/, '')
            .replace(/#.*/, '');
        },
        replaceState: (_: unknown, __: string, url?: string) => {
          calls.push(['replace', url ?? '']);
          win.location.search = (url ?? '')
            .replace(/^[^?]*/, '')
            .replace(/#.*/, '');
        },
      },
      addEventListener() {},
      removeEventListener() {},
    };
    const adapter = createHistoryFilterAdapter({ window: win });
    expect(adapter.read()).toEqual({ sort: 'created_desc', q: 'old' });
    adapter.write({ sort: 'created_desc', q: 'new' }, 'replace');
    adapter.write({ sort: 'created_desc', q: 'new', kinds: ['image'] }, 'push');
    expect(calls).toEqual([
      ['replace', '/admin?tab=media&q=new#top'],
      ['push', '/admin?tab=media&q=new&type=image#top'],
    ]);
  });

  it('namespaces keys with a prefix', () => {
    const win = {
      location: { search: '?q=page-search&m.q=asset', pathname: '/', hash: '' },
      history: { state: null, pushState() {}, replaceState() {} },
      addEventListener() {},
      removeEventListener() {},
    };
    expect(
      createHistoryFilterAdapter({ window: win, prefix: 'm.' }).read(),
    ).toEqual({
      sort: 'created_desc',
      q: 'asset',
    });
  });
});

describe('filterToQuery', () => {
  it('maps the filter to listAssets parameters', () => {
    expect(
      filterToQuery({
        sort: 'width_desc',
        folderId: 'fld_1',
        recursive: true,
        kinds: ['image', 'video'],
        processingState: ['pending'],
        usage: 'unused',
        usageScope: 'published',
      }),
    ).toEqual({
      folderId: 'fld_1',
      recursive: true,
      kinds: 'image,video',
      usage: 'unused',
      usageScope: 'published',
    });
    expect(filterToQuery({ sort: 'created_desc', folderId: null })).toEqual({
      unfiled: true,
    });
    expect(sortOfFilter('name_asc')).toEqual({
      sortBy: 'originalName',
      sortDirection: 'asc',
    });
  });
});
