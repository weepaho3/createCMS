import { describe, expect, it } from 'vitest';

import type { TreeRow } from './rows';

import { dropInstruction, sameDropInstruction } from './drop';
import { treeSubtreeRange } from './rows';

/**
 * a
 *   a1
 *   a2
 *     a2x
 * b
 */
const rows: TreeRow[] = [
  row('a', null, 1, 1, 2, true, true),
  row('a1', 'a', 2, 1, 2, false, false),
  row('a2', 'a', 2, 2, 2, true, true),
  row('a2x', 'a2', 3, 1, 1, false, false),
  row('b', null, 1, 2, 2, true, false),
];

function row(
  id: string,
  parentId: string | null,
  level: number,
  posinset: number,
  setsize: number,
  hasChildren: boolean,
  expanded: boolean,
): TreeRow {
  return { id, parentId, level, posinset, setsize, hasChildren, expanded };
}

const at = (
  index: number,
  y: number,
  x = 200,
  extra: Partial<Parameters<typeof dropInstruction>[0]> = {},
) =>
  dropInstruction({ rows, index, y, x, indent: 20, ordered: true, ...extra });

describe('dropInstruction', () => {
  it('drops into a row over its middle', () => {
    expect(at(1, 0.5)).toMatchObject({
      kind: 'inside',
      parentId: 'a1',
      index: null,
      line: null,
      overId: 'a1',
      blocked: false,
    });
  });

  it('drops before a row over its top edge', () => {
    expect(at(1, 0.1)).toMatchObject({
      kind: 'between',
      parentId: 'a',
      index: 0,
      line: { rowIndex: 1, edge: 'top', level: 2 },
    });
  });

  it('drops after a row over its bottom edge', () => {
    expect(at(1, 0.9)).toMatchObject({
      parentId: 'a',
      index: 1,
      line: { rowIndex: 1, edge: 'bottom', level: 2 },
    });
  });

  it('drops as the first child below an expanded row', () => {
    expect(at(0, 0.9)).toMatchObject({
      parentId: 'a',
      index: 0,
      line: { rowIndex: 0, edge: 'bottom', level: 2 },
    });
  });

  it('picks the level at the end of a subtree by the inline offset', () => {
    // a2x closes a2 (level 2) and a (level 1); b follows on level 1.
    expect(at(3, 0.9, 50)).toMatchObject({
      parentId: 'a2',
      index: 1,
      line: { level: 3 },
    });
    expect(at(3, 0.9, 25)).toMatchObject({
      parentId: 'a',
      index: 2,
      line: { level: 2 },
    });
    expect(at(3, 0.9, 5)).toMatchObject({
      parentId: null,
      index: 1,
      line: { level: 1 },
    });
  });

  it('never goes above the level of the next row', () => {
    const nested = [
      row('p', null, 1, 1, 1, true, true),
      row('q', 'p', 2, 1, 2, true, true),
      row('q1', 'q', 3, 1, 1, false, false),
      row('r', 'p', 2, 2, 2, false, false),
    ];
    expect(
      dropInstruction({ rows: nested, index: 2, y: 0.9, x: 0, indent: 20 }),
    ).toMatchObject({ parentId: 'p' });
  });

  it('splits the row in halves when it cannot take children', () => {
    const leafless = { canContain: (r: TreeRow) => r.hasChildren };
    expect(at(1, 0.4, 200, leafless)).toMatchObject({
      kind: 'between',
      line: { edge: 'top' },
    });
    expect(at(1, 0.6, 200, leafless)).toMatchObject({
      kind: 'between',
      line: { edge: 'bottom' },
    });
  });

  it('drops into the root level over empty space', () => {
    expect(at(-1, 0.5)).toMatchObject({
      kind: 'inside',
      parentId: null,
      index: 2,
      overId: null,
      line: { rowIndex: 4, edge: 'bottom', level: 1 },
    });
  });

  it('marks refused targets as blocked', () => {
    const result = at(3, 0.5, 200, {
      canDrop: (target) => target.parentId !== 'a2x',
    });
    expect(result).toMatchObject({ parentId: 'a2x', blocked: true });
  });

  it('drops no line and no index in unordered trees', () => {
    expect(at(1, 0.9, 200, { ordered: false })).toMatchObject({
      kind: 'between',
      parentId: 'a',
      index: null,
      line: null,
    });
  });

  it('compares instructions by what they show', () => {
    expect(sameDropInstruction(at(1, 0.4), at(1, 0.5))).toBe(true);
    expect(sameDropInstruction(at(1, 0.1), at(1, 0.5))).toBe(false);
    expect(sameDropInstruction(null, at(1, 0.5))).toBe(false);
  });
});

describe('treeSubtreeRange', () => {
  it('spans a node and its visible descendants', () => {
    expect(treeSubtreeRange(rows, 'a')).toEqual({ start: 0, end: 3 });
    expect(treeSubtreeRange(rows, 'a2')).toEqual({ start: 2, end: 3 });
    expect(treeSubtreeRange(rows, 'b')).toEqual({ start: 4, end: 4 });
    expect(treeSubtreeRange(rows, null)).toEqual({ start: 0, end: 4 });
    expect(treeSubtreeRange(rows, 'missing')).toBeNull();
  });
});
