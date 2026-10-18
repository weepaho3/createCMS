import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import type { DocState, EditorDocument, JsonValue, Origin } from '../core';

import {
  canonicalJson,
  conformanceDocument,
  runDocStoreConformance,
  serializeSubtree,
  TxRejectedError,
} from '../core';
import { createYjsDocStore, yjsToDocument } from './yjs-doc-store';

const doc = (): EditorDocument => ({
  schemaVersion: 1,
  root: {
    id: 'root',
    type: 'root',
    props: {},
    slots: {
      children: [
        { id: 'a', type: 'box', props: {}, slots: { children: [] } },
        { id: 'b', type: 'box', props: {}, slots: { children: [] } },
        { id: 'x', type: 'text', props: { text: 'X' } },
      ],
    },
  },
});

/** Peers that exchange updates on demand, like a network that can lag. */
function peers(count: number, initialValue = doc()) {
  const docs = Array.from({ length: count }, () => new Y.Doc());
  // One peer seeds; the others start from its state, as a server would.
  const seed = createYjsDocStore({ ydoc: docs[0]!, initialValue });
  for (const other of docs.slice(1)) {
    Y.applyUpdate(other, Y.encodeStateAsUpdate(docs[0]!), 'network');
  }
  const stores = [
    seed,
    ...docs.slice(1).map((ydoc) => createYjsDocStore({ ydoc })),
  ];
  const sync = () => {
    for (const from of docs) {
      for (const to of docs) {
        if (from === to) continue;
        Y.applyUpdate(
          to,
          Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)),
          'network',
        );
      }
    }
  };
  return { stores, sync };
}

const json = (state: DocState) =>
  canonicalJson(
    serializeSubtree(state.nodes, state.rootId) as unknown as JsonValue,
  );

/** How often each id appears in a slot. */
function placements(state: DocState): Map<string, number> {
  const out = new Map<string, number>();
  for (const node of Object.values(state.nodes)) {
    for (const list of Object.values(node.slots)) {
      for (const id of list) out.set(id, (out.get(id) ?? 0) + 1);
    }
  }
  return out;
}

function assertTree(state: DocState): void {
  const seen = new Set<string>();
  const walk = (id: string) => {
    expect(seen.has(id), `${id} reached twice`).toBe(false);
    seen.add(id);
    for (const list of Object.values(state.nodes[id]!.slots)) {
      for (const child of list) {
        expect(state.nodes[child]?.parent?.id).toBe(id);
        walk(child);
      }
    }
  };
  walk(state.rootId);
  expect(seen.size).toBe(Object.keys(state.nodes).length);
}

