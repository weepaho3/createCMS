import { describe, expect, it, vi } from 'vitest';

import { flatNodes as nodesOf } from '../core/store/fixtures';
import {
  adjustMoveIndex,
  blockIdAtPoint,
  createDndStore,
  DND_THRESHOLD_PX,
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
    expect(DND_THRESHOLD_PX).toBe(4);
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
