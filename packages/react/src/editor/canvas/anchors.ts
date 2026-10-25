import { computedStyleOf } from '../dom';
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

/**
 * The box of `el` in content coordinates, also for elements without one
 * of their own: `display: contents` and zero-size elements take their
 * text (a leaf) or the union of their children, else a zero rect at
 * their position.
 */
export function elementBox(el: Element, canvas: HTMLElement): CanvasRect {
  const own = canvasRectOf(el, canvas);
  if (own.width > 0 || own.height > 0) return own;
  const children = [...el.children];
  if (children.length === 0 && el.textContent?.trim()) {
    const range = el.ownerDocument.createRange();
    range.selectNodeContents(el);
    const text = range.getBoundingClientRect();
    const box = canvas.getBoundingClientRect();
    if (text.width > 0 || text.height > 0) {
      return {
        x: text.left - box.left + canvas.scrollLeft,
        y: text.top - box.top + canvas.scrollTop,
        width: text.width,
        height: text.height,
      };
    }
  }
  return (
    unionRects(
      children
        .map((child) => elementBox(child, canvas))
        .filter((rect) => rect.width > 0 || rect.height > 0),
    ) ?? own
  );
}

/** Which edges of a rect the canvas or an overflow ancestor cut off. */
export type ClampedEdges = {
  readonly left: boolean;
  readonly top: boolean;
  readonly right: boolean;
  readonly bottom: boolean;
};

/** A block's rect cut to what its overflow ancestors let show. */
export type VisibleRect = CanvasRect & { readonly clamped: ClampedEdges };

export function measureBlock(
  canvas: HTMLElement,
  id: string,
): CanvasRect | null {
  return unionRects(
    blockElements(canvas, id).map((el) => elementBox(el, canvas)),
  );
}

/**
 * The visible part of block `id`: its rect intersected with every
 * ancestor below the canvas whose overflow clips (the overlay itself
 * clips to the canvas), with the clipped edges flagged; `null` when
 * nothing of it shows.
 */
export function measureVisibleBlock(
  canvas: HTMLElement,
  id: string,
): VisibleRect | null {
  const els = blockElements(canvas, id);
  const rect = unionRects(els.map((el) => elementBox(el, canvas)));
  if (!rect) return null;
  let left = rect.x;
  let top = rect.y;
  let right = rect.x + rect.width;
  let bottom = rect.y + rect.height;
  const clips: CanvasRect[] = [];
  for (
    let cur = els[0]?.parentElement ?? null;
    cur && cur !== canvas;
    cur = cur.parentElement
  ) {
    const style = computedStyleOf(cur);
    if (!style) break;
    if (style.overflowX !== 'visible' || style.overflowY !== 'visible') {
      clips.push(canvasRectOf(cur, canvas));
    }
  }
  const clamped = { left: false, top: false, right: false, bottom: false };
  for (const clip of clips) {
    if (clip.x > left) {
      left = clip.x;
      clamped.left = true;
    }
    if (clip.y > top) {
      top = clip.y;
      clamped.top = true;
    }
    if (clip.x + clip.width < right) {
      right = clip.x + clip.width;
      clamped.right = true;
    }
    if (clip.y + clip.height < bottom) {
      bottom = clip.y + clip.height;
      clamped.bottom = true;
    }
  }
  const cut = clamped.left || clamped.top || clamped.right || clamped.bottom;
  // Clipped away entirely: nothing to draw. An unclipped empty block
  // keeps its (zero) rect.
  if (cut && (right - left <= 0 || bottom - top <= 0)) return null;
  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
    clamped,
  };
}

export function measureField(
  canvas: HTMLElement,
  id: string,
  key: string,
): CanvasRect | null {
  return unionRects(
    fieldElements(canvas, id, key).map((el) => elementBox(el, canvas)),
  );
}

export function measureSlot(
  canvas: HTMLElement,
  id: string,
  slot: string,
): CanvasRect | null {
  return unionRects(
    slotElements(canvas, id, slot).map((el) => elementBox(el, canvas)),
  );
}
