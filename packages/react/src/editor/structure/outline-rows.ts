import * as React from 'react';

import type { TreeRow } from '../../tree/core';
import type { SlotRef } from '../core/document';
import type { AnyEditorSchema } from '../core/schema';
import type { EditorNodes } from '../core/store';

import { useDocSelector, useSessionSelector } from '../binding';
import { useEditorContext } from '../context';
import { DEFAULT_SLOT, slotsOf } from '../core/schema';

/** A block row of the outline. */
export type OutlineNodeRow = TreeRow & {
  readonly kind: 'node';
  readonly type: string;
  /** The slot the block sits in. */
  readonly parent: SlotRef;
};

/**
 * A slot label row (`<block id>:<slot>`), for blocks with more than one
 * slot or a named one: the slot's blocks are its children in the tree.
 */
export type OutlineSlotRow = TreeRow & {
  readonly kind: 'slot';
  readonly blockId: string;
  readonly slot: string;
};

export type OutlineRow = OutlineNodeRow | OutlineSlotRow;

export type OutlineRowsOptions = {
  /** `labelled` (default): a slot row before each slot of a block with more than one slot or a named one. `none`: blocks only. */
  slotRows?: 'labelled' | 'none';
};

/** The id of the slot row of `slot` in block `blockId`. */
export const outlineSlotRowId = (blockId: string, slot: string) =>
  `${blockId}:${slot}`;

/** The slot names a block holds: declared ones first, then the rest alphabetically. */
function slotNamesOf(
  schema: AnyEditorSchema,
  nodes: EditorNodes,
  id: string,
): string[] {
  const node = nodes[id];
  if (!node) return [];
  const declared = Object.keys(slotsOf(schema, node.type));
  const extra = Object.keys(node.slots).filter((s) => !declared.includes(s));
  return [...declared, ...extra.sort()];
}

/** Whether a block's slots show as slot rows. */
export function hasSlotRows(
  schema: AnyEditorSchema,
  nodes: EditorNodes,
  id: string,
  options: OutlineRowsOptions = {},
): boolean {
  if ((options.slotRows ?? 'labelled') !== 'labelled') return false;
  const names = slotNamesOf(schema, nodes, id);
  return names.length > 1 || (names[0] ?? DEFAULT_SLOT) !== DEFAULT_SLOT;
}

/**
 * The visible outline rows in document order, as tree rows: the root's
 * blocks on level 1, each block's children one level deeper, and for
 * blocks with several slots or a named one a slot row per slot whose
 * blocks sit one level below it. Blocks inside a collapsed block are left
 * out; slot rows never collapse.
 */
export function outlineRows(
  schema: AnyEditorSchema,
  nodes: EditorNodes,
  rootId: string,
  collapsed: readonly string[],
  options: OutlineRowsOptions = {},
): OutlineRow[] {
  const closed = new Set(collapsed);
  const rows: OutlineRow[] = [];
  const walkSlot = (
    blockId: string,
    slot: string,
    treeParent: string | null,
    level: number,
  ) => {
    const ids = nodes[blockId]?.slots[slot] ?? [];
    ids.forEach((id, index) => {
      const node = nodes[id];
      if (!node) return;
      // A block whose slots show as rows always has children: its slot rows.
      const hasChildren =
        hasSlotRows(schema, nodes, id, options) ||
        Object.values(node.slots).some((children) => children.length > 0);
      const expanded = hasChildren && !closed.has(id);
      rows.push({
        kind: 'node',
        id,
        type: node.type,
        parent: { id: blockId, slot },
        parentId: treeParent,
        level,
        posinset: index + 1,
        setsize: ids.length,
        hasChildren,
        expanded,
      });
      if (expanded) walkBlock(id, id, level + 1);
    });
  };
  const walkBlock = (
    blockId: string,
    treeParent: string | null,
    level: number,
  ) => {
    const names = slotNamesOf(schema, nodes, blockId);
    if (!hasSlotRows(schema, nodes, blockId, options)) {
      for (const slot of names) walkSlot(blockId, slot, treeParent, level);
      return;
    }
    names.forEach((slot, index) => {
      const id = outlineSlotRowId(blockId, slot);
      const count = nodes[blockId]?.slots[slot]?.length ?? 0;
      rows.push({
        kind: 'slot',
        id,
        blockId,
        slot,
        parentId: treeParent,
        level,
        posinset: index + 1,
        setsize: names.length,
        hasChildren: count > 0,
        expanded: count > 0,
      });
      walkSlot(blockId, slot, id, level + 1);
    });
  };
  walkBlock(rootId, null, 1);
  return rows;
}

const sameRow = (a: OutlineRow, b: OutlineRow) =>
  a.kind === b.kind &&
  a.id === b.id &&
  a.parentId === b.parentId &&
  a.level === b.level &&
  a.posinset === b.posinset &&
  a.setsize === b.setsize &&
  a.hasChildren === b.hasChildren &&
  a.expanded === b.expanded &&
  (a.kind === 'slot' ||
    (b.kind === 'node' &&
      a.type === b.type &&
      a.parent.id === b.parent.id &&
      a.parent.slot === b.parent.slot));

const sameRows = (a: OutlineRow[], b: OutlineRow[]) =>
  a.length === b.length && a.every((row, i) => sameRow(row, b[i]!));

/**
 * The outline rows (see {@link outlineRows}); re-renders only when they
 * change. Pass them to `Editor.Outline rows` when a virtualizer needs
 * the same list.
 */
export function useOutlineRows(
  options: OutlineRowsOptions = {},
): readonly OutlineRow[] {
  const { schema } = useEditorContext('useOutlineRows');
  const collapsed = useSessionSelector((s) => s.collapsed);
  const slotRows = options.slotRows;
  const selector = React.useCallback(
    (state: { nodes: EditorNodes; rootId: string }) =>
      outlineRows(schema, state.nodes, state.rootId, collapsed, {
        slotRows,
      }),
    [schema, collapsed, slotRows],
  );
  return useDocSelector(selector, sameRows);
}
