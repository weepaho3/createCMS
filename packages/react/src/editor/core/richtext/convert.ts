import type {
  RichTextDoc,
  RichTextJsonValue,
  RichTextMark,
  RichTextNode,
} from './types';

import { BLOCK_NODES, isSafeUrl, linkMarkHref } from './schema';

const BLOCKISH = new Set([...BLOCK_NODES, 'listItem']);

/**
 * The text of a rich text value: blocks (paragraphs, headings, list
 * items, ...) joined by `blockSeparator` (default `\n`), hard breaks as
 * `\n`. Used for length limits, search and excerpts.
 */
export function richTextToPlainText(
  doc: RichTextDoc,
  options: { blockSeparator?: string } = {},
): string {
  const blocks: string[] = [];
  collectBlocks(doc.content ?? [], blocks);
  return blocks.join(options.blockSeparator ?? '\n');
}

const CONTAINERS = new Set([
  'bulletList',
  'orderedList',
  'listItem',
  'blockquote',
]);

function isContainer(node: RichTextNode): boolean {
  return (
    CONTAINERS.has(node.type) ||
    (node.content?.some((child) => BLOCKISH.has(child.type)) ?? false)
  );
}

function inlineText(nodes: readonly RichTextNode[] | undefined): string {
  let out = '';
  for (const node of nodes ?? []) {
    if (node.type === 'text') out += node.text ?? '';
    else if (node.type === 'hardBreak') out += '\n';
    else out += inlineText(node.content);
  }
  return out;
}

function collectBlocks(nodes: readonly RichTextNode[], out: string[]) {
  let run: string | null = null;
  for (const node of nodes) {
    if (!BLOCKISH.has(node.type) && !isContainer(node)) {
      run = (run ?? '') + inlineText([node]);
      continue;
    }
    if (run !== null) out.push(run);
    run = null;
    if (isContainer(node)) collectBlocks(node.content ?? [], out);
    else if (node.type !== 'horizontalRule' && node.type !== 'image') {
      out.push(inlineText(node.content));
    }
  }
  if (run !== null) out.push(run);
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escapes text and attribute values for HTML. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ESCAPES[c]!);
}

export type RichTextToHtmlOptions = {
  /**
   * The URL of a link mark (its attrs: `{ link }` or `{ href }`); `null`
   * renders the text without a link. Default: external URLs, `mailto:`
   * and `tel:`; internal links render as text.
   */
  resolveLink?: (attrs: Record<string, RichTextJsonValue>) => string | null;
  /** The URL of an image asset; without it images are left out. */
  resolveAsset?: (assetId: string) => string | null;
  /**
   * Inline CSS per node or mark type (`paragraph`, `heading`, `link`,
   * `bold`, ...) for e-mail clients that ignore style sheets.
   */
  styles?: Partial<Record<string, string>>;
};

const MARK_TAGS: Record<string, string> = {
  bold: 'strong',
  italic: 'em',
  underline: 'u',
  strike: 's',
  code: 'code',
};

const NODE_TAGS: Record<string, string> = {
  paragraph: 'p',
  bulletList: 'ul',
  orderedList: 'ol',
  listItem: 'li',
  blockquote: 'blockquote',
};

function attrString(name: string, value: string): string {
  return ` ${name}="${escapeHtml(value)}"`;
}

function styleOf(type: string, options: RichTextToHtmlOptions): string {
  const css = options.styles?.[type];
  return css ? attrString('style', css) : '';
}

function wrapMark(
  html: string,
  mark: RichTextMark,
  options: RichTextToHtmlOptions,
): string {
  const tag = MARK_TAGS[mark.type];
  if (tag) return `<${tag}${styleOf(mark.type, options)}>${html}</${tag}>`;
  if (mark.type === 'link') {
    const attrs = mark.attrs ?? {};
    const href = options.resolveLink
      ? options.resolveLink(attrs)
      : linkMarkHref(attrs);
    if (href === null || !isSafeUrl(href)) return html;
    const blank = attrs.target === '_blank';
    return `<a${attrString('href', href)}${
      blank ? ' target="_blank" rel="noopener noreferrer"' : ''
    }${styleOf('link', options)}>${html}</a>`;
  }
  return html;
}

