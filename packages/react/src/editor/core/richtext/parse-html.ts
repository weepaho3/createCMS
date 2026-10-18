import type {
  RichTextDoc,
  RichTextJsonValue,
  RichTextMark,
  RichTextNode,
  RichTextSchema,
} from './types';

import { ALWAYS_ALLOWED_NODES, isSafeUrl } from './schema';

/** The DOM surface the parser reads (a browser, happy-dom or linkedom document). */
export type ParsedHtmlNode = {
  readonly nodeType: number;
  readonly nodeName: string;
  readonly nodeValue: string | null;
  readonly textContent: string | null;
  readonly childNodes: ArrayLike<ParsedHtmlNode>;
  readonly attributes?: ArrayLike<{ name: string; value: string }>;
  getAttribute?(name: string): string | null;
};

export type ParsedHtmlDocument = { readonly body: ParsedHtmlNode | null };

/**
 * What an import dropped, by count: HTML `tags` that were removed or had
 * no counterpart, `attributes` (`tag[attr]`; `class`, `style`, `id`,
 * `dir` and `lang` are presentation and not counted), and `nodes` and
 * `marks` the field does not allow.
 */
export type RichTextLossReport = {
  tags: Record<string, number>;
  attributes: Record<string, number>;
  nodes: Record<string, number>;
  marks: Record<string, number>;
};

export type HtmlToRichTextOptions = {
  /** Parses HTML; default the global `DOMParser` (browsers). */
  domParser?: (html: string) => ParsedHtmlDocument;
};

const ELEMENT = 1;
const TEXT = 3;

/** Removed silently: metadata and Office namespace noise. */
const NOISE = new Set(['META', 'STYLE', 'TITLE', 'HEAD', 'LINK', 'XML']);
/** Removed with their content and reported. */
const DROPPED = new Set([
  'SCRIPT',
  'NOSCRIPT',
  'TEMPLATE',
  'IFRAME',
  'OBJECT',
  'EMBED',
  'svg',
  'SVG',
  'CANVAS',
  'VIDEO',
  'AUDIO',
  'SELECT',
  'TEXTAREA',
  'BUTTON',
  'INPUT',
]);
/** Containers whose content stays and whose tag carries nothing. */
const TRANSPARENT_BLOCKS = new Set([
  'DIV',
  'SECTION',
  'ARTICLE',
  'HEADER',
  'FOOTER',
  'MAIN',
  'ASIDE',
  'NAV',
  'FIGURE',
  'FIGCAPTION',
  'CENTER',
  'ADDRESS',
  'BODY',
  'HTML',
  'FORM',
  'DL',
  'DT',
  'DD',
]);
const TRANSPARENT_INLINE = new Set(['SPAN', 'FONT', 'LABEL', 'ABBR', 'TIME']);
const TABLE_CELLS = new Set(['TD', 'TH', 'CAPTION']);
const TABLE_PARTS = new Set([
  'THEAD',
  'TBODY',
  'TFOOT',
  'TR',
  'COLGROUP',
  'COL',
]);
const MARK_TAGS: Record<string, string> = {
  STRONG: 'bold',
  B: 'bold',
  EM: 'italic',
  I: 'italic',
  U: 'underline',
  INS: 'underline',
  S: 'strike',
  DEL: 'strike',
  STRIKE: 'strike',
  CODE: 'code',
};
const IGNORED_ATTRIBUTES = new Set(['class', 'style', 'id', 'dir', 'lang']);

type Pending = { type: string; attrs?: Record<string, RichTextJsonValue> };

/** Collects blocks; inline content gathers into the pending text block. */
class Sink {
  readonly blocks: RichTextNode[] = [];
  private inline: RichTextNode[] = [];
  private pending: Pending | null = null;

  /**
   * `break`: a line break is a `hardBreak`; `space`: a space (one-paragraph
   * fields without hard breaks); `split`: it ends the text block.
   */
  constructor(private readonly breaks: 'break' | 'space' | 'split') {}

