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

type AnchorNode = { el: Element; children: AnchorNode[] };

type AnchorIndex = {
  roots: AnchorNode[] | null;
  boxes: Map<Element, Box | null>;
  frame: number;
};

const indexes = new WeakMap<Element, AnchorIndex>();

/** The anchors of `content` as a tree by nearest anchor ancestor, in document order. */
function buildTree(content: Element): AnchorNode[] {
  const roots: AnchorNode[] = [];
  const byEl = new Map<Element, AnchorNode>();
  for (const el of content.querySelectorAll(ANCHORS)) {
    const node: AnchorNode = { el, children: [] };
    byEl.set(el, node);
    let up = el.parentElement;
    while (up && up !== content && !byEl.has(up)) up = up.parentElement;
    const parent = up && up !== content ? byEl.get(up) : undefined;
    (parent ? parent.children : roots).push(node);
  }
  return roots;
}

/**
 * The anchor tree of `content`, rebuilt after a DOM change, and its boxes,
 * measured at most once per animation frame.
 */
function indexOf(content: Element): AnchorIndex {
  let index = indexes.get(content);
  if (!index) {
    const created: AnchorIndex = { roots: null, boxes: new Map(), frame: 0 };
    const view = content.ownerDocument.defaultView;
    new (view?.MutationObserver ?? MutationObserver)(() => {
      created.roots = null;
      created.boxes.clear();
    }).observe(content, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        'data-editor-block',
        'data-editor-field',
        'data-editor-slot',
        'data-editor-readonly',
      ],
    });
    indexes.set(content, created);
    index = created;
  }
  return index;
}

function cachedBox(index: AnchorIndex, content: Element, el: Element) {
  if (index.boxes.has(el)) return index.boxes.get(el) ?? null;
  const box = boxOf(el);
  index.boxes.set(el, box);
  const view = content.ownerDocument.defaultView;
  if (index.frame === 0 && view) {
    index.frame = view.requestAnimationFrame(() => {
      index.frame = 0;
      index.boxes.clear();
    });
  }
  return box;
}

/**
 * The block, field, slot and read-only anchors of the content under a
 * client point, front to back. Locked content is `inert`, which takes it
 * out of `elementsFromPoint`, so this measures the anchors instead.
 *
 * The anchors form a tree by nesting; the search descends only into
 * anchors whose box holds the point, so it measures the siblings along
 * one path, not every anchor. Later siblings count as in front. The list
 * is the path from the innermost anchor out, then overlapped siblings met
 * on the way. An anchor drawn outside the box of its anchor parent
 * (absolute positioning, overflow) is found only where the parent's box
 * holds the point.
 */
export function anchorsAt(host: Element, x: number, y: number): Element[] {
  const content = host.querySelector(`[${CONTENT_ATTR}]`) ?? host;
  const index = indexOf(content);
  index.roots ??= buildTree(content);
  const path: Element[] = [];
  const behind: Element[] = [];
  let level: AnchorNode[] = index.roots;
  while (level.length > 0) {
    let front: AnchorNode | null = null;
    for (let i = level.length - 1; i >= 0; i--) {
      const node = level[i]!;
      const box = cachedBox(index, content, node.el);
      if (!box || !contains(box, x, y)) continue;
      if (front === null) front = node;
      else behind.push(node.el);
    }
    if (front === null) break;
    path.push(front.el);
    level = front.children;
  }
  return [...path.reverse(), ...behind];
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
