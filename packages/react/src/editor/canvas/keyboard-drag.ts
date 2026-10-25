import type { InsertionPoint } from '../core/insertion';
import type { EditorNodes } from '../core/store';
import type { InsertTarget } from './insert';
import type { CanvasRect } from './rect';

import { INSERT_BOX_PAD, INSERT_LINE_THICKNESS } from './insert';

/**
 * The drop target for an insertion point: a line at the gap (before the
 * child at `index`, else after the last), a box for an empty slot.
 * `index` counts the slot without the moving block.
 */
export function targetFor(
  point: InsertionPoint,
  nodes: EditorNodes,
  rootId: string,
  options: {
    getRect: (id: string) => CanvasRect | null;
    getSlotRect: (parentId: string, slot: string) => CanvasRect | null;
    movingId?: string;
  },
): InsertTarget | null {
  const { parent, index } = point;
  const children = (nodes[parent.id]?.slots[parent.slot] ?? []).filter(
    (child) => child !== options.movingId,
  );
  const base = {
    parent,
    allowedTypes: [],
    nested: parent.id !== rootId,
  };
  if (children.length === 0) {
    const rect =
      options.getSlotRect(parent.id, parent.slot) ?? options.getRect(parent.id);
    if (!rect) return null;
    return {
      ...base,
      index: 0,
      orientation: 'horizontal',
      variant: 'box',
      rect: {
        x: rect.x + INSERT_BOX_PAD,
        y: rect.y + INSERT_BOX_PAD,
        width: Math.max(0, rect.width - 2 * INSERT_BOX_PAD),
        height: Math.max(0, rect.height - 2 * INSERT_BOX_PAD),
      },
    };
  }
  const before = children[index];
  const anchor = options.getRect(before ?? children[children.length - 1]!);
  if (!anchor) return null;
  const y = before ? anchor.y : anchor.y + anchor.height;
  // Store index: the moving block, when it sits earlier in this slot,
  // still counts until it leaves.
  const full = nodes[parent.id]?.slots[parent.slot] ?? [];
  const from = options.movingId ? full.indexOf(options.movingId) : -1;
  return {
    ...base,
    index: from >= 0 && from <= index ? index + 1 : index,
    orientation: 'horizontal',
    variant: 'line',
    rect: {
      x: anchor.x,
      y: y - INSERT_LINE_THICKNESS / 2,
      width: anchor.width,
      height: INSERT_LINE_THICKNESS,
    },
  };
}
