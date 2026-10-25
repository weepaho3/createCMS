import * as Y from 'yjs';

import type {
  JsonValue,
  ProseMirrorJson,
  RichTextDoc,
  RichTextNode,
} from '../core';

import { canonicalJson, normalizeRichTextJson } from '../core';

// The encoding of the Tiptap Collaboration binding (`@tiptap/y-tiptap`): a
// node is a `Y.XmlElement` named by its type with its non-null attributes;
// adjacent text nodes share one `Y.XmlText` whose formatting attributes are
// the marks (`{ [mark]: attrs }`). Editors bound to the fragment and this
// store read and write the same structure.

/** Mark names of overlapping marks carry a hash suffix (`comment--Ab3x9Q==`). */
const HASHED_MARK = /(.*)(--[a-zA-Z0-9+/=]{8})$/;

function serialize(item: unknown): ProseMirrorJson | ProseMirrorJson[] {
  if (item instanceof Y.XmlText) {
    const delta = item.toDelta() as {
      insert: string;
      attributes?: Record<string, Record<string, unknown>>;
    }[];
    return delta.map((part) => {
      const text: ProseMirrorJson = { type: 'text', text: part.insert };
      if (part.attributes) {
        text.marks = Object.entries(part.attributes).map(([name, attrs]) => ({
          type: HASHED_MARK.exec(name)?.[1] ?? name,
          attrs,
        }));
      }
      return text;
    });
  }
  if (item instanceof Y.XmlElement) {
    const node: ProseMirrorJson = { type: item.nodeName };
    const attrs = item.getAttributes();
    if (Object.keys(attrs).length > 0) node.attrs = attrs;
    const children = item.toArray().flatMap((child) => serialize(child));
    if (children.length > 0) node.content = children;
    return node;
  }
  return [];
}

/** The rich text value a fragment holds, as the editor stores it. */
export function fragmentToRichText(fragment: Y.XmlFragment): RichTextDoc {
  return normalizeRichTextJson({
    type: 'doc',
    content: fragment.toArray().flatMap((item) => serialize(item)),
  });
}

function marksOf(node: RichTextNode): Record<string, JsonValue> {
  const out: Record<string, JsonValue> = {};
  for (const mark of node.marks ?? []) out[mark.type] = mark.attrs ?? {};
  return out;
}

/** Attribute values are JSON; Yjs types elements with string attributes by default. */
type Element = Y.XmlElement<Record<string, JsonValue>>;

function build(nodes: readonly RichTextNode[]): (Y.XmlElement | Y.XmlText)[] {
  const out: (Element | Y.XmlText)[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    if (node.type === 'text') {
      const run: RichTextNode[] = [];
      while (i < nodes.length && nodes[i]!.type === 'text') {
        run.push(nodes[i]!);
        i += 1;
      }
      i -= 1;
      const text = new Y.XmlText();
      text.applyDelta(
        run.map((part) => ({
          insert: part.text ?? '',
          attributes: marksOf(part),
        })),
      );
      out.push(text);
      continue;
    }
    const element: Element = new Y.XmlElement(node.type);
    for (const [key, value] of Object.entries(node.attrs ?? {})) {
      if (value !== null) element.setAttribute(key, value);
    }
    element.insert(0, build(node.content ?? []));
    out.push(element);
  }
  return out as (Y.XmlElement | Y.XmlText)[];
}

/** Replaces the content of `fragment` with `value`. */
export function writeRichText(
  fragment: Y.XmlFragment,
  value: RichTextDoc,
): void {
  if (fragment.length > 0) fragment.delete(0, fragment.length);
  fragment.insert(0, build(value.content ?? []));
}

function sortMarks(node: RichTextNode): RichTextNode {
  const out: RichTextNode = { ...node };
  if (node.marks) {
    out.marks = [...node.marks].sort((a, b) =>
      a.type < b.type ? -1 : a.type > b.type ? 1 : 0,
    );
  }
  if (node.content) out.content = node.content.map(sortMarks);
  return out;
}

/**
 * Whether two values hold the same text. Mark order does not count: a
 * fragment keeps marks in the order Yjs stores them, editors in schema
 * order.
 */
export function sameRichText(a: RichTextDoc, b: RichTextDoc): boolean {
  return canonicalJson(sortMarks(a)) === canonicalJson(sortMarks(b));
}
