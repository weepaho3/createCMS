import { describe, expect, it } from 'vitest';

import { makeTree } from './fixtures';
import { applyOp } from './ops';
import { flattenTree, serializeToTree } from './serde';
import type { EditorNodes, EditorOp } from './types';

function base(): { nodes: EditorNodes; rootId: string } {
  return flattenTree(makeTree());
}

describe('applyOp add', () => {
  it('adds a leaf at an index: parent childIds updated, node has parentId, inverse is remove', () => {
    const { nodes, rootId } = base();
    const op: EditorOp = {
      op: 'add',
      parentId: 'root_1',
      index: 1,
      node: { blockId: 'new1', type: 'heading', properties: {}, children: [] },
    };
    const result = applyOp(nodes, rootId, op);
    expect(result).not.toBeNull();
    expect(result?.nodes.root_1?.childIds).toEqual(['h1', 'new1', 'sec1']);
    expect(result?.nodes.new1?.parentId).toBe('root_1');
    expect(result?.inverse).toEqual({ op: 'remove', id: 'new1' });
  });

  it('adds a subtree (section with a child), flattening both nodes with correct parentIds', () => {
    const { nodes, rootId } = base();
    const op: EditorOp = {
      op: 'add',
      parentId: 'root_1',
      index: 2,
      node: {
        blockId: 'newSec',
        type: 'section',
        properties: {},
        children: [
          { blockId: 'newPara', type: 'paragraph', properties: {}, children: [] },
        ],
      },
    };
    const result = applyOp(nodes, rootId, op);
    expect(result?.nodes.newSec?.parentId).toBe('root_1');
    expect(result?.nodes.newSec?.childIds).toEqual(['newPara']);
    expect(result?.nodes.newPara?.parentId).toBe('newSec');
  });

  it('clamps the index (99 appends, -1 prepends)', () => {
    const { nodes, rootId } = base();
    const appended = applyOp(nodes, rootId, {
      op: 'add',
      parentId: 'root_1',
      index: 99,
      node: { blockId: 'appendedId', type: 'heading', properties: {}, children: [] },
    });
    expect(appended?.nodes.root_1?.childIds).toEqual(['h1', 'sec1', 'appendedId']);

    const prepended = applyOp(nodes, rootId, {
      op: 'add',
      parentId: 'root_1',
      index: -1,
      node: { blockId: 'prependedId', type: 'heading', properties: {}, children: [] },
    });
    expect(prepended?.nodes.root_1?.childIds).toEqual(['prependedId', 'h1', 'sec1']);
  });

  it('rejects an id collision with an existing id', () => {
    const { nodes, rootId } = base();
    const result = applyOp(nodes, rootId, {
      op: 'add',
      parentId: 'root_1',
      index: 0,
      node: { blockId: 'h1', type: 'heading', properties: {}, children: [] },
    });
    expect(result).toBeNull();
  });

  it('rejects a duplicate id inside the added subtree', () => {
    const { nodes, rootId } = base();
    const result = applyOp(nodes, rootId, {
      op: 'add',
      parentId: 'root_1',
      index: 0,
      node: {
        blockId: 'dup',
        type: 'section',
        properties: {},
        children: [{ blockId: 'dup', type: 'paragraph', properties: {}, children: [] }],
      },
    });
    expect(result).toBeNull();
  });

  it('rejects an unknown parent', () => {
    const { nodes, rootId } = base();
    const result = applyOp(nodes, rootId, {
      op: 'add',
      parentId: 'ghost',
      index: 0,
      node: { blockId: 'newId', type: 'heading', properties: {}, children: [] },
    });
    expect(result).toBeNull();
  });

  it('shares object references for untouched nodes', () => {
    const { nodes, rootId } = base();
    const result = applyOp(nodes, rootId, {
      op: 'add',
      parentId: 'root_1',
      index: 0,
      node: { blockId: 'newId', type: 'heading', properties: {}, children: [] },
    });
    expect(result?.nodes.p1).toBe(nodes.p1);
    expect(result?.nodes.sec1).toBe(nodes.sec1);
  });
});

