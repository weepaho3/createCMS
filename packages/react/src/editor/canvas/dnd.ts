import type { SlotRef } from '../core/document';
import type { EditorNodes } from '../core/store';
import type { InsertTarget } from './insert';
import type { CanvasRect } from './rect';

import { computedStyleOf } from '../dom';
import { autoScrollSpeed } from './drag-geometry';

/** Default distance before a mouse or pen gesture becomes a drag. */
export const DND_THRESHOLD_PX = 5;

export type DragSession =
  | {
      kind: 'move';
      id: string;
      /**
       * Every block that moves, in document order, the primary `id`
       * included (a multi-selection); absent for a single block.
       */
      ids?: readonly string[];
    }
  | { kind: 'new'; type: string; properties?: Record<string, unknown> };

export type DndStore = {
  subscribeSession: (listener: () => void) => () => void;
  subscribeTarget: (listener: () => void) => () => void;
  getSession: () => DragSession | null;
  getDropTarget: () => InsertTarget | null;
  getClientPoint: () => { x: number; y: number } | null;
  /**
   * Starts tracking a gesture; it becomes a drag after `thresholdPx` of
   * movement (`Infinity` waits for `start`, a long press).
   */
  beginGesture: (
    originClient: { x: number; y: number },
    thresholdPx?: number,
  ) => void;
  /** Turns the pending gesture into a drag now (long press, keyboard). */
  start: (session: DragSession) => void;
  moveGesture: (
    client: { x: number; y: number },
    session: DragSession,
  ) => boolean;
  setDropTarget: (target: InsertTarget | null) => void;
  end: () => void;
  destroy: () => void;
};

function sameTarget(a: InsertTarget, b: InsertTarget): boolean {
  const ar = a.rect;
  const br = b.rect;
  return (
    a.parent.id === b.parent.id &&
    a.parent.slot === b.parent.slot &&
    a.index === b.index &&
    a.orientation === b.orientation &&
    a.variant === b.variant &&
    ar.x === br.x &&
    ar.y === br.y &&
    ar.width === br.width &&
    ar.height === br.height
  );
}

/**
 * A drop index computed with the moved node still in place, as the store's
 * `move` index (the position after the node left): one less when the node
 * moves later within the same slot.
 */
export function adjustMoveIndex(
  nodes: EditorNodes,
  id: string,
  parent: SlotRef,
  index: number,
): number {
  const node = nodes[id];
  if (
    !node ||
    node.parent?.id !== parent.id ||
    node.parent.slot !== parent.slot
  ) {
    return index;
  }
  const oldIndex = nodes[parent.id]?.slots[parent.slot]?.indexOf(id) ?? -1;
  if (oldIndex >= 0 && oldIndex < index) return index - 1;
  return index;
}

/**
 * The `move` calls that put `ids` (in this order) into `parent` at
 * `index`, where `index` counts the slot as it is before the drag: the
 * blocks land next to each other, in order, wherever they came from.
 * Each entry's `index` is the store's `move` index at that step.
 */
export function planMultiMove(
  nodes: EditorNodes,
  ids: readonly string[],
  parent: SlotRef,
  index: number,
): Array<{ id: string; index: number }> {
  const moving = new Set(ids);
  const slot = [...(nodes[parent.id]?.slots[parent.slot] ?? [])];
  const others = slot.filter((id) => !moving.has(id));
  const before = slot.slice(0, index).filter((id) => !moving.has(id)).length;
  // The block the run of moved blocks follows, if any.
  const anchor = before > 0 ? others[before - 1]! : null;
  const plan: Array<{ id: string; index: number }> = [];
  let list = slot;
  let prev = anchor;
  for (const id of ids) {
    list = list.filter((entry) => entry !== id);
    const at = prev === null ? 0 : list.indexOf(prev) + 1;
    plan.push({ id, index: at });
    list = [...list.slice(0, at), id, ...list.slice(at)];
    prev = id;
  }
  return plan;
}

function clampToRect(
  x: number,
  y: number,
  rect: CanvasRect,
): { x: number; y: number } {
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  return {
    x: Math.max(rect.x, Math.min(right, x)),
    y: Math.max(rect.y, Math.min(bottom, y)),
  };
}

