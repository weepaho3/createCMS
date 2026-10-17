import type { SlotRef } from '../core/document';
import type { AnyEditorSchema } from '../core/schema';
import type { EditorNodes } from '../core/store';
import type { CanvasRect } from './rect';

import {
  allowedChildTypes,
  canPlaceIn,
  isSelfOrDescendant,
  slotsOf,
} from '../core/schema';

export type InsertOrientation = 'horizontal' | 'vertical';
export type InsertVariant = 'line' | 'box';

export type InsertTarget = {
  /** The parent node and slot the new or moved node goes into. */
  parent: SlotRef;
  index: number;
  orientation: InsertOrientation;
  variant: InsertVariant;
  rect: CanvasRect;
  /** Schema types the slot accepts right now, in definition order. */
  allowedTypes: string[];
  /** True when the parent is not the document root. */
  nested: boolean;
};

export type ResolveInsertAtOptions = {
  draggedType?: string;
  draggedId?: string;
  getRect: (id: string) => CanvasRect | null;
  /**
   * The rect of the element holding a slot (`edit.slot.<name>`); an empty
   * slot shows its box there. Falls back to the parent's rect when absent.
   */
  getSlotRect?: (parentId: string, slot: string) => CanvasRect | null;
  /**
   * True when a single child's layout parent flows as a row (flex row
   * or multi-column grid). Ignored when two or more children have rects;
   * those infer row vs column from geometry. Unit tests stub this.
   */
  isRowFlow: (parent: SlotRef) => boolean;
};

export const INSERT_LINE_THICKNESS = 2;
export const INSERT_BOX_PAD = 6;

export function parentTypeOf(
  nodes: EditorNodes,
  rootId: string,
  parentId: string,
): string | null {
  if (parentId === rootId) return 'root';
  return nodes[parentId]?.type ?? null;
}

/**
 * Whether `parent.slot` takes the dragged node (with `draggedType`), or
 * anything at all when nothing is dragged.
 */
export function accepts(
  schema: AnyEditorSchema,
  nodes: EditorNodes,
  parent: SlotRef,
  draggedType?: string,
  draggedId?: string,
): boolean {
  if (draggedType !== undefined) {
    return canPlaceIn(schema, nodes, draggedType, parent, {
      movingId: draggedId,
    }).ok;
  }
  return allowedChildTypes(schema, nodes, parent).length > 0;
}

export function distToSeg(
  px: number,
  py: number,
  fixed: number,
  span0: number,
  span1: number,
  segmentIsVertical: boolean,
): number {
  const lo = Math.min(span0, span1);
  const hi = Math.max(span0, span1);
  if (segmentIsVertical) {
    const cy = Math.max(lo, Math.min(hi, py));
    const cx = fixed;
    return Math.hypot(px - cx, py - cy);
  }
  const cx = Math.max(lo, Math.min(hi, px));
  const cy = fixed;
  return Math.hypot(px - cx, py - cy);
}

/**
 * Flow is read from the child's layout parent via
 * `ownerDocument.defaultView`, never the global `window`. Used only when
 * a container has a single measurable child (geometry cannot reveal
 * row vs column).
 */
export function flowIsHorizontal(el: HTMLElement): boolean {
  const wrap = el.parentElement;
  if (!wrap) return false;
  const view = el.ownerDocument.defaultView;
  if (!view) return false;
  const ws = view.getComputedStyle(wrap);
  if (ws.display === 'grid' || ws.display === 'inline-grid') {
    const cols = ws.gridTemplateColumns
      .split(/\s+/)
      .filter((t) => t && t !== 'none');
    return cols.length > 1;
  }
  if (ws.display === 'flex' || ws.display === 'inline-flex') {
    return ws.flexDirection === 'row' || ws.flexDirection === 'row-reverse';
  }
  return false;
}

