import type { Arbitrary } from 'fast-check';

import {
  array,
  assert,
  constant,
  constantFrom,
  letrec,
  oneof,
  property,
  record,
  string,
} from 'fast-check';
import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';

import type { RichTextDoc, RichTextMark, RichTextNode } from './types';

import { richTextToHtml, richTextToPlainText, walkText } from './convert';
import { EMPTY_RICH_TEXT, isSafeUrl } from './schema';

const text = (value: string, marks?: RichTextMark[]): RichTextNode =>
  marks ? { type: 'text', text: value, marks } : { type: 'text', text: value };
const p = (...content: RichTextNode[]): RichTextNode => ({
  type: 'paragraph',
  content,
});

const sample: RichTextDoc = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [text('Hello')] },
    p(
      text('Dear '),
      text('{{name}}', [{ type: 'bold' }]),
      { type: 'hardBreak' },
      text('see '),
      text('our site', [
        { type: 'link', attrs: { href: 'https://x.test', target: '_blank' } },
        { type: 'italic' },
      ]),
    ),
    {
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [p(text('one'))] },
        {
          type: 'listItem',
          content: [
            p(text('two')),
            {
              type: 'orderedList',
              attrs: { start: 3 },
              content: [{ type: 'listItem', content: [p(text('deep'))] }],
            },
          ],
        },
      ],
    },
    { type: 'blockquote', content: [p(text('quoted'))] },
    {
      type: 'codeBlock',
      attrs: { language: 'ts' },
      content: [text('a < b')],
    },
    { type: 'horizontalRule' },
    { type: 'image', attrs: { assetId: 'a1', alt: 'Logo "x"' } },
  ],
};

describe('richTextToPlainText', () => {
  it('joins blocks and breaks with newlines', () => {
    expect(richTextToPlainText(sample)).toBe(
      'Hello\nDear {{name}}\nsee our site\none\ntwo\ndeep\nquoted\na < b',
    );
  });

  it('takes a block separator', () => {
    expect(
      richTextToPlainText(
        { type: 'doc', content: [p(text('a')), p(text('b'))] },
        { blockSeparator: ' ' },
      ),
    ).toBe('a b');
  });

  it('is empty for the empty value', () => {
    expect(richTextToPlainText(EMPTY_RICH_TEXT)).toBe('');
  });
});

