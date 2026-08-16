export type CanvasRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

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
