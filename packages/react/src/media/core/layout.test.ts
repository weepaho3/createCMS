import { describe, expect, it } from 'vitest';

import type { LayoutItem, LayoutMode, NavigationKey } from './layout';

import {
  columnCount,
  itemsInRect,
  layout,
  navigate,
  navigationKeyOf,
  visibleRows,
} from './layout';

function items(count: number, seed = 1): LayoutItem[] {
  let s = seed;
  const next = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  return Array.from({ length: count }, (_, i) => ({
    id: `a${i}`,
    width: i % 7 === 3 ? null : Math.round(400 + next() * 3600),
    height: i % 7 === 3 ? null : Math.round(300 + next() * 3000),
  }));
}

const MODES: LayoutMode[] = ['grid', 'justified', 'masonry', 'list'];
const KEYS: NavigationKey[] = [
  'left',
  'right',
  'up',
  'down',
  'rowStart',
  'rowEnd',
  'first',
  'last',
  'pageUp',
  'pageDown',
];

describe('layout', () => {
  it('derives grid columns from width, min cell and gap', () => {
    for (let width = 0; width <= 2000; width += 37) {
      for (const minCell of [80, 120, 160, 240]) {
        const columns = columnCount(width, minCell, 8);
        expect(columns).toBeGreaterThanOrEqual(1);
        if (columns > 1) {
          expect(columns * minCell + (columns - 1) * 8).toBeLessThanOrEqual(
            width,
          );
        }
        expect((columns + 1) * minCell + columns * 8).toBeGreaterThan(width);
      }
    }
  });

  it('gives a phone 3 to 4 columns with a small minimum cell', () => {
    expect(layout({ width: 360 }, items(10), { minCell: 100 }).columns).toBe(3);
    expect(layout({ width: 430 }, items(10), { minCell: 96 }).columns).toBe(4);
  });

  it('lays out a grid in rows with square or 4:3 cells', () => {
    const square = layout({ width: 500 }, items(7), { minCell: 150, gap: 10 });
    expect(square.columns).toBe(3);
    expect(square.rows.map((r) => r.items)).toEqual([
      [0, 1, 2],
      [3, 4, 5],
      [6],
    ]);
    expect(square.rects[4]).toEqual({
      x: 170,
      y: 170,
      width: 160,
      height: 160,
    });
    const wide = layout({ width: 500 }, items(3), {
      minCell: 150,
      gap: 10,
      aspect: '4:3',
    });
    expect(wide.rects[0].height).toBe(120);
  });

  it('fills justified rows to the width at about the target height', () => {
    const result = layout({ width: 1000 }, items(60), {
      mode: 'justified',
      gap: 4,
      targetRowHeight: 200,
    });
    for (const row of result.rows.slice(0, -1)) {
      const last = result.rects[row.items[row.items.length - 1]];
      expect(last.x + last.width).toBeCloseTo(1000, 5);
      expect(row.height).toBeLessThanOrEqual(240);
    }
    const lastRow = result.rows[result.rows.length - 1];
    expect(lastRow.height).toBeLessThanOrEqual(200);
  });

  it('places masonry items in the shortest lane', () => {
    const result = layout({ width: 660 }, items(30), {
      mode: 'masonry',
      minCell: 200,
      gap: 30,
    });
    expect(result.columns).toBe(3);
    const lanes = result.laneOf!;
    const bottoms = [0, 0, 0];
    result.rects.forEach((rect, i) => {
      expect(rect.y).toBeCloseTo(bottoms[lanes[i]], 5);
      bottoms[lanes[i]] += rect.height + 30;
    });
  });

  it('mirrors x for right-to-left', () => {
    const ltr = layout({ width: 500 }, items(3), { minCell: 150, gap: 10 });
    const rtl = layout({ width: 500 }, items(3), {
      minCell: 150,
      gap: 10,
      rtl: true,
    });
    expect(rtl.rects[0].x).toBe(500 - ltr.rects[0].x - ltr.rects[0].width);
  });

  it('never measures: the same input gives the same output', () => {
    const a = layout({ width: 900 }, items(50), { mode: 'justified' });
    const b = layout({ width: 900 }, items(50), { mode: 'justified' });
    expect(a).toEqual(b);
  });
});

