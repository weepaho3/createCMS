// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';

import type { RichTextDoc, RichTextNode } from '../../core/rich-text/types';

import { richTextToHtml } from '../../core/rich-text/convert';
import { RichText, renderRichText } from '../rich-text';

afterEach(cleanup);

const text = (value: string, marks?: RichTextNode['marks']): RichTextNode =>
  marks ? { type: 'text', text: value, marks } : { type: 'text', text: value };

const sample: RichTextDoc = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [text('Title')] },
    {
      type: 'paragraph',
      content: [
        text('Hi '),
        text('there', [{ type: 'bold' }, { type: 'italic' }]),
        { type: 'hardBreak' },
        text('go', [{ type: 'link', attrs: { href: 'https://x.test' } }]),
      ],
    },
    {
      type: 'orderedList',
      attrs: { start: 2 },
      content: [
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [text('one')] }],
        },
      ],
    },
    {
      type: 'blockquote',
      content: [{ type: 'paragraph', content: [text('q')] }],
    },
    { type: 'codeBlock', attrs: { language: 'ts' }, content: [text('a < b')] },
    { type: 'horizontalRule' },
    { type: 'image', attrs: { assetId: 'ast_1', alt: 'Logo' } },
  ],
};

describe('RichText', () => {
  it('renders the same elements as richTextToHtml', () => {
    const resolveAsset = (id: string) => `/api/cms/media/asset/${id}`;
    const { container } = render(
      <RichText value={sample} resolveAsset={resolveAsset} />,
    );
    const expected = document.createElement('div');
    expected.innerHTML = richTextToHtml(sample, { resolveAsset });
    expect(container.isEqualNode(expected)).toBe(true);
  });

  it('works in a server render', () => {
    expect(renderToString(<RichText value={sample} />)).toContain(
      '<h2>Title</h2>',
    );
  });

  it('uses the resolved href of internal links and drops gone targets', () => {
    const value: RichTextDoc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            text('live', [
              {
                type: 'link',
                attrs: {
                  link: { kind: 'internal', rootId: 'r1', collection: 'pages' },
                  resolved: { href: '/about' },
                },
              },
            ]),
            text(' gone', [
              {
                type: 'link',
                attrs: {
                  link: { kind: 'internal', rootId: 'r2', collection: 'pages' },
                  resolved: { href: null },
                },
              },
            ]),
          ],
        },
      ],
    };
    const { container } = render(<RichText value={value} />);
    expect(container.innerHTML).toBe('<p><a href="/about">live</a> gone</p>');
  });

  it('takes component overrides per node and mark', () => {
    const { container } = render(
      <RichText
        value={sample}
        components={{
          link: ({ href, children }) => (
            <a data-next="" href={href}>
              {children}
            </a>
          ),
          heading: ({ children }) => <h1 className="title">{children}</h1>,
        }}
      />,
    );
    expect(container.querySelector('h1.title')?.textContent).toBe('Title');
    expect(container.querySelector('a[data-next]')?.getAttribute('href')).toBe(
      'https://x.test',
    );
  });

  it.each([
    ['script text', [text('<script>alert(1)</script>')]],
    [
      'javascript link',
      [text('x', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }])],
    ],
    [
      'resolved javascript link',
      [
        text('x', [
          {
            type: 'link',
            attrs: { resolved: { href: 'javascript:alert(1)' } },
          },
        ]),
      ],
    ],
  ] as const)('renders inert output for %s', (_name, content) => {
    const { container } = render(
      <RichText
        value={{
          type: 'doc',
          content: [{ type: 'paragraph', content: [...content] }],
        }}
      />,
    );
    expect(container.querySelector('script, a[href^="javascript"]')).toBeNull();
  });

  it('renders nothing for a missing or non-doc value', () => {
    expect(renderRichText(undefined)).toBeNull();
    expect(renderRichText('<p>html</p>' as unknown as RichTextDoc)).toBeNull();
  });
});