export function blockIdAtPoint(
  nodes: EditorNodes,
  rootId: string,
  x: number,
  y: number,
  getRect: (id: string) => CanvasRect | null,
): string | null {
  const containing: Array<{ id: string; area: number }> = [];
  const nearest: Array<{ id: string; d: number }> = [];

  for (const id of Object.keys(nodes)) {
    const rect = getRect(id);
    if (!rect) continue;
    const inside =
      x >= rect.x &&
      x <= rect.x + rect.width &&
      y >= rect.y &&
      y <= rect.y + rect.height;
    if (inside) {
      containing.push({ id, area: rect.width * rect.height });
      continue;
    }
    const clamped = clampToRect(x, y, rect);
    nearest.push({
      id,
      d: Math.hypot(x - clamped.x, y - clamped.y),
    });
  }

  if (rootId && !nodes[rootId]) {
    const rect = getRect(rootId);
    if (rect) {
      const inside =
        x >= rect.x &&
        x <= rect.x + rect.width &&
        y >= rect.y &&
        y <= rect.y + rect.height;
      if (inside) {
        containing.push({ id: rootId, area: rect.width * rect.height });
      } else {
        const clamped = clampToRect(x, y, rect);
        nearest.push({
          id: rootId,
          d: Math.hypot(x - clamped.x, y - clamped.y),
        });
      }
    }
  }

  if (containing.length > 0) {
    containing.sort((a, b) => a.area - b.area);
    return containing[0]!.id;
  }
  if (nearest.length === 0) return rootId;
  nearest.sort((a, b) => a.d - b.d);
  return nearest[0]!.id;
}

export function findScrollParent(el: HTMLElement): HTMLElement | null {
  let cur: HTMLElement | null = el;
  while (cur) {
    const style = computedStyleOf(cur);
    if (!style) return null;
    const overflowY = style.overflowY;
    const overflowX = style.overflowX;
    const scrollsY =
      (overflowY === 'auto' || overflowY === 'scroll') &&
      cur.scrollHeight > cur.clientHeight;
    const scrollsX =
      (overflowX === 'auto' || overflowX === 'scroll') &&
      cur.scrollWidth > cur.clientWidth;
    if (scrollsY || scrollsX) return cur;
    cur = cur.parentElement;
  }
  return null;
}

type ScrollAxis = 'x' | 'y';

/** A scroller and the pointer in its own document's client coordinates. */
export type ScrollEntry = {
  readonly el: Element;
  readonly client: { x: number; y: number };
};

/**
 * Scrollable elements from `el` outward, innermost first, each with the
 * pointer in its document's coordinates. For a canvas in a frame pass the
 * host page point (`hostClient`): the chain goes on in the host page, so a
 * frame that grows with its content scrolls the page around it.
 */
export function scrollChain(
  el: Element,
  client: { x: number; y: number },
  hostClient: { x: number; y: number } | null,
): ScrollEntry[] {
  const out: ScrollEntry[] = scrollableAncestors(el).map((cur) => ({
    el: cur,
    client,
  }));
  const frame = el.ownerDocument.defaultView?.frameElement;
  if (hostClient && frame?.parentElement) {
    for (const cur of scrollableAncestors(frame.parentElement)) {
      out.push({ el: cur, client: hostClient });
    }
  }
  return out;
}

/** Scrollable elements from `el` outward, innermost first. */
export function scrollableAncestors(el: Element): Element[] {
  const out: Element[] = [];
  for (let cur: Element | null = el; cur; cur = cur.parentElement) {
    const style = computedStyleOf(cur);
    if (!style) break;
    const root = cur === el.ownerDocument.documentElement;
    const scrollsY =
      (root || style.overflowY === 'auto' || style.overflowY === 'scroll') &&
      cur.scrollHeight > cur.clientHeight;
    const scrollsX =
      (root || style.overflowX === 'auto' || style.overflowX === 'scroll') &&
      cur.scrollWidth > cur.clientWidth;
    if (scrollsY || scrollsX) out.push(cur);
  }
  return out;
}

/**
 * Auto-scroll during a drag: each `step` scrolls the innermost scroller
 * whose edge zone holds the pointer and that can still move that way, at
 * a speed per second (frame-rate independent), ramping up after the
 * pointer entered the zone.
 */
