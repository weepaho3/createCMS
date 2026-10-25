import { describe, expect, it } from 'vitest';

import type { NodeData } from '../document';

import { makeDoc } from './fixtures';
import {
  denormalize,
  flattenSubtree,
  normalize,
  serializeSubtree,
} from './serde';

describe('normalize', () => {
  it('flattens makeDoc() to the expected shape', () => {
    const { nodes, rootId } = normalize(makeDoc());
    expect(rootId).toBe('root_1');
    expect(Object.keys(nodes).sort()).toEqual(['h1', 'p1', 'root_1', 'sec1']);
    expect(nodes.root_1?.type).toBe('root');
    expect(nodes.root_1?.parent).toBeNull();
    expect(nodes.root_1?.slots.children).toEqual(['h1', 'sec1']);
    expect(nodes.sec1?.slots.children).toEqual(['p1']);
    expect(nodes.p1?.parent).toEqual({ id: 'sec1', slot: 'children' });
  });

  it('keeps undeclared root properties (__slug)', () => {
    const { nodes } = normalize(makeDoc());
    expect(nodes.root_1?.props.__slug).toBe('home');
  });
});

describe('serializeSubtree', () => {
  it('emits every type verbatim (root stays "root")', () => {
    const { nodes, rootId } = normalize(makeDoc());
    const tree = serializeSubtree(nodes, rootId);
    expect(tree.type).toBe('root');
    const children = tree.slots?.children ?? [];
    expect(children.map((c: NodeData) => c.type)).toEqual([
      'heading',
      'section',
    ]);
    expect(children[1]?.slots?.children?.map((c: NodeData) => c.type)).toEqual([
      'paragraph',
    ]);
  });

  it('round-trips to the original tree', () => {
    const original = makeDoc().root;
    const nodes = flattenSubtree(original, null);
    expect(serializeSubtree(nodes, original.id)).toEqual(original);
  });

  it('serialises a subtree from a non-root id', () => {
    const { nodes } = normalize(makeDoc());
    const subtree = serializeSubtree(nodes, 'sec1');
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
    const { nodes, rootId } = normalize(makeDoc());
    const broken = {
      ...nodes,
      root_1: {
        ...nodes.root_1!,
        slots: { children: [...nodes.root_1!.slots.children!, 'ghost'] },
      },
    };
    expect(() => serializeSubtree(broken, rootId)).toThrow(/dangling/);
  });

  it('returns copies of `props` (mutating the output does not mutate the node table)', () => {
    const { nodes, rootId } = normalize(makeDoc());
    const tree = serializeSubtree(nodes, rootId);
    tree.props.title = 'Mutated';
    expect(nodes.root_1?.props.title).toBe('Home');
  });

  it('carries v, meta and empty slots through a round trip', () => {
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
    const nodes = flattenSubtree(node, null);
    expect(serializeSubtree(nodes, 'r')).toEqual(node);
  });

  it('denormalize wraps the tree with the schema version', () => {
    expect(denormalize(normalize(makeDoc()), { schemaVersion: 4 })).toEqual({
      schemaVersion: 4,
      root: makeDoc().root,
    });
  });
});

describe('named slots', () => {
  const doc = {
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
              right: [{ id: 'b', type: 'text', props: {} }],
              left: [{ id: 'a', type: 'text', props: {} }],
              aside: [],
            },
          },
        ],
      },
    },
  };

  it('records each child with its slot', () => {
    const { nodes } = normalize(doc);
    expect(nodes.a?.parent).toEqual({ id: 'cols', slot: 'left' });
    expect(nodes.b?.parent).toEqual({ id: 'cols', slot: 'right' });
    expect(nodes.cols?.slots.aside).toEqual([]);
  });

  it('orders declared slots first, the rest alphabetically', () => {
    const order = (type: string) => (type === 'columns' ? ['left'] : []);
    const tree = serializeSubtree(normalize(doc).nodes, 'cols', order);
    expect(Object.keys(tree.slots ?? {})).toEqual(['left', 'aside', 'right']);
  });

  it('round-trips through normalize and denormalize', () => {
    const order = (type: string) =>
      type === 'columns' ? ['right', 'left', 'aside'] : ['children'];
    expect(
      denormalize(normalize(doc), { schemaVersion: 1, slotOrder: order }),
    ).toEqual(doc);
  });
});
