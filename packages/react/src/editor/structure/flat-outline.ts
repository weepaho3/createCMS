import * as React from 'react';

import type { AnyEditorSchema } from '../core/schema';
import type { EditorNodes } from '../core/store';

import { useDocSelector, useSessionSelector } from '../binding';
import { useEditorContext } from '../context';
import { DEFAULT_SLOT, slotsOf } from '../core/schema';

/** A block row of a flat outline. */
export type FlatOutlineNodeRow = {
  readonly kind: 'node';
  readonly id: string;
  readonly type: string;
  /** 1 for the root's children (`aria-level`). */
  readonly level: number;
  readonly posInSet: number;
  readonly setSize: number;
  readonly parentId: string;
  readonly slot: string;
  readonly hasChildren: boolean;
  readonly expanded: boolean;
};

/** A slot label row, for blocks with more than one slot or a named one. */
export type FlatOutlineSlotRow = {
  readonly kind: 'slot';
  /** `<parent id>:<slot>`. */
  readonly id: string;
  readonly parentId: string;
  readonly slot: string;
  readonly level: number;
};

export type FlatOutlineRow = FlatOutlineNodeRow | FlatOutlineSlotRow;

export type FlatOutlineOptions = {
  /** `labelled` (default): a label row before each slot of a block with more than one slot or a named one. `none`: blocks only. */
  slotRows?: 'labelled' | 'none';
};

/**
 * The visible rows of the outline in document order: blocks inside a
 * collapsed block are left out. Rows carry their level, position and set
 * size for `aria-level`, `aria-posinset` and `aria-setsize`.
 */
export function flatOutlineRows(
  schema: AnyEditorSchema,
  nodes: EditorNodes,
  rootId: string,
  collapsed: readonly string[],
  options: FlatOutlineOptions = {},
): FlatOutlineRow[] {
  const labelSlots = (options.slotRows ?? 'labelled') === 'labelled';
  const closed = new Set(collapsed);
  const rows: FlatOutlineRow[] = [];
  const slotNames = (id: string, type: string): string[] => {
    const node = nodes[id];
    if (!node) return [];
    const declared = Object.keys(slotsOf(schema, type));
    const extra = Object.keys(node.slots).filter((s) => !declared.includes(s));
    return [...declared, ...extra.sort()];
  };
  const walk = (parentId: string, level: number) => {
    const parent = nodes[parentId];
    if (!parent) return;
    const names = slotNames(parentId, parent.type);
    const labelled =
      labelSlots &&
      parentId !== rootId &&
      (names.length > 1 || (names[0] ?? DEFAULT_SLOT) !== DEFAULT_SLOT);
    for (const slot of names) {
      const ids = parent.slots[slot] ?? [];
      if (labelled) {
        rows.push({
          kind: 'slot',
          id: `${parentId}:${slot}`,
          parentId,
          slot,
          level,
        });
      }
      ids.forEach((id, index) => {
        const node = nodes[id];
        if (!node) return;
        const hasChildren = Object.values(node.slots).some(
          (children) => children.length > 0,
        );
        const expanded = hasChildren && !closed.has(id);
        rows.push({
          kind: 'node',
          id,
          type: node.type,
          level,
          posInSet: index + 1,
          setSize: ids.length,
          parentId,
          slot,
          hasChildren,
          expanded,
        });
        if (expanded) walk(id, level + 1);
      });
    }
  };
  walk(rootId, 1);
  return rows;
}

const sameRows = (a: FlatOutlineRow[], b: FlatOutlineRow[]) =>
  a.length === b.length &&
  a.every((row, i) => {
    const other = b[i]!;
    return (
      row.kind === other.kind &&
      row.id === other.id &&
      row.level === other.level &&
      (row.kind === 'slot' ||
        (other.kind === 'node' &&
          row.type === other.type &&
          row.posInSet === other.posInSet &&
          row.setSize === other.setSize &&
          row.hasChildren === other.hasChildren &&
          row.expanded === other.expanded))
    );
  });

/**
 * The outline as flat rows (see {@link flatOutlineRows}), for virtualized
 * outlines: render the visible slice of rows inside `Editor.Outline` and
 * pass the block ids as its `rows`. Re-renders only when the rows change.
 */
export function useFlatOutline(
  options: FlatOutlineOptions = {},
): readonly FlatOutlineRow[] {
  const { schema } = useEditorContext('useFlatOutline');
  const collapsed = useSessionSelector((s) => s.collapsed);
  const slotRows = options.slotRows;
  const selector = React.useCallback(
    (state: { nodes: EditorNodes; rootId: string }) =>
      flatOutlineRows(schema, state.nodes, state.rootId, collapsed, {
        slotRows,
      }),
    [schema, collapsed, slotRows],
  );
  return useDocSelector(selector, sameRows);
}
