import { describe, expect, it, vi } from 'vitest';

import type { EditorNodes } from '../core/store';

import { flatNodes as nodesOf } from '../core/store/fixtures';
import {
  adjustMoveIndex,
  blockIdAtPoint,
  createDndStore,
  DND_THRESHOLD_PX,
  planMultiMove,
} from './dnd';

const rootId = 'root_1';

function rect(x: number, y: number, width: number, height: number) {
  return { x, y, width, height };
}

describe('adjustMoveIndex same parent earlier to later', () => {
  it('moves a to index 2 as 1 and to index 3 as 2', () => {
    const nodes = nodesOf({
      [rootId]: { type: 'root', parentId: null, childIds: ['a', 'b', 'c'] },
      a: { type: 'cell', parentId: rootId, childIds: [] },
      b: { type: 'cell', parentId: rootId, childIds: [] },
      c: { type: 'cell', parentId: rootId, childIds: [] },
    });
    expect(
      adjustMoveIndex(nodes, 'a', { id: rootId, slot: 'children' }, 2),
    ).toBe(1);
    expect(
      adjustMoveIndex(nodes, 'a', { id: rootId, slot: 'children' }, 3),
    ).toBe(2);
  });
});

describe('adjustMoveIndex same parent later to earlier', () => {
  it('moves c to index 0 as 0 and to index 1 as 1', () => {
    const nodes = nodesOf({
      [rootId]: { type: 'root', parentId: null, childIds: ['a', 'b', 'c'] },
      a: { type: 'cell', parentId: rootId, childIds: [] },
      b: { type: 'cell', parentId: rootId, childIds: [] },
      c: { type: 'cell', parentId: rootId, childIds: [] },
    });
    expect(
      adjustMoveIndex(nodes, 'c', { id: rootId, slot: 'children' }, 0),
    ).toBe(0);
    expect(
      adjustMoveIndex(nodes, 'c', { id: rootId, slot: 'children' }, 1),
    ).toBe(1);
  });
});

describe('adjustMoveIndex cross parent', () => {
  it('leaves the target index unchanged', () => {
    const nodes = nodesOf({
      [rootId]: { type: 'root', parentId: null, childIds: ['a', 'sec'] },
      a: { type: 'cell', parentId: rootId, childIds: [] },
      sec: { type: 'stack', parentId: rootId, childIds: ['x', 'y'] },
      x: { type: 'cell', parentId: 'sec', childIds: [] },
      y: { type: 'cell', parentId: 'sec', childIds: [] },
    });
    expect(
      adjustMoveIndex(nodes, 'a', { id: 'sec', slot: 'children' }, 2),
    ).toBe(2);
  });
});

describe('blockIdAtPoint smallest containing', () => {
  it('picks the nested child at (20, 20)', () => {
    const nodes = nodesOf({
      [rootId]: { type: 'root', parentId: null, childIds: ['sec'] },
      sec: { type: 'stack', parentId: rootId, childIds: ['child'] },
      child: { type: 'cell', parentId: 'sec', childIds: [] },
    });
    const getRect = (id: string) => {
      if (id === 'sec') return rect(0, 0, 200, 200);
      if (id === 'child') return rect(10, 10, 40, 40);
      return null;
    };
    expect(blockIdAtPoint(nodes, rootId, 20, 20, getRect)).toBe('child');
  });
});

describe('blockIdAtPoint nearest when outside', () => {
  it('picks the child nearest to (50, 10)', () => {
    const nodes = nodesOf({
      [rootId]: { type: 'root', parentId: null, childIds: ['child'] },
      child: { type: 'cell', parentId: rootId, childIds: [] },
    });
    const getRect = (id: string) => {
      if (id === 'child') return rect(0, 80, 100, 40);
      return null;
    };
    expect(blockIdAtPoint(nodes, rootId, 50, 10, getRect)).toBe('child');
  });
});

describe('dnd store threshold', () => {
  it('starts the session only after 4 px', () => {
    const dnd = createDndStore();
    const session = { kind: 'move' as const, id: 'a' };
    dnd.beginGesture({ x: 0, y: 0 });
    expect(dnd.moveGesture({ x: 2, y: 0 }, session)).toBe(false);
    expect(dnd.getSession()).toBeNull();
    expect(dnd.moveGesture({ x: 5, y: 0 }, session)).toBe(true);
    expect(dnd.getSession()).toEqual(session);
    dnd.end();
    expect(dnd.getSession()).toBeNull();
  });

  it('uses the configured threshold constant', () => {
    expect(DND_THRESHOLD_PX).toBe(5);
  });
});

