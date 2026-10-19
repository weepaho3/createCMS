import type { TreeDropTarget } from '../../tree/core';
import type { SlotRef } from '../core/document';
import type { AnyEditorSchema } from '../core/schema';
import type { EditorNodes } from '../core/store';
import type { OutlineRow, OutlineRowsOptions } from './outline-rows';

import { canPlaceIn, slotsOf } from '../core/schema';
import { hasSlotRows } from './outline-rows';

/** The first slot of a block: declared ones first, then any it holds. */
function firstSlotOf(
  schema: AnyEditorSchema,
  nodes: EditorNodes,
  id: string,
): string | null {
  const node = nodes[id];
  if (!node) return null;
  return (
    Object.keys(slotsOf(schema, node.type))[0] ??
    Object.keys(node.slots).sort()[0] ??
    null
  );
}

/**
 * The slot a tree drop parent stands for: a slot row is its slot, a block
 * row its only slot, `null` the root's. A block whose slots show as slot
 * rows takes drops only through those rows (`null` here).
 */
export function outlineDropParent(
  schema: AnyEditorSchema,
  nodes: EditorNodes,
  rootId: string,
  rows: readonly OutlineRow[],
  parentId: string | null,
  options: OutlineRowsOptions = {},
): SlotRef | null {
  if (parentId !== null) {
    const row = rows.find((candidate) => candidate.id === parentId);
    if (row?.kind === 'slot') return { id: row.blockId, slot: row.slot };
  }
  const blockId = parentId ?? rootId;
  if (!nodes[blockId] || hasSlotRows(schema, nodes, blockId, options)) {
    return null;
  }
  const slot = firstSlotOf(schema, nodes, blockId);
  return slot === null ? null : { id: blockId, slot };
}

/** Whether a row can take a drop into it: slot rows and blocks with one unlabelled slot. */
export function outlineCanContain(
  schema: AnyEditorSchema,
  nodes: EditorNodes,
  row: OutlineRow,
  options: OutlineRowsOptions = {},
): boolean {
  if (row.kind === 'slot') return true;
  return (
    firstSlotOf(schema, nodes, row.id) !== null &&
    !hasSlotRows(schema, nodes, row.id, options)
  );
}

/**
 * The store `move` target of a tree drop for `draggedId`: the slot and the
 * index counted with the dragged block still in place (an append when the
 * drop lands on a row), or `null` when the placement rules refuse it or
 * it would drop the block into itself.
 */
export function outlineDropTarget(
  schema: AnyEditorSchema,
  nodes: EditorNodes,
  rootId: string,
  rows: readonly OutlineRow[],
  draggedId: string,
  target: TreeDropTarget,
  options: OutlineRowsOptions = {},
): { parent: SlotRef; index: number } | null {
  const parent = outlineDropParent(
    schema,
    nodes,
    rootId,
    rows,
    target.parentId,
    options,
  );
  const dragged = nodes[draggedId];
  if (!parent || !dragged) return null;
  const placed = canPlaceIn(schema, nodes, dragged.type, parent, {
    movingId: draggedId,
  });
  if (!placed.ok) return null;
  const length = nodes[parent.id]?.slots[parent.slot]?.length ?? 0;
  return { parent, index: target.index ?? length };
}
