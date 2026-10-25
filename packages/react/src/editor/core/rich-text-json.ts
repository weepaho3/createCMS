import type {
  RichTextDoc,
  RichTextJsonValue,
  RichTextNode,
} from './richtext/types';

/** ProseMirror JSON as editors and Yjs bindings produce it. */
export type ProseMirrorJson = {
  type?: string;
  attrs?: Record<string, unknown>;
  text?: string;
  marks?: readonly { type: string; attrs?: Record<string, unknown> }[];
  content?: readonly ProseMirrorJson[];
};

/** Attributes that only carry rendering defaults. */
const DROPPED_ATTRS = new Set(['rel', 'class']);

function cleanAttrs(
  attrs: Record<string, unknown> | undefined,
): Record<string, RichTextJsonValue> | undefined {
  if (!attrs) return undefined;
  const out: Record<string, RichTextJsonValue> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || DROPPED_ATTRS.has(key)) {
      continue;
    }
    out[key] = value as RichTextJsonValue;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function cleanNode(node: ProseMirrorJson): RichTextNode {
  const out: RichTextNode = { type: node.type ?? 'paragraph' };
  const attrs = cleanAttrs(node.attrs);
  if (attrs) out.attrs = attrs;
  if (node.text !== undefined) out.text = node.text;
  if (node.marks && node.marks.length > 0) {
    out.marks = node.marks.map((mark) => {
      const markAttrs = cleanAttrs(mark.attrs);
      return markAttrs
        ? { type: mark.type, attrs: markAttrs }
        : { type: mark.type };
    });
  }
  if (node.content && node.content.length > 0) {
    out.content = node.content.map(cleanNode);
  }
  return out;
}

/**
 * A rich text value from ProseMirror JSON without its rendering defaults
 * (null attributes, `rel`, `class`), so the same content always gives the
 * same value, whether it comes from an editor or from a Yjs fragment.
 */
export function normalizeRichTextJson(json: ProseMirrorJson): RichTextDoc {
  return { type: 'doc', content: (json.content ?? []).map(cleanNode) };
}
