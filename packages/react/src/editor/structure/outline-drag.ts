import type { SlotRef } from '../core/document';
import type { AnyEditorSchema } from '../core/schema';
import type { EditorNodes } from '../core/store';

import {
  canPlaceIn,
  DEFAULT_SLOT,
  isSelfOrDescendant,
  slotsOf,
} from '../core/schema';

/**
 * Where a row drop goes, from the pointer over a row: above or below it,
 * into it (as its last child), or below it at a shallower level (out of
 * its parent), chosen by the horizontal offset.
 */
export type TreeInstruction =
  | { readonly type: 'reorder-above' }
  | { readonly type: 'reorder-below' }
  | { readonly type: 'make-child' }
  | { readonly type: 'reparent'; readonly level: number };

/**
 * The instruction for a pointer at `point` over a row `rect` at `level`
 * (root children are 1): the top quarter reorders above, the bottom
 * quarter below, the middle makes a child when the row takes one. Below
 * the last row of a group, moving left by whole indents reparents to that
 * level.
 */
export function treeInstruction(
  rect: { x: number; y: number; width: number; height: number },
  point: { x: number; y: number },
  options: {
    level: number;
    indent: number;
    canMakeChild: boolean;
    isLastInGroup: boolean;
  },
): TreeInstruction {
  const offset = (point.y - rect.y) / Math.max(1, rect.height);
  const below = offset >= 0.75 || (!options.canMakeChild && offset >= 0.5);
  const above = offset < 0.25 || (!options.canMakeChild && offset < 0.5);
  if (above) return { type: 'reorder-above' };
  if (!below) return { type: 'make-child' };
  if (options.isLastInGroup && options.indent > 0) {
    const desired = Math.max(
      1,
      Math.round((point.x - rect.x) / options.indent),
    );
    if (desired < options.level) {
      return { type: 'reparent', level: desired };
    }
  }
  return { type: 'reorder-below' };
}

function depthOf(nodes: EditorNodes, id: string): number {
  let depth = 0;
  for (
    let up = nodes[id]?.parent ?? null;
    up;
    up = nodes[up.id]?.parent ?? null
  ) {
    depth += 1;
  }
  return depth;
}

/**
 * The store `move` target of an instruction over row `rowId` for
 * `draggedId` (its index counts the slot with the dragged block still in
 * place, like every drop target), or `null` when the placement rules
 * refuse it or it would drop the block into itself.
 */
export function instructionTarget(
  schema: AnyEditorSchema,
  nodes: EditorNodes,
  rowId: string,
  draggedId: string,
  instruction: TreeInstruction,
): { parent: SlotRef; index: number } | null {
  const row = nodes[rowId];
  const dragged = nodes[draggedId];
  if (!row || !dragged || row.parent === null) return null;
  if (isSelfOrDescendant(nodes, draggedId, rowId)) return null;
  let target: { parent: SlotRef; index: number };
  if (instruction.type === 'make-child') {
    const slots = Object.keys(slotsOf(schema, row.type));
    const slot = slots.includes(DEFAULT_SLOT) ? DEFAULT_SLOT : slots[0];
    if (slot === undefined) return null;
    target = {
      parent: { id: rowId, slot },
      index: row.slots[slot]?.length ?? 0,
    };
  } else {
    let anchor = row;
    if (instruction.type === 'reparent') {
      while (anchor.parent && depthOf(nodes, anchor.id) > instruction.level) {
        const up = nodes[anchor.parent.id];
        if (!up || up.parent === null) break;
        anchor = up;
      }
    }
    const parent = anchor.parent!;
    const siblings = nodes[parent.id]?.slots[parent.slot] ?? [];
    const at = siblings.indexOf(anchor.id);
    target = {
      parent,
      index: instruction.type === 'reorder-above' ? at : at + 1,
    };
  }
  const ok = canPlaceIn(schema, nodes, dragged.type, target.parent, {
    movingId: draggedId,
  }).ok;
  return ok ? target : null;
}