  /** Starts a text block of `type`; the next flush writes it. */
  open(pending: Pending) {
    this.flush();
    this.pending = pending;
  }

  /** True when the pending text block holds no text yet. */
  atLineStart(): boolean {
    const last = this.inline.at(-1);
    return (
      !last ||
      last.type === 'hardBreak' ||
      (last.type === 'text' && /[ \n]$/.test(last.text ?? ''))
    );
  }

  text(text: string, marks: readonly RichTextMark[]) {
    if (text === '') return;
    const last = this.inline.at(-1);
    if (last?.type === 'text' && sameMarks(last.marks, marks)) {
      last.text = (last.text ?? '') + text;
      return;
    }
    const node: RichTextNode = { type: 'text', text };
    if (marks.length > 0) node.marks = marks.map((m) => ({ ...m }));
    this.inline.push(node);
  }

  lineBreak() {
    if (this.breaks === 'break') this.inline.push({ type: 'hardBreak' });
    else if (this.breaks === 'space') this.text(' ', []);
    else this.flush();
  }

  block(node: RichTextNode) {
    this.flush();
    this.blocks.push(node);
  }

  flush() {
    const pending = this.pending ?? { type: 'paragraph' };
    this.pending = null;
    const content = trimInline(this.inline);
    this.inline = [];
    if (content.length === 0) return;
    const node: RichTextNode = { type: pending.type, content };
    if (pending.attrs) node.attrs = pending.attrs;
    this.blocks.push(node);
  }
}

function sameMarks(
  a: readonly RichTextMark[] | undefined,
  b: readonly RichTextMark[],
): boolean {
  const left = a ?? [];
  return (
    left.length === b.length &&
    left.every(
      (m, i) =>
        m.type === b[i]!.type &&
        JSON.stringify(m.attrs ?? null) === JSON.stringify(b[i]!.attrs ?? null),
    )
  );
}

/** Drops leading and trailing spaces and breaks of a text block. */
function trimInline(nodes: RichTextNode[]): RichTextNode[] {
  const out = [...nodes];
  while (out[0]?.type === 'hardBreak') out.shift();
  while (out.at(-1)?.type === 'hardBreak') out.pop();
  const first = out[0];
  if (first?.type === 'text') {
    first.text = (first.text ?? '').replace(/^[ \n]+/, '');
    if (first.text === '') out.shift();
  }
  const last = out.at(-1);
  if (last?.type === 'text') {
    last.text = (last.text ?? '').replace(/[ \n]+$/, '');
    if (last.text === '') out.pop();
  }
  return out;
}

function count(record: Record<string, number>, key: string) {
  record[key] = (record[key] ?? 0) + 1;
}