describe('applyOp remove', () => {
  it('cascades (sec1 + p1 gone) and relinks the parent', () => {
    const { nodes, rootId } = base();
    const result = applyOp(nodes, rootId, { op: 'remove', id: 'sec1' });
    expect(result?.nodes.sec1).toBeUndefined();
    expect(result?.nodes.p1).toBeUndefined();
    expect(result?.nodes.root_1?.childIds).toEqual(['h1']);
  });

  it('inverse is add at the old index with the full subtree', () => {
    const { nodes, rootId } = base();
    const result = applyOp(nodes, rootId, { op: 'remove', id: 'sec1' });
    expect(result?.inverse).toEqual({
      op: 'add',
      parentId: 'root_1',
      index: 1,
      node: serializeToTree(nodes, 'sec1'),
    });
  });

  it('rejects removing the root', () => {
    const { nodes, rootId } = base();
    expect(applyOp(nodes, rootId, { op: 'remove', id: rootId })).toBeNull();
  });

  it('rejects an unknown id', () => {
    const { nodes, rootId } = base();
    expect(applyOp(nodes, rootId, { op: 'remove', id: 'ghost' })).toBeNull();
  });
});

describe('applyOp move', () => {
  it('reparents: relinks both parents and updates parentId', () => {
    const { nodes, rootId } = base();
    const result = applyOp(nodes, rootId, { op: 'move', id: 'h1', parentId: 'sec1', index: 0 });
    expect(result?.nodes.root_1?.childIds).toEqual(['sec1']);
    expect(result?.nodes.sec1?.childIds).toEqual(['h1', 'p1']);
    expect(result?.nodes.h1?.parentId).toBe('sec1');
  });

  it('reorders within the same parent, inverse moves it back', () => {
    const { nodes, rootId } = base();
    const result = applyOp(nodes, rootId, { op: 'move', id: 'h1', parentId: 'root_1', index: 1 });
    expect(result?.nodes.root_1?.childIds).toEqual(['sec1', 'h1']);
    expect(result?.inverse).toEqual({ op: 'move', id: 'h1', parentId: 'root_1', index: 0 });
  });

  it('clamps the index', () => {
    const { nodes, rootId } = base();
    const result = applyOp(nodes, rootId, { op: 'move', id: 'h1', parentId: 'sec1', index: 99 });
    expect(result?.nodes.sec1?.childIds).toEqual(['p1', 'h1']);
  });

  it('rejects moving the root', () => {
    const { nodes, rootId } = base();
    expect(applyOp(nodes, rootId, { op: 'move', id: rootId, parentId: 'sec1', index: 0 })).toBeNull();
  });

  it('rejects an unknown target', () => {
    const { nodes, rootId } = base();
    expect(applyOp(nodes, rootId, { op: 'move', id: 'h1', parentId: 'ghost', index: 0 })).toBeNull();
  });

  it('rejects moving a node into itself', () => {
    const { nodes, rootId } = base();
    expect(applyOp(nodes, rootId, { op: 'move', id: 'sec1', parentId: 'sec1', index: 0 })).toBeNull();
  });

  it('rejects moving a node into its own descendant', () => {
    const { nodes, rootId } = base();
    expect(applyOp(nodes, rootId, { op: 'move', id: 'sec1', parentId: 'p1', index: 0 })).toBeNull();
  });
});

describe('applyOp update', () => {
  it('sets and deletes (null) keys', () => {
    const { nodes, rootId } = base();
    const result = applyOp(nodes, rootId, {
      op: 'update',
      id: 'h1',
      patch: { text: 'Changed', level: null },
    });
    expect(result?.nodes.h1?.properties).toEqual({ text: 'Changed' });
  });

  it('keeps unknown keys (__slug survives an update of title)', () => {
    const { nodes, rootId } = base();
    const result = applyOp(nodes, rootId, {
      op: 'update',
      id: rootId,
      patch: { title: 'New Home' },
    });
    expect(result?.nodes[rootId]?.properties).toEqual({ title: 'New Home', __slug: 'home' });
  });

  it('inverse patch holds previous values and null for keys that did not exist', () => {
    const { nodes, rootId } = base();
    const result = applyOp(nodes, rootId, {
      op: 'update',
      id: 'h1',
      patch: { text: 'Changed', brandNew: 'value' },
    });
    expect(result?.inverse).toEqual({
      op: 'update',
      id: 'h1',
      patch: { text: 'Hello', brandNew: null },
    });
  });

  it('undefined in a patch deletes like null (defensive)', () => {
    const { nodes, rootId } = base();
    const result = applyOp(nodes, rootId, {
      op: 'update',
      id: 'h1',
      patch: { level: undefined },
    });
    expect(result?.nodes.h1?.properties).toEqual({ text: 'Hello' });
  });
});

