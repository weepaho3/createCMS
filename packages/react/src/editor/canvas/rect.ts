export type CanvasRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Canvas host scrollport in content coordinates (`scroll*` + `client*`). */
export type CanvasViewBox = {
  scrollLeft: number;
  scrollTop: number;
  clientWidth: number;
  clientHeight: number;
};

/** Estimated overlay toolbar height used to detect clip against `overflow: hidden`. */
export const OVERLAY_TOOLBAR_ESTIMATE_PX = 40;

/** Inset for overlay-anchored drag handles so they stay inside the clip. */
export const OVERLAY_CHROME_INSET_PX = 8;

export function unionRects(rects: readonly CanvasRect[]): CanvasRect | null {
  if (rects.length === 0) return null;
  let minX = rects[0]!.x;
  let minY = rects[0]!.y;
  let maxRight = rects[0]!.x + rects[0]!.width;
  let maxBottom = rects[0]!.y + rects[0]!.height;
  for (let i = 1; i < rects.length; i++) {
    const r = rects[i]!;
    if (r.x < minX) minX = r.x;
    if (r.y < minY) minY = r.y;
    const right = r.x + r.width;
    const bottom = r.y + r.height;
    if (right > maxRight) maxRight = right;
    if (bottom > maxBottom) maxBottom = bottom;
  }
  return {
    x: minX,
    y: minY,
    width: maxRight - minX,
    height: maxBottom - minY,
  };
}

/**
 * Content coordinates: the element's viewport offset relative to the
 * canvas padding box, plus `scrollLeft` / `scrollTop`.
 */
export function canvasRectOf(el: Element, canvas: HTMLElement): CanvasRect {
  const view = canvas.ownerDocument.defaultView;
  const a = el.getBoundingClientRect();
  const c = canvas.getBoundingClientRect();
  const scrollX = view ? canvas.scrollLeft : 0;
  const scrollY = view ? canvas.scrollTop : 0;
  return {
    x: a.left - c.left + scrollX,
    y: a.top - c.top + scrollY,
    width: a.width,
    height: a.height,
  };
}

export function sameRect(a: CanvasRect, b: CanvasRect): boolean {
  return (
    Object.is(a.x, b.x) &&
    Object.is(a.y, b.y) &&
    Object.is(a.width, b.width) &&
    Object.is(a.height, b.height)
  );
}

export function adoptRect(
  prev: CanvasRect | undefined,
  next: CanvasRect,
): CanvasRect {
  return prev && sameRect(prev, next) ? prev : next;
}

/**
 * Intersection of a block rect with the host scrollport, in content
 * coordinates. Null when the block is fully scrolled out of view.
 */
export function visibleIntersection(
  rect: CanvasRect,
  view: CanvasViewBox,
): CanvasRect | null {
  const left = Math.max(rect.x, view.scrollLeft);
  const top = Math.max(rect.y, view.scrollTop);
  const right = Math.min(
    rect.x + rect.width,
    view.scrollLeft + view.clientWidth,
  );
  const bottom = Math.min(
    rect.y + rect.height,
    view.scrollTop + view.clientHeight,
  );
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function overlayChromeFitsAbove(
  rect: CanvasRect,
  view: CanvasViewBox,
  offset: number,
): boolean {
  return rect.y - OVERLAY_TOOLBAR_ESTIMATE_PX - offset >= view.scrollTop;
}

export function overlayChromeFitsBelow(
  rect: CanvasRect,
  view: CanvasViewBox,
  offset: number,
): boolean {
  return (
    rect.y + rect.height + offset + OVERLAY_TOOLBAR_ESTIMATE_PX <=
    view.scrollTop + view.clientHeight
  );
}
