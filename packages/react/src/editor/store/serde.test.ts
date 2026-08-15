import { describe, expect, it } from 'vitest';

import { makeTree } from './fixtures';
import { flattenTree, serializeToTree } from './serde';

describe('flattenTree', () => {
  it('flattens makeTree() to the expected shape', () => {
    const { nodes, rootId } = flattenTree(makeTree());
    expect(rootId).toBe('root_1');
    expect(Object.keys(nodes).sort()).toEqual(['h1', 'p1', 'root_1', 'sec1']);
    expect(nodes.root_1?.type).toBe('root');
    expect(nodes.root_1?.parentId).toBeNull();
    expect(nodes.root_1?.childIds).toEqual(['h1', 'sec1']);
    expect(nodes.sec1?.childIds).toEqual(['p1']);
    expect(nodes.p1?.parentId).toBe('sec1');
  });

  it('keeps undeclared root properties (__slug)', () => {
    const { nodes } = flattenTree(makeTree());
    expect(nodes.root_1?.properties.__slug).toBe('home');
  });
});

describe('serializeToTree', () => {
  it('emits every type verbatim (root stays "root")', () => {
    const { nodes, rootId } = flattenTree(makeTree());
    const tree = serializeToTree(nodes, rootId);
    expect(tree.type).toBe('root');
    expect(tree.children.map((c) => c.type)).toEqual(['heading', 'section']);
    expect(tree.children[1]?.children.map((c) => c.type)).toEqual(['paragraph']);
  });

  it('round-trips to the original tree', () => {
    const original = makeTree();
    const { nodes, rootId } = flattenTree(original);
    expect(serializeToTree(nodes, rootId)).toEqual(original);
  });

  it('serialises a subtree from a non-root id', () => {
    const { nodes } = flattenTree(makeTree());
    const subtree = serializeToTree(nodes, 'sec1');
    expect(subtree).toEqual({
      blockId: 'sec1',
      type: 'section',
      properties: { title: 'Sec' },
      children: [
        { blockId: 'p1', type: 'paragraph', properties: { text: 'World' }, children: [] },
      ],
    });
  });

  it('throws on a dangling child id', () => {
    const { nodes, rootId } = flattenTree(makeTree());
    const broken = {
      ...nodes,
      root_1: { ...nodes.root_1!, childIds: [...nodes.root_1!.childIds, 'ghost'] },
    };
    expect(() => serializeToTree(broken, rootId)).toThrow(/dangling/);
  });

  it('returns copies of `properties` (mutating the output does not mutate the node table)', () => {
    const { nodes, rootId } = flattenTree(makeTree());
    const tree = serializeToTree(nodes, rootId);
    (tree.properties as Record<string, unknown>).title = 'Mutated';
    expect(nodes.root_1?.properties.title).toBe('Home');
  });
});