function insetBoxRect(rect: CanvasRect, pad: number): CanvasRect {
  const x = rect.x + pad;
  const y = rect.y + pad;
  const width = Math.max(0, rect.width - 2 * pad);
  const height = Math.max(0, rect.height - 2 * pad);
  return { x, y, width, height };
}

function clampToRect(
  x: number,
  y: number,
  rect: CanvasRect,
): { x: number; y: number } {
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  return {
    x: Math.max(rect.x, Math.min(right, x)),
    y: Math.max(rect.y, Math.min(bottom, y)),
  };
}

function buildTarget(
  schema: AnyEditorSchema,
  nodes: EditorNodes,
  rootId: string,
  parent: SlotRef,
  index: number,
  orientation: InsertOrientation,
  variant: InsertVariant,
  rect: CanvasRect,
  draggedId: string | undefined,
): InsertTarget {
  return {
    parent,
    index,
    orientation,
    variant,
    rect,
    allowedTypes: allowedChildTypes(schema, nodes, parent, {
      movingId: draggedId,
    }),
    nested: parent.id !== rootId,
  };
}

function nearestIn(
  schema: AnyEditorSchema,
  nodes: EditorNodes,
  rootId: string,
  slotRef: SlotRef,
  x: number,
  y: number,
  options: ResolveInsertAtOptions,
): { d: number; target: InsertTarget } | null {
  const { draggedId, getRect } = options;
  const parent = nodes[slotRef.id];
  if (!parent) return null;
  const target = (
    index: number,
    orientation: InsertOrientation,
    variant: InsertVariant,
    rect: CanvasRect,
  ): InsertTarget =>
    buildTarget(
      schema,
      nodes,
      rootId,
      slotRef,
      index,
      orientation,
      variant,
      rect,
      draggedId,
    );

  const items: Array<{ index: number; rect: CanvasRect }> = [];
  (parent.slots[slotRef.slot] ?? []).forEach((id, index) => {
    if (id === draggedId) return;
    const rect = getRect(id);
    if (rect) items.push({ index, rect });
  });

  if (items.length === 0) {
    const parentRect =
      options.getSlotRect?.(slotRef.id, slotRef.slot) ?? getRect(slotRef.id);
    if (!parentRect) return null;
    const clamped = clampToRect(x, y, parentRect);
    const d = Math.hypot(x - clamped.x, y - clamped.y);
    return {
      d,
      target: target(
        0,
        'horizontal',
        'box',
        insetBoxRect(parentRect, INSERT_BOX_PAD),
      ),
    };
  }

  const sorted = [...items].sort((a, b) => a.rect.y - b.rect.y);
  const rows: number[] = [];
  let rowBottom = -Infinity;
  for (const item of sorted) {
    if (rows.length === 0 || item.rect.y >= rowBottom) {
      rows.push(1);
      rowBottom = item.rect.y + item.rect.height * 0.6;
    } else {
      rows[rows.length - 1]! += 1;
    }
  }

  const rowFlow =
    items.length === 1
      ? options.isRowFlow(slotRef)
      : (rows.length === 1 && items.length > 1) ||
        (rows.length > 1 && rows.some((n) => n > 1));

  type Candidate = {
    d: number;
    pos: number;
    index: number;
    rect: CanvasRect;
    after: boolean;
  };

  let best: Candidate | null = null;

  for (let pos = 0; pos < items.length; pos++) {
    const item = items[pos]!;
    const { rect, index } = item;

    const leadD = rowFlow
      ? distToSeg(x, y, rect.x, rect.y, rect.y + rect.height, true)
      : distToSeg(x, y, rect.y, rect.x, rect.x + rect.width, false);

    const trailD = rowFlow
      ? distToSeg(x, y, rect.x + rect.width, rect.y, rect.y + rect.height, true)
      : distToSeg(
          x,
          y,
          rect.y + rect.height,
          rect.x,
          rect.x + rect.width,
          false,
        );

    const candidates: Array<{ d: number; after: boolean }> = [
      { d: leadD, after: false },
      { d: trailD, after: true },
    ];

    for (const cand of candidates) {
      if (best !== null && cand.d >= best.d) continue;
      best = { d: cand.d, pos, index, rect, after: cand.after };
    }
  }

  if (!best) return null;

  const item = items[best.pos]!;
  const neighbour = best.after ? items[best.pos + 1] : items[best.pos - 1];
  const insertIndex = best.after ? best.index + 1 : best.index;

  let lineRect: CanvasRect;
  if (rowFlow) {
    let lineX: number;
    if (best.after) {
      if (
        neighbour &&
        Math.abs(
          neighbour.rect.y +
            neighbour.rect.height / 2 -
            (item.rect.y + item.rect.height / 2),
        ) <
          item.rect.height * 0.5
      ) {
        lineX = (item.rect.x + item.rect.width + neighbour.rect.x) / 2;
      } else {
        lineX = item.rect.x + item.rect.width;
      }
    } else {
      if (
        neighbour &&
        Math.abs(
          neighbour.rect.y +
            neighbour.rect.height / 2 -
            (item.rect.y + item.rect.height / 2),
        ) <
          item.rect.height * 0.5
      ) {
        lineX = (neighbour.rect.x + neighbour.rect.width + item.rect.x) / 2;
      } else {
        lineX = item.rect.x;
      }
    }
    lineRect = {
      x: lineX - 1,
      y: item.rect.y,
      width: INSERT_LINE_THICKNESS,
      height: item.rect.height,
    };
    return {
      d: best.d,
      target: target(insertIndex, 'vertical', 'line', lineRect),
    };
  }

  let lineY: number;
  if (best.after) {
    if (
      neighbour &&
      Math.abs(
        neighbour.rect.x +
          neighbour.rect.width / 2 -
          (item.rect.x + item.rect.width / 2),
      ) <
        item.rect.width * 0.5
    ) {
      lineY = (item.rect.y + item.rect.height + neighbour.rect.y) / 2;
    } else {
      lineY = item.rect.y + item.rect.height;
    }
  } else {
    if (
      neighbour &&
      Math.abs(
        neighbour.rect.x +
          neighbour.rect.width / 2 -
          (item.rect.x + item.rect.width / 2),
      ) <
        item.rect.width * 0.5
    ) {
      lineY = (neighbour.rect.y + neighbour.rect.height + item.rect.y) / 2;
    } else {
      lineY = item.rect.y;
    }
  }
  lineRect = {
    x: item.rect.x,
    y: lineY - 1,
    width: item.rect.width,
    height: INSERT_LINE_THICKNESS,
  };
  return {
    d: best.d,
    target: target(insertIndex, 'horizontal', 'line', lineRect),
  };
}

