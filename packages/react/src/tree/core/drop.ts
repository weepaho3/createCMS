import type { TreeRow } from './rows';

/** Where dropped nodes go. */
export type TreeDropTarget = {
  /** The node that receives the drop; `null` is the root level. */
  parentId: string | null;
  /**
   * In an ordered tree, the child index the first dropped node takes
   * (counted before the dragged nodes leave their place). `null` when the
   * drop lands on a node (append) or the tree is unordered.
   */
  index: number | null;
};

/** Where the drop line of an ordered tree is drawn. */
export type TreeDropLine = {
  /** The row the line touches. */
  rowIndex: number;
  edge: 'top' | 'bottom';
  /** 1-based level the line is indented to: the level of the dropped node. */
  level: number;
};

export type TreeDropInstruction = TreeDropTarget & {
  /** `inside`: onto a row or empty tree space; `between`: next to rows. */
  kind: 'inside' | 'between';
  /** The row under the pointer; `null` over empty tree space. */
  overId: string | null;
  /** Ordered trees between rows only; unordered trees mark the receiving node instead. */
  line: TreeDropLine | null;
  /** `canDrop` refused the target: show it as blocked and refuse the drop. */
  blocked: boolean;
};

export type TreeDropInput = {
  rows: readonly TreeRow[];
  /** Index of the row under the pointer; `-1` over empty tree space. */
  index: number;
  /** Pointer offset from the row's top edge, as a share of its height (0 to 1). */
  y: number;
  /**
   * Pointer offset in px from the row's inline start edge (the tree's
   * start edge, not the indented label). The caller mirrors it for RTL.
   */
  x: number;
  /** Indentation per level in px. */
  indent: number;
  /** Siblings keep a user-defined order (a line is drawn); otherwise the receiving node is marked. @default false */
  ordered?: boolean;
  /** Share of the row height at its top and bottom that drops next to it. @default 0.25 */
  edge?: number;
  /** Whether a row can take children at all. @default every row */
  canContain?: (row: TreeRow) => boolean;
  /** Validates a target (a node into itself, schema rules). @default every target */
  canDrop?: (target: TreeDropTarget) => boolean;
};

/** The row at `level` that contains `rows[index]` (itself or an ancestor). */
function ancestorAt(
  rows: readonly TreeRow[],
  index: number,
  level: number,
): TreeRow {
  let i = index;
  while (i > 0 && rows[i].level > level) i -= 1;
  return rows[i];
}

/**
 * Turns a pointer position over a tree into a drop instruction, following
 * file trees (VS Code, Finder) and headless-tree:
 *
 * - top edge: next to the row, before it;
 * - middle: into the row (rows that cannot take children split in halves);
 * - bottom edge: after the row, or as the first child of an expanded row;
 * - bottom edge of the last row of a subtree, with the pointer left of the
 *   row's indentation: after an ancestor; `x` picks which one, so a drop
 *   can leave a nested group at any level it closes;
 * - empty tree space: into the root level.
 *
 * Unordered trees get the same targets with `index: null` and no line.
 */
export function dropInstruction(input: TreeDropInput): TreeDropInstruction {
  const {
    rows,
    index,
    y,
    x,
    indent,
    ordered = false,
    edge = 0.25,
    canContain = () => true,
    canDrop = () => true,
  } = input;
  const finish = (
    kind: TreeDropInstruction['kind'],
    target: TreeDropTarget,
    line: TreeDropLine | null,
    overId: string | null,
  ): TreeDropInstruction => {
    const placed = ordered ? target : { ...target, index: null };
    return {
      ...placed,
      kind,
      overId,
      line: ordered ? line : null,
      blocked: !canDrop(placed),
    };
  };

  const row = index >= 0 ? rows[index] : undefined;
  if (!row) {
    const roots = rows.filter((r) => r.parentId === null).length;
    const last = rows.length - 1;
    return finish(
      'inside',
      { parentId: null, index: roots },
      last >= 0 ? { rowIndex: last, edge: 'bottom', level: 1 } : null,
      null,
    );
  }

  // A row that can never take children splits in halves; a refused drop
  // into one that can is shown as blocked, not redirected to its parent.
  const share = canContain(row) ? Math.min(Math.max(edge, 0), 0.5) : 0.5;

  if (y < share) {
    return finish(
      'between',
      { parentId: row.parentId, index: row.posinset - 1 },
      { rowIndex: index, edge: 'top', level: row.level },
      row.id,
    );
  }
  if (y >= 1 - share) {
    const next = rows[index + 1];
    if (row.expanded && next?.parentId === row.id) {
      return finish(
        'between',
        { parentId: row.id, index: 0 },
        { rowIndex: index, edge: 'bottom', level: row.level + 1 },
        row.id,
      );
    }
    const indentEnd = (row.level - 1) * indent;
    if (row.posinset === row.setsize && x < indentEnd) {
      const minLevel = next?.level ?? 1;
      const level = Math.min(
        Math.max(Math.floor(x / indent) + 1, minLevel),
        row.level,
      );
      const ancestor = ancestorAt(rows, index, level);
      return finish(
        'between',
        { parentId: ancestor.parentId, index: ancestor.posinset },
        { rowIndex: index, edge: 'bottom', level },
        row.id,
      );
    }
    return finish(
      'between',
      { parentId: row.parentId, index: row.posinset },
      { rowIndex: index, edge: 'bottom', level: row.level },
      row.id,
    );
  }
  return finish('inside', { parentId: row.id, index: null }, null, row.id);
}

/** Two instructions show the same thing (skip a re-render on `dragover`). */
export function sameDropInstruction(
  a: TreeDropInstruction | null,
  b: TreeDropInstruction | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.kind === b.kind &&
    a.parentId === b.parentId &&
    a.index === b.index &&
    a.overId === b.overId &&
    a.blocked === b.blocked &&
    a.line?.rowIndex === b.line?.rowIndex &&
    a.line?.edge === b.line?.edge &&
    a.line?.level === b.line?.level
  );
}
