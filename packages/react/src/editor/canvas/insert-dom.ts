import type { SlotRef } from '../core/document';
import type { AnyEditorSchema } from '../core/schema';
import type { EditorNodes } from '../core/store';
import type { DragSession } from './dnd';
import type { Measurer } from './measurer';

import { isHTMLElement } from '../dom';
import { blockElements } from './anchors';
import { blockIdAtPoint } from './dnd';
import { flowIsHorizontal, resolveInsertAt, type InsertTarget } from './insert';

export type InsertAdapters = {
  getRect: (id: string) => ReturnType<Measurer['getBlockRect']>;
  getSlotRect: (
    parentId: string,
    slot: string,
  ) => ReturnType<Measurer['getSlotRect']>;
  isRowFlow: (parent: SlotRef) => boolean;
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

  return { getRect, getSlotRect, isRowFlow };
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
  const startId = blockIdAtPoint(nodes, rootId, x, y, getRect);
  const draggedType =
    session.kind === 'new' ? session.type : (nodes[session.id]?.type ?? '');
  const draggedId = session.kind === 'move' ? session.id : undefined;
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