export function createAutoScroller() {
  const entered = new Map<string, number>();
  let last = 0;
  const ids = new WeakMap<Element, number>();
  let nextId = 0;
  const keyOf = (el: Element, axis: ScrollAxis, sign: number) => {
    let id = ids.get(el);
    if (id === undefined) {
      nextId += 1;
      id = nextId;
      ids.set(el, id);
    }
    return `${axis}${sign}:${id}`;
  };
  return {
    /**
     * Scrolls for the time since the previous step. Returns whether
     * anything scrolled.
     */
    step(chain: readonly ScrollEntry[], now: number, fast = false): boolean {
      const dt = last === 0 ? 16 : Math.min(100, now - last);
      last = now;
      const seen = new Set<string>();
      let scrolled = false;
      for (const { el, client } of chain) {
        const root = el === el.ownerDocument.documentElement;
        const view = el.ownerDocument.defaultView;
        const rect =
          root && view
            ? {
                left: 0,
                top: 0,
                right: view.innerWidth,
                bottom: view.innerHeight,
              }
            : el.getBoundingClientRect();
        if (
          client.x < rect.left ||
          client.x > rect.right ||
          client.y < rect.top ||
          client.y > rect.bottom
        ) {
          continue;
        }
        const axes: Array<[ScrollAxis, number, number, number]> = [
          ['y', -1, client.y - rect.top, rect.bottom - rect.top],
          ['y', 1, rect.bottom - client.y, rect.bottom - rect.top],
          ['x', -1, client.x - rect.left, rect.right - rect.left],
          ['x', 1, rect.right - client.x, rect.right - rect.left],
        ];
        for (const [axis, sign, distance, size] of axes) {
          const scroller = root
            ? (el.ownerDocument.scrollingElement ?? el)
            : el;
          const max =
            axis === 'y'
              ? scroller.scrollHeight - scroller.clientHeight
              : scroller.scrollWidth - scroller.clientWidth;
          const pos = axis === 'y' ? scroller.scrollTop : scroller.scrollLeft;
          const canMove = sign < 0 ? pos > 0 : pos < max - 0.5;
          const key = keyOf(el, axis, sign);
          const zoneSpeed = autoScrollSpeed(distance, size, 1e9, fast);
          if (zoneSpeed === 0 || !canMove) continue;
          seen.add(key);
          if (!entered.has(key)) entered.set(key, now);
          const speed = autoScrollSpeed(
            distance,
            size,
            now - entered.get(key)!,
            fast,
          );
          const delta = (sign * speed * dt) / 1000;
          if (axis === 'y') scroller.scrollTop += delta;
          else scroller.scrollLeft += delta;
          scrolled = true;
        }
        // The innermost scroller that moved wins; outer ones wait for its limit.
        if (scrolled) break;
      }
      for (const key of entered.keys()) if (!seen.has(key)) entered.delete(key);
      return scrolled;
    },
    reset() {
      entered.clear();
      last = 0;
    },
  };
}

export type AutoScroller = ReturnType<typeof createAutoScroller>;

export function createDndStore(): DndStore {
  const sessionListeners = new Set<() => void>();
  const targetListeners = new Set<() => void>();
  let session: DragSession | null = null;
  let dropTarget: InsertTarget | null = null;
  let origin: { x: number; y: number } | null = null;
  let clientPoint: { x: number; y: number } | null = null;
  let threshold = DND_THRESHOLD_PX;

  const notifySession = () => {
    for (const listener of sessionListeners) listener();
  };

  const notifyTarget = () => {
    for (const listener of targetListeners) listener();
  };

  const setSession = (next: DragSession | null) => {
    if (session === next) return;
    session = next;
    notifySession();
    notifyTarget();
  };

  return {
    subscribeSession(listener) {
      sessionListeners.add(listener);
      return () => {
        sessionListeners.delete(listener);
      };
    },
    subscribeTarget(listener) {
      targetListeners.add(listener);
      return () => {
        targetListeners.delete(listener);
      };
    },
    getSession() {
      return session;
    },
    getDropTarget() {
      return dropTarget;
    },
    getClientPoint() {
      return clientPoint;
    },
    beginGesture(originClient, thresholdPx = DND_THRESHOLD_PX) {
      origin = { ...originClient };
      clientPoint = { ...originClient };
      threshold = thresholdPx;
      session = null;
      dropTarget = null;
    },
    start(nextSession) {
      setSession(nextSession);
    },
    moveGesture(client, nextSession) {
      clientPoint = { ...client };
      if (session !== null) return true;
      if (origin === null) return false;
      const dx = client.x - origin.x;
      const dy = client.y - origin.y;
      const moved = Math.hypot(dx, dy);
      if (moved === 0 || moved < threshold) return false;
      setSession(nextSession);
      return true;
    },
    setDropTarget(target) {
      if (target === null && dropTarget === null) return;
      if (
        target !== null &&
        dropTarget !== null &&
        sameTarget(target, dropTarget)
      )
        return;
      dropTarget = target;
      notifyTarget();
    },
    end() {
      const hadSession = session !== null;
      origin = null;
      clientPoint = null;
      session = null;
      dropTarget = null;
      if (hadSession) {
        notifySession();
        notifyTarget();
      }
    },
    destroy() {
      sessionListeners.clear();
      targetListeners.clear();
      origin = null;
      clientPoint = null;
      session = null;
      dropTarget = null;
    },
  };
}
