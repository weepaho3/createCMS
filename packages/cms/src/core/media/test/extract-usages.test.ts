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

describe('rich text documents', () => {
  const C = 'ast_cccccccccccccccccccc';
  const R2 = 'rot_dddddddddddddddddddd';
  const internal = (rootId: string) => ({
    type: 'link',
    attrs: { link: { kind: 'internal', rootId, collection: 'pages' } },
  });
  // A heading, a nested list with an image and an internal link, a table
  // with a decorative image, and an external link to an asset URL.
  const doc = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'See ', marks: [] },
          { type: 'text', text: 'the team', marks: [internal(R)] },
        ],
      },
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'image',
                    attrs: {
                      assetId: A,
                      alt: 'Two people',
                      revisionId: 'ast_rev00000000000000000',
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              {
                type: 'tableCell',
                content: [
                  {
                    type: 'image',
                    attrs: { assetId: B, alt: null, decorative: true },
                  },
                  { type: 'image', attrs: { assetId: C, alt: null } },
                ],
              },
            ],
          },
        ],
      },
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'download',
            marks: [
              {
                type: 'link',
                attrs: {
                  link: {
                    kind: 'external',
                    url: `https://cms.example.com/api/cms/media/asset/${A}`,
                  },
                },
              },
              internal(R2),
            ],
          },
        ],
      },
    ],
  };

  it('reads image nodes, internal links and asset URLs with node paths', () => {
    expect(extractUsages(specs, { body: doc })).toEqual([
      {
        kind: 'link',
        key: R,
        propertyKey: 'body',
        path: '/body/content/0/content/1',
        matchedBy: 'schema',
      },
      {
        kind: 'asset',
        key: A,
        propertyKey: 'body',
        path: '/body/content/1/content/0/content/0/content/0',
        matchedBy: 'schema',
        altState: 'present',
        revisionId: 'ast_rev00000000000000000',
      },
      {
        kind: 'asset',
        key: B,
        propertyKey: 'body',
        path: '/body/content/2/content/0/content/0/content/0',
        matchedBy: 'schema',
        altState: 'decorative',
      },
      {
        kind: 'asset',
        key: C,
        propertyKey: 'body',
        path: '/body/content/2/content/0/content/0/content/1',
        matchedBy: 'schema',
        altState: 'missing',
      },
      {
        kind: 'asset',
        key: A,
        propertyKey: 'body',
        path: '/body/content/3/content/0',
        matchedBy: 'url',
      },
      {
        kind: 'link',
        key: R2,
        propertyKey: 'body',
        path: '/body/content/3/content/0',
        matchedBy: 'schema',
      },
    ]);
  });

  it('reads a document stored as a string and keeps HTML on the URL path', () => {
    const fromString = extractUsages(specs, { body: JSON.stringify(doc) });
    expect(fromString).toEqual(extractUsages(specs, { body: doc }));
    expect(
      extractUsages(specs, {
        body: `<p><img src="/api/cms/media/asset/${B}"></p>`,
      }),
    ).toEqual([
      {
        kind: 'asset',
        key: B,
        propertyKey: 'body',
        path: '/body',
        matchedBy: 'url',
      },
    ]);
    expect(
      extractUsages(specs, {
        body: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: 'x',
                  marks: [
                    { type: 'link', attrs: { href: `/media/asset/${C}` } },
                  ],
                },
              ],
            },
          ],
        },
      }).map((u) => [u.key, u.matchedBy]),
    ).toEqual([[C, 'url']]);
  });

  it('rewrites image nodes and internal link marks and keeps the rest', () => {
    type Node = { attrs?: Record<string, unknown>; content: Node[] };
    const swapped = rewriteUsages(specs, { body: doc, title: 'x' }, A, B) as {
      body: Node;
    };
    const image = swapped.body.content[1].content[0].content[0].content[0];
    expect(image.attrs).toEqual({ assetId: B, alt: 'Two people' });
    expect(swapped.body.content[0]).toBe(doc.content[0] as unknown);
    expect(swapped.body.content[2]).toBe(doc.content[2] as unknown);

    const relinked = rewriteUsages(specs, { body: JSON.stringify(doc) }, R, R2);
    expect(
      extractUsages(specs, relinked)
        .filter((u) => u.kind === 'link')
        .map((u) => u.key),
    ).toEqual([R2, R2]);
    const untouched = { body: doc };
    expect(rewriteUsages(specs, untouched, 'ast_zzzzzzzzzzzzzzzzzzzz', B)).toBe(
      untouched,
    );
  });
});
