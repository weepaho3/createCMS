import { isElement } from '../dom';

/** Marks the wrapper around the rendered blocks; it is `inert` while locked. */
export const CONTENT_ATTR = 'data-editor-content';

const ANCHORS =
  '[data-editor-block],[data-editor-field],[data-editor-slot],[data-editor-readonly]';

type Box = { left: number; top: number; right: number; bottom: number };

/** The client box of `el`; a `display: contents` element spans its children. */
function boxOf(el: Element): Box | null {
  const rect = el.getBoundingClientRect();
  if (rect.width > 0 || rect.height > 0) return rect;
  let box: Box | null = null;
  for (const child of el.children) {
    const inner = boxOf(child);
    if (!inner) continue;
    box = box
      ? {
          left: Math.min(box.left, inner.left),
          top: Math.min(box.top, inner.top),
          right: Math.max(box.right, inner.right),
          bottom: Math.max(box.bottom, inner.bottom),
        }
      : inner;
  }
  return box;
}

const contains = (box: Box, x: number, y: number) =>
  x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;

/**
 * The block, field, slot and read-only anchors of the content under a
 * client point, front to back. Locked content is `inert`, which takes it
 * out of `elementsFromPoint`, so this measures the anchors instead: later
 * elements in document order count as in front, descendants before their
 * ancestors.
 */
export function anchorsAt(host: Element, x: number, y: number): Element[] {
  const content = host.querySelector(`[${CONTENT_ATTR}]`) ?? host;
  const anchors = content.querySelectorAll(ANCHORS);
  const out: Element[] = [];
  for (let i = anchors.length - 1; i >= 0; i--) {
    const el = anchors[i]!;
    const box = boxOf(el);
    if (box && contains(box, x, y)) out.push(el);
  }
  return out;
}

const resolved = new WeakMap<Event, Element | null>();

/**
 * The element an event on the canvas is about. Locked content never is the
 * target (events land on the canvas element), so a pointer event on the
 * canvas element resolves to the frontmost anchor under the pointer. Any
 * other target stays: overlay chrome, content while editing in place, and
 * events dispatched straight at a content element.
 */
export function contentTargetOf(event: Event, host: Element): Element | null {
  const target = event.target;
  if (!isElement(target)) return null;
  if (target !== host && !target.hasAttribute(CONTENT_ATTR)) return target;
  if (!('clientX' in event)) return target;
  if (resolved.has(event)) return resolved.get(event) ?? target;
  const { clientX, clientY } = event as MouseEvent;
  const hit = anchorsAt(host, clientX, clientY)[0] ?? null;
  resolved.set(event, hit);
  return hit ?? target;
}