describe('subscribeSession does not fire on setDropTarget', () => {
  it('notifies session listeners only when the session changes', () => {
    const dnd = createDndStore();
    const sessionListener = vi.fn();
    const targetListener = vi.fn();
    dnd.subscribeSession(sessionListener);
    dnd.subscribeTarget(targetListener);
    dnd.beginGesture({ x: 0, y: 0 });
    dnd.moveGesture({ x: 8, y: 0 }, { kind: 'move', id: 'a' });
    const afterStart = sessionListener.mock.calls.length;
    dnd.setDropTarget({
      parent: { id: rootId, slot: 'children' },
      index: 0,
      orientation: 'horizontal',
      variant: 'box',
      rect: rect(0, 0, 10, 10),
      allowedTypes: [],
      nested: false,
    });
    expect(sessionListener.mock.calls.length).toBe(afterStart);
    expect(targetListener.mock.calls.length).toBeGreaterThan(afterStart);
    dnd.end();
    expect(sessionListener.mock.calls.length).toBe(afterStart + 1);
  });
});

describe('planMultiMove', () => {
  /** Applies store `move` semantics: leave the old place, insert at `index`. */
  function apply(
    slots: Record<string, string[]>,
    target: string,
    plan: Array<{ id: string; index: number }>,
  ) {
    const next = Object.fromEntries(
      Object.entries(slots).map(([key, ids]) => [key, [...ids]]),
    );
    for (const step of plan) {
      for (const ids of Object.values(next)) {
        const at = ids.indexOf(step.id);
        if (at >= 0) ids.splice(at, 1);
      }
      next[target]!.splice(step.index, 0, step.id);
    }
    return next;
  }

  function slotNodes(slots: Record<string, string[]>): EditorNodes {
    const nodes: Record<string, unknown> = {
      root: { id: 'root', type: 'root', props: {}, parent: null, slots },
    };
    for (const [slot, ids] of Object.entries(slots)) {
      for (const id of ids) {
        nodes[id] = {
          id,
          type: 'cell',
          props: {},
          parent: { id: 'root', slot },
          slots: {},
        };
      }
    }
    return nodes as EditorNodes;
  }

  it('lands non-adjacent blocks next to each other in their order', () => {
    const slots = { a: ['x1', 'x2', 'x3', 'x4', 'x5'] };
    const plan = planMultiMove(
      slotNodes(slots),
      ['x1', 'x3', 'x5'],
      { id: 'root', slot: 'a' },
      4,
    );
    expect(apply(slots, 'a', plan).a).toEqual(['x2', 'x4', 'x1', 'x3', 'x5']);
  });

  it('property: any selection, any target keeps the others in order and the run contiguous', () => {
    let seed = 7;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    for (let round = 0; round < 300; round++) {
      const all = Array.from({ length: 2 + rand(8) }, (_, i) => `n${i}`);
      const split = rand(all.length + 1);
      const slots = { a: all.slice(0, split), b: all.slice(split) };
      const ids = all.filter(() => rand(3) === 0);
      if (ids.length === 0) continue;
      const target = rand(2) === 0 ? 'a' : 'b';
      const index = rand(slots[target].length + 1);
      const result = apply(
        slots,
        target,
        planMultiMove(
          slotNodes(slots),
          ids,
          { id: 'root', slot: target },
          index,
        ),
      );
      const run = result[target]!.filter((id) => ids.includes(id));
      expect(run).toEqual(ids);
      const start = result[target]!.indexOf(ids[0]!);
      expect(result[target]!.slice(start, start + ids.length)).toEqual(ids);
      const others = slots[target].filter((id) => !ids.includes(id));
      expect(result[target]!.filter((id) => !ids.includes(id))).toEqual(others);
      // The run sits where the pointer was among the others.
      const before = slots[target]
        .slice(0, index)
        .filter((id) => !ids.includes(id)).length;
      expect(start).toBe(before);
    }
  });
});
