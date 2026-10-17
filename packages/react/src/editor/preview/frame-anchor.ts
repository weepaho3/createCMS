export type FramePreviewAnchor = {
  blockId: string;
  /** The field that was clicked, when the click landed inside one. */
  key?: string;
  /** The slot that was clicked, when the click landed in a slot outside any field. */
  slot?: string;
};

function isElement(target: EventTarget | null): target is Element {
  return (
    typeof target === 'object' &&
    target !== null &&
    (target as Node).nodeType === 1
  );
}

export function frameClickAnchor(
  target: EventTarget | null,
  resolveAnchor?: (el: Element) => FramePreviewAnchor | null,
): FramePreviewAnchor | null {
  if (!isElement(target)) return null;
  if (resolveAnchor) {
    const resolved = resolveAnchor(target);
    if (resolved) return resolved;
  }
  const fieldEl = target.closest('[data-editor-field]');
  const blockEl = (fieldEl ?? target).closest('[data-editor-block]');
  if (!blockEl) return null;
  const blockId = blockEl.getAttribute('data-editor-block');
  if (!blockId) return null;
  if (fieldEl && blockEl.contains(fieldEl)) {
    const key = fieldEl.getAttribute('data-editor-field');
    if (key) return { blockId, key };
  }
  // A slot counts only when it belongs to this block, not to a nested one.
  const slotEl = target.closest('[data-editor-slot]');
  if (slotEl && slotEl.closest('[data-editor-block]') === blockEl) {
    const slot = slotEl.getAttribute('data-editor-slot');
    if (slot) return { blockId, slot };
  }
  return { blockId };
}
