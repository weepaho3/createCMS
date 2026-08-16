// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';

import type { EditorNodes } from '../store';

import { getPlacement } from '../schema/placement';
import { storeSchema } from '../store/fixtures';
import {
  INSERT_BOX_PAD,
  resolveInsertAt,
  type ResolveInsertAtOptions,
} from './insert';

const rootId = 'root_1';

function nodesOf(
  entries: Record<
    string,
    {
      type: string;
      parentId: string | null;
      childIds: string[];
    }
  >,
): EditorNodes {
  const out: Record<
    string,
    {
      id: string;
      type: string;
      parentId: string | null;
      childIds: string[];
      properties: Record<string, unknown>;
    }
  > = {};
  for (const [id, node] of Object.entries(entries)) {
    out[id] = {
      id,
      type: node.type,
      parentId: node.parentId,
      childIds: [...node.childIds],
      properties: {},
    };
  }
  return out;
}

function rect(
  x: number,
  y: number,
  width: number,
  height: number,
): { x: number; y: number; width: number; height: number } {
  return { x, y, width, height };
}

function resolve(
  nodes: EditorNodes,
  startBlockId: string | null,
  x: number,
  y: number,
  rects: Record<string, ReturnType<typeof rect>>,
  extra?: Partial<ResolveInsertAtOptions>,
) {
  const placement = getPlacement(storeSchema);
  const getRect = (id: string) => rects[id] ?? null;
  return resolveInsertAt(nodes, placement, rootId, startBlockId, x, y, {
    getRect,
    isRowFlow: () => false,
    ...extra,
  });
}

