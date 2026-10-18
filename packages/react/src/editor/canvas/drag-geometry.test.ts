import { describe, expect, it } from 'vitest';

import type { InsertTarget } from './insert';

import {
  activationFor,
  autoScrollSpeed,
  contractRect,
  inEdgeBand,
  stickyTarget,
} from './drag-geometry';

const target = (index: number, y: number): InsertTarget => ({
  parent: { id: 'root', slot: 'children' },
  index,
  orientation: 'horizontal',
  variant: 'line',
  rect: { x: 0, y, width: 200, height: 2 },
  allowedTypes: [],
  nested: false,
});

describe('drag geometry', () => {
  it('contracts rects without going negative', () => {
    expect(contractRect({ x: 0, y: 0, width: 100, height: 40 }, 6)).toEqual({
      x: 6,
      y: 6,
      width: 88,
      height: 28,
    });
    expect(contractRect({ x: 0, y: 0, width: 8, height: 8 }, 6).width).toBe(0);
  });

  it('edge band: only tall containers, only near the flow edges, rtl-neutral for rows', () => {
    const tall = { x: 0, y: 0, width: 400, height: 300 };
    expect(inEdgeBand(tall, { x: 200, y: 20 }, 'column')).toBe(true);
    expect(inEdgeBand(tall, { x: 200, y: 280 }, 'column')).toBe(true);
    expect(inEdgeBand(tall, { x: 200, y: 150 }, 'column')).toBe(false);
    expect(
      inEdgeBand({ ...tall, height: 100 }, { x: 200, y: 5 }, 'column'),
    ).toBe(false);
    expect(inEdgeBand(tall, { x: 10, y: 150 }, 'row')).toBe(true);
    expect(inEdgeBand(tall, { x: 390, y: 150 }, 'row')).toBe(true);
  });

  it('hysteresis: jitter of 3 px keeps the target, a 10 px move or a clearly closer one switches', () => {
    const a = target(1, 100);
    const b = target(2, 108);
    const held = stickyTarget(null, a, { x: 50, y: 103 })!;
    expect(held.target).toBe(a);
    for (const dy of [3, -3, 2, -2]) {
      expect(stickyTarget(held, b, { x: 50, y: 103 + dy })!.target).toBe(a);
    }
    expect(stickyTarget(held, b, { x: 50, y: 114 })!.target).toBe(b);
    const far = target(3, 300);
    expect(stickyTarget(held, far, { x: 50, y: 299 })!.target).toBe(far);
  });

  it('auto-scroll speed is per second, ramps to the edge and after entering', () => {
    expect(autoScrollSpeed(500, 1000, 1000)).toBe(0);
    // Zone is min(25 %, 180) = 180 px; full speed from half the zone.
    expect(autoScrollSpeed(90, 1000, 1000)).toBe(900);
    expect(autoScrollSpeed(135, 1000, 1000)).toBe(450);
    expect(autoScrollSpeed(0, 1000, 200)).toBe(450);
    expect(autoScrollSpeed(0, 1000, 1000, true)).toBe(1500);
    // Small scrollers get a proportional zone (25 % of 200 = 50 px).
    expect(autoScrollSpeed(60, 200, 1000)).toBe(0);
    expect(autoScrollSpeed(10, 200, 1000)).toBeGreaterThan(0);
  });

  it('the same speed covers the same distance at 60 and 120 Hz', () => {
    const run = (hz: number) => {
      let scrolled = 0;
      const dt = 1000 / hz;
      for (let t = 0; t < 1000; t += dt) {
        scrolled += (autoScrollSpeed(10, 1000, t) * dt) / 1000;
      }
      return scrolled;
    };
    const slow = run(60);
    expect(Math.abs(slow - run(120)) / slow).toBeLessThan(0.02);
  });

  it('activation per pointer type', () => {
    expect(activationFor('touch', true)).toEqual({
      kind: 'press',
      delayMs: 250,
      tolerancePx: 5,
    });
    expect(activationFor('mouse', true)).toEqual({ kind: 'distance', px: 0 });
    expect(activationFor('mouse', false)).toEqual({ kind: 'distance', px: 5 });
    expect(activationFor('pen', true)).toEqual({ kind: 'distance', px: 5 });
  });
});
