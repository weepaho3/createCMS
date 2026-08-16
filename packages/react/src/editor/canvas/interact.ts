import type { EditorStore } from '../store';

import { frameClickAnchor } from '../preview/frame-anchor';

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
  const target = event.target;
  if (!isElement(target)) return;

  const intercept = target.closest('a[href], button[type="submit"], form');
  if (insideHost(host, intercept)) {
    event.preventDefault();
  }

  if (interactive === 'none') return;

  const readonly = target.closest('[data-editor-readonly]');
  if (insideHost(host, readonly)) return;

  const anchor = frameClickAnchor(event.target);
  if (!anchor) return;
  store.select(anchor.blockId);
  store.focus(anchor.key ? { blockId: anchor.blockId, key: anchor.key } : null);
}

export function handleCanvasPointerOver(
  event: Event,
  host: Element,
  store: EditorStore,
  interactive: Interactive,
): void {
  if (interactive === 'none') return;
  const target = event.target;
  if (!isElement(target)) return;

  const readonly = target.closest('[data-editor-readonly]');
  if (insideHost(host, readonly)) {
    store.hover(null);
    return;
  }

  // Overlay chrome keeps the last hovered block so the insert control
  // stays mounted under the pointer.
  const overlay = target.closest('[data-editor-overlay]');
  if (overlay && insideHost(host, overlay)) return;

  const block = target.closest('[data-editor-block]');
  if (block && insideHost(host, block)) {
    store.hover(block.getAttribute('data-editor-block'));
    return;
  }
  store.hover(null);
}
