import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { EditorDocument, JsonValue, NodeData, Op } from '../document';
import type { EditorNodes } from './serde';

import { canonicalJson } from '../document';
import { remapIds } from '../schema/remap';
import { createJsonDocStore, TxRejectedError } from './doc-store';
import { applyOp } from './ops';
import { denormalize, normalize, serializeSubtree } from './serde';

// fast-check prints the seed and the shrunk counterexample of a failing
// property, so a CI failure can be replayed with `{ seed, path }`.
const RUNS = { numRuns: 500 };

const SLOTS = ['aside', 'children'] as const;

const propsArb: fc.Arbitrary<Record<string, JsonValue>> = fc.record(
  {
    title: fc.string({ maxLength: 6 }),
    count: fc.integer({ min: -5, max: 5 }),
    on: fc.boolean(),
  },
  { requiredKeys: [] },
);

/** A nested subtree with ids from `next`; slots in alphabetical order. */
function nodeArb(depth: number, next: () => string): fc.Arbitrary<NodeData> {
  const childList =
    depth <= 0
      ? fc.constant([] as NodeData[])
      : fc.array(nodeArb(depth - 1, next), { maxLength: 3 });
  return fc
    .tuple(
      fc.constantFrom('text', 'box'),
      propsArb,
      fc.option(
        fc.record(
          { aside: childList, children: childList },
          {
            requiredKeys: ['children'],
          },
        ),
        { nil: undefined },
      ),
    )
    .map(([type, props, slots]) => {
      const node: NodeData = { id: next(), type, props };
      if (slots) {
        const sorted: Record<string, NodeData[]> = {};
        for (const name of SLOTS) {
          const list = slots[name];
          if (list) sorted[name] = list;
        }
        node.slots = sorted;
      }
      return node;
    });
}

/** A document whose ids are unique: they are numbered after generation. */
const docArb: fc.Arbitrary<EditorDocument> = nodeArb(3, () => '').map(
  (root) => {
    let n = 0;
    const number = (node: NodeData): NodeData => {
      const id = n === 0 ? 'root' : `n${n}`;
      n += 1;
      const out: NodeData = { ...node, id };
      if (node.slots) {
        out.slots = Object.fromEntries(
          Object.entries(node.slots).map(([slot, list]) => [
            slot,
            list.map(number),
          ]),
        );
      }
      return out;
    };
    const numbered = number(root);
    return {
      schemaVersion: 1,
      root: {
        ...numbered,
        type: 'root',
        slots: numbered.slots ?? { children: [] },
      },
    };
  },
);

/**
 * An op chosen against the current table: raw numbers pick existing ids,
 * so a sequence of choices stays meaningful as the table changes. Some ops
 * are invalid on purpose (moving a node into its own subtree, removing the
 * root); `applyOp` must reject those.
 */
type Choice = {
  kind: 'insert' | 'remove' | 'move' | 'update';
  a: number;
  b: number;
  index: number;
  slot: (typeof SLOTS)[number];
  props: Record<string, JsonValue>;
};

const choiceArb: fc.Arbitrary<Choice> = fc.record({
  kind: fc.constantFrom('insert', 'remove', 'move', 'update'),
  a: fc.nat(),
  b: fc.nat(),
  index: fc.integer({ min: -1, max: 5 }),
  slot: fc.constantFrom(...SLOTS),
  props: propsArb,
});

function opFor(nodes: EditorNodes, choice: Choice, fresh: () => string): Op {
  const ids = Object.keys(nodes).sort();
  const pick = (n: number) => ids[n % ids.length]!;
  switch (choice.kind) {
    case 'insert':
      return {
        op: 'insert',
        parent: { id: pick(choice.a), slot: choice.slot },
        index: choice.index,
        node: { id: fresh(), type: 'text', props: choice.props },
      };
    case 'remove':
      return { op: 'remove', id: pick(choice.a) };
    case 'move':
      return {
        op: 'move',
        id: pick(choice.a),
        parent: { id: pick(choice.b), slot: choice.slot },
        index: choice.index,
      };
    case 'update':
      return { op: 'update', id: pick(choice.a), patch: choice.props };
  }
}

