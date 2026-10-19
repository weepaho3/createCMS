/**
 * One visible row of a tree, flattened in display order. A tree renders
 * its rows as siblings (no nested DOM), so rows can be virtualized and one
 * drop line can be positioned against them.
 */
export type TreeRow = {
  id: string;
  /** `null` for a row on the root level. */
  parentId: string | null;
  /** 1-based nesting depth (`aria-level`). */
  level: number;
  /** Number of siblings including this row (`aria-setsize`). */
  setsize: number;
  /** 1-based position among its siblings (`aria-posinset`). */
  posinset: number;
  /** The row may have children (`aria-expanded` is set). */
  hasChildren: boolean;
  expanded: boolean;
};

export type TreeKey =
  | 'up'
  | 'down'
  | 'right'
  | 'left'
  | 'home'
  | 'end'
  | 'expandSiblings';

export type TreeKeyResult = {
  focus?: string;
  expand?: string[];
  collapse?: string;
};

export function treeKeyOf(key: string): TreeKey | null {
  switch (key) {
    case 'ArrowUp':
      return 'up';
    case 'ArrowDown':
      return 'down';
    case 'ArrowRight':
      return 'right';
    case 'ArrowLeft':
      return 'left';
    case 'Home':
      return 'home';
    case 'End':
      return 'end';
    case '*':
      return 'expandSiblings';
    default:
      return null;
  }
}

/**
 * APG tree view keys: Up/Down move between visible rows, Right opens a
 * closed node or moves to its first child, Left closes an open node or
 * moves to its parent, Home/End go to the first/last row, `*` opens every
 * sibling. Right and Left are swapped by the caller for RTL.
 */
export function treeNavigate(
  rows: readonly TreeRow[],
  focusId: string,
  key: TreeKey,
): TreeKeyResult {
  const index = rows.findIndex((row) => row.id === focusId);
  if (index === -1) return rows[0] ? { focus: rows[0].id } : {};
  const row = rows[index];
  switch (key) {
    case 'up':
      return index > 0 ? { focus: rows[index - 1].id } : {};
    case 'down':
      return index < rows.length - 1 ? { focus: rows[index + 1].id } : {};
    case 'home':
      return { focus: rows[0].id };
    case 'end':
      return { focus: rows[rows.length - 1].id };
    case 'right':
      if (!row.hasChildren) return {};
      if (!row.expanded) return { expand: [row.id] };
      return rows[index + 1]?.parentId === row.id
        ? { focus: rows[index + 1].id }
        : {};
    case 'left':
      if (row.expanded) return { collapse: row.id };
      return row.parentId ? { focus: row.parentId } : {};
    case 'expandSiblings':
      return {
        expand: rows
          .filter(
            (other) =>
              other.parentId === row.parentId &&
              other.hasChildren &&
              !other.expanded,
          )
          .map((other) => other.id),
      };
  }
}

/**
 * The rows `parentId` spans: its own row and every visible descendant
 * (`start` to `end`, inclusive). The root level spans all rows. `null` when
 * `parentId` is not visible.
 */
export function treeSubtreeRange(
  rows: readonly TreeRow[],
  parentId: string | null,
): { start: number; end: number } | null {
  if (parentId === null) {
    return rows.length > 0 ? { start: 0, end: rows.length - 1 } : null;
  }
  const start = rows.findIndex((row) => row.id === parentId);
  if (start === -1) return null;
  const level = rows[start].level;
  let end = start;
  while (end + 1 < rows.length && rows[end + 1].level > level) end += 1;
  return { start, end };
}