describe('richTextToHtml', () => {
  it('serializes every built-in node', () => {
    expect(
      richTextToHtml(sample, { resolveAsset: (id) => `/media/${id}.png` }),
    ).toMatchInlineSnapshot(
      `"<h2>Hello</h2><p>Dear <strong>{{name}}</strong><br>see <a href="https://x.test" target="_blank" rel="noopener noreferrer"><em>our site</em></a></p><ul><li><p>one</p></li><li><p>two</p><ol start="3"><li><p>deep</p></li></ol></li></ul><blockquote><p>quoted</p></blockquote><pre><code class="language-ts">a &lt; b</code></pre><hr><img src="/media/a1.png" alt="Logo &quot;x&quot;">"`,
    );
  });

  it('leaves images out without a resolver and internal links as text', () => {
    const value: RichTextDoc = {
      type: 'doc',
      content: [
        p(
          text('go', [
            {
              type: 'link',
              attrs: {
                link: { kind: 'internal', rootId: 'r', collection: 'pages' },
              },
            },
          ]),
        ),
        { type: 'image', attrs: { assetId: 'a1' } },
      ],
    };
    expect(richTextToHtml(value)).toBe('<p>go</p>');
    expect(
      richTextToHtml(value, {
        resolveLink: (attrs) =>
          attrs.link && typeof attrs.link === 'object' ? '/pages/r' : null,
      }),
    ).toBe('<p><a href="/pages/r">go</a></p>');
  });

  it('adds inline styles per node and mark for e-mail', () => {
    expect(
      richTextToHtml(
        {
          type: 'doc',
          content: [
            p(text('a', [{ type: 'bold' }])),
            { type: 'horizontalRule' },
          ],
        },
        {
          styles: {
            paragraph: 'margin:0 0 16px',
            bold: 'font-weight:700',
            horizontalRule: 'border:0;border-top:1px solid "x"',
          },
        },
      ),
    ).toBe(
      '<p style="margin:0 0 16px"><strong style="font-weight:700">a</strong></p><hr style="border:0;border-top:1px solid &quot;x&quot;">',
    );
  });

  const xss: [string, RichTextDoc][] = [
    [
      'script text',
      { type: 'doc', content: [p(text('<script>alert(1)</script>'))] },
    ],
    [
      'javascript href',
      {
        type: 'doc',
        content: [
          p(
            text('x', [
              { type: 'link', attrs: { href: 'javascript:alert(1)' } },
            ]),
          ),
        ],
      },
    ],
    [
      'obfuscated scheme',
      {
        type: 'doc',
        content: [
          p(
            text('x', [
              { type: 'link', attrs: { href: ' j\na\tvascript:alert(1)' } },
            ]),
          ),
        ],
      },
    ],
    [
      'attribute breakout',
      {
        type: 'doc',
        content: [
          p(
            text('x', [
              { type: 'link', attrs: { href: '/a" onmouseover="alert(1)' } },
            ]),
          ),
        ],
      },
    ],
    [
      'image attribute breakout',
      {
        type: 'doc',
        content: [
          {
            type: 'image',
            attrs: { assetId: 'a', alt: '"><img src=x onerror=alert(1)>' },
          },
        ],
      },
    ],
    [
      'resolver returning a data URL',
      {
        type: 'doc',
        content: [{ type: 'image', attrs: { assetId: 'a' } }],
      },
    ],
    [
      'unknown node with html text',
      {
        type: 'doc',
        content: [{ type: 'iframe', content: [text('<iframe src=x>')] }],
      },
    ],
    [
      'heading level injection',
      {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: '1 onclick=alert(1)' },
            content: [text('x')],
          },
        ],
      },
    ],
  ];

  it.each(xss)('never emits executable markup: %s', (_name, value) => {
    const html = richTextToHtml(value, {
      resolveAsset: () => 'data:text/html,<script>alert(1)</script>',
    });
    const body = new Window().document.createElement('div');
    body.innerHTML = html;
    expect(body.querySelector('script, iframe, object, embed')).toBeNull();
    for (const el of body.querySelectorAll('*')) {
      for (const attr of Array.from(el.attributes)) {
        expect(attr.name).not.toMatch(/^on/i);
        if (attr.name === 'href' || attr.name === 'src') {
          expect(isSafeUrl(attr.value ?? '')).toBe(true);
        }
      }
    }
  });
});

const markArb: Arbitrary<RichTextMark> = constantFrom(
  { type: 'bold' },
  { type: 'italic' },
  { type: 'link', attrs: { href: 'https://x.test' } },
);
const textArb: Arbitrary<RichTextNode> = record({
  type: constant('text'),
  text: string({ minLength: 1 }),
  marks: array(markArb, { maxLength: 2 }),
});
const nodeArb: Arbitrary<RichTextNode> = letrec<{
  node: RichTextNode;
}>((tie) => ({
  node: oneof(
    { depthSize: 'small' },
    textArb,
    record({
      type: constantFrom('paragraph', 'blockquote', 'listItem'),
      content: array(tie('node'), { maxLength: 3 }),
    }),
  ),
})).node;
const docArb: Arbitrary<RichTextDoc> = record({
  type: constant('doc' as const),
  content: array(nodeArb, { maxLength: 4 }),
});

describe('walkText', () => {
  it('without changes returns the same value', () => {
    assert(
      property(docArb, (value) => {
        const seen: string[] = [];
        const out = walkText(value, (t) => {
          seen.push(t);
        });
        expect(out).toBe(value);
        const same = walkText(value, (t) => t);
        expect(same).toBe(value);
        return seen.length >= 0;
      }),
    );
  });

  it('rewrites text immutably and drops text that becomes empty', () => {
    const value: RichTextDoc = {
      type: 'doc',
      content: [p(text('Hi {{name}}')), p(text('x'), text('{{gone}}'))],
    };
    const paths: number[][] = [];
    const out = walkText(value, (t, path) => {
      paths.push([...path]);
      return t.replace('{{name}}', 'Ada').replace('{{gone}}', '');
    });
    expect(out).toEqual({
      type: 'doc',
      content: [p(text('Hi Ada')), p(text('x'))],
    });
    expect(value.content![0]!.content![0]!.text).toBe('Hi {{name}}');
    expect(out.content![1]).not.toBe(value.content![1]);
    expect(paths).toEqual([
      [0, 0],
      [1, 0],
      [1, 1],
    ]);
  });
});
