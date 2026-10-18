import { describe, expect, it } from 'vitest';

import type { RichTextDoc, RichTextNode } from './types';

import { RICH_TEXT_MARKS, RICH_TEXT_NODES, richTextSchemaOf } from './schema';
import { validateRichText } from './validate';

const all = richTextSchemaOf({});
const doc = (...content: RichTextNode[]): RichTextDoc => ({
  type: 'doc',
  content,
});
const p = (...content: RichTextNode[]): RichTextNode => ({
  type: 'paragraph',
  content,
});
const text = (value: string, marks?: RichTextNode['marks']): RichTextNode =>
  marks ? { type: 'text', text: value, marks } : { type: 'text', text: value };
const reasonOf = (params: Record<string, unknown> | undefined): string =>
  typeof params?.reason === 'string' ? params.reason : '';
const codes = (value: unknown, schema = all) =>
  validateRichText(value, schema).map((e) =>
    e.code === 'richTextStructure' ? `${e.code}:${reasonOf(e.params)}` : e.code,
  );

describe('validateRichText', () => {
  it('accepts every built-in node and mark', () => {
    const value = doc(
      { type: 'heading', attrs: { level: 2 }, content: [text('Title')] },
      p(
        text('a', [{ type: 'bold' }, { type: 'italic' }]),
        { type: 'hardBreak' },
        text('b', [{ type: 'link', attrs: { href: 'https://x.test' } }]),
        text('c', [
          {
            type: 'link',
            attrs: {
              link: { kind: 'internal', rootId: 'r1', collection: 'pages' },
            },
          },
        ]),
      ),
      {
        type: 'bulletList',
        content: [{ type: 'listItem', content: [p(text('one'))] }],
      },
      {
        type: 'orderedList',
        attrs: { start: 3 },
        content: [{ type: 'listItem', content: [p(text('two'))] }],
      },
      { type: 'blockquote', content: [p(text('quote'))] },
      {
        type: 'codeBlock',
        attrs: { language: 'ts' },
        content: [text('let x')],
      },
      { type: 'horizontalRule' },
      { type: 'image', attrs: { assetId: 'a1', alt: 'A' } },
      { type: 'paragraph' },
    );
    expect(codes(value)).toEqual([]);
    expect(RICH_TEXT_NODES.length + RICH_TEXT_MARKS.length).toBe(17);
  });

  it.each<[string, unknown, string[]]>([
    ['not a doc', 'plain', ['type']],
    ['nested doc', doc({ type: 'doc' }), ['richTextStructure:nestedDoc']],
    [
      'list item outside a list',
      doc({ type: 'listItem', content: [p(text('x'))] }),
      ['richTextStructure:placement'],
    ],
    [
      'paragraph inside a paragraph',
      doc(p(p(text('x')))),
      ['richTextStructure:placement'],
    ],
    ['text at the top level', doc(text('x')), ['richTextStructure:placement']],
    [
      'empty list',
      doc({ type: 'bulletList', content: [] }),
      ['richTextStructure:emptyContainer'],
    ],
    [
      'heading level 7',
      doc({ type: 'heading', attrs: { level: 7 }, content: [text('x')] }),
      ['richTextStructure:headingLevel'],
    ],
    [
      'empty text node',
      doc(p({ type: 'text', text: '' })),
      ['richTextStructure:emptyText'],
    ],
    [
      'marks on a paragraph',
      doc({ type: 'paragraph', marks: [{ type: 'bold' }] }),
      ['richTextStructure:marksOnText'],
    ],
    [
      'duplicate mark',
      doc(p(text('x', [{ type: 'bold' }, { type: 'bold' }]))),
      ['richTextStructure:duplicateMark'],
    ],
    [
      'image without asset',
      doc({ type: 'image', attrs: {} }),
      ['richTextStructure:imageAsset'],
    ],
    [
      'content in a leaf',
      doc({ type: 'horizontalRule', content: [] }),
      ['richTextStructure:leaf'],
    ],
    [
      'marks inside code',
      doc({
        type: 'codeBlock',
        content: [text('x', [{ type: 'bold' }])],
      }),
      ['richTextStructure:marksInCode'],
    ],
    [
      'link without a target',
      doc(p(text('x', [{ type: 'link', attrs: {} }]))),
      ['richTextStructure:linkTarget'],
    ],
  ])('%s', (_name, value, expected) => {
    expect(codes(value)).toEqual(expected);
  });

  it.each([
    'javascript:alert(1)',
    ' JavaScript:alert(1)',
    'java\tscript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox',
  ])('rejects the link URL %j', (href) => {
    expect(
      codes(doc(p(text('x', [{ type: 'link', attrs: { href } }])))),
    ).toEqual(['richTextLinkProtocol']);
    expect(
      codes(
        doc(
          p(
            text('x', [
              {
                type: 'link',
                attrs: { link: { kind: 'external', url: href } },
              },
            ]),
          ),
        ),
      ),
    ).toEqual(['richTextLinkProtocol']);
  });

  it.each(['https://x.test', 'mailto:a@b.test', 'tel:+49', '/about', '#top'])(
    'accepts the link URL %j',
    (href) => {
      expect(
        codes(doc(p(text('x', [{ type: 'link', attrs: { href } }])))),
      ).toEqual([]);
    },
  );

  it('rejects marks and nodes the field does not allow', () => {
    const narrow = richTextSchemaOf({ marks: ['bold'], nodes: [] });
    const value = doc(p(text('x', [{ type: 'italic' }])), {
      type: 'heading',
      attrs: { level: 1 },
      content: [text('h')],
    });
    expect(validateRichText(value, narrow)).toEqual([
      {
        code: 'richTextMark',
        path: ['content', 0, 'content', 0, 'marks', 0],
        params: { mark: 'italic' },
      },
      {
        code: 'richTextNode',
        path: ['content', 1],
        params: { node: 'heading' },
      },
    ]);
  });

  it('an inline field holds at most one paragraph', () => {
    const inline = richTextSchemaOf({ inline: true });
    expect(codes(doc(p(text('a'))), inline)).toEqual([]);
    expect(codes(doc(p(text('a')), p(text('b'))), inline)).toEqual([
      'richTextStructure:inline',
    ]);
    expect(
      codes(
        doc({ type: 'heading', attrs: { level: 1 }, content: [text('a')] }),
        inline,
      ),
    ).toEqual(['richTextStructure:inline']);
  });

  it('nodes outside the built-in set pass when the field allows them', () => {
    const custom = richTextSchemaOf({ nodes: ['callout'] });
    expect(
      codes(doc({ type: 'callout', content: [p(text('x'))] }), custom),
    ).toEqual([]);
    expect(codes(doc({ type: 'callout' }))).toEqual(['richTextNode']);
  });
});
