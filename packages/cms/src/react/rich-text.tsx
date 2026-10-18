import type { ReactNode } from 'react';

import { createElement, Fragment } from 'react';

import type { RichTextDiffSegment } from '../core/diff/types';
import type {
  RichTextDoc,
  RichTextMark,
  RichTextNode,
} from '../core/rich-text/types';

import { isSafeUrl, linkMarkHref } from '../core/rich-text/schema';

type Attrs = Readonly<Record<string, unknown>>;

/** What an override in {@link RichTextComponents} receives. */
export type RichTextElementProps = {
  /** The node or mark type (`paragraph`, `heading`, `link`, `bold`, ...). */
  type: string;
  attrs: Attrs;
  children: ReactNode;
  /** Links: the resolved URL. Images: the asset URL. */
  href?: string;
  src?: string;
};

/**
 * Replaces the element of a node or mark type, e.g. `link` with Next's
 * `Link` or `image` with `next/image`. Return `children` to drop the
 * element and keep its content.
 */
export type RichTextComponents = Partial<
  Record<string, (props: RichTextElementProps) => ReactNode>
>;

export type RenderRichTextOptions = {
  components?: RichTextComponents;
  /**
   * The URL of a link mark; `null` renders its text without a link.
   * Default: the published read path's `attrs.resolved.href`, else external
   * URLs, `mailto:` and `tel:`; an unresolved internal link renders as
   * text.
   */
  resolveLink?: (attrs: Attrs) => string | null;
  /** The URL of an image asset (`{api}/media/asset/{id}`); without it images are left out. */
  resolveAsset?: (assetId: string) => string | null;
};

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

/** The href of a link mark: the resolved one first, then the static target. */
export function richTextLinkHref(attrs: Attrs): string | null {
  const resolved = attrs.resolved;
  if (typeof resolved === 'object' && resolved !== null && 'href' in resolved) {
    const href = (resolved as { href: unknown }).href;
    return typeof href === 'string' && isSafeUrl(href) ? href : null;
  }
  return linkMarkHref(attrs as Parameters<typeof linkMarkHref>[0]);
}

function element(
  type: string,
  tag: string,
  attrs: Attrs,
  props: Record<string, unknown>,
  children: ReactNode,
  options: RenderRichTextOptions,
): ReactNode {
  const override = options.components?.[type];
  if (override) {
    return createElement(
      Fragment,
      { key: props.key as string | number | undefined },
      override({
        type,
        attrs,
        children,
        href: props.href as string | undefined,
        src: props.src as string | undefined,
      }),
    );
  }
  return createElement(tag, props, children);
}

function withMark(
  children: ReactNode,
  mark: RichTextMark,
  options: RenderRichTextOptions,
): ReactNode {
  const attrs = mark.attrs ?? {};
  const tag = MARK_ELEMENTS[mark.type];
  if (tag) return element(mark.type, tag, attrs, {}, children, options);
  if (mark.type !== 'link') {
    const override = options.components?.[mark.type];
    return override ? override({ type: mark.type, attrs, children }) : children;
  }
  const href = options.resolveLink
    ? options.resolveLink(attrs)
    : richTextLinkHref(attrs);
  if (href === null || !isSafeUrl(href)) return children;
  const props: Record<string, unknown> = { href };
  if (attrs.target === '_blank') {
    props.target = '_blank';
    props.rel = 'noopener noreferrer';
  }
  return element('link', 'a', attrs, props, children, options);
}