function styleMarks(style: string | null): string[] {
  if (!style) return [];
  const out: string[] = [];
  const decl = (name: string) =>
    new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`, 'i').exec(style)?.[1];
  const weight = decl('font-weight')?.trim().toLowerCase();
  if (
    weight &&
    (weight === 'bold' || weight === 'bolder' || Number(weight) >= 600)
  ) {
    out.push('bold');
  }
  if (decl('font-style')?.trim().toLowerCase() === 'italic') out.push('italic');
  const decoration = `${decl('text-decoration') ?? ''} ${
    decl('text-decoration-line') ?? ''
  }`.toLowerCase();
  if (decoration.includes('underline')) out.push('underline');
  if (decoration.includes('line-through')) out.push('strike');
  return out;
}

class Importer {
  readonly loss: RichTextLossReport = {
    tags: {},
    attributes: {},
    nodes: {},
    marks: {},
  };
  private readonly nodes: ReadonlySet<string>;
  private readonly marks: ReadonlySet<string>;

  readonly breaks: 'break' | 'space' | 'split';

  constructor(allowed: RichTextSchema) {
    this.nodes = new Set([...ALWAYS_ALLOWED_NODES, ...allowed.nodes]);
    this.marks = new Set(allowed.marks);
    this.breaks = this.nodes.has('hardBreak')
      ? 'break'
      : allowed.inline
        ? 'space'
        : 'split';
  }

  private allows(type: string): boolean {
    if (this.nodes.has(type)) return true;
    count(this.loss.nodes, type);
    return false;
  }

  private attributes(el: ParsedHtmlNode, consumed: readonly string[] = []) {
    const tag = el.nodeName.toLowerCase();
    for (const attr of Array.from(el.attributes ?? [])) {
      const name = attr.name.toLowerCase();
      if (IGNORED_ATTRIBUTES.has(name) || consumed.includes(name)) continue;
      if (tag.includes(':') || name.includes(':')) continue;
      count(this.loss.attributes, `${tag}[${name}]`);
    }
  }

  private withMark(
    marks: readonly RichTextMark[],
    mark: RichTextMark,
  ): readonly RichTextMark[] {
    if (!this.marks.has(mark.type)) {
      count(this.loss.marks, mark.type);
      return marks;
    }
    if (marks.some((m) => m.type === mark.type)) return marks;
    return [...marks, mark];
  }

  /** Walks the children of `el` into `sink`. */
  children(el: ParsedHtmlNode, sink: Sink, marks: readonly RichTextMark[]) {
    for (const child of Array.from(el.childNodes)) {
      this.node(child, sink, marks);
    }
  }

  /** The blocks of `nodes` in a fresh sink (list items, quotes). */
  private blocksOf(nodes: ArrayLike<ParsedHtmlNode>): RichTextNode[] {
    const sink = new Sink(this.breaks);
    for (const node of Array.from(nodes)) this.node(node, sink, []);
    sink.flush();
    return sink.blocks;
  }

  node(node: ParsedHtmlNode, sink: Sink, marks: readonly RichTextMark[]) {
    if (node.nodeType === TEXT) {
      let text = (node.nodeValue ?? '').replace(/[ \t\n\r\f]+/g, ' ');
      if (sink.atLineStart()) text = text.replace(/^ /, '');
      sink.text(text, marks);
      return;
    }
    if (node.nodeType !== ELEMENT) return;
    const tag = node.nodeName.toUpperCase();
    // Office namespaces (`o:p`, `v:shape`, `w:...`): carry no content of
    // their own that a reader sees.
    if (tag.includes(':')) {
      if (tag === 'O:P') this.children(node, sink, marks);
      return;
    }
    if (NOISE.has(tag)) return;
    if (DROPPED.has(tag)) {
      count(this.loss.tags, tag.toLowerCase());
      return;
    }
    const get = (name: string) => node.getAttribute?.(name) ?? null;

    if (tag === 'BR') {
      this.attributes(node);
      sink.lineBreak();
      return;
    }
    if (tag === 'HR') {
      this.attributes(node);
      if (this.allows('horizontalRule')) sink.block({ type: 'horizontalRule' });
      else sink.flush();
      return;
    }
    if (tag === 'IMG') {
      const assetId = get('data-asset-id');
      if (!assetId) {
        count(this.loss.tags, 'img');
        return;
      }
      this.attributes(node, ['data-asset-id', 'alt', 'src', 'width', 'height']);
      if (!this.allows('image')) return;
      const attrs: Record<string, RichTextJsonValue> = { assetId };
      const alt = get('alt');
      if (alt) attrs.alt = alt;
      sink.block({ type: 'image', attrs });
      return;
    }
    if (tag === 'P' || TRANSPARENT_BLOCKS.has(tag) || TABLE_CELLS.has(tag)) {
      this.attributes(node);
      sink.flush();
      this.children(node, sink, marks);
      sink.flush();
      return;
    }
    if (TABLE_PARTS.has(tag) || tag === 'TABLE') {
      if (tag === 'TABLE') count(this.loss.tags, 'table');
      sink.flush();
      this.children(node, sink, marks);
      sink.flush();
      return;
    }
    if (/^H[1-6]$/.test(tag)) {
      this.attributes(node);
      if (this.allows('heading')) {
        sink.open({ type: 'heading', attrs: { level: Number(tag[1]) } });
      } else sink.flush();
      this.children(node, sink, marks);
      sink.flush();
      return;
    }
    if (tag === 'UL' || tag === 'OL') {
      this.list(node, tag === 'OL' ? 'orderedList' : 'bulletList', sink);
      return;
    }
    if (tag === 'LI') {
      // A list item outside a list keeps its text as paragraphs.
      count(this.loss.tags, 'li');
      sink.flush();
      this.children(node, sink, marks);
      sink.flush();
      return;
    }
    if (tag === 'BLOCKQUOTE') {
      this.attributes(node, ['cite']);
      if (!this.allows('blockquote')) {
        sink.flush();
        this.children(node, sink, marks);
        sink.flush();
        return;
      }
      const content = this.blocksOf(node.childNodes);
      if (content.length > 0) sink.block({ type: 'blockquote', content });
      return;
    }
    if (tag === 'PRE') {
      this.pre(node, sink);
      return;
    }
    if (tag === 'A') {
      const href = get('href');
      this.attributes(node, ['href', 'target', 'rel', 'title']);
      if (href === null || href === '' || href.startsWith('#')) {
        this.children(node, sink, marks);
        return;
      }
      if (!isSafeUrl(href)) {
        count(this.loss.attributes, 'a[href]');
        this.children(node, sink, marks);
        return;
      }
      const attrs: Record<string, RichTextJsonValue> = { href };
      if (get('target') === '_blank') attrs.target = '_blank';
      this.children(node, sink, this.withMark(marks, { type: 'link', attrs }));
      return;
    }
    const markType = MARK_TAGS[tag];
    if (markType) {
      // The Google Docs clipboard wraps everything in
      // `<b id="docs-internal-guid-...">` with a normal weight.
      const gdocs =
        tag === 'B' && (get('id') ?? '').startsWith('docs-internal-guid');
      const normal = /font-weight\s*:\s*(normal|400)/i.test(get('style') ?? '');
      this.attributes(node, gdocs ? ['id'] : []);
      let next = marks;
      if (!gdocs && !normal) next = this.withMark(next, { type: markType });
      for (const extra of styleMarks(get('style'))) {
        if (extra !== markType) next = this.withMark(next, { type: extra });
      }
      this.children(node, sink, next);
      return;
    }
    if (TRANSPARENT_INLINE.has(tag)) {
      this.attributes(node);
      let next = marks;
      for (const extra of styleMarks(get('style'))) {
        next = this.withMark(next, { type: extra });
      }
      this.children(node, sink, next);
      return;
    }
    // Any other element: its text stays, the element is reported.
    count(this.loss.tags, tag.toLowerCase());
    this.children(node, sink, marks);
  }

  private list(node: ParsedHtmlNode, type: string, sink: Sink) {
    this.attributes(node, type === 'orderedList' ? ['start', 'type'] : []);
    const lists = this.allows(type) && this.allows('listItem');
    if (!lists) {
      sink.flush();
      for (const child of Array.from(node.childNodes)) {
        this.node(child, sink, []);
        sink.flush();
      }
      return;
    }
    const items: RichTextNode[] = [];
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === ELEMENT && child.nodeName.toUpperCase() === 'LI') {
        this.attributes(child, ['value']);
        const content = this.blocksOf(child.childNodes);
        items.push({
          type: 'listItem',
          content: content.length > 0 ? content : [{ type: 'paragraph' }],
        });
        continue;
      }
      if (child.nodeType === TEXT && !(child.nodeValue ?? '').trim()) continue;
      // Content between items (a nested list, stray text) joins the
      // previous item.
      const content = this.blocksOf([child]);
      if (content.length === 0) continue;
      const last = items.at(-1);
      if (last) last.content = [...(last.content ?? []), ...content];
      else items.push({ type: 'listItem', content });
    }
    if (items.length === 0) return;
    const start = Number(node.getAttribute?.('start') ?? '1');
    const list: RichTextNode = { type, content: items };
    if (type === 'orderedList' && Number.isInteger(start) && start !== 1) {
      list.attrs = { start };
    }
    sink.block(list);
  }

  private pre(node: ParsedHtmlNode, sink: Sink) {
    this.attributes(node);
    const text = (node.textContent ?? '').replace(/\n$/, '');
    if (text === '') return;
    if (this.allows('codeBlock')) {
      const code = Array.from(node.childNodes).find(
        (child) => child.nodeName.toUpperCase() === 'CODE',
      );
      const cls = code?.getAttribute?.('class') ?? '';
      const language = /(?:^|\s)language-([\w-]+)/.exec(cls)?.[1];
      sink.block({
        type: 'codeBlock',
        attrs: { language: language ?? null },
        content: [{ type: 'text', text }],
      });
      return;
    }
    sink.flush();
    text.split('\n').forEach((line, i) => {
      if (i > 0) sink.lineBreak();
      sink.text(line, []);
    });
    sink.flush();
  }
}

/** Joins the text blocks of `blocks` into one paragraph (`inline` fields). */
function flattenInline(
  blocks: RichTextNode[],
  hardBreak: boolean,
  loss: RichTextLossReport,
): RichTextNode[] {
  const content: RichTextNode[] = [];
  const visit = (nodes: RichTextNode[]) => {
    for (const node of nodes) {
      if (node.type === 'paragraph' || node.type === 'heading') {
        if (node.type === 'heading') count(loss.nodes, 'heading');
        if (content.length > 0 && node.content?.length) {
          content.push(
            hardBreak ? { type: 'hardBreak' } : { type: 'text', text: ' ' },
          );
        }
        content.push(...(node.content ?? []));
      } else if (node.content) {
        count(loss.nodes, node.type);
        visit(node.content);
      } else count(loss.nodes, node.type);
    }
  };
  visit(blocks);
  return content.length > 0 ? [{ type: 'paragraph', content }] : [];
}

/**
 * Parses HTML (pasted, imported or stored before rich text became JSON)
 * into a value the field allows. Office and Google Docs clipboard noise
 * is removed, inline styles for bold, italic, underline and strike become
 * marks, elements without a counterpart keep their text, and links keep
 * only allowed URL schemes. `{{variables}}` stay as text. `lossy` reports
 * everything dropped.
 */
export function htmlToRichText(
  html: string,
  allowed: RichTextSchema,
  options: HtmlToRichTextOptions = {},
): { doc: RichTextDoc; lossy: RichTextLossReport } {
  const parse =
    options.domParser ??
    ((source: string): ParsedHtmlDocument => {
      const Parser = (
        globalThis as {
          DOMParser?: new () => {
            parseFromString(s: string, t: string): ParsedHtmlDocument;
          };
        }
      ).DOMParser;
      if (!Parser) {
        throw new Error(
          'htmlToRichText: no DOMParser here; pass options.domParser',
        );
      }
      return new Parser().parseFromString(source, 'text/html');
    });
  const importer = new Importer(allowed);
  const hardBreak = allowed.nodes.includes('hardBreak');
  const sink = new Sink(importer.breaks);
  const body = parse(html).body;
  if (body) importer.children(body, sink, []);
  sink.flush();
  const blocks = allowed.inline
    ? flattenInline(sink.blocks, hardBreak, importer.loss)
    : sink.blocks;
  return {
    doc: {
      type: 'doc',
      content: blocks.length > 0 ? blocks : [{ type: 'paragraph' }],
    },
    lossy: importer.loss,
  };
}

/** True when an import dropped nothing. */
export function isLossless(report: RichTextLossReport): boolean {
  return (
    Object.keys(report.tags).length === 0 &&
    Object.keys(report.attributes).length === 0 &&
    Object.keys(report.nodes).length === 0 &&
    Object.keys(report.marks).length === 0
  );
}
