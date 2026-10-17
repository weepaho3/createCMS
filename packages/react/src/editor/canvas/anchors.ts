import { canvasRectOf, unionRects, type CanvasRect } from './rect';

export function isInsideReadonly(el: Element, canvas: Element): boolean {
  const ro = el.closest('[data-editor-readonly]');
  return ro !== null && canvas.contains(ro);
}

export function blockElements(canvas: Element, id: string): Element[] {
  const nodes = canvas.querySelectorAll(
    `[data-editor-block="${CSS.escape(id)}"]`,
  );
  return [...nodes].filter(
    (el) => canvas.contains(el) && !isInsideReadonly(el, canvas),
  );
}

export function fieldElements(
  canvas: Element,
  id: string,
  key: string,
): Element[] {
  const out: Element[] = [];
  for (const block of blockElements(canvas, id)) {
    const fields = block.querySelectorAll(
      `[data-editor-field="${CSS.escape(key)}"]`,
    );
    for (const field of fields) {
      if (field.closest('[data-editor-block]') === block) out.push(field);
    }
  }
  return out;
}

/** The elements holding slot `slot` of block `id`, counted only inside that block. */
export function slotElements(
  canvas: Element,
  id: string,
  slot: string,
): Element[] {
  const out: Element[] = [];
  for (const block of blockElements(canvas, id)) {
    const slots = block.matches(`[data-editor-slot="${CSS.escape(slot)}"]`)
      ? [block]
      : [];
    slots.push(
      ...block.querySelectorAll(`[data-editor-slot="${CSS.escape(slot)}"]`),
    );
    for (const el of slots) {
      if (el.closest('[data-editor-block]') === block) out.push(el);
    }
  }
  return out;
}

export function measureBlock(
  canvas: HTMLElement,
  id: string,
): CanvasRect | null {
  return unionRects(
    blockElements(canvas, id).map((el) => canvasRectOf(el, canvas)),
  );
}

export function measureField(
  canvas: HTMLElement,
  id: string,
  key: string,
): CanvasRect | null {
  return unionRects(
    fieldElements(canvas, id, key).map((el) => canvasRectOf(el, canvas)),
  );
}
