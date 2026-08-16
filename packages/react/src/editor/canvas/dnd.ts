import type { EditorNodes } from '../store';
import type { InsertTarget } from './insert';
import type { CanvasRect } from './rect';

export const DND_THRESHOLD_PX = 4;
export const DND_SCROLL_EDGE_PX = 64;
export const DND_SCROLL_MAX_PX = 22;

export type DragSession =
  | { kind: 'move'; id: string }
  | { kind: 'new'; type: string; properties?: Record<string, unknown> };

export type DndStore = {
  subscribeSession: (listener: () => void) => () => void;
  subscribeTarget: (listener: () => void) => () => void;
  getSession: () => DragSession | null;
  getDropTarget: () => InsertTarget | null;
  getClientPoint: () => { x: number; y: number } | null;
  beginGesture: (originClient: { x: number; y: number }) => void;
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
    a.parentId === b.parentId &&
    a.index === b.index &&
    a.orientation === b.orientation &&
    a.variant === b.variant &&
    ar.x === br.x &&
    ar.y === br.y &&
    ar.width === br.width &&
    ar.height === br.height
  );
}

export function adjustMoveIndex(
  nodes: EditorNodes,
  id: string,
  parentId: string,
  index: number,
): number {
  const node = nodes[id];
  if (!node || node.parentId !== parentId) return index;
  const oldIndex = nodes[parentId]?.childIds.indexOf(id) ?? -1;
  if (oldIndex >= 0 && oldIndex < index) return index - 1;
  return index;
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
  const view = el.ownerDocument.defaultView;
  if (!view) return null;
  while (cur) {
    const style = view.getComputedStyle(cur);
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

export function autoScrollAtClient(
  scroller: HTMLElement,
  client: { x: number; y: number },
): boolean {
  const view = scroller.ownerDocument.defaultView;
  if (!view) return false;
  const gbr = scroller.getBoundingClientRect();
  const top = client.y - gbr.top;
  const bottom = gbr.bottom - client.y;
  const left = client.x - gbr.left;
  const right = gbr.right - client.x;
  const edge = DND_SCROLL_EDGE_PX;
  const max = DND_SCROLL_MAX_PX;
  let dy = 0;
  let dx = 0;
  if (top < edge) dy = -max * (1 - Math.max(0, top) / edge);
  if (bottom < edge) dy = max * (1 - Math.max(0, bottom) / edge);
  if (left < edge) dx = -max * (1 - Math.max(0, left) / edge);
  if (right < edge) dx = max * (1 - Math.max(0, right) / edge);
  if (dy === 0 && dx === 0) return false;
  const prevTop = scroller.scrollTop;
  const prevLeft = scroller.scrollLeft;
  scroller.scrollTop += dy;
  scroller.scrollLeft += dx;
  return scroller.scrollTop !== prevTop || scroller.scrollLeft !== prevLeft;
}

export function createDndStore(): DndStore {
  const sessionListeners = new Set<() => void>();
  const targetListeners = new Set<() => void>();
  let session: DragSession | null = null;
  let dropTarget: InsertTarget | null = null;
  let origin: { x: number; y: number } | null = null;
  let clientPoint: { x: number; y: number } | null = null;

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
    beginGesture(originClient) {
      origin = { ...originClient };
      clientPoint = { ...originClient };
      session = null;
      dropTarget = null;
    },
    moveGesture(client, nextSession) {
      clientPoint = { ...client };
      if (session !== null) return true;
      if (origin === null) return false;
      const dx = client.x - origin.x;
      const dy = client.y - origin.y;
      if (Math.hypot(dx, dy) < DND_THRESHOLD_PX) return false;
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
