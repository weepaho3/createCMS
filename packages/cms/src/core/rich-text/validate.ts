import type { RichTextIssue, RichTextJsonValue, RichTextSchema } from './types';

import {
  ALWAYS_ALLOWED_NODES,
  BLOCK_NODES,
  INLINE_NODES,
  isSafeUrl,
  linkMarkValue,
} from './schema';

type Path = (string | number)[];
type Ctx = {
  allowed: RichTextSchema;
  nodes: ReadonlySet<string>;
  marks: ReadonlySet<string>;
  errors: RichTextIssue[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const KNOWN = new Set([...BLOCK_NODES, ...INLINE_NODES, 'listItem']);

/** What a parent takes: block nodes, inline nodes, list items or text. */
type Expect = 'block' | 'inline' | 'listItem' | 'text';

function fits(type: string, expect: Expect): boolean {
  // Node types outside the built-in set are the field's own extensions:
  // their placement is the editor extension's business.
  if (!KNOWN.has(type)) return true;
  if (expect === 'block') return BLOCK_NODES.has(type);
  if (expect === 'inline') return INLINE_NODES.has(type);
  if (expect === 'listItem') return type === 'listItem';
  return type === 'text';
}

function childExpect(type: string): Expect | null {
  switch (type) {
    case 'paragraph':
    case 'heading':
      return 'inline';
    case 'bulletList':
    case 'orderedList':
      return 'listItem';
    case 'listItem':
    case 'blockquote':
      return 'block';
    case 'codeBlock':
      return 'text';
    case 'text':
    case 'hardBreak':
    case 'horizontalRule':
    case 'image':
      return null;
    default:
      return 'block';
  }
}

const NEEDS_CONTENT = new Set([
  'bulletList',
  'orderedList',
  'listItem',
  'blockquote',
]);

function structure(ctx: Ctx, path: Path, reason: string) {
  ctx.errors.push({
    code: 'richTextStructure',
    path,
    params: { reason },
  });
}

function checkAttrs(
  ctx: Ctx,
  type: string,
  attrs: Record<string, unknown> | undefined,
  path: Path,
) {
  const at = [...path, 'attrs'];
  if (type === 'heading') {
    const level = attrs?.level;
    if (
      typeof level !== 'number' ||
      !Number.isInteger(level) ||
      level < 1 ||
      level > 6
    ) {
      structure(ctx, [...at, 'level'], 'headingLevel');
    }
  }
  if (type === 'orderedList' && attrs?.start !== undefined) {
    if (attrs.start !== null && !Number.isInteger(attrs.start)) {
      structure(ctx, [...at, 'start'], 'listStart');
    }
  }
  if (type === 'image') {
    const id = attrs?.assetId;
    if (typeof id !== 'string' || id === '') {
      structure(ctx, [...at, 'assetId'], 'imageAsset');
    }
    if (
      attrs?.alt !== undefined &&
      attrs.alt !== null &&
      typeof attrs.alt !== 'string'
    ) {
      structure(ctx, [...at, 'alt'], 'imageAlt');
    }
  }
  if (type === 'codeBlock' && attrs?.language !== undefined) {
    if (attrs.language !== null && typeof attrs.language !== 'string') {
      structure(ctx, [...at, 'language'], 'codeLanguage');
    }
  }
}

function checkLink(
  ctx: Ctx,
  attrs: Record<string, RichTextJsonValue> | undefined,
  path: Path,
) {
  const value = linkMarkValue(attrs);
  if (!value) {
    structure(ctx, [...path, 'attrs'], 'linkTarget');
    return;
  }
  const target = [...path, 'attrs', 'link'];
  let url: unknown;
  switch (value.kind) {
    case 'href':
      url = value.href;
      break;
    case 'external':
      url = value.url;
      break;
    case 'internal':
      if (
        typeof value.rootId !== 'string' ||
        typeof value.collection !== 'string'
      ) {
        structure(ctx, target, 'linkTarget');
      }
      return;
    case 'email':
      if (typeof value.email !== 'string') structure(ctx, target, 'linkTarget');
      return;
    case 'phone':
      if (typeof value.phone !== 'string') structure(ctx, target, 'linkTarget');
      return;
    default:
      structure(ctx, target, 'linkTarget');
      return;
  }
  if (typeof url !== 'string') {
    structure(ctx, [...path, 'attrs'], 'linkTarget');
  } else if (!isSafeUrl(url)) {
    ctx.errors.push({
      code: 'richTextLinkProtocol',
      path: [...path, 'attrs'],
      params: { url },
    });
  }
}

function checkMarks(ctx: Ctx, node: Record<string, unknown>, path: Path) {
  const marks = node.marks;
  if (marks === undefined) return;
  const at = [...path, 'marks'];
  if (!Array.isArray(marks)) {
    structure(ctx, at, 'marks');
    return;
  }
  if (node.type !== 'text' && marks.length > 0) {
    structure(ctx, at, 'marksOnText');
    return;
  }
  const seen = new Set<string>();
  marks.forEach((mark: unknown, i) => {
    const mp = [...at, i];
    if (!isRecord(mark) || typeof mark.type !== 'string') {
      structure(ctx, mp, 'mark');
      return;
    }
    if (seen.has(mark.type)) structure(ctx, mp, 'duplicateMark');
    seen.add(mark.type);
    if (!ctx.marks.has(mark.type)) {
      ctx.errors.push({
        code: 'richTextMark',
        path: mp,
        params: { mark: mark.type },
      });
      return;
    }
    if (mark.attrs !== undefined && !isRecord(mark.attrs)) {
      structure(ctx, [...mp, 'attrs'], 'attrs');
      return;
    }
    if (mark.type === 'link') {
      checkLink(
        ctx,
        mark.attrs as Record<string, RichTextJsonValue> | undefined,
        mp,
      );
    }
  });
}

function checkNode(ctx: Ctx, node: unknown, expect: Expect, path: Path) {
  if (!isRecord(node) || typeof node.type !== 'string') {
    structure(ctx, path, 'node');
    return;
  }
  const type = node.type;
  if (type === 'doc') {
    structure(ctx, path, 'nestedDoc');
    return;
  }
  if (!ctx.nodes.has(type)) {
    ctx.errors.push({
      code: 'richTextNode',
      path,
      params: { node: type },
    });
    return;
  }
  if (!fits(type, expect)) {
    structure(ctx, path, 'placement');
    return;
  }
  if (node.attrs !== undefined && !isRecord(node.attrs)) {
    structure(ctx, [...path, 'attrs'], 'attrs');
  } else {
    checkAttrs(ctx, type, node.attrs, path);
  }
  if (type === 'text') {
    if (typeof node.text !== 'string' || node.text === '') {
      structure(ctx, path, 'emptyText');
    }
  } else if (node.text !== undefined) {
    structure(ctx, [...path, 'text'], 'textOnNode');
  }
  checkMarks(ctx, node, path);
  const inner = childExpect(type);
  const content = node.content;
  if (inner === null) {
    if (content !== undefined) structure(ctx, [...path, 'content'], 'leaf');
    return;
  }
  if (content === undefined) {
    if (NEEDS_CONTENT.has(type)) {
      structure(ctx, [...path, 'content'], 'emptyContainer');
    }
    return;
  }
  if (!Array.isArray(content)) {
    structure(ctx, [...path, 'content'], 'content');
    return;
  }
  if (content.length === 0 && NEEDS_CONTENT.has(type)) {
    structure(ctx, [...path, 'content'], 'emptyContainer');
  }
  if (type === 'codeBlock') {
    content.forEach((child: unknown, i) => {
      if (isRecord(child) && Array.isArray(child.marks) && child.marks.length) {
        structure(ctx, [...path, 'content', i, 'marks'], 'marksInCode');
      }
    });
  }
  content.forEach((child: unknown, i) =>
    checkNode(ctx, child, inner, [...path, 'content', i]),
  );
}

/**
 * Checks a rich text value against what its field allows: node and mark
 * types (`richTextNode`, `richTextMark`), link URL schemes
 * (`richTextLinkProtocol`: only `http`, `https`, `mailto`, `tel` or a
 * relative URL), and structure (`richTextStructure` with
 * `params.reason`: list items only in lists, inline nodes only in
 * paragraphs and headings, heading levels 1 to 6, an `inline` field holds
 * at most one paragraph). Paths point into the value.
 */
export function validateRichText(
  doc: unknown,
  allowed: RichTextSchema,
): RichTextIssue[] {
  const ctx: Ctx = {
    allowed,
    nodes: new Set([...ALWAYS_ALLOWED_NODES, ...allowed.nodes]),
    marks: new Set(allowed.marks),
    errors: [],
  };
  if (!isRecord(doc) || doc.type !== 'doc') {
    return [{ code: 'type', path: [], params: { expected: 'richText' } }];
  }
  const content = doc.content;
  if (content === undefined) return [];
  if (!Array.isArray(content)) {
    structure(ctx, ['content'], 'content');
    return ctx.errors;
  }
  if (allowed.inline) {
    if (content.length > 1) structure(ctx, ['content'], 'inline');
    content.forEach((child: unknown, i) => {
      if (isRecord(child) && child.type !== 'paragraph') {
        structure(ctx, ['content', i], 'inline');
      }
    });
  }
  content.forEach((child: unknown, i) =>
    checkNode(ctx, child, 'block', ['content', i]),
  );
  return ctx.errors;
}
