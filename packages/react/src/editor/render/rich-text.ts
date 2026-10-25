import * as React from 'react';

import type { JsonValue } from '../core/document';
import type {
  RichTextDoc,
  RichTextMark,
  RichTextNode,
} from '../core/richtext/types';

import { isSafeUrl, linkMarkHref } from '../core/richtext/schema';

export type RichTextStaticProps = {
  value: RichTextDoc | null | undefined;
  /**
   * The URL of a link mark; `null` renders its text without a link.
   * Default: external URLs, `mailto:` and `tel:`; internal links render
   * as text.
   */
  resolveLink?: (attrs: Record<string, JsonValue>) => string | null;
  /** The URL of an image asset; without it images are left out. */
  resolveAsset?: (assetId: string) => string | null;
};

type Resolvers = Omit<RichTextStaticProps, 'value'>;

const h = React.createElement;

const MARK_ELEMENTS: Record<string, string> = {
  bold: 'strong',
  italic: 'em',
  underline: 'u',
  strike: 's',
  code: 'code',
};

const NODE_ELEMENTS: Record<string, string> = {
  paragraph: 'p',
  bulletList: 'ul',
  listItem: 'li',
  blockquote: 'blockquote',
};

function withMark(
  children: React.ReactNode,
  mark: RichTextMark,
  resolvers: Resolvers,
): React.ReactNode {
  const tag = MARK_ELEMENTS[mark.type];
  if (tag) return h(tag, null, children);
  if (mark.type !== 'link') return children;
  const attrs = mark.attrs ?? {};
  const href = resolvers.resolveLink
    ? resolvers.resolveLink(attrs)
    : linkMarkHref(attrs);
  if (href === null || !isSafeUrl(href)) return children;
  return attrs.target === '_blank'
    ? h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, children)
    : h('a', { href }, children);
}

function renderNode(
  node: RichTextNode,
  key: number,
  resolvers: Resolvers,
): React.ReactNode {
  const children = () =>
    (node.content ?? []).map((child, i) => renderNode(child, i, resolvers));
  switch (node.type) {
    case 'text': {
      let out: React.ReactNode = node.text ?? '';
      const marks = node.marks ?? [];
      // The first mark is the outermost element.
      for (let i = marks.length - 1; i >= 0; i -= 1) {
        out = withMark(out, marks[i]!, resolvers);
      }
      return h(React.Fragment, { key }, out);
    }
    case 'hardBreak':
      return h('br', { key });
    case 'horizontalRule':
      return h('hr', { key });
    case 'heading': {
      const raw = node.attrs?.level;
      const level =
        typeof raw === 'number' && raw >= 1 && raw <= 6 ? Math.floor(raw) : 2;
      return h(`h${level}`, { key }, children());
    }
    case 'orderedList': {
      const start = node.attrs?.start;
      return h(
        'ol',
        {
          key,
          start:
            typeof start === 'number' && Number.isInteger(start) && start !== 1
              ? start
              : undefined,
        },
        children(),
      );
    }
    case 'codeBlock': {
      const language = node.attrs?.language;
      return h(
        'pre',
        { key },
        h(
          'code',
          {
            className:
              typeof language === 'string' && language !== ''
                ? `language-${language}`
                : undefined,
          },
          (node.content ?? []).map((child) => child.text ?? '').join(''),
        ),
      );
    }
    case 'image': {
      const id = node.attrs?.assetId;
      if (typeof id !== 'string' || !resolvers.resolveAsset) return null;
      const src = resolvers.resolveAsset(id);
      if (src === null || !isSafeUrl(src)) return null;
      const alt = node.attrs?.alt;
      return h('img', { key, src, alt: typeof alt === 'string' ? alt : '' });
    }
    default: {
      const tag = NODE_ELEMENTS[node.type];
      return h(tag ?? React.Fragment, { key }, children());
    }
  }
}

/**
 * Renders a rich text value as React elements, without an editor and
 * without `dangerouslySetInnerHTML`: the same elements as
 * `richTextToHtml`. Works in Server Components.
 */
export function RichTextStatic({
  value,
  resolveLink,
  resolveAsset,
}: RichTextStaticProps): React.ReactNode {
  if (!value || !Array.isArray(value.content)) return null;
  const resolvers: Resolvers = { resolveLink, resolveAsset };
  return value.content.map((node, i) => renderNode(node, i, resolvers));
}