function counter(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}${(n += 1)}`;
}

/** Tree invariants of a node table; returns the violations. */
function violations(nodes: EditorNodes, rootId: string): string[] {
  const out: string[] = [];
  for (const [id, node] of Object.entries(nodes)) {
    if (node.id !== id) out.push(`${id}: keyed under another id`);
  }
  const root = nodes[rootId];
  if (!root) return [...out, 'root missing'];
  if (root.parent !== null) out.push('root has a parent');
  const seen = new Set<string>();
  const walk = (id: string) => {
    if (seen.has(id)) {
      out.push(`${id}: reached twice (cycle or shared child)`);
      return;
    }
    seen.add(id);
    const node = nodes[id];
    if (!node) {
      out.push(`${id}: dangling child`);
      return;
    }
    for (const [slot, children] of Object.entries(node.slots)) {
      for (const child of children) {
        const parent = nodes[child]?.parent;
        if (parent?.id !== id || parent.slot !== slot) {
          out.push(`${child}: parent pointer does not match ${id}.${slot}`);
        }
        walk(child);
      }
    }
  };
  walk(rootId);
  for (const id of Object.keys(nodes)) {
    if (!seen.has(id)) out.push(`${id}: unreachable from the root`);
  }
  return out;
}

/**
 * The table as canonical JSON, empty slots left out: the editor reads a
 * missing slot as an empty one (`slots[name] ?? []`), and the inverse of an
 * insert that created a slot leaves it behind empty.
 */
const docOf = (nodes: EditorNodes, rootId: string) => {
  const prune = (node: NodeData): NodeData => {
    const slots = Object.entries(node.slots ?? {}).filter(
      ([, list]) => list.length > 0,
    );
    const out: NodeData = { ...node };
    delete out.slots;
    if (slots.length > 0) {
      out.slots = Object.fromEntries(
        slots.map(([name, list]) => [name, list.map(prune)]),
      );
    }
    return out;
  };
  return canonicalJson(
    prune(serializeSubtree(nodes, rootId)) as unknown as JsonValue,
  );
};

describe('editor core properties', () => {
  it('serde: normalize then denormalize returns the document', () => {
    fc.assert(
      fc.property(docArb, (doc) => {
        expect(
          denormalize(normalize(doc), { schemaVersion: doc.schemaVersion }),
        ).toEqual(doc);
      }),
      RUNS,
    );
  });

  it('applyOp then its inverse restores the table', () => {
    fc.assert(
      fc.property(docArb, choiceArb, (doc, choice) => {
        const { nodes, rootId } = normalize(doc);
        const op = opFor(nodes, choice, counter('new'));
        const applied = applyOp(nodes, rootId, op);
        fc.pre(applied !== null);
        const undone = applyOp(
          applied!.nodes,
          applied!.rootId,
          applied!.inverse,
        );
        expect(undone).not.toBeNull();
        expect(docOf(undone!.nodes, undone!.rootId)).toBe(docOf(nodes, rootId));
      }),
      RUNS,
    );
  });

  it('every op sequence keeps the tree invariants', () => {
    fc.assert(
      fc.property(
        docArb,
        fc.array(choiceArb, { maxLength: 20 }),
        (doc, choices) => {
          let { nodes, rootId } = normalize(doc);
          const fresh = counter('new');
          for (const choice of choices) {
            const result = applyOp(nodes, rootId, opFor(nodes, choice, fresh));
            if (!result) continue;
            ({ nodes, rootId } = result);
            expect(violations(nodes, rootId)).toEqual([]);
          }
        },
      ),
      RUNS,
    );
  });

  it('a move into the node itself or its subtree is rejected', () => {
    fc.assert(
      fc.property(docArb, fc.nat(), fc.nat(), (doc, a, b) => {
        const { nodes, rootId } = normalize(doc);
        const ids = Object.keys(nodes)
          .filter((id) => id !== rootId)
          .sort();
        fc.pre(ids.length > 0);
        const id = ids[a % ids.length]!;
        const inside: string[] = [];
        const collect = (current: string) => {
          inside.push(current);
          for (const list of Object.values(nodes[current]!.slots)) {
            for (const child of list) collect(child);
          }
        };
        collect(id);
        const target = inside[b % inside.length]!;
        expect(
          applyOp(nodes, rootId, {
            op: 'move',
            id,
            parent: { id: target, slot: 'children' },
            index: 0,
          }),
        ).toBeNull();
      }),
      RUNS,
    );
  });

  it('undo of every step returns the initial document, redo the final one', () => {
    fc.assert(
      fc.property(
        docArb,
        fc.array(choiceArb, { maxLength: 12 }),
        (doc, choices) => {
          let time = 0;
          const store = createJsonDocStore({
            initialValue: doc,
            // Steps far apart: none merge, each undo reverts one.
            now: () => (time += 10_000),
          });
          const initial = docOf(
            store.getSnapshot().nodes,
            store.getSnapshot().rootId,
          );
          const fresh = counter('new');
          let steps = 0;
          for (const choice of choices) {
            try {
              store.transact((tx) =>
                tx.apply(opFor(store.getSnapshot().nodes, choice, fresh)),
              );
              steps += 1;
            } catch (error) {
              if (!(error instanceof TxRejectedError)) throw error;
            }
          }
          const final = docOf(
            store.getSnapshot().nodes,
            store.getSnapshot().rootId,
          );
          for (let i = 0; i < steps; i += 1) store.undo();
          expect(
            docOf(store.getSnapshot().nodes, store.getSnapshot().rootId),
          ).toBe(initial);
          for (let i = 0; i < steps; i += 1) store.redo();
          expect(
            docOf(store.getSnapshot().nodes, store.getSnapshot().rootId),
          ).toBe(final);
        },
      ),
      RUNS,
    );
  });

  it('remapIds gives every node a fresh, unique id and keeps the shape', () => {
    fc.assert(
      fc.property(docArb, (doc) => {
        const ids = (node: NodeData, out: string[] = []): string[] => {
          out.push(node.id);
          for (const list of Object.values(node.slots ?? {})) {
            for (const child of list) ids(child, out);
          }
          return out;
        };
        const before = ids(doc.root);
        const { node, map } = remapIds(doc.root, counter('copy'));
        const after = ids(node);
        expect(new Set(after).size).toBe(after.length);
        expect(after.some((id) => before.includes(id))).toBe(false);
        expect(map.size).toBe(before.length);
        expect(after).toEqual(before.map((id) => map.get(id)));
      }),
      RUNS,
    );
  });

  it('canonical JSON does not depend on key order', () => {
    fc.assert(
      fc.property(docArb, (doc) => {
        const reversed = (value: JsonValue): JsonValue => {
          if (Array.isArray(value)) return value.map(reversed);
          if (value && typeof value === 'object') {
            return Object.fromEntries(
              Object.entries(value)
                .reverse()
                .map(([key, inner]) => [key, reversed(inner)]),
            );
          }
          return value;
        };
        const json = doc as unknown as JsonValue;
        expect(canonicalJson(reversed(json))).toBe(canonicalJson(json));
      }),
      RUNS,
    );
  });
});
