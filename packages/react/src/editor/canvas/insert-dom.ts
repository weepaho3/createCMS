import type { SlotRef } from '../core/document';
import type { AnyEditorSchema } from '../core/schema';
import type { EditorNodes } from '../core/store';
import type { DragSession } from './dnd';
import type { Measurer } from './measurer';

import { isSelfOrDescendant } from '../core/schema';
import { isHTMLElement } from '../dom';
import { blockElements, isInsideReadonly } from './anchors';
import { blockIdAtPoint } from './dnd';
import {
  contractRect,
  HIT_EDGE_PX,
  inEdgeBand,
  rectContains,
} from './drag-geometry';
import { flowIsHorizontal, resolveInsertAt, type InsertTarget } from './insert';

export type InsertAdapters = {
  getRect: (id: string) => ReturnType<Measurer['getBlockRect']>;
  getSlotRect: (
    parentId: string,
    slot: string,
  ) => ReturnType<Measurer['getSlotRect']>;
  isRowFlow: (parent: SlotRef) => boolean;
  /**
   * The block a drop starts from at a content point: the deepest block
   * under the pointer that is neither the dragged block nor inside it nor
   * read-only, skipping a leaf whose 6 px edge holds the point and a tall
   * container whose 30 px edge band holds it, so those drop beside it.
   * `null` when the pointer is outside the canvas.
   */
  blockAt: (x: number, y: number, draggedId?: string) => string | null;
};

export function createInsertAdapters(
  host: HTMLElement,
  measurer: Measurer,
  nodes: EditorNodes,
  rootId: string,
): InsertAdapters {
  const getRect = (id: string) => {
    const measured = measurer.getBlockRect(id);
    if (measured) return measured;
    if (id === rootId) {
      return {
        x: 0,
        y: 0,
        width: host.clientWidth,
        height: host.clientHeight,
      };
    }
    return null;
  };

  const getSlotRect = (parentId: string, slot: string) =>
    measurer.getSlotRect(parentId, slot);

  const isRowFlow = (target: SlotRef) => {
    const parent = nodes[target.id];
    if (!parent) return false;
    for (const childId of parent.slots[target.slot] ?? []) {
      const els = blockElements(host, childId);
      const el = els[0];
      if (isHTMLElement(el)) return flowIsHorizontal(el);
    }
    return false;
  };

  const outsideChildren = (
    slots: Readonly<Record<string, readonly string[]>>,
    point: { x: number; y: number },
    flow: 'row' | 'column',
  ): boolean => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const ids of Object.values(slots)) {
      for (const id of ids) {
        const rect = getRect(id);
        if (!rect) continue;
        lo = Math.min(lo, flow === 'row' ? rect.x : rect.y);
        hi = Math.max(
          hi,
          flow === 'row' ? rect.x + rect.width : rect.y + rect.height,
        );
      }
    }
    const at = flow === 'row' ? point.x : point.y;
    return !(at >= lo && at <= hi);
  };

  const blockAt = (x: number, y: number, draggedId?: string) => {
    const box = host.getBoundingClientRect();
    const client = {
      x: x - host.scrollLeft + box.left,
      y: y - host.scrollTop + box.top,
    };
    const hits = host.ownerDocument.elementsFromPoint?.(client.x, client.y);
    if (!hits) return null;
    const point = { x, y };
    for (const hit of hits) {
      if (!host.contains(hit)) continue;
      if (isInsideReadonly(hit, host)) continue;
      const blockEl = hit.closest('[data-editor-block]');
      const first =
        blockEl && host.contains(blockEl)
          ? blockEl.getAttribute('data-editor-block')
          : null;
      for (let cur = first; cur; cur = nodes[cur]?.parent?.id ?? null) {
        if (draggedId && isSelfOrDescendant(nodes, draggedId, cur)) continue;
        const node = nodes[cur];
        const rect = getRect(cur);
        if (!node || !rect) continue;
        if (node.parent === null) return cur;
        const container = Object.keys(node.slots).length > 0;
        if (!container) {
          // A leaf takes no drop itself; its edge belongs to the gaps around it.
          if (!rectContains(contractRect(rect, HIT_EDGE_PX), point)) continue;
          return cur;
        }
        const flow = isRowFlow(node.parent) ? 'row' : 'column';
        // The band covers only the container's own space past its
        // children: right below a flush last child still drops inside.
        if (
          inEdgeBand(rect, point, flow) &&
          outsideChildren(node.slots, point, flow)
        ) {
          continue;
        }
        return cur;
      }
      return rootId;
    }
    return null;
  };

  return { getRect, getSlotRect, isRowFlow, blockAt };
}

export function resolveDropTarget(
  schema: AnyEditorSchema,
  nodes: EditorNodes,
  rootId: string,
  session: DragSession,
  x: number,
  y: number,
  adapters: InsertAdapters,
): InsertTarget | null {
  const { getRect, getSlotRect, isRowFlow } = adapters;
  const draggedType =
    session.kind === 'new' ? session.type : (nodes[session.id]?.type ?? '');
  const draggedId = session.kind === 'move' ? session.id : undefined;
  // Outside the canvas the nearest block by distance still gives a target.
  const startId =
    adapters.blockAt(x, y, draggedId) ??
    blockIdAtPoint(nodes, rootId, x, y, getRect);
  return resolveInsertAt(schema, nodes, rootId, startId, x, y, {
    draggedType,
    draggedId,
    getRect,
    getSlotRect,
    isRowFlow,
  });
}

export function contentPointFromClient(
  host: HTMLElement,
  client: { x: number; y: number },
): { x: number; y: number } {
  const box = host.getBoundingClientRect();
  return {
    x: Math.round(client.x - box.left + host.scrollLeft),
    y: Math.round(client.y - box.top + host.scrollTop),
  };
}
