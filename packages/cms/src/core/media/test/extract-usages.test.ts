import { describe, expect, it } from 'vitest';

import {
  assetIdsInUrls,
  extractUsages,
  rewriteUsages,
} from '../extract-usages';

const A = 'ast_aaaaaaaaaaaaaaaaaaaa';
const B = 'ast_bbbbbbbbbbbbbbbbbbbb';
const R = 'rot_cccccccccccccccccccc';

const specs = {
  hero: { type: 'image' },
  gallery: { type: 'list', of: { type: 'image' } },
  related: { type: 'reference' },
  more: { type: 'list', of: { type: 'reference' } },
  cta: { type: 'link' },
  body: { type: 'richText' },
  count: { type: 'number' },
};

describe('extractUsages', () => {
  it('reads every typed usage with paths and alt states', () => {
    const usages = extractUsages(specs, {
      hero: { assetId: A, decorative: true },
      gallery: [
        A,
        { assetId: B, alt: 'Team', revisionId: 'ast_rev' },
        { assetId: A, alt: '  ' },
      ],
      related: R,
      more: [R, ''],
      cta: { kind: 'internal', rootId: R },
      count: 3,
    });
    expect(usages).toEqual([
      {
        kind: 'asset',
        key: A,
        propertyKey: 'hero',
        path: '/hero',
        matchedBy: 'schema',
        altState: 'decorative',
      },
      {
        kind: 'asset',
        key: A,
        propertyKey: 'gallery',
        path: '/gallery/0',
        matchedBy: 'schema',
        altState: 'missing',
      },
      {
        kind: 'asset',
        key: B,
        propertyKey: 'gallery',
        path: '/gallery/1',
        matchedBy: 'schema',
        altState: 'present',
        revisionId: 'ast_rev',
      },
      {
        kind: 'asset',
        key: A,
        propertyKey: 'gallery',
        path: '/gallery/2',
        matchedBy: 'schema',
        altState: 'missing',
      },
      {
        kind: 'reference',
        key: R,
        propertyKey: 'related',
        path: '/related',
        matchedBy: 'schema',
      },
      {
        kind: 'reference',
        key: R,
        propertyKey: 'more',
        path: '/more/0',
        matchedBy: 'schema',
      },
      {
        kind: 'link',
        key: R,
        propertyKey: 'cta',
        path: '/cta',
        matchedBy: 'schema',
      },
    ]);
  });

  it('finds asset URLs in text and ids in untyped values', () => {
    const usages = extractUsages(specs, {
      body: `<img src="/api/cms/media/asset/${A}?w=640"> <a href="https://cdn.test/pub/${B}/x.jpg">`,
      seo: { image: A, nested: [`https://cdn.test/t/acme/prv/${B}/y.png`] },
    });
    expect(
      usages.map((u) => [u.key, u.propertyKey, u.path, u.matchedBy]),
    ).toEqual([
      [A, 'body', '/body', 'url'],
      [B, 'body', '/body', 'url'],
      [A, 'seo', '/seo/image', 'heuristic'],
      [B, 'seo', '/seo/nested/0', 'url'],
    ]);
  });

  it('ignores external links and empty values', () => {
    expect(
      extractUsages(specs, {
        cta: { kind: 'external', url: 'https://x.test' },
        hero: '',
        gallery: 'not-a-list',
      }),
    ).toEqual([]);
  });
});

describe('assetIdsInUrls', () => {
  it.each([
    [`/media/asset/${A}`, [A]],
    [`https://cdn.test/${A}/hero.jpg`, [A]],
    [`https://cdn.test/pub/${A}/hero.jpg`, [A]],
    [`https://cdn.test/t/acme/prv/${A}/hero.jpg`, [A]],
    [`text ${A} without a url`, []],
  ])('%s', (text, ids) => {
    expect(assetIdsInUrls(text)).toEqual(ids);
  });
});

describe('rewriteUsages', () => {
  it('swaps typed occurrences and keeps everything else', () => {
    const before = {
      hero: {
        assetId: A,
        alt: 'Team',
        revisionId: 'r1',
        crop: { x: 0, y: 0, width: 1, height: 1 },
      },
      gallery: [A, B],
      related: A,
      body: `/media/asset/${A}`,
      count: 1,
    };
    const after = rewriteUsages(specs, before, A, B, { dropCrop: true });
    expect(after).toEqual({
      hero: { assetId: B, alt: 'Team' },
      gallery: [B, B],
      related: B,
      body: `/media/asset/${A}`,
      count: 1,
    });
    expect(rewriteUsages(specs, { gallery: [B] }, A, B)).toEqual({
      gallery: [B],
    });
    const untouched = { hero: B };
    expect(rewriteUsages(specs, untouched, A, B)).toBe(untouched);
  });
});
