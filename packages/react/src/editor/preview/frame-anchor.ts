export type FramePreviewAnchor = {
  blockId: string;
  key?: string;
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
  return { blockId };
}