describe('createYjsDocStore', () => {
  it('passes the DocStore conformance suite', () => {
    const passed = runDocStoreConformance((initialValue) =>
      createYjsDocStore({ ydoc: new Y.Doc(), initialValue }),
    );
    expect(passed).toHaveLength(10);
  });

  it('exports the document without order keys', () => {
    const ydoc = new Y.Doc();
    createYjsDocStore({ ydoc, initialValue: conformanceDocument() });
    expect(yjsToDocument(ydoc)).toEqual(conformanceDocument());
    expect(yjsToDocument(new Y.Doc())).toBeNull();
  });

  it('converges when two peers move the same node, without a duplicate', () => {
    const { stores, sync } = peers(2);
    const [p, q] = stores;
    p!.transact((tx) => tx.moveNode('x', 'a', 'children', 0));
    q!.transact((tx) => tx.moveNode('x', 'b', 'children', 0));
    sync();
    expect(json(p!.getSnapshot())).toBe(json(q!.getSnapshot()));
    expect(placements(p!.getSnapshot()).get('x')).toBe(1);
    assertTree(p!.getSnapshot());
  });

  it('breaks a cycle from two concurrent moves the same way on every peer', () => {
    const { stores, sync } = peers(2);
    const [p, q] = stores;
    p!.transact((tx) => tx.moveNode('a', 'b', 'children', 0));
    q!.transact((tx) => tx.moveNode('b', 'a', 'children', 0));
    sync();
    expect(json(p!.getSnapshot())).toBe(json(q!.getSnapshot()));
    assertTree(p!.getSnapshot());
    assertTree(q!.getSnapshot());
  });

  it('keeps a node moved into a parent another peer removed', () => {
    const { stores, sync } = peers(2);
    const [p, q] = stores;
    p!.transact((tx) => tx.removeNode('a'));
    q!.transact((tx) => tx.moveNode('x', 'a', 'children', 0));
    sync();
    expect(json(p!.getSnapshot())).toBe(json(q!.getSnapshot()));
    expect(p!.getSnapshot().nodes.x?.parent?.id).toBe('root');
    assertTree(p!.getSnapshot());
  });

  it('keeps both of two inserts at the same place, in the same order', () => {
    const { stores, sync } = peers(3);
    stores.forEach((store, i) =>
      store.transact((tx) =>
        tx.insertNode({ id: 'root', slot: 'children' }, 1, {
          id: `new${i}`,
          type: 'text',
          props: { text: `${i}` },
        }),
      ),
    );
    sync();
    const [first, ...rest] = stores.map((s) => json(s.getSnapshot()));
    for (const other of rest) expect(other).toBe(first);
    const children = stores[0]!.getSnapshot().nodes.root!.slots.children!;
    expect(children.filter((id) => id.startsWith('new'))).toHaveLength(3);
  });

  it('reports peer changes as remote and drops the undo steps they conflict with', () => {
    const { stores, sync } = peers(2);
    const [p, q] = stores;
    const origins: Origin[] = [];
    p!.subscribe((_changes, origin) => origins.push(origin));
    p!.transact((tx) => tx.setProp('x', ['text'], 'mine'));
    p!.transact((tx) => tx.setProp('a', ['title'], 'kept'));
    q!.transact((tx) => tx.removeNode('x'));
    sync();
    expect(origins).toContain('remote');
    expect(p!.getSnapshot().nodes.x).toBeUndefined();
    // The step on `x` conflicts with the remote removal; the one on `a` stays.
    expect(p!.getHistory().past).toHaveLength(1);
    p!.undo();
    expect(p!.getSnapshot().nodes.a?.props.title).toBeUndefined();
  });

  it('keeps the node objects a change did not touch', () => {
    const store = createYjsDocStore({ ydoc: new Y.Doc(), initialValue: doc() });
    const before = store.getSnapshot();
    store.transact((tx) => tx.setProp('x', ['text'], 'changed'));
    const after = store.getSnapshot();
    expect(after.nodes.a).toBe(before.nodes.a);
    expect(after.nodes.b).toBe(before.nodes.b);
    expect(after.nodes.x).not.toBe(before.nodes.x);
  });

  it('converges for random edits on three peers with random syncs', () => {
    type Edit = {
      peer: number;
      kind: number;
      a: number;
      b: number;
      index: number;
      sync: boolean;
    };
    const editArb: fc.Arbitrary<Edit> = fc.record({
      peer: fc.nat({ max: 2 }),
      kind: fc.nat({ max: 3 }),
      a: fc.nat(),
      b: fc.nat(),
      index: fc.nat({ max: 4 }),
      sync: fc.boolean(),
    });
    fc.assert(
      fc.property(fc.array(editArb, { maxLength: 25 }), (edits) => {
        const { stores, sync } = peers(3);
        let fresh = 0;
        for (const edit of edits) {
          const store = stores[edit.peer]!;
          const state = store.getSnapshot();
          const ids = Object.keys(state.nodes).sort();
          const pick = (n: number) => ids[n % ids.length]!;
          try {
            store.transact((tx) => {
              switch (edit.kind) {
                case 0:
                  tx.insertNode(
                    { id: pick(edit.a), slot: 'children' },
                    edit.index,
                    {
                      id: `n${edit.peer}-${(fresh += 1)}`,
                      type: 'box',
                      props: {},
                    },
                  );
                  break;
                case 1:
                  tx.removeNode(pick(edit.a));
                  break;
                case 2:
                  tx.moveNode(
                    pick(edit.a),
                    pick(edit.b),
                    'children',
                    edit.index,
                  );
                  break;
                default:
                  tx.setProp(pick(edit.a), ['n'], edit.b);
              }
            });
          } catch (error) {
            if (!(error instanceof TxRejectedError)) throw error;
          }
          if (edit.sync) sync();
        }
        sync();
        const [first, ...rest] = stores.map((s) => json(s.getSnapshot()));
        for (const other of rest) expect(other).toBe(first);
        for (const store of stores) assertTree(store.getSnapshot());
      }),
      { numRuns: 200 },
    );
  });
});
