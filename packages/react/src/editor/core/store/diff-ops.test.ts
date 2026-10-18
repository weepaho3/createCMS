import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { DocState, EditorDocument, JsonValue } from '..';

import { applyOp, canonicalJson, normalize, serializeSubtree } from '..';
import { diffOps } from './diff-ops';

const base: EditorDocument = {
  schemaVersion: 1,
  root: {
    id: 'root',
    type: 'root',
    props: {},
    slots: {
      children: [
        { id: 'a', type: 'box', props: { n: 1 }, slots: { children: [] } },
        { id: 'b', type: 'box', props: {}, slots: { children: [] } },
        { id: 'c', type: 'text', props: { text: 'C' } },
      ],
    },
  },
};

const stateOf = (doc: EditorDocument): DocState => ({
  ...normalize(doc),
  version: 0,
  schemaVersion: doc.schemaVersion,
});

const json = (state: DocState) =>
  canonicalJson(
    serializeSubtree(state.nodes, state.rootId) as unknown as JsonValue,
  );

function replay(prev: DocState, next: DocState): DocState {
  let nodes = prev.nodes;
  let rootId = prev.rootId;
  for (const op of diffOps(prev, next)) {
    const result = applyOp(nodes, rootId, op, prev.schemaVersion);
    expect(result, `op ${op.op} applies`).not.toBeNull();
    nodes = result!.nodes;
    rootId = result!.rootId;
  }
  const draft: DocState = { ...prev, nodes, rootId };
  return draft;
}

describe('diffOps', () => {
  it('turns a state into another with removes, inserts, moves and updates', () => {
    const prev = stateOf(base);
    let next = prev;
    const step = (op: Parameters<typeof applyOp>[2]) => {
      const r = applyOp(next.nodes, next.rootId, op, 1)!;
      next = { ...next, nodes: r.nodes };
    };
    step({
      op: 'move',
      id: 'c',
      parent: { id: 'a', slot: 'children' },
      index: 0,
    });
    step({ op: 'remove', id: 'b' });
    step({
      op: 'insert',
      parent: { id: 'root', slot: 'children' },
      index: 0,
      node: { id: 'n', type: 'text', props: { text: 'N' } },
    });
    step({ op: 'update', id: 'a', patch: { n: 2 } });
    const ops = diffOps(prev, next);
    expect(ops.map((op) => op.op).sort()).toEqual([
      'insert',
      'move',
      'remove',
      'update',
    ]);
    expect(json(replay(prev, next))).toBe(json(next));
  });

  it('reproduces any sequence of edits', () => {
    const choice = fc.record({
      kind: fc.nat({ max: 3 }),
      a: fc.nat(),
      b: fc.nat(),
      index: fc.nat({ max: 3 }),
    });
    fc.assert(
      fc.property(fc.array(choice, { maxLength: 15 }), (choices) => {
        const prev = stateOf(base);
        let nodes = prev.nodes;
        let fresh = 0;
        for (const c of choices) {
          const ids = Object.keys(nodes).sort();
          const pick = (n: number) => ids[n % ids.length]!;
          const op =
            c.kind === 0
              ? {
                  op: 'insert' as const,
                  parent: { id: pick(c.a), slot: 'children' },
                  index: c.index,
                  node: { id: `x${(fresh += 1)}`, type: 'box', props: {} },
                }
              : c.kind === 1
                ? { op: 'remove' as const, id: pick(c.a) }
                : c.kind === 2
                  ? {
                      op: 'move' as const,
                      id: pick(c.a),
                      parent: { id: pick(c.b), slot: 'children' },
                      index: c.index,
                    }
                  : { op: 'update' as const, id: pick(c.a), patch: { k: c.b } };
          const r = applyOp(nodes, prev.rootId, op, 1);
          if (r) nodes = r.nodes;
        }
        const next: DocState = { ...prev, nodes };
        expect(json(replay(prev, next))).toBe(json(next));
      }),
      { numRuns: 300 },
    );
  });
});