function renderNode(
  node: RichTextNode,
  key: number,
  options: RenderRichTextOptions,
): ReactNode {
  const attrs: Attrs = node.attrs ?? {};
  const children = () =>
    (node.content ?? []).map((child, i) => renderNode(child, i, options));
  switch (node.type) {
    case 'text': {
      let out: ReactNode = node.text ?? '';
      const marks = node.marks ?? [];
      // The first mark is the outermost element.
      for (let i = marks.length - 1; i >= 0; i -= 1) {
        out = withMark(out, marks[i]!, options);
      }
      return createElement(Fragment, { key }, out);
    }
    case 'hardBreak':
      return element('hardBreak', 'br', attrs, { key }, undefined, options);
    case 'horizontalRule':
      return element(
        'horizontalRule',
        'hr',
        attrs,
        { key },
        undefined,
        options,
      );
    case 'heading': {
      const raw = attrs.level;
      const level =
        typeof raw === 'number' && raw >= 1 && raw <= 6 ? Math.floor(raw) : 2;
      return element(
        'heading',
        `h${level}`,
        attrs,
        { key },
        children(),
        options,
      );
    }
    case 'orderedList': {
      const start = attrs.start;
      return element(
        'orderedList',
        'ol',
        attrs,
        {
          key,
          start:
            typeof start === 'number' && Number.isInteger(start) && start !== 1
              ? start
              : undefined,
        },
        children(),
        options,
      );
    }
    case 'codeBlock': {
      const language = attrs.language;
      const code = createElement(
        'code',
        {
          className:
            typeof language === 'string' && language !== ''
              ? `language-${language}`
              : undefined,
        },
        (node.content ?? []).map((child) => child.text ?? '').join(''),
      );
      return element('codeBlock', 'pre', attrs, { key }, code, options);
    }
    case 'image': {
      const id = attrs.assetId;
      if (typeof id !== 'string' || !options.resolveAsset) return null;
      const src = options.resolveAsset(id);
      if (src === null || !isSafeUrl(src)) return null;
      const alt = typeof attrs.alt === 'string' ? attrs.alt : '';
      return element(
        'image',
        'img',
        attrs,
        { key, src, alt },
        undefined,
        options,
      );
    }
    default: {
      const tag = NODE_ELEMENTS[node.type];
      if (tag) {
        return element(node.type, tag, attrs, { key }, children(), options);
      }
      const override = options.components?.[node.type];
      return createElement(
        Fragment,
        { key },
        override
          ? override({ type: node.type, attrs, children: children() })
          : children(),
      );
    }
  }
}

/**
 * React elements for a `richText` value, without `dangerouslySetInnerHTML`
 * and without an editor. Server-safe: works in Server Components.
 */
export function renderRichText(
  value: RichTextDoc | null | undefined,
  options: RenderRichTextOptions = {},
): ReactNode {
  if (!value || value.type !== 'doc' || !Array.isArray(value.content)) {
    return null;
  }
  return value.content.map((node, i) => renderNode(node, i, options));
}

export type RichTextProps = RenderRichTextOptions & {
  value: RichTextDoc | null | undefined;
};

/** Renders a `richText` value; see {@link renderRichText}. */
export function RichText({ value, ...options }: RichTextProps): ReactNode {
  return renderRichText(value, options);
}

export type RichTextDiffProps = Omit<RenderRichTextOptions, 'resolveAsset'> & {
  /** `richTextDiff` of a changed `richText` property. */
  segments: readonly RichTextDiffSegment[];
};

function blockTag(segment: RichTextDiffSegment): string {
  if (segment.blockType === 'heading') {
    const level = segment.level;
    return `h${typeof level === 'number' && level >= 1 && level <= 6 ? level : 2}`;
  }
  return segment.blockType === 'codeBlock' ? 'pre' : 'p';
}

/**
 * Renders word-level `richText` diff segments: one element per text block
 * (`p`, `h1` to `h6`, `pre`), inserted words in `<ins data-diff-text="ins">`,
 * deleted words in `<del data-diff-text="del">`, and text whose formatting
 * changed in `<span data-diff-text="format">`, each with its marks. No
 * `dangerouslySetInnerHTML`; style `ins`, `del` and the attribute via CSS.
 */
export function RichTextDiff({
  segments,
  ...options
}: RichTextDiffProps): ReactNode {
  const blocks: { key: string; tag: string; parts: ReactNode[] }[] = [];
  let current: (typeof blocks)[number] | undefined;
  let lastBlock: string | undefined;
  segments.forEach((segment, i) => {
    // Deleted text of the old value sits in the block it came from.
    const id = `${segment.type === 'del' ? 'd' : 'n'}${segment.block}`;
    const blockId = segment.type === 'del' ? (lastBlock ?? id) : id;
    if (segment.type !== 'del') lastBlock = id;
    if (!current || current.key !== blockId) {
      current = { key: blockId, tag: blockTag(segment), parts: [] };
      blocks.push(current);
    }
    let out: ReactNode = segment.text;
    for (let m = segment.marks.length - 1; m >= 0; m -= 1) {
      out = withMark(out, segment.marks[m]!, options);
    }
    if (segment.type === 'same') {
      current.parts.push(createElement(Fragment, { key: i }, out));
    } else {
      const tag =
        segment.type === 'ins'
          ? 'ins'
          : segment.type === 'del'
            ? 'del'
            : 'span';
      current.parts.push(
        createElement(tag, { key: i, 'data-diff-text': segment.type }, out),
      );
    }
  });
  return blocks.map((block, i) =>
    createElement(block.tag, { key: i }, block.parts),
  );
}