function nodeToHtml(
  node: RichTextNode,
  options: RichTextToHtmlOptions,
): string {
  const inner = () =>
    (node.content ?? []).map((child) => nodeToHtml(child, options)).join('');
  switch (node.type) {
    case 'text': {
      let html = escapeHtml(node.text ?? '');
      // The first mark is the outermost element.
      const marks = node.marks ?? [];
      for (let i = marks.length - 1; i >= 0; i -= 1) {
        html = wrapMark(html, marks[i]!, options);
      }
      return html;
    }
    case 'hardBreak':
      return '<br>';
    case 'horizontalRule':
      return `<hr${styleOf('horizontalRule', options)}>`;
    case 'heading': {
      const raw = node.attrs?.level;
      const level =
        typeof raw === 'number' && raw >= 1 && raw <= 6 ? Math.floor(raw) : 2;
      return `<h${level}${styleOf('heading', options)}>${inner()}</h${level}>`;
    }
    case 'orderedList': {
      const start = node.attrs?.start;
      const attr =
        typeof start === 'number' && Number.isInteger(start) && start !== 1
          ? attrString('start', String(start))
          : '';
      return `<ol${attr}${styleOf('orderedList', options)}>${inner()}</ol>`;
    }
    case 'codeBlock': {
      const language = node.attrs?.language;
      const cls =
        typeof language === 'string' && language !== ''
          ? attrString('class', `language-${language}`)
          : '';
      return `<pre${styleOf('codeBlock', options)}><code${cls}>${(
        node.content ?? []
      )
        .map((child) => escapeHtml(child.text ?? ''))
        .join('')}</code></pre>`;
    }
    case 'image': {
      const id = node.attrs?.assetId;
      if (typeof id !== 'string' || !options.resolveAsset) return '';
      const src = options.resolveAsset(id);
      if (src === null || !isSafeUrl(src)) return '';
      const alt = node.attrs?.alt;
      return `<img${attrString('src', src)}${attrString(
        'alt',
        typeof alt === 'string' ? alt : '',
      )}${styleOf('image', options)}>`;
    }
    default: {
      const tag = NODE_TAGS[node.type];
      return tag
        ? `<${tag}${styleOf(node.type, options)}>${inner()}</${tag}>`
        : inner();
    }
  }
}

/**
 * HTML for a rich text value (e-mail, feeds, string contexts). Every text
 * and attribute is escaped; nothing passes through as raw HTML, links
 * keep only allowed URL schemes, and unknown nodes render their content
 * without a tag.
 */
export function richTextToHtml(
  doc: RichTextDoc,
  options: RichTextToHtmlOptions = {},
): string {
  return (doc.content ?? []).map((node) => nodeToHtml(node, options)).join('');
}

/**
 * Rewrites the text nodes of a value: `fn` gets each text and its path of
 * content indexes and returns the new text, or nothing to keep it. Text
 * that becomes empty is removed. Returns `doc` itself when nothing
 * changed.
 */
export function walkText(
  doc: RichTextDoc,
  fn: (text: string, path: readonly number[]) => string | void,
): RichTextDoc {
  const walk = (
    nodes: RichTextNode[],
    path: number[],
  ): RichTextNode[] | null => {
    let out: RichTextNode[] | null = null;
    nodes.forEach((node, i) => {
      const at = [...path, i];
      let next: RichTextNode | null = node;
      if (node.type === 'text' && typeof node.text === 'string') {
        const text = fn(node.text, at);
        if (typeof text === 'string' && text !== node.text) {
          next = text === '' ? null : { ...node, text };
        }
      } else if (node.content) {
        const content = walk(node.content, at);
        if (content) next = { ...node, content };
      }
      if (next !== node && !out) out = nodes.slice(0, i);
      if (out && next) out.push(next);
    });
    return out;
  };
  const content = doc.content ? walk(doc.content, []) : null;
  return content ? { ...doc, content } : doc;
}

/**
 * A rich text value for plain text: one paragraph per line, or for an
 * `inline` field one paragraph with hard breaks. `{{variables}}` stay text.
 */
export function plainTextToRichText(
  text: string,
  options: { inline?: boolean } = {},
): RichTextDoc {
  const lines = text.split(/\r\n|\r|\n/);
  const paragraph = (content: RichTextNode[]): RichTextNode =>
    content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' };
  if (options.inline) {
    const content: RichTextNode[] = [];
    lines.forEach((line, i) => {
      if (i > 0) content.push({ type: 'hardBreak' });
      if (line !== '') content.push({ type: 'text', text: line });
    });
    return { type: 'doc', content: [paragraph(content)] };
  }
  return {
    type: 'doc',
    content: lines.map((line) =>
      paragraph(line === '' ? [] : [{ type: 'text', text: line }]),
    ),
  };
}
