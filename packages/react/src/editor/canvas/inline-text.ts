import type { BlockProperty } from '@createcms/schema';

import type { AnyEditorSchema } from '../schema';
import type { EditorNodes } from '../store';

import { propertiesOf } from '../schema';

export const EMPTY_FIELD_PLACEHOLDER = '\u200B';

export function isInlineEditableKind(kind: string): boolean {
  return kind === 'string' || kind === 'richText';
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
  specs: Record<string, BlockProperty>,
): Record<string, unknown> {
  const out = { ...properties };
  for (const [key, spec] of Object.entries(specs)) {
    if (!isInlineEditableKind(spec.type)) continue;
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

export function fieldKindOf(
  schema: AnyEditorSchema,
  nodes: EditorNodes,
  blockId: string,
  key: string,
): string | null {
  const node = nodes[blockId];
  if (!node) return null;
  const specs = propertiesOf(schema, node.type);
  return specs[key]?.type ?? null;
}
