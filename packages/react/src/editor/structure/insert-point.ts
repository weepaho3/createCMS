import type { SlotRef } from '../core/document';
import type { AnyEditorSchema, PlacementNode } from '../core/schema';

import { canPlaceIn, DEFAULT_SLOT } from '../core/schema';

/** Where a new node goes and whether it may go there. */
export type InsertPoint = {
  parent: SlotRef;
  /** Position in the slot; `undefined` appends. */
  index: number | undefined;
  allowed: boolean;
};

/**
 * The insert point for a new `type` node relative to the selection: into the
 * selected node's `children` slot when it accepts the type, else right after
 * the selected node in its slot, else appended to the root's `children`.
 */
export function insertPointFor(
  schema: AnyEditorSchema,
  nodes: Readonly<Record<string, PlacementNode & { readonly id?: string }>>,
  rootId: string,
  selectedId: string | null,
  type: string,
): InsertPoint {
  const selected = selectedId === null ? undefined : nodes[selectedId];
  if (selected && selectedId !== null) {
    const inside: SlotRef = { id: selectedId, slot: DEFAULT_SLOT };
    if (canPlaceIn(schema, nodes, type, inside).ok) {
      return { parent: inside, index: undefined, allowed: true };
    }
    if (selected.parent) {
      const siblings =
        nodes[selected.parent.id]?.slots[selected.parent.slot] ?? [];
      return {
        parent: selected.parent,
        index: siblings.indexOf(selectedId) + 1,
        allowed: canPlaceIn(schema, nodes, type, selected.parent).ok,
      };
    }
  }
  const root: SlotRef = { id: rootId, slot: DEFAULT_SLOT };
  return {
    parent: root,
    index: undefined,
    allowed: canPlaceIn(schema, nodes, type, root).ok,
  };
}
