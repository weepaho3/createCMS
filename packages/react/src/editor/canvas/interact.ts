import type { SlotRef } from '../core/document';
import type { EditorStore } from '../core/store';

import { frameClickAnchor } from '../preview/frame-anchor';
import { contentTargetOf } from './hit';

type Interactive = 'edit' | 'select' | 'none';

function isElement(target: EventTarget | null): target is Element {
  return (
    typeof target === 'object' &&
    target !== null &&
    (target as Node).nodeType === 1
  );
}

function insideHost(host: Element, node: Element | null): boolean {
  return node !== null && host.contains(node);
}

export function handleCanvasClick(
  event: Event,
  host: Element,
  store: EditorStore,
  interactive: Interactive,
): void {
  const target = contentTargetOf(event, host);
  if (!isElement(target)) return;

  const intercept = target.closest('a[href], button[type="submit"], form');
  if (insideHost(host, intercept)) {
    event.preventDefault();
  }

  if (interactive === 'none') return;

  const readonly = target.closest('[data-editor-readonly]');
  if (insideHost(host, readonly)) return;

  const anchor = frameClickAnchor(target);
  if (!anchor) return;
  const mouse = event as MouseEvent;
  if (mouse.shiftKey) {
    store.setSelection(rangeSelection(store, anchor.blockId));
    return;
  }
  if (mouse.metaKey || mouse.ctrlKey) {
    store.setSelection(toggledSelection(store, anchor.blockId));
    return;
  }
  if (mouse.altKey) {
    const parent = depthParent(store, anchor.blockId);
    if (parent !== null) store.select(parent);
    return;
  }
  store.select(anchor.blockId);
  store.focus(anchor.key ? { blockId: anchor.blockId, key: anchor.key } : null);
}

/** Whether a click with these modifiers selects without editing. */
export function isSelectionClick(event: MouseEvent): boolean {
  return event.shiftKey || event.metaKey || event.ctrlKey || event.altKey;
}

/** The selection with `id` added, or removed when it was selected. */
export function toggledSelection(
  store: EditorStore,
  id: string,
): readonly string[] {
  const current = store.getSession().selection;
  return current.includes(id)
    ? current.filter((entry) => entry !== id)
    : [...current, id];
}

/**
 * From the primary selection to `id` in document order: the siblings in
 * between when both share a slot, else from the primary selection to the
 * ancestor of `id` that is its sibling; just `id` when they are unrelated.
 * The primary selection stays first.
 */
export function rangeSelection(
  store: EditorStore,
  id: string,
): readonly string[] {
  const { nodes } = store.getDoc();
  const [anchor] = store.getSession().selection;
  const anchorNode = anchor === undefined ? undefined : nodes[anchor];
  if (!anchorNode?.parent || anchor === id) return [id];
  const at = anchorNode.parent;
  const siblings = nodes[at.id]?.slots[at.slot] ?? [];
  // The ancestor-or-self of `id` that sits in the anchor's slot.
  let end: string | null = id;
  while (end !== null) {
    const parent: SlotRef | null = nodes[end]?.parent ?? null;
    if (parent === null) return [id];
    if (parent.id === at.id && parent.slot === at.slot) break;
    end = parent.id;
  }
  if (end === null) return [id];
  const from = siblings.indexOf(anchorNode.id);
  const to = siblings.indexOf(end);
  const range =
    from <= to ? siblings.slice(from, to + 1) : siblings.slice(to, from + 1);
  return [anchorNode.id, ...range.filter((entry) => entry !== anchorNode.id)];
}

/**
 * The parent of the clicked block, one level further up on each repeat
 * while the clicked block's ancestor stays selected; `null` at the root.
 */
export function depthParent(store: EditorStore, id: string): string | null {
  const { nodes, rootId } = store.getDoc();
  const [selected] = store.getSession().selection;
  let start = id;
  // Walk up from the clicked block when the selection is already one of
  // its ancestors.
  for (let up = nodes[id]?.parent?.id; up; up = nodes[up]?.parent?.id) {
    if (up === selected) {
      start = up;
      break;
    }
  }
  const parent = nodes[start]?.parent?.id ?? null;
  return parent === null || parent === rootId ? null : parent;
}

/**
 * The block the pointer is over: its id, `null` for none, `undefined` to
 * keep the current hover (over overlay chrome).
 */
export function handleCanvasPointerOver(
  event: Event,
  host: Element,
  interactive: Interactive,
): string | null | undefined {
  if (interactive === 'none') return undefined;
  const target = contentTargetOf(event, host);
  if (!isElement(target)) return undefined;

  const readonly = target.closest('[data-editor-readonly]');
  if (insideHost(host, readonly)) return null;

  // Overlay chrome keeps the last hovered block so the insert control
  // stays mounted under the pointer.
  const overlay = target.closest('[data-editor-overlay]');
  if (overlay && insideHost(host, overlay)) return undefined;

  const block = target.closest('[data-editor-block]');
  if (block && insideHost(host, block)) {
    return block.getAttribute('data-editor-block');
  }
  return null;
}
