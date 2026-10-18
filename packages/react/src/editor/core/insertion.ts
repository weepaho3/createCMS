import type { SlotRef } from './document';
import type { AnyEditorSchema } from './schema';
import type { EditorNodes } from './store';

import { canPlaceIn, isSelfOrDescendant, slotsOf } from './schema';

/** A place a block can go: a slot and the index it would get there. */
export type InsertionPoint = {
  readonly parent: SlotRef;
  readonly index: number;
};

function slotOrder(
  schema: AnyEditorSchema,
  type: string,
  slots: Readonly<Record<string, readonly string[]>>,
): string[] {
  return [
    ...new Set([...Object.keys(slotsOf(schema, type)), ...Object.keys(slots)]),
  ];
}

/**
 * Every place `type` may go, in document order: each slot that takes it
 * contributes its gaps, and a child's own slots come right after the gap
 * before it. With `movingId`, places inside that block are left out and
 * the block's own slot counts it as already gone (its current gap is
 * included, so a keyboard drag starts there).
 */
export function insertionPoints(
  schema: AnyEditorSchema,
  nodes: EditorNodes,
  rootId: string,
  type: string,
  movingId?: string,
): InsertionPoint[] {
  const out: InsertionPoint[] = [];
  const visit = (id: string) => {
    const node = nodes[id];
    if (!node) return;
    if (movingId && isSelfOrDescendant(nodes, movingId, id)) return;
    for (const slot of slotOrder(schema, node.type, node.slots)) {
      const parent = { id, slot };
      const accepts = canPlaceIn(schema, nodes, type, parent, {
        movingId,
      }).ok;
      const children = (node.slots[slot] ?? []).filter(
        (child) => child !== movingId,
      );
      children.forEach((child, index) => {
        if (accepts) out.push({ parent, index });
        visit(child);
      });
      if (accepts) out.push({ parent, index: children.length });
    }
  };
  visit(rootId);
  return out;
}
