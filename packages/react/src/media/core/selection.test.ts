import { describe, expect, it } from 'vitest';

import type { SelectionState } from './selection';

import { layout } from './layout';
import {
  applyMarquee,
  autoScrollDelta,
  marqueeActivated,
  marqueeHits,
  marqueeModeOf,
  marqueeRect,
} from './marquee';
import {
  bulkTarget,
  clearSelection,
  createSelection,
  dragIds,
  extendSelection,
  isSelected,
  nextFocusAfterRemoval,
  reconcileSelection,
  selectAllLoaded,
  selectAllMatching,
  selectionClick,
  selectionCount,
  toggleSelection,
} from './selection';

const order = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];

function clicks(
  ...steps: [string, { range?: boolean; toggle?: boolean }?][]
): SelectionState {
  return steps.reduce(
    (state, [id, modifiers]) => selectionClick(state, order, id, modifiers),
    createSelection('multiple'),
  );
}

describe('selection state machine', () => {
  it('replaces on a plain click', () => {
    expect(clicks(['b'], ['d']).selected).toEqual(['d']);
  });

  it('toggles with Cmd/Ctrl and moves the anchor', () => {
    const state = clicks(
      ['b'],
      ['d', { toggle: true }],
      ['b', { toggle: true }],
    );
    expect(state.selected).toEqual(['d']);
    expect(state.anchor).toBe('b');
  });

  it('replaces the previous Shift range like Finder', () => {
    const first = clicks(['c'], ['f', { range: true }]);
    expect(first.selected).toEqual(['c', 'd', 'e', 'f']);
    const shrunk = selectionClick(first, order, 'd', { range: true });
    expect(shrunk.selected).toEqual(['c', 'd']);
    const flipped = selectionClick(shrunk, order, 'a', { range: true });
    expect(flipped.selected).toEqual(['a', 'b', 'c']);
  });

  it('keeps Cmd-selected items outside the Shift range', () => {
    const state = clicks(
      ['a'],
      ['g', { toggle: true }],
      ['e', { range: true }],
    );
    expect(state.anchor).toBe('g');
    expect([...state.selected].sort()).toEqual(['a', 'e', 'f', 'g']);
  });

  it('adds a range with Shift+Cmd', () => {
    const state = clicks(
      ['a'],
      ['c', { toggle: true }],
      ['e', { range: true, toggle: true }],
    );
    expect([...state.selected].sort()).toEqual(['a', 'c', 'd', 'e']);
  });

  it('honours single and none modes', () => {
    const single = createSelection('single');
    const once = selectionClick(single, order, 'b', { range: true });
    expect(selectionClick(once, order, 'd', { toggle: true }).selected).toEqual(
      ['d'],
    );
    expect(selectionClick(once, order, 'b', { toggle: true }).selected).toEqual(
      [],
    );
    const none = selectionClick(createSelection('none'), order, 'b');
    expect(none.selected).toEqual([]);
    expect(none.focus).toBe('b');
  });

  it('extends from the focus with Shift+Arrow when there is no anchor', () => {
    const focused = { ...createSelection('multiple'), focus: 'b' };
    expect(extendSelection(focused, order, 'd').selected).toEqual([
      'b',
      'c',
      'd',
    ]);
  });

  it('selects all loaded and all matching with exceptions', () => {
    const all = selectAllLoaded(createSelection('multiple'), order);
    expect(all.selected).toEqual(order);
    const matching = selectAllMatching(
      createSelection('multiple'),
      { sort: 'created_desc' },
      order,
    );
    const without = toggleSelection(matching, 'c');
    expect(isSelected(without, 'c')).toBe(false);
    expect(isSelected(without, 'zzz')).toBe(true);
    expect(selectionCount(without, 312)).toBe(311);
    expect(bulkTarget(without)).toEqual({
      allMatching: { query: { sort: 'created_desc' }, except: ['c'] },
    });
    expect(clearSelection(without).allMatching).toBeNull();
  });

  it('drops hidden ids unless asked to keep and count them', () => {
    const state = clicks(
      ['a'],
      ['c', { toggle: true }],
      ['e', { toggle: true }],
    );
    expect(reconcileSelection(state, ['a', 'b']).state.selected).toEqual(['a']);
    const kept = reconcileSelection(state, ['a', 'b'], { keepHidden: true });
    expect(kept.state.selected).toEqual(['a', 'c', 'e']);
    expect(kept.hidden).toBe(2);
  });

  it('drags the selection or only the unselected item', () => {
    const state = clicks(['a'], ['b', { toggle: true }]);
    expect(dragIds(state, 'b')).toEqual(['a', 'b']);
    expect(dragIds(state, 'f')).toEqual(['f']);
  });

  it('focuses the next, else the previous item after a removal', () => {
    expect(nextFocusAfterRemoval(order, ['c', 'd'], 'c')).toBe('e');
    expect(nextFocusAfterRemoval(order, ['f', 'g'], 'g')).toBe('e');
    expect(nextFocusAfterRemoval(['a'], ['a'], 'a')).toBeNull();
  });
});

describe('marquee', () => {
  const ids = Array.from({ length: 300 }, (_, i) => `a${i}`);
  const grid = layout(
    { width: 500 },
    ids.map((id) => ({ id })),
    { minCell: 150, gap: 10 },
  );

  it('activates only after a few pixels', () => {
    expect(marqueeActivated({ x: 0, y: 0 }, { x: 3, y: 3 })).toBe(false);
    expect(marqueeActivated({ x: 0, y: 0 }, { x: 5, y: 5 })).toBe(true);
  });

  it('hits rects outside the mounted window', () => {
    const rect = marqueeRect({ x: 400, y: 9000 }, { x: 10, y: 8600 });
    const hits = marqueeHits(grid, ids, rect);
    expect(hits.length).toBeGreaterThan(3);
    expect(hits.every((id) => Number(id.slice(1)) > 100)).toBe(true);
  });

  it('replaces, adds or toggles from the selection at the start', () => {
    const base = {
      ...createSelection('multiple' as const),
      selected: ['x', 'a1'],
    };
    expect(applyMarquee(base, ['a1', 'a2'], 'replace').selected).toEqual([
      'a1',
      'a2',
    ]);
    expect(applyMarquee(base, ['a1', 'a2'], 'add').selected).toEqual([
      'x',
      'a1',
      'a2',
    ]);
    expect(applyMarquee(base, ['a1', 'a2'], 'toggle').selected).toEqual([
      'x',
      'a2',
    ]);
    expect(marqueeModeOf({ range: true })).toBe('add');
    expect(marqueeModeOf({ toggle: true, range: true })).toBe('toggle');
  });

  it('auto-scrolls in a band of min(25%, 180 px) and ramps up over 400 ms', () => {
    // 1000 px viewport: band is 180 px
    expect(autoScrollDelta(500, 0, 1000, 1000)).toBe(0);
    expect(autoScrollDelta(10, 0, 1000, 1000)).toBeLessThan(0);
    expect(autoScrollDelta(990, 0, 1000, 1000)).toBeGreaterThan(0);
    expect(autoScrollDelta(990, 0, 1000, 0)).toBe(0);
    expect(Math.abs(autoScrollDelta(990, 0, 1000, 200))).toBeLessThan(
      Math.abs(autoScrollDelta(990, 0, 1000, 400)),
    );
    // 200 px viewport: band is 50 px
    expect(autoScrollDelta(60, 0, 200, 1000)).toBe(0);
    expect(autoScrollDelta(40, 0, 200, 1000)).toBeLessThan(0);
  });
});
