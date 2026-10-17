import type { AnyEditorSchema, Field } from '../core/schema';
import type { EditorNodes } from '../core/store';

import { fieldsOf } from '../core/schema';

export const EMPTY_FIELD_PLACEHOLDER = '\u200B';

export const RICH_TEXT_INLINE_WARNING =
  '[editor:E001] richText is not inline editable until the rich text adapter is configured';

/**
 * Only single-line `text` fields get the inline glass. `richText` is
 * excluded: the glass writes back `textContent`, which would drop the value's
 * markup.
 */
export function isInlineEditableKind(kind: string): boolean {
  return kind === 'text';
}

/** A field the inline glass may edit: an inline-editable kind that is not `readOnly`. */
export function isInlineEditableField(field: Field): boolean {
  return isInlineEditableKind(field.type) && field.readOnly !== true;
}

export function applyTextEdit(
  full: string,
  start: number,
  end: number,
  text: string,
): { text: string; caret: number } {
  return {
    text: full.slice(0, start) + text + full.slice(end),
    caret: start + text.length,
  };
}

export function stripPlaceholder(text: string): string {
  return text.replaceAll(EMPTY_FIELD_PLACEHOLDER, '');
}

export function withEmptyFieldPlaceholder(
  properties: Record<string, unknown>,
  specs: Record<string, Field>,
): Record<string, unknown> {
  const out = { ...properties };
  for (const [key, spec] of Object.entries(specs)) {
    if (!isInlineEditableField(spec)) continue;
    const value = out[key];
    if (value === '' || value === null || value === undefined) {
      out[key] = EMPTY_FIELD_PLACEHOLDER;
    }
  }
  return out;
}

type CaretPosition = {
  offsetNode: Node;
  offset: number;
};

type CaretDocument = Document & {
  caretPositionFromPoint?: (x: number, y: number) => CaretPosition | null;
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
};

export function caretRangeAtPoint(
  doc: Document,
  x: number,
  y: number,
): Range | null {
  const caretDoc = doc as CaretDocument;
  try {
    const pos = caretDoc.caretPositionFromPoint?.(x, y);
    if (pos) {
      const range = doc.createRange();
      range.setStart(pos.offsetNode, pos.offset);
      range.collapse(true);
      return range;
    }
    // Safari before 18 only implements this deprecated predecessor.
    // oxlint-disable-next-line typescript/no-deprecated
    const legacy = caretDoc.caretRangeFromPoint?.(x, y);
    if (legacy) {
      legacy.collapse(true);
      return legacy;
    }
  } catch {
    return null;
  }
  return null;
}

export function caretOffsetWithin(el: HTMLElement): number {
  const doc = el.ownerDocument;
  const sel = doc.getSelection();
  if (!sel || sel.rangeCount === 0) {
    return stripPlaceholder(el.textContent ?? '').length;
  }
  const range = sel.getRangeAt(0);
  if (!el.contains(range.startContainer)) {
    return stripPlaceholder(el.textContent ?? '').length;
  }
  const pre = doc.createRange();
  pre.selectNodeContents(el);
  pre.setEnd(range.startContainer, range.startOffset);
  return pre.toString().length;
}

export function placeCaret(el: HTMLElement, pos: number): void {
  const doc = el.ownerDocument;
  const range = doc.createRange();
  const sel = doc.getSelection();
  if (!sel) return;

  let remaining = pos;
  const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const len = node.textContent?.length ?? 0;
    if (remaining <= len) {
      range.setStart(node, remaining);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      return;
    }
    remaining -= len;
    node = walker.nextNode();
  }
  range.selectNodeContents(el);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

/** The field `key` of node `blockId`, or `null` for an unknown node or key. */
export function fieldOf(
  schema: AnyEditorSchema,
  nodes: EditorNodes,
  blockId: string,
  key: string,
): Field | null {
  const node = nodes[blockId];
  if (!node) return null;
  return fieldsOf(schema, node.type)[key] ?? null;
}
