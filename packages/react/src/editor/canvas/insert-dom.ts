import type { PlacementIndex } from '../schema/placement';
import type { EditorNodes } from '../store';
import type { DragSession } from './dnd';
import type { Measurer } from './measurer';

import { blockElements } from './anchors';
import { blockIdAtPoint } from './dnd';
import { flowIsHorizontal, resolveInsertAt, type InsertTarget } from './insert';

export type InsertAdapters = {
  getRect: (id: string) => ReturnType<Measurer['getBlockRect']>;
  isRowFlow: (parentId: string) => boolean;
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

  const isRowFlow = (parentId: string) => {
    const parent = nodes[parentId];
    if (!parent) return false;
    for (const childId of parent.childIds) {
      const els = blockElements(host, childId);
      const el = els[0];
      if (el instanceof HTMLElement) return flowIsHorizontal(el);
    }
    return false;
  };

  return { getRect, isRowFlow };
}

export function resolveDropTarget(
  nodes: EditorNodes,
  placement: PlacementIndex,
  rootId: string,
  session: DragSession,
  x: number,
  y: number,
  adapters: InsertAdapters,
): InsertTarget | null {
  const { getRect, isRowFlow } = adapters;
  const startId = blockIdAtPoint(nodes, rootId, x, y, getRect);
  const draggedType =
    session.kind === 'new' ? session.type : (nodes[session.id]?.type ?? '');
  const draggedId = session.kind === 'move' ? session.id : undefined;
  return resolveInsertAt(nodes, placement, rootId, startId, x, y, {
    draggedType,
    draggedId,
    getRect,
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