describe('resolveInsertAt', () => {
  it('column before / between / after', () => {
    const nodes = nodesOf({
      [rootId]: { type: 'root', parentId: null, childIds: ['a', 'b', 'c'] },
      a: { type: 'heading', parentId: rootId, childIds: [] },
      b: { type: 'heading', parentId: rootId, childIds: [] },
      c: { type: 'heading', parentId: rootId, childIds: [] },
    });
    const rects = {
      a: rect(0, 0, 100, 40),
      b: rect(0, 40, 100, 40),
      c: rect(0, 80, 100, 40),
    };

    const before = resolve(nodes, 'a', 50, 0, rects);
    expect(before?.index).toBe(0);
    expect(before?.variant).toBe('line');
    expect(before?.orientation).toBe('horizontal');

    const between = resolve(nodes, 'b', 50, 40, rects);
    expect(between?.index).toBe(1);
    expect(between?.variant).toBe('line');
    expect(between?.orientation).toBe('horizontal');

    const after = resolve(nodes, 'c', 50, 120, rects);
    expect(after?.index).toBe(3);
    expect(after?.variant).toBe('line');
    expect(after?.orientation).toBe('horizontal');
  });

  it('row before / between / after', () => {
    const nodes = nodesOf({
      [rootId]: { type: 'root', parentId: null, childIds: ['a', 'b', 'c'] },
      a: { type: 'heading', parentId: rootId, childIds: [] },
      b: { type: 'heading', parentId: rootId, childIds: [] },
      c: { type: 'heading', parentId: rootId, childIds: [] },
    });
    const rects = {
      a: rect(0, 0, 80, 40),
      b: rect(80, 0, 80, 40),
      c: rect(160, 0, 80, 40),
    };

    const before = resolve(nodes, 'a', 0, 20, rects);
    expect(before?.index).toBe(0);
    expect(before?.orientation).toBe('vertical');

    const between = resolve(nodes, 'b', 80, 20, rects);
    expect(between?.index).toBe(1);
    expect(between?.orientation).toBe('vertical');

    const after = resolve(nodes, 'c', 240, 20, rects);
    expect(after?.index).toBe(3);
    expect(after?.orientation).toBe('vertical');
  });

  it('empty container box', () => {
    const nodes = nodesOf({
      [rootId]: { type: 'root', parentId: null, childIds: ['sec'] },
      sec: { type: 'section', parentId: rootId, childIds: [] },
    });
    const parentRect = rect(0, 0, 200, 100);
    const target = resolve(nodes, 'sec', 100, 50, { sec: parentRect });
    expect(target?.variant).toBe('box');
    expect(target?.index).toBe(0);
    expect(target?.orientation).toBe('horizontal');
    expect(target?.rect).toEqual({
      x: INSERT_BOX_PAD,
      y: INSERT_BOX_PAD,
      width: 200 - 2 * INSERT_BOX_PAD,
      height: 100 - 2 * INSERT_BOX_PAD,
    });
  });

  it('walk-up canPlace', () => {
    const nodes = nodesOf({
      [rootId]: { type: 'root', parentId: null, childIds: ['sec'] },
      sec: { type: 'section', parentId: rootId, childIds: ['h'] },
      h: { type: 'heading', parentId: 'sec', childIds: [] },
    });
    const rects = {
      sec: rect(0, 0, 200, 120),
      h: rect(0, 80, 100, 40),
    };

    const heading = resolve(nodes, 'h', 50, 80, rects, {
      draggedType: 'heading',
    });
    expect(heading?.parentId).toBe('sec');
    expect(heading?.index).toBe(0);

    const image = resolve(nodes, 'h', 50, 80, rects, {
      draggedType: 'image',
    });
    expect(image?.parentId).toBe(rootId);
  });

  it('draggedId excluded from geometry, original index kept', () => {
    const nodes = nodesOf({
      [rootId]: { type: 'root', parentId: null, childIds: ['a', 'b', 'c'] },
      a: { type: 'heading', parentId: rootId, childIds: [] },
      b: { type: 'heading', parentId: rootId, childIds: [] },
      c: { type: 'heading', parentId: rootId, childIds: [] },
    });
    const rects = {
      a: rect(0, 0, 100, 40),
      b: rect(0, 40, 100, 40),
      c: rect(0, 80, 100, 40),
    };

    const target = resolve(nodes, 'a', 50, 40, rects, { draggedId: 'b' });
    expect(target?.index).toBe(1);
  });

  it('do not insert into draggedId', () => {
    const nodes = nodesOf({
      [rootId]: { type: 'root', parentId: null, childIds: ['drag'] },
      drag: { type: 'section', parentId: rootId, childIds: ['child'] },
      child: { type: 'heading', parentId: 'drag', childIds: [] },
    });
    const rects = {
      [rootId]: rect(0, 0, 400, 400),
      drag: rect(0, 0, 200, 100),
      child: rect(0, 20, 100, 40),
    };

    const target = resolve(nodes, 'drag', 50, 30, rects, {
      draggedId: 'drag',
    });
    expect(target?.parentId).toBe(rootId);
  });

  it('grid wrap', () => {
    const nodes = nodesOf({
      [rootId]: {
        type: 'root',
        parentId: null,
        childIds: ['a', 'b', 'c', 'd'],
      },
      a: { type: 'heading', parentId: rootId, childIds: [] },
      b: { type: 'heading', parentId: rootId, childIds: [] },
      c: { type: 'heading', parentId: rootId, childIds: [] },
      d: { type: 'heading', parentId: rootId, childIds: [] },
    });
    const rects = {
      a: rect(0, 0, 80, 40),
      b: rect(80, 0, 80, 40),
      c: rect(0, 40, 80, 40),
      d: rect(80, 40, 80, 40),
    };

    const target = resolve(nodes, 'a', 80, 20, rects);
    expect(target?.index).toBe(1);
    expect(target?.orientation).toBe('vertical');
  });

  it('null when nothing accepts', () => {
    const nodes = nodesOf({
      [rootId]: { type: 'root', parentId: null, childIds: ['sec'] },
      sec: { type: 'section', parentId: rootId, childIds: ['h'] },
      h: { type: 'heading', parentId: 'sec', childIds: [] },
    });
    const rects = {
      sec: rect(0, 0, 200, 100),
      h: rect(0, 20, 100, 40),
    };
    const placement = getPlacement(storeSchema);
    placement.rules.set('root', { mode: 'only', set: new Set(['heading']) });

    const target = resolveInsertAt(nodes, placement, rootId, 'h', 50, 30, {
      getRect: (id) => rects[id as keyof typeof rects] ?? null,
      isRowFlow: () => false,
      draggedType: 'nope',
    });
    expect(target).toBeNull();
  });

  it('single child row flow', () => {
    const nodes = nodesOf({
      [rootId]: { type: 'root', parentId: null, childIds: ['a'] },
      a: { type: 'heading', parentId: rootId, childIds: [] },
    });
    const rects = { a: rect(0, 0, 80, 40) };

    const row = resolve(nodes, 'a', 40, 20, rects, {
      isRowFlow: () => true,
    });
    expect(row?.orientation).toBe('vertical');

    const col = resolve(nodes, 'a', 40, 0, rects, {
      isRowFlow: () => false,
    });
    expect(col?.orientation).toBe('horizontal');
  });

  it('globally nearest ancestor', () => {
    const nodes = nodesOf({
      [rootId]: { type: 'root', parentId: null, childIds: ['sib', 'sec'] },
      sib: { type: 'heading', parentId: rootId, childIds: [] },
      sec: { type: 'section', parentId: rootId, childIds: ['child'] },
      child: { type: 'heading', parentId: 'sec', childIds: [] },
    });
    const rects = {
      sib: rect(0, 0, 100, 40),
      sec: rect(0, 40, 200, 100),
      child: rect(0, 80, 100, 40),
    };

    const target = resolve(nodes, 'child', 50, 79, rects);
    expect(target?.parentId).toBe('sec');
    expect(target?.index).toBe(0);
  });
});
