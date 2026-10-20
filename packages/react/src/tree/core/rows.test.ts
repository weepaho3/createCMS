import { describe, expect, it } from 'vitest';

import type { TreeRow } from './rows';

import { treeKeyOf, treeNavigate } from './rows';
import { createTypeAhead, isTypeAheadKey, matchTypeAhead } from './typeahead';

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

/** a (open) > a1, a2; b; c (closed, has children). */
const rows: TreeRow[] = [
  row('a', null, 1, 1, 3, true, true),
  row('a1', 'a', 2, 1, 2, false, false),
  row('a2', 'a', 2, 2, 2, false, false),
  row('b', null, 1, 2, 3, false, false),
  row('c', null, 1, 3, 3, true, false),
];

describe('treeNavigate', () => {
  it('follows the APG tree keys', () => {
    expect(treeNavigate(rows, 'a', 'down')).toEqual({ focus: 'a1' });
    expect(treeNavigate(rows, 'a', 'right')).toEqual({ focus: 'a1' });
    expect(treeNavigate(rows, 'a', 'left')).toEqual({ collapse: 'a' });
    expect(treeNavigate(rows, 'a2', 'left')).toEqual({ focus: 'a' });
    expect(treeNavigate(rows, 'c', 'right')).toEqual({ expand: ['c'] });
    expect(treeNavigate(rows, 'b', 'right')).toEqual({});
    expect(treeNavigate(rows, 'b', 'expandSiblings')).toEqual({
      expand: ['c'],
    });
    expect(treeNavigate(rows, 'b', 'end')).toEqual({ focus: 'c' });
    expect(treeNavigate(rows, 'missing', 'down')).toEqual({ focus: 'a' });
  });

  it('maps keys', () => {
    expect(treeKeyOf('ArrowUp')).toBe('up');
    expect(treeKeyOf('*')).toBe('expandSiblings');
    expect(treeKeyOf('x')).toBeNull();
  });
});

describe('type-ahead', () => {
  it('builds a buffer within 500 ms and matches labels', () => {
    const typeAhead = createTypeAhead();
    expect(typeAhead.push('h', 0)).toBe('h');
    expect(typeAhead.push('a', 300)).toBe('ha');
    expect(typeAhead.push('x', 1000)).toBe('x');
    const labels = ['Hafen.jpg', 'Hamburg.jpg', 'house.png', 'Zebra.gif'];
    expect(matchTypeAhead(labels, 0, 'ham')).toBe(1);
    expect(matchTypeAhead(labels, 0, 'h')).toBe(1);
    expect(matchTypeAhead(labels, 2, 'h')).toBe(0);
    expect(matchTypeAhead(labels, 0, 'q')).toBe(-1);
    expect(isTypeAheadKey('a', { ctrl: false, meta: false, alt: false })).toBe(
      true,
    );
    expect(isTypeAheadKey('a', { ctrl: true, meta: false, alt: false })).toBe(
      false,
    );
  });
});
