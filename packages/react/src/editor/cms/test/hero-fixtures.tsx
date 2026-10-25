import type {
  BlockTreeNode,
  CollectionDefinition,
  EditProps,
  ResolvedReference,
} from '@createcms/schema';
import type { ReactNode } from 'react';

import type { EditorDocument } from '../../core';
import type { CmsBlocksMap } from '../canvas';

import { NO_EDIT } from '../../core';
import { toEditor } from '../mapping';

export const heroSchema = {
  label: 'Pages',
  root: { properties: {} },
  blocks: {
    hero: {
      label: 'Hero',
      properties: {
        title: { type: 'string', label: 'Title' },
        featured: {
          type: 'reference',
          collection: 'items',
          label: 'Featured',
        },
      },
    },
    grid: {
      label: 'Grid',
      allowChildren: true,
      properties: {},
    },
    item: {
      label: 'Item',
      properties: { label: { type: 'string', label: 'Label' } },
    },
  },
} satisfies CollectionDefinition;

export const featuredRef: ResolvedReference = {
  rootId: 'item-root',
  collection: 'items',
  properties: {},
  tree: {
    blockId: 'item-root',
    type: 'root',
    properties: {},
    children: [
      {
        blockId: 'ref-item',
        type: 'item',
        properties: { label: 'Featured' },
        children: [],
      },
    ],
  },
};

export const heroTree: BlockTreeNode = {
  blockId: 'root_1',
  type: 'root',
  properties: {},
  children: [
    {
      blockId: 'hero1',
      type: 'hero',
      properties: { title: 'Welcome', featured: 'item-root' },
      children: [],
    },
    {
      blockId: 'grid1',
      type: 'grid',
      properties: {},
      children: [
        {
          blockId: 'item1',
          type: 'item',
          properties: { label: 'A' },
          children: [],
        },
        {
          blockId: 'item2',
          type: 'item',
          properties: { label: 'B' },
          children: [],
        },
      ],
    },
  ],
};

export function Hero({
  properties,
  children,
  edit,
}: {
  properties: Record<string, unknown>;
  children?: ReactNode;
  edit: EditProps;
}) {
  return (
    <section {...edit.block}>
      <h1 {...edit.field.title}>{String(properties.title)}</h1>
      {children}
    </section>
  );
}

export function Grid({
  children,
  edit,
}: {
  children?: ReactNode;
  edit: EditProps;
}) {
  return <div {...edit.block}>{children}</div>;
}

export function Item({
  properties,
  edit,
}: {
  properties: Record<string, unknown>;
  edit: EditProps;
}) {
  return (
    <article {...edit.block} {...edit.field.label}>
      {String(properties.label)}
    </article>
  );
}

/** The `createBlocksMap` shape: components plus the collection they render. */
export const heroBlocks: CmsBlocksMap<typeof heroSchema> = {
  _components: { hero: Hero, grid: Grid, item: Item },
  _collection: heroSchema,
};

/** `heroTree` as the editor loads it. */
export const heroDoc: EditorDocument = toEditor(heroTree, heroSchema);

export function PublishedHeroTree() {
  return (
    <>
      <Hero
        properties={{ title: 'Welcome', featured: featuredRef }}
        edit={NO_EDIT}
      >
        <div style={{ display: 'contents' }}>
          <Item properties={{ label: 'Featured' }} edit={NO_EDIT} />
        </div>
      </Hero>
      <Grid edit={NO_EDIT}>
        <Item properties={{ label: 'A' }} edit={NO_EDIT} />
        <Item properties={{ label: 'B' }} edit={NO_EDIT} />
      </Grid>
    </>
  );
}
