import { describe, expect, it } from 'vitest';

import type { Op } from '../document';
import type { EditorNodes } from './serde';

import { makeDoc } from './fixtures';
import { applyOp } from './ops';
import { normalize, serializeSubtree } from './serde';

function base(): { nodes: EditorNodes; rootId: string } {
  return normalize(makeDoc());
}

describe('applyOp insert', () => {
  it('adds a leaf at an index: parent childIds updated, node has parentId, inverse is remove', () => {
    const { nodes, rootId } = base();
    const op: Op = {
      op: 'insert',
      parent: { id: 'root_1', slot: 'children' },
      index: 1,
      node: { id: 'new1', type: 'heading', props: {} },
    };
    const result = applyOp(nodes, rootId, op);
    expect(result).not.toBeNull();
    expect(result?.nodes.root_1?.slots.children).toEqual([
      'h1',
      'new1',
      'sec1',
    ]);
    expect(result?.nodes.new1?.parent?.id).toBe('root_1');
    expect(result?.inverse).toEqual({ op: 'remove', id: 'new1' });
  });

  it('adds a subtree (section with a child), flattening both nodes with correct parentIds', () => {
    const { nodes, rootId } = base();
    const op: Op = {
      op: 'insert',
      parent: { id: 'root_1', slot: 'children' },
      index: 2,
      node: {
        id: 'newSec',
        type: 'section',
        props: {},
        slots: {
          children: [
            {
              id: 'newPara',
              type: 'paragraph',
              props: {},
            },
          ],
        },
      },
    };
    const result = applyOp(nodes, rootId, op);
    expect(result?.nodes.newSec?.parent?.id).toBe('root_1');
    expect(result?.nodes.newSec?.slots.children).toEqual(['newPara']);
    expect(result?.nodes.newPara?.parent?.id).toBe('newSec');
  });

  it('clamps the index (99 appends, -1 prepends)', () => {
    const { nodes, rootId } = base();
    const appended = applyOp(nodes, rootId, {
      op: 'insert',
      parent: { id: 'root_1', slot: 'children' },
      index: 99,
      node: {
        id: 'appendedId',
        type: 'heading',
        props: {},
      },
    });
    expect(appended?.nodes.root_1?.slots.children).toEqual([
      'h1',
      'sec1',
      'appendedId',
    ]);

    const prepended = applyOp(nodes, rootId, {
      op: 'insert',
      parent: { id: 'root_1', slot: 'children' },
      index: -1,
      node: {
        id: 'prependedId',
        type: 'heading',
        props: {},
      },
    });
    expect(prepended?.nodes.root_1?.slots.children).toEqual([
      'prependedId',
      'h1',
      'sec1',
    ]);
  });

  it('rejects an id collision with an existing id', () => {
    const { nodes, rootId } = base();
    const result = applyOp(nodes, rootId, {
      op: 'insert',
      parent: { id: 'root_1', slot: 'children' },
      index: 0,
      node: { id: 'h1', type: 'heading', props: {} },
    });
    expect(result).toBeNull();
  });

  it('rejects a duplicate id inside the added subtree', () => {
    const { nodes, rootId } = base();
    const result = applyOp(nodes, rootId, {
      op: 'insert',
      parent: { id: 'root_1', slot: 'children' },
      index: 0,
      node: {
        id: 'dup',
        type: 'section',
        props: {},
        slots: { children: [{ id: 'dup', type: 'paragraph', props: {} }] },
      },
    });
    expect(result).toBeNull();
  });

  it('rejects an unknown parent', () => {
    const { nodes, rootId } = base();
    const result = applyOp(nodes, rootId, {
      op: 'insert',
      parent: { id: 'ghost', slot: 'children' },
      index: 0,
      node: { id: 'newId', type: 'heading', props: {} },
    });
    expect(result).toBeNull();
  });

  it('shares object references for untouched nodes', () => {
    const { nodes, rootId } = base();
    const result = applyOp(nodes, rootId, {
      op: 'insert',
      parent: { id: 'root_1', slot: 'children' },
      index: 0,
      node: { id: 'newId', type: 'heading', props: {} },
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
    expect(result?.nodes.root_1?.slots.children).toEqual(['h1']);
  });

  it('inverse is add at the old index with the full subtree', () => {
    const { nodes, rootId } = base();
    const result = applyOp(nodes, rootId, { op: 'remove', id: 'sec1' });
    expect(result?.inverse).toEqual({
      op: 'insert',
      parent: { id: 'root_1', slot: 'children' },
      index: 1,
      node: serializeSubtree(nodes, 'sec1'),
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
    const result = applyOp(nodes, rootId, {
      op: 'move',
      id: 'h1',
      parent: { id: 'sec1', slot: 'children' },
      index: 0,
    });
    expect(result?.nodes.root_1?.slots.children).toEqual(['sec1']);
    expect(result?.nodes.sec1?.slots.children).toEqual(['h1', 'p1']);
    expect(result?.nodes.h1?.parent?.id).toBe('sec1');
  });

  it('reorders within the same parent, inverse moves it back', () => {
    const { nodes, rootId } = base();
    const result = applyOp(nodes, rootId, {
      op: 'move',
      id: 'h1',
      parent: { id: 'root_1', slot: 'children' },
      index: 1,
    });
    expect(result?.nodes.root_1?.slots.children).toEqual(['sec1', 'h1']);
    expect(result?.inverse).toEqual({
      op: 'move',
      id: 'h1',
      parent: { id: 'root_1', slot: 'children' },
      index: 0,
    });
  });

  it('clamps the index', () => {
    const { nodes, rootId } = base();
    const result = applyOp(nodes, rootId, {
      op: 'move',
      id: 'h1',
      parent: { id: 'sec1', slot: 'children' },
      index: 99,
    });
    expect(result?.nodes.sec1?.slots.children).toEqual(['p1', 'h1']);
  });

  it('rejects moving the root', () => {
    const { nodes, rootId } = base();
    expect(
      applyOp(nodes, rootId, {
        op: 'move',
        id: rootId,
        parent: { id: 'sec1', slot: 'children' },
        index: 0,
      }),
    ).toBeNull();
  });

  it('rejects an unknown target', () => {
    const { nodes, rootId } = base();
    expect(
      applyOp(nodes, rootId, {
        op: 'move',
        id: 'h1',
        parent: { id: 'ghost', slot: 'children' },
        index: 0,
      }),
    ).toBeNull();
  });

  it('rejects moving a node into itself', () => {
    const { nodes, rootId } = base();
    expect(
      applyOp(nodes, rootId, {
        op: 'move',
        id: 'sec1',
        parent: { id: 'sec1', slot: 'children' },
        index: 0,
      }),
    ).toBeNull();
  });

  it('rejects moving a node into its own descendant', () => {
    const { nodes, rootId } = base();
    expect(
      applyOp(nodes, rootId, {
        op: 'move',
        id: 'sec1',
        parent: { id: 'p1', slot: 'children' },
        index: 0,
      }),
    ).toBeNull();
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
    expect(result?.nodes.h1?.props).toEqual({ text: 'Changed' });
  });

  it('keeps unknown keys (__slug survives an update of title)', () => {
    const { nodes, rootId } = base();
    const result = applyOp(nodes, rootId, {
      op: 'update',
      id: rootId,
      patch: { title: 'New Home' },
    });
    expect(result?.nodes[rootId]?.props).toEqual({
      title: 'New Home',
      __slug: 'home',
    });
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
      patch: { level: undefined } as unknown as Record<string, null>,
    });
    expect(result?.nodes.h1?.props).toEqual({ text: 'Hello' });
  });
});

describe('applyOp replace', () => {
  it('replaces the table and root id', () => {
    const { nodes, rootId } = base();
    const newDoc = {
      schemaVersion: 2,
      root: { id: 'other_root', type: 'root', props: {} },
    };
    const result = applyOp(nodes, rootId, { op: 'replace', doc: newDoc });
    expect(result?.rootId).toBe('other_root');
    expect(Object.keys(result?.nodes ?? {})).toEqual(['other_root']);
  });

  it('inverse is replace with the previous tree', () => {
    const { nodes, rootId } = base();
    const newDoc = {
      schemaVersion: 2,
      root: { id: 'other_root', type: 'root', props: {} },
    };
    const result = applyOp(nodes, rootId, { op: 'replace', doc: newDoc });
    expect(result?.inverse).toEqual({
      op: 'replace',
      doc: { schemaVersion: 0, root: serializeSubtree(nodes, rootId) },
    });
    expect(result?.schemaVersion).toBe(2);
  });
});

describe('applyOp roundtrip (op then inverse restores the original tree)', () => {
  it('add', () => {
    const { nodes, rootId } = base();
    const op: Op = {
      op: 'insert',
      parent: { id: 'root_1', slot: 'children' },
      index: 0,
      node: { id: 'newId', type: 'heading', props: {} },
    };
    const forward = applyOp(nodes, rootId, op);
    const back = applyOp(forward!.nodes, forward!.rootId, forward!.inverse);
    expect(serializeSubtree(back!.nodes, back!.rootId)).toEqual(makeDoc().root);
  });

  it('remove', () => {
    const { nodes, rootId } = base();
    const forward = applyOp(nodes, rootId, { op: 'remove', id: 'sec1' });
    const back = applyOp(forward!.nodes, forward!.rootId, forward!.inverse);
    expect(serializeSubtree(back!.nodes, back!.rootId)).toEqual(makeDoc().root);
  });

  it('move (reparent)', () => {
    const { nodes, rootId } = base();
    const forward = applyOp(nodes, rootId, {
      op: 'move',
      id: 'h1',
      parent: { id: 'sec1', slot: 'children' },
      index: 0,
    });
    const back = applyOp(forward!.nodes, forward!.rootId, forward!.inverse);
    expect(serializeSubtree(back!.nodes, back!.rootId)).toEqual(makeDoc().root);
  });

  it('move (reorder)', () => {
    const { nodes, rootId } = base();
    const forward = applyOp(nodes, rootId, {
      op: 'move',
      id: 'h1',
      parent: { id: 'root_1', slot: 'children' },
      index: 1,
    });
    const back = applyOp(forward!.nodes, forward!.rootId, forward!.inverse);
    expect(serializeSubtree(back!.nodes, back!.rootId)).toEqual(makeDoc().root);
  });

  it('update', () => {
    const { nodes, rootId } = base();
    const forward = applyOp(nodes, rootId, {
      op: 'update',
      id: 'h1',
      patch: { text: 'Changed' },
    });
    const back = applyOp(forward!.nodes, forward!.rootId, forward!.inverse);
    expect(serializeSubtree(back!.nodes, back!.rootId)).toEqual(makeDoc().root);
  });

  it('load', () => {
    const { nodes, rootId } = base();
    const newDoc = {
      schemaVersion: 2,
      root: { id: 'other_root', type: 'root', props: {} },
    };
    const forward = applyOp(nodes, rootId, { op: 'replace', doc: newDoc });
    const back = applyOp(forward!.nodes, forward!.rootId, forward!.inverse);
    expect(serializeSubtree(back!.nodes, back!.rootId)).toEqual(makeDoc().root);
  });
});

describe('applyOp ops stay JSON', () => {
  it('every op and its inverse survive JSON.parse(JSON.stringify(...))', () => {
    const { nodes, rootId } = base();
    const cases: Op[] = [
      {
        op: 'insert',
        parent: { id: 'root_1', slot: 'children' },
        index: 0,
        node: {
          id: 'newId',
          type: 'heading',
          props: { text: 'x' },
        },
      },
      { op: 'remove', id: 'sec1' },
      {
        op: 'move',
        id: 'h1',
        parent: { id: 'sec1', slot: 'children' },
        index: 0,
      },
      { op: 'update', id: 'h1', patch: { text: 'Changed', level: null } },
      {
        op: 'replace',
        doc: { schemaVersion: 1, root: { id: 'r2', type: 'root', props: {} } },
      },
    ];
    for (const op of cases) {
      const result = applyOp(nodes, rootId, op);
      expect(result).not.toBeNull();
      expect(JSON.parse(JSON.stringify(op))).toEqual(op);
      expect(JSON.parse(JSON.stringify(result?.inverse))).toEqual(
        result?.inverse,
      );
    }
  });
});

describe('applyOp named slots', () => {
  function columns(): { nodes: EditorNodes; rootId: string } {
    return normalize({
      schemaVersion: 1,
      root: {
        id: 'r',
        type: 'root',
        props: {},
        slots: {
          children: [
            {
              id: 'cols',
              type: 'columns',
              props: {},
              slots: {
                left: [{ id: 'a', type: 'text', props: {} }],
                right: [
                  {
                    id: 'box',
                    type: 'box',
                    props: {},
                    slots: { children: [{ id: 'b', type: 'text', props: {} }] },
                  },
                ],
              },
            },
          ],
        },
      },
    });
  }

  it('moves a node across slots and the inverse moves it back', () => {
    const { nodes, rootId } = columns();
    const result = applyOp(nodes, rootId, {
      op: 'move',
      id: 'a',
      parent: { id: 'cols', slot: 'right' },
      index: 1,
    });
    expect(result?.nodes.cols?.slots).toEqual({
      left: [],
      right: ['box', 'a'],
    });
    expect(result?.nodes.a?.parent).toEqual({ id: 'cols', slot: 'right' });
    expect(result?.inverse).toEqual({
      op: 'move',
      id: 'a',
      parent: { id: 'cols', slot: 'left' },
      index: 0,
    });
    const back = applyOp(result!.nodes, rootId, result!.inverse);
    expect(back?.nodes).toEqual(nodes);
  });

  it('rejects a move into its own subtree through another slot', () => {
    const { nodes, rootId } = columns();
    expect(
      applyOp(nodes, rootId, {
        op: 'move',
        id: 'cols',
        parent: { id: 'box', slot: 'children' },
        index: 0,
      }),
    ).toBeNull();
  });

  it('creates a slot the parent does not hold yet', () => {
    const { nodes, rootId } = columns();
    const result = applyOp(nodes, rootId, {
      op: 'insert',
      parent: { id: 'cols', slot: 'footer' },
      index: 0,
      node: { id: 'f', type: 'text', props: {} },
    });
    expect(result?.nodes.cols?.slots.footer).toEqual(['f']);
    expect(result?.nodes.f?.parent).toEqual({ id: 'cols', slot: 'footer' });
  });

  it('removes a subtree from a named slot and reinserts it there', () => {
    const { nodes, rootId } = columns();
    const result = applyOp(nodes, rootId, { op: 'remove', id: 'box' });
    expect(result?.nodes.b).toBeUndefined();
    expect(result?.inverse).toMatchObject({
      op: 'insert',
      parent: { id: 'cols', slot: 'right' },
      index: 0,
    });
    const back = applyOp(result!.nodes, rootId, result!.inverse);
    expect(back?.nodes).toEqual(nodes);
  });
});