describe('applyOp load', () => {
  it('replaces the table and root id', () => {
    const { nodes, rootId } = base();
    const newTree = { blockId: 'other_root', type: 'root', properties: {}, children: [] };
    const result = applyOp(nodes, rootId, { op: 'load', tree: newTree });
    expect(result?.rootId).toBe('other_root');
    expect(Object.keys(result?.nodes ?? {})).toEqual(['other_root']);
  });

  it('inverse is load with the previous tree', () => {
    const { nodes, rootId } = base();
    const newTree = { blockId: 'other_root', type: 'root', properties: {}, children: [] };
    const result = applyOp(nodes, rootId, { op: 'load', tree: newTree });
    expect(result?.inverse).toEqual({ op: 'load', tree: serializeToTree(nodes, rootId) });
  });
});

describe('applyOp roundtrip (op then inverse restores the original tree)', () => {
  it('add', () => {
    const { nodes, rootId } = base();
    const op: EditorOp = {
      op: 'add',
      parentId: 'root_1',
      index: 0,
      node: { blockId: 'newId', type: 'heading', properties: {}, children: [] },
    };
    const forward = applyOp(nodes, rootId, op);
    const back = applyOp(forward!.nodes, forward!.rootId, forward!.inverse);
    expect(serializeToTree(back!.nodes, back!.rootId)).toEqual(makeTree());
  });

  it('remove', () => {
    const { nodes, rootId } = base();
    const forward = applyOp(nodes, rootId, { op: 'remove', id: 'sec1' });
    const back = applyOp(forward!.nodes, forward!.rootId, forward!.inverse);
    expect(serializeToTree(back!.nodes, back!.rootId)).toEqual(makeTree());
  });

  it('move (reparent)', () => {
    const { nodes, rootId } = base();
    const forward = applyOp(nodes, rootId, { op: 'move', id: 'h1', parentId: 'sec1', index: 0 });
    const back = applyOp(forward!.nodes, forward!.rootId, forward!.inverse);
    expect(serializeToTree(back!.nodes, back!.rootId)).toEqual(makeTree());
  });

  it('move (reorder)', () => {
    const { nodes, rootId } = base();
    const forward = applyOp(nodes, rootId, { op: 'move', id: 'h1', parentId: 'root_1', index: 1 });
    const back = applyOp(forward!.nodes, forward!.rootId, forward!.inverse);
    expect(serializeToTree(back!.nodes, back!.rootId)).toEqual(makeTree());
  });

  it('update', () => {
    const { nodes, rootId } = base();
    const forward = applyOp(nodes, rootId, { op: 'update', id: 'h1', patch: { text: 'Changed' } });
    const back = applyOp(forward!.nodes, forward!.rootId, forward!.inverse);
    expect(serializeToTree(back!.nodes, back!.rootId)).toEqual(makeTree());
  });

  it('load', () => {
    const { nodes, rootId } = base();
    const newTree = { blockId: 'other_root', type: 'root', properties: {}, children: [] };
    const forward = applyOp(nodes, rootId, { op: 'load', tree: newTree });
    const back = applyOp(forward!.nodes, forward!.rootId, forward!.inverse);
    expect(serializeToTree(back!.nodes, back!.rootId)).toEqual(makeTree());
  });
});

describe('applyOp ops stay JSON', () => {
  it('every op and its inverse survive JSON.parse(JSON.stringify(...))', () => {
    const { nodes, rootId } = base();
    const cases: EditorOp[] = [
      {
        op: 'add',
        parentId: 'root_1',
        index: 0,
        node: { blockId: 'newId', type: 'heading', properties: { text: 'x' }, children: [] },
      },
      { op: 'remove', id: 'sec1' },
      { op: 'move', id: 'h1', parentId: 'sec1', index: 0 },
      { op: 'update', id: 'h1', patch: { text: 'Changed', level: null } },
      { op: 'load', tree: { blockId: 'r2', type: 'root', properties: {}, children: [] } },
    ];
    for (const op of cases) {
      const result = applyOp(nodes, rootId, op);
      expect(result).not.toBeNull();
      expect(JSON.parse(JSON.stringify(op))).toEqual(op);
      expect(JSON.parse(JSON.stringify(result?.inverse))).toEqual(result?.inverse);
    }
  });
});