/**
 * The insert target nearest to `(x, y)`: walks from `startBlockId` (or the
 * root) up through its ancestors and, for each, through every slot its
 * component declares that takes the dragged node, and returns the closest
 * gap (a line between children) or empty slot (a box).
 */
export function resolveInsertAt(
  schema: AnyEditorSchema,
  nodes: EditorNodes,
  rootId: string,
  startBlockId: string | null,
  x: number,
  y: number,
  options: ResolveInsertAtOptions,
): InsertTarget | null {
  const { draggedType, draggedId } = options;
  let winner: { d: number; target: InsertTarget } | null = null;

  for (
    let cur: string | null = startBlockId ?? rootId;
    cur;
    cur = nodes[cur]?.parent?.id ?? null
  ) {
    const node = nodes[cur];
    if (!node) continue;
    if (draggedId && isSelfOrDescendant(nodes, draggedId, cur)) continue;
    for (const slot of Object.keys(slotsOf(schema, node.type))) {
      const slotRef = { id: cur, slot };
      if (!accepts(schema, nodes, slotRef, draggedType, draggedId)) continue;
      const res = nearestIn(schema, nodes, rootId, slotRef, x, y, options);
      if (res && (!winner || res.d < winner.d)) winner = res;
    }
  }

  return winner?.target ?? null;
}
