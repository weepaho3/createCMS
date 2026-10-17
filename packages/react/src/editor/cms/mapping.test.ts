import type { BlockTreeNode, CollectionDefinition } from '@createcms/schema';

import { describe, expect, it } from 'vitest';

import type { PlacementNode } from '../core';

import { EditorAdapterError, canPlaceIn } from '../core';
import {
  CMS_SCHEMA_VERSION,
  fromCollection,
  fromEditor,
  toEditor,
} from './mapping';
import { cmsSchema, makeCmsTree } from './test/cms-fixtures';
import { heroSchema, heroTree } from './test/hero-fixtures';

const kitchenSink = {
  label: 'Kitchen',
  root: { properties: { slug: { type: 'string', label: 'Slug' } } },
  blocks: {
    all: {
      label: 'All',
      group: 'Misc',
      description: 'Every kind',
      previewImageUrl: '/all.png',
      properties: {
        s: {
          type: 'string',
          label: 'S',
          minLength: 1,
          maxLength: 9,
          pattern: '^a',
          required: true,
          group: 'G',
          placeholder: 'p',
        },
        n: { type: 'number', label: 'N', min: 0, max: 5, defaultValue: 1 },
        b: { type: 'boolean', label: 'B' },
        d: { type: 'date', label: 'D' },
        r: { type: 'richText', label: 'R', maxLength: 100 },
        i: { type: 'image', label: 'I', defaultValue: 'asset-1' },
        sel: {
          type: 'select',
          label: 'Sel',
          options: [{ label: 'A', value: 'a' }],
        },
        ref: { type: 'reference', label: 'Ref', collection: 'pages' },
        l: { type: 'link', label: 'L', allowedKinds: ['external'] },
        tags: { type: 'list', label: 'Tags', of: { type: 'string' }, max: 3 },
        pics: { type: 'list', label: 'Pics', of: { type: 'image' } },
        refs: {
          type: 'list',
          label: 'Refs',
          of: { type: 'reference', collection: 'pages' },
        },
      },
    },
    box: { label: 'Box', allowChildren: true, properties: {} },
    shut: { label: 'Shut', allowChildren: true, properties: {} },
  },
  structure: {
    root: { excludes: ['shut'] },
    box: { accepts: ['all'] },
    shut: { accepts: [] },
  },
} satisfies CollectionDefinition;

