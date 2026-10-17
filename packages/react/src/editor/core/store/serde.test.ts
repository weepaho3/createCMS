import { describe, expect, it } from 'vitest';

import { makeDoc } from './fixtures';
import { flattenTree, serializeDocument, serializeToTree } from './serde';

describe('flattenTree', () => {
  it('flattens makeDoc() to the expected shape', () => {
    const { nodes, rootId } = flattenTree(makeDoc().root);
    expect(rootId).toBe('root_1');
    expect(Object.keys(nodes).sort()).toEqual(['h1', 'p1', 'root_1', 'sec1']);
    expect(nodes.root_1?.type).toBe('root');
    expect(nodes.root_1?.parentId).toBeNull();
    expect(nodes.root_1?.childIds).toEqual(['h1', 'sec1']);
    expect(nodes.sec1?.childIds).toEqual(['p1']);
    expect(nodes.p1?.parentId).toBe('sec1');
  });

  it('keeps undeclared root properties (__slug)', () => {
    const { nodes } = flattenTree(makeDoc().root);
    expect(nodes.root_1?.properties.__slug).toBe('home');
  });
});

describe('serializeToTree', () => {
  it('emits every type verbatim (root stays "root")', () => {
    const { nodes, rootId } = flattenTree(makeDoc().root);
    const tree = serializeToTree(nodes, rootId);
    expect(tree.type).toBe('root');
    const children = tree.slots?.children ?? [];
    expect(children.map((c) => c.type)).toEqual(['heading', 'section']);
    expect(children[1]?.slots?.children?.map((c) => c.type)).toEqual([
      'paragraph',
    ]);
  });

  it('round-trips to the original tree', () => {
    const original = makeDoc().root;
    const { nodes, rootId } = flattenTree(original);
    expect(serializeToTree(nodes, rootId)).toEqual(original);
  });

  it('serialises a subtree from a non-root id', () => {
    const { nodes } = flattenTree(makeDoc().root);
    const subtree = serializeToTree(nodes, 'sec1');
    expect(subtree).toEqual({
      id: 'sec1',
      type: 'section',
      props: { title: 'Sec' },
      slots: {
        children: [
          {
            id: 'p1',
            type: 'paragraph',
            props: { text: 'World' },
          },
        ],
      },
    });
  });

  it('throws on a dangling child id', () => {
    const { nodes, rootId } = flattenTree(makeDoc().root);
    const broken = {
      ...nodes,
      root_1: {
        ...nodes.root_1!,
        childIds: [...nodes.root_1!.childIds, 'ghost'],
      },
    };
    expect(() => serializeToTree(broken, rootId)).toThrow(/dangling/);
  });

  it('returns copies of `props` (mutating the output does not mutate the node table)', () => {
    const { nodes, rootId } = flattenTree(makeDoc().root);
    const tree = serializeToTree(nodes, rootId);
    tree.props.title = 'Mutated';
    expect(nodes.root_1?.properties.title).toBe('Home');
  });

  it('carries v and meta through a round trip and omits empty slots', () => {
    const node = {
      id: 'r',
      type: 'root',
      v: 3,
      props: {},
      meta: { source: 'import' },
      slots: {
        children: [
          { id: 'a', type: 'heading', props: {}, slots: { children: [] } },
        ],
      },
    };
    const { nodes, rootId } = flattenTree(node);
    expect(serializeToTree(nodes, rootId)).toEqual({
      id: 'r',
      type: 'root',
      v: 3,
      props: {},
      meta: { source: 'import' },
      slots: { children: [{ id: 'a', type: 'heading', props: {} }] },
    });
  });

  it('serializeDocument wraps the tree with the schema version', () => {
    const { nodes, rootId } = flattenTree(makeDoc().root);
    expect(serializeDocument(nodes, rootId, 4)).toEqual({
      schemaVersion: 4,
      root: makeDoc().root,
    });
  });
});

describe('flattenTree slots', () => {
  it('rejects a slot other than children', () => {
    expect(() =>
      flattenTree({ id: 'r', type: 'root', props: {}, slots: { side: [] } }),
    ).toThrow(/slot "side"/);
  });
});
