import { describe, expect, it } from 'vitest';

import type { NodeData } from '../document';

import { createBlockId } from '../store/id';
import { remapIds } from './remap';
import { defineEditorSchema } from './types';

const schema = defineEditorSchema({
  root: { label: 'Root', fields: {}, slots: { children: {} } },
  components: {
    tabs: {
      label: 'Tabs',
      fields: {
        jump: { type: 'link' },
        items: {
          type: 'list',
          of: {
            type: 'object',
            fields: { target: { type: 'link' }, title: { type: 'text' } },
          },
        },
        owner: {
          type: 'custom',
          kind: 'block-id',
          rewriteRefs: (value, map) =>
            typeof value === 'string' ? (map.get(value) ?? value) : value,
        },
      },
      slots: { panes: {}, footer: {} },
    },
    pane: { label: 'Pane', fields: { title: { type: 'text' } } },
  },
});

function tabs(): NodeData {
  return {
    id: 'tabs',
    type: 'tabs',
    props: {
      jump: {
        kind: 'internal',
        rootId: 'p',
        collection: 'pages',
        fragment: 'b',
      },
      items: [
        {
          target: {
            kind: 'internal',
            rootId: 'p',
            collection: 'pages',
            fragment: 'a',
          },
          title: 'A',
        },
        {
          target: {
            kind: 'internal',
            rootId: 'p',
            collection: 'pages',
            fragment: 'outside',
          },
          title: 'Out',
        },
      ],
      owner: 'a',
    },
    slots: {
      panes: [
        { id: 'a', type: 'pane', props: { title: 'A' } },
        {
          id: 'b',
          type: 'pane',
          props: {},
          slots: { children: [{ id: 'c', type: 'pane', props: {} }] },
        },
      ],
      footer: [],
    },
  };
}

function counter(): () => string {
  let i = 0;
  return () => `x${++i}`;
}

describe('remapIds', () => {
  it('gives every node in every slot a fresh id and keeps the shape', () => {
    const { node, map } = remapIds(tabs(), counter());
    expect([...map]).toEqual([
      ['tabs', 'x1'],
      ['a', 'x2'],
      ['b', 'x3'],
      ['c', 'x4'],
    ]);
    expect(node.id).toBe('x1');
    expect(node.slots?.panes?.map((n) => n.id)).toEqual(['x2', 'x3']);
    expect(node.slots?.panes?.[1]?.slots?.children?.[0]?.id).toBe('x4');
    expect(node.slots?.footer).toEqual([]);
  });

  it('leaves props untouched without a schema', () => {
    const { node } = remapIds(tabs(), counter());
    expect(node.props).toEqual(tabs().props);
  });

  it('rewrites anchor fragments inside the subtree, also in lists and objects', () => {
    const { node } = remapIds(tabs(), counter(), { schema });
    expect(node.props.jump).toMatchObject({ fragment: 'x3' });
    expect(node.props.items).toEqual([
      expect.objectContaining({
        target: expect.objectContaining({ fragment: 'x2' }),
      }),
      expect.objectContaining({
        target: expect.objectContaining({ fragment: 'outside' }),
      }),
    ]);
  });

  it("uses a field's own rewriteRefs", () => {
    const { node } = remapIds(tabs(), counter(), { schema });
    expect(node.props.owner).toBe('x2');
  });

  it('an options.rewriteRefs overrides every field', () => {
    const { node } = remapIds(tabs(), counter(), {
      schema,
      rewriteRefs: (value) => value,
    });
    expect(node.props.owner).toBe('a');
    expect(node.props.jump).toMatchObject({ fragment: 'b' });
  });

  it('does not mutate the input', () => {
    const input = tabs();
    remapIds(input, counter(), { schema });
    expect(input).toEqual(tabs());
  });

  it('does not collide across 10,000 duplicates', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const { map } = remapIds(tabs(), createBlockId);
      for (const id of map.values()) seen.add(id);
    }
    expect(seen.size).toBe(40_000);
  });
});