describe('fromCollection', () => {
  const schema = fromCollection(kitchenSink);

  it('maps every property kind and its settings', () => {
    expect(schema.components.all.fields).toEqual({
      s: {
        type: 'text',
        label: 'S',
        description: undefined,
        required: true,
        group: 'G',
        placeholder: 'p',
        minLength: 1,
        maxLength: 9,
        pattern: '^a',
      },
      n: { type: 'number', label: 'N', min: 0, max: 5, defaultValue: 1 },
      b: { type: 'boolean', label: 'B' },
      d: { type: 'date', label: 'D' },
      r: { type: 'richText', label: 'R', maxLength: 100 },
      i: { type: 'media', label: 'I', defaultValue: { assetId: 'asset-1' } },
      sel: {
        type: 'select',
        label: 'Sel',
        options: [{ label: 'A', value: 'a' }],
      },
      ref: { type: 'reference', label: 'Ref', collection: 'pages' },
      l: { type: 'link', label: 'L', allowedKinds: ['external'] },
      tags: { type: 'list', label: 'Tags', of: { type: 'text' }, max: 3 },
      pics: { type: 'list', label: 'Pics', of: { type: 'media' } },
      refs: {
        type: 'list',
        label: 'Refs',
        of: { type: 'reference', collection: 'pages' },
      },
    });
  });

  it('maps block metadata and the root', () => {
    expect(schema.components.all).toMatchObject({
      label: 'All',
      category: 'Misc',
      description: 'Every kind',
      previewImageUrl: '/all.png',
    });
    expect(schema.components.all).not.toHaveProperty('slots');
    expect(schema.root).toEqual({
      label: 'Kitchen',
      fields: { slug: { type: 'text', label: 'Slug' } },
      slots: { children: { disallow: ['shut'] } },
    });
  });

  it('maps allowChildren and structure to the children slot with server semantics', () => {
    expect(schema.components.box.slots).toEqual({
      children: { allow: ['all'] },
    });
    const can = (child: string, parentType: string): boolean => {
      const nodes: Record<string, PlacementNode> = {
        p: { type: parentType, parent: null, slots: {} },
      };
      return canPlaceIn(schema, nodes, child, { id: 'p', slot: 'children' }).ok;
    };
    expect(can('all', 'box')).toBe(true);
    expect(can('box', 'box')).toBe(false);
    expect(can('all', 'shut')).toBe(false);
    expect(can('shut', 'root')).toBe(false);
    expect(can('box', 'all')).toBe(false);
  });

  it('throws a validation error for an unknown property type', () => {
    const bad = {
      label: 'Bad',
      root: { properties: {} },
      blocks: {
        x: { label: 'X', properties: { y: { type: 'blob', label: 'Y' } } },
      },
    } as unknown as CollectionDefinition;
    let caught: unknown;
    try {
      fromCollection(bad);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(EditorAdapterError);
    expect((caught as EditorAdapterError).kind).toBe('validation');
    expect((caught as EditorAdapterError).message).toContain('"blob"');
  });
});

describe('toEditor / fromEditor', () => {
  it.each<[string, BlockTreeNode, CollectionDefinition]>([
    ['store fixture', makeCmsTree(), cmsSchema],
    ['hero fixture', heroTree, heroSchema],
  ])('round-trips the %s unchanged', (_name, tree, def) => {
    expect(fromEditor(toEditor(tree, def), def)).toEqual(tree);
  });

  it('maps structure, keeps undeclared root keys and stamps the schema version', () => {
    const doc = toEditor(makeCmsTree(), cmsSchema);
    expect(doc.schemaVersion).toBe(CMS_SCHEMA_VERSION);
    expect(doc.root.id).toBe('root_1');
    expect(doc.root.props).toEqual({ title: 'Home', __slug: 'home' });
    expect(doc.root.slots?.children?.map((c) => c.id)).toEqual(['h1', 'sec1']);
    expect(doc.root.slots?.children?.[0]).toEqual({
      id: 'h1',
      type: 'heading',
      props: { text: 'Hello', level: 1 },
    });
  });

  it('maps image and reference values to editor shape and back', () => {
    const tree: BlockTreeNode = {
      blockId: 'r',
      type: 'root',
      properties: {},
      children: [
        {
          blockId: 'a',
          type: 'all',
          properties: {
            i: 'asset-9',
            ref: 'root-2',
            pics: ['p1', 'p2'],
            refs: ['x'],
            s: 'abc',
          },
          children: [],
        },
      ],
    };
    const doc = toEditor(tree, kitchenSink);
    expect(doc.root.slots?.children?.[0]?.props).toEqual({
      i: { assetId: 'asset-9' },
      ref: { id: 'root-2' },
      pics: [{ assetId: 'p1' }, { assetId: 'p2' }],
      refs: [{ id: 'x' }],
      s: 'abc',
    });
    expect(fromEditor(doc, kitchenSink)).toEqual(tree);
  });

  it('rejects a slot createcms cannot store', () => {
    expect(() =>
      fromEditor(
        {
          schemaVersion: 1,
          root: { id: 'r', type: 'root', props: {}, slots: { side: [] } },
        },
        cmsSchema,
      ),
    ).toThrow(EditorAdapterError);
  });

  it('passes asset references through with their known keys only', () => {
    const tree: BlockTreeNode = {
      blockId: 'r',
      type: 'root',
      properties: {},
      children: [
        {
          blockId: 'a',
          type: 'all',
          properties: {
            i: {
              assetId: 'asset-9',
              alt: 'A cat',
              crop: { x: 0, y: 0, width: 0.5, height: 0.5 },
              stray: 'dropped',
            },
          },
          children: [],
        },
      ],
    } as unknown as BlockTreeNode;
    const doc = toEditor(tree, kitchenSink);
    const image = doc.root.slots?.children?.[0]?.props.i;
    expect(image).toEqual({
      assetId: 'asset-9',
      alt: 'A cat',
      crop: { x: 0, y: 0, width: 0.5, height: 0.5 },
    });
    const back = fromEditor(doc, kitchenSink).children[0]?.properties.i;
    expect(back).toEqual(image);
  });

  it('writes the bare id for media without settings and for list elements', () => {
    const doc = toEditor(
      {
        blockId: 'r',
        type: 'root',
        properties: {},
        children: [
          {
            blockId: 'a',
            type: 'all',
            properties: { i: 'asset-1', pics: ['p1'] },
            children: [],
          },
        ],
      },
      kitchenSink,
    );
    const node = doc.root.slots!.children![0]!;
    node.props.pics = [{ assetId: 'p1', alt: 'ignored in lists' }];
    const back = fromEditor(doc, kitchenSink).children[0]?.properties;
    expect(back).toEqual({ i: 'asset-1', pics: ['p1'] });
  });
});