describe('navigate', () => {
  it('never leaves the items, in every mode and width', () => {
    for (const mode of MODES) {
      for (const count of [1, 2, 7, 23]) {
        for (const width of [0, 320, 1000]) {
          const result = layout({ width }, items(count), { mode });
          for (let i = 0; i < count; i++) {
            for (const key of KEYS) {
              for (const rtl of [false, true]) {
                const next = navigate(result, i, key, {
                  rtl,
                  viewportHeight: 600,
                });
                expect(next).toBeGreaterThanOrEqual(0);
                expect(next).toBeLessThan(count);
              }
            }
          }
        }
      }
    }
  });

  it('moves a whole row up and down in a grid and clamps into a short last row', () => {
    const result = layout({ width: 500 }, items(7), { minCell: 150, gap: 10 });
    expect(navigate(result, 1, 'down')).toBe(4);
    expect(navigate(result, 4, 'up')).toBe(1);
    expect(navigate(result, 5, 'down')).toBe(6);
    expect(navigate(result, 6, 'down')).toBe(6);
    expect(navigate(result, 1, 'up')).toBe(1);
  });

  it('wraps left and right across rows and mirrors them for RTL', () => {
    const result = layout({ width: 500 }, items(7), { minCell: 150, gap: 10 });
    expect(navigate(result, 2, 'right')).toBe(3);
    expect(navigate(result, 3, 'left')).toBe(2);
    expect(navigate(result, 2, 'left', { rtl: true })).toBe(3);
  });

  it('jumps within the row with Home/End and to the ends with Ctrl', () => {
    const result = layout({ width: 500 }, items(7), { minCell: 150, gap: 10 });
    expect(navigate(result, 4, 'rowStart')).toBe(3);
    expect(navigate(result, 4, 'rowEnd')).toBe(5);
    expect(navigate(result, 4, 'first')).toBe(0);
    expect(navigate(result, 4, 'last')).toBe(6);
    expect(navigationKeyOf('Home', true)).toBe('first');
    expect(navigationKeyOf('End')).toBe('rowEnd');
  });

  it('moves up and down by one row in every layout mode', () => {
    for (const mode of MODES) {
      const result = layout({ width: 900 }, items(40), { mode, minCell: 160 });
      const start = result.rows[2].items[0];
      const down = navigate(result, start, 'down');
      if (mode === 'masonry') {
        expect(result.laneOf![down]).toBe(result.laneOf![start]);
        expect(result.rects[down].y).toBeGreaterThan(result.rects[start].y);
      } else {
        expect(result.rowOf[down]).toBe(result.rowOf[start] + 1);
      }
      expect(navigate(result, down, 'up')).toBeLessThan(down);
    }
  });

  it('picks the closest horizontal center in justified rows', () => {
    const result = layout(
      { width: 1000 },
      [
        { id: 'a', width: 400, height: 200 },
        { id: 'b', width: 600, height: 200 },
        { id: 'c', width: 200, height: 200 },
        { id: 'd', width: 200, height: 200 },
        { id: 'e', width: 200, height: 200 },
        { id: 'f', width: 200, height: 200 },
        { id: 'g', width: 200, height: 200 },
      ],
      { mode: 'justified', gap: 0 },
    );
    expect(result.rows[0].items).toEqual([0, 1]);
    // b's center is at 700; in the next row d (300-500) and e (500-700) and f (700-900)
    const down = navigate(result, 1, 'down');
    expect(['e', 'f']).toContain(['a', 'b', 'c', 'd', 'e', 'f', 'g'][down]);
  });

  it('pages by the rows that fit the viewport', () => {
    const result = layout({ width: 500 }, items(60), { minCell: 150, gap: 10 });
    // rows are 160 + 10; a 520 px viewport fits 3 rows
    expect(navigate(result, 0, 'pageDown', { viewportHeight: 520 })).toBe(9);
  });
});

describe('visible rows and hit tests', () => {
  it('mounts the rows in view plus the overscan', () => {
    const result = layout({ width: 500 }, items(300), {
      minCell: 150,
      gap: 10,
    });
    const [first, last] = visibleRows(result, 1700, 600, 2);
    expect(first).toBe(8);
    expect(last).toBe(15);
    expect(visibleRows(layout({ width: 500 }, [], {}), 0, 600)).toEqual([
      0, -1,
    ]);
  });

  it('hits items outside the mounted window', () => {
    const result = layout({ width: 500 }, items(300), {
      minCell: 150,
      gap: 10,
    });
    const hits = itemsInRect(result, {
      x: 0,
      y: 5000,
      width: 200,
      height: 400,
    });
    expect(hits.length).toBeGreaterThan(0);
    for (const i of hits) expect(result.rects[i].y).toBeGreaterThan(4500);
  });
});
