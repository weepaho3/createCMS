import type {
  RichTextDoc,
  RichTextJsonValue,
  RichTextLinkValue,
  RichTextSchema,
} from './types';

/** The node types every editor understands (StarterKit plus `image`). */
export const RICH_TEXT_NODES = [
  'paragraph',
  'text',
  'heading',
  'bulletList',
  'orderedList',
  'listItem',
  'blockquote',
  'codeBlock',
  'hardBreak',
  'horizontalRule',
  'image',
] as const;

/** The mark types every editor understands. */
export const RICH_TEXT_MARKS = [
  'bold',
  'italic',
  'underline',
  'strike',
  'code',
  'link',
] as const;

/** Allowed in every field: the value cannot be written without them. */
export const ALWAYS_ALLOWED_NODES: ReadonlySet<string> = new Set([
  'doc',
  'paragraph',
  'text',
]);

/** Nodes that sit in a block position (doc, blockquote, list item). */
export const BLOCK_NODES: ReadonlySet<string> = new Set([
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'blockquote',
  'codeBlock',
  'horizontalRule',
  'image',
]);

/** Nodes that sit inside a paragraph or heading. */
export const INLINE_NODES: ReadonlySet<string> = new Set(['text', 'hardBreak']);

/** An empty value: one empty paragraph. */
export const EMPTY_RICH_TEXT: RichTextDoc = Object.freeze({
  type: 'doc',
  content: Object.freeze([Object.freeze({ type: 'paragraph' })]),
}) as RichTextDoc;

/**
 * The schema of a field: its `marks` and `nodes`, or every built-in one
 * when the field does not restrict them.
 */
export function richTextSchemaOf(field: {
  marks?: readonly string[];
  nodes?: readonly string[];
  inline?: boolean;
}): RichTextSchema {
  return {
    marks: field.marks ?? RICH_TEXT_MARKS,
    nodes: field.nodes ?? RICH_TEXT_NODES,
    inline: field.inline === true,
  };
}

/** True for a value shaped like a rich text document (not validated). */
export function isRichTextDoc(value: unknown): value is RichTextDoc {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'doc' &&
    ((value as { content?: unknown }).content === undefined ||
      Array.isArray((value as { content?: unknown }).content))
  );
}

/** URL schemes a link may use. A URL without a scheme is relative. */
export const LINK_PROTOCOLS: ReadonlySet<string> = new Set([
  'http',
  'https',
  'mailto',
  'tel',
]);

/**
 * The scheme of `url` in lower case (`javascript` for ` JavaScript:`), or
 * `null` for a relative URL. Browsers drop whitespace and control
 * characters inside a scheme, so they are dropped here too.
 */
export function urlScheme(url: string): string | null {
  // oxlint-disable-next-line no-control-regex -- on purpose: browsers ignore these in a scheme
  const cleaned = url.replace(/[\u0000- \u007f]/g, '');
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(cleaned);
  return match ? match[1]!.toLowerCase() : null;
}

/** True when `url` is relative or uses an allowed scheme. */
export function isSafeUrl(url: string): boolean {
  const scheme = urlScheme(url);
  return scheme === null || LINK_PROTOCOLS.has(scheme);
}

/** A `link` mark's target: `{ link: RichTextLinkValue }` or `{ href }`. */
export function linkMarkValue(
  attrs: Record<string, RichTextJsonValue> | undefined,
): RichTextLinkValue | { kind: 'href'; href: string } | null {
  if (!attrs) return null;
  const link = attrs.link;
  if (typeof link === 'object' && link !== null && !Array.isArray(link)) {
    return link as RichTextLinkValue;
  }
  return typeof attrs.href === 'string'
    ? { kind: 'href', href: attrs.href }
    : null;
}

/**
 * The URL a link mark points to without a resolver: the external URL,
 * `mailto:` or `tel:`; `null` for an internal link or an unsafe URL.
 */
export function linkMarkHref(
  attrs: Record<string, RichTextJsonValue> | undefined,
): string | null {
  const value = linkMarkValue(attrs);
  if (!value) return null;
  let href: string | null = null;
  if (value.kind === 'href') href = value.href;
  else if (value.kind === 'external') href = value.url;
  else if (value.kind === 'email') href = `mailto:${value.email}`;
  else if (value.kind === 'phone') href = `tel:${value.phone}`;
  return href !== null && isSafeUrl(href) ? href : null;
}
