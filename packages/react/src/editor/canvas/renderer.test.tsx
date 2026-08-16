// @vitest-environment happy-dom
import type {
  BlockTreeNode,
  CollectionDefinition,
  EditProps,
} from '@createcms/schema';
import type * as React from 'react';

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CanvasComponent } from './map';

import { Editor } from '../index';
import { makeTree, storeSchema } from '../store/fixtures';
import { Canvas } from './index';
import { canvasBlocks, Heading } from './test/fixtures';
import { renderCanvas } from './test/harness';
import {
  featuredRef,
  heroBlocks,
  heroSchema,
  heroTree,
  PublishedHeroTree,
} from './test/hero-fixtures';

afterEach(cleanup);

const STRIP_ATTRS = [
  'data-editor-block',
  'data-editor-field',
  'data-editor-canvas',
  'data-editor-readonly',
  'data-interactive',
  'data-dragging',
  'data-editing',
  'data-unresolved',
  'data-testid',
  'inert',
] as const;

function strippedHtml(host: HTMLElement): string {
  const clone = host.cloneNode(true) as HTMLElement;
  const all = [clone, ...clone.querySelectorAll('*')];
  for (const el of all) {
    for (const attr of STRIP_ATTRS) {
      el.removeAttribute(attr);
    }
  }
  return clone.innerHTML;
}

const cardSchema = {
  label: 'Cards',
  root: { properties: {} },
  blocks: {
    card: {
      label: 'Card',
      properties: {
        source: {
          type: 'reference',
          collection: 'items',
          label: 'Source',
        },
      },
    },
  },
} satisfies CollectionDefinition;

function twoCards(source = 'abc'): BlockTreeNode {
  return {
    blockId: 'root_1',
    type: 'root',
    properties: {},
    children: [
      {
        blockId: 'c1',
        type: 'card',
        properties: { source },
        children: [],
      },
      {
        blockId: 'c2',
        type: 'card',
        properties: { source },
        children: [],
      },
    ],
  };
}

function Card({
  properties,
  edit,
}: {
  properties: Record<string, unknown>;
  edit: EditProps;
}) {
  return (
    <div {...edit.block} data-testid="card">
      {properties.source ? 'has' : 'missing'}
    </div>
  );
}

const cardBlocks = { card: Card as CanvasComponent };

const resolvedRef = {
  rootId: 'abc',
  collection: 'items',
  tree: {
    blockId: 'r',
    type: 'root',
    properties: {},
    children: [],
  },
  properties: {},
};

describe('Canvas.Root renderer', () => {
  it('renders the root as a fragment of child blocks', () => {
    const { host } = renderCanvas();
    expect(
      [...host.children].map((el) => el.getAttribute('data-editor-block')),
    ).toEqual(['h1', 'sec1']);
  });

  it('passes document edit with active true and schema field keys', () => {
    let seen: EditProps | undefined;
    function HeadingProbe(props: {
      properties: { text: string; level: number };
      edit: EditProps;
    }) {
      seen = props.edit;
      return <Heading {...props} />;
    }
    renderCanvas(undefined, {
      components: {
        ...canvasBlocks,
        heading: HeadingProbe as unknown as CanvasComponent,
      },
    });
    expect(seen?.active).toBe(true);
    expect(seen?.block).toEqual({ 'data-editor-block': 'h1' });
    expect(seen?.field).toEqual({
      text: { 'data-editor-field': 'text' },
      level: { 'data-editor-field': 'level' },
    });
  });

  it('warns and renders null for an unknown type', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const tree: BlockTreeNode = {
      blockId: 'root_1',
      type: 'root',
      properties: {},
      children: [
        {
          blockId: 'w1',
          type: 'widget',
          properties: {},
          children: [],
        },
      ],
    };
    const { host } = renderCanvas(undefined, { tree });
    expect(host.querySelector('[data-editor-block]')).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      'Canvas.Root: no component mapped for block type "widget"',
    );
    warn.mockRestore();
  });

  it('calls a reference resolver once for the same rootId', () => {
    const reference = vi.fn(() => resolvedRef);
    const { rerender } = render(
      <Editor.Root schema={cardSchema} defaultValue={twoCards()}>
        <Canvas.Root components={cardBlocks} resolve={{ reference }} />
      </Editor.Root>,
    );
    expect(reference).toHaveBeenCalledTimes(1);
    rerender(
      <Editor.Root schema={cardSchema} defaultValue={twoCards()}>
        <Canvas.Root components={cardBlocks} resolve={{ reference }} />
      </Editor.Root>,
    );
    expect(reference).toHaveBeenCalledTimes(1);
  });

  it('omits an unresolved reference and sets data-unresolved', () => {
    const { host } = renderCanvas(undefined, {
      schema: cardSchema,
      tree: twoCards(),
      components: cardBlocks,
    });
    const cards = host.querySelectorAll('[data-testid="card"]');
    expect(cards).toHaveLength(2);
    expect(cards[0]?.textContent).toBe('missing');
    expect(cards[0]?.getAttribute('data-unresolved')).toBe('');
  });

  it('throws when surface is frame', () => {
    expect(() =>
      render(
        <Editor.Root schema={storeSchema} defaultValue={makeTree()}>
          <Canvas.Root components={canvasBlocks} surface="frame" />
        </Editor.Root>,
      ),
    ).toThrow('Canvas.Root: surface "frame" is not implemented');
  });

  it('marks referenced trees readonly and does not select them', () => {
    const featured = {
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
    function Hero({
      children,
      edit,
    }: {
      children?: React.ReactNode;
      edit: EditProps;
    }) {
      return <section {...edit.block}>{children}</section>;
    }
    function Item({
      properties,
      edit,
    }: {
      properties: Record<string, unknown>;
      edit: EditProps;
    }) {
      return <article {...edit.block}>{String(properties.label)}</article>;
    }
    const { host, store } = renderCanvas(undefined, {
      schema: {
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
          item: {
            label: 'Item',
            properties: { label: { type: 'string', label: 'Label' } },
          },
        },
      },
      tree: {
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
        ],
      },
      components: {
        hero: Hero as unknown as CanvasComponent,
        item: Item as unknown as CanvasComponent,
      },
      resolve: { reference: () => featured },
    });
    const readonly = host.querySelector('[data-editor-readonly][inert]');
    expect(readonly).not.toBeNull();
    const inner = host.querySelector('article');
    expect(inner).not.toBeNull();
    expect(inner?.hasAttribute('data-editor-block')).toBe(false);
    inner!.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    );
    expect(store.getState().selection.local?.selected).toBeNull();
  });

  it('intercepts a[href] clicks with preventDefault', () => {
    const { host } = renderCanvas(<a href="https://example.com">Go</a>);
    const link = host.querySelector('a');
    expect(link).not.toBeNull();
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    link!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('warns when a mapped block renders no data-editor-block', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    function Broken() {
      return (
        <>
          <span />
        </>
      );
    }
    renderCanvas(undefined, {
      tree: {
        blockId: 'root_1',
        type: 'root',
        properties: {},
        children: [
          {
            blockId: 'h1',
            type: 'heading',
            properties: { text: 'Hello', level: 1 },
            children: [],
          },
        ],
      },
      components: { heading: Broken as unknown as CanvasComponent },
    });
    expect(warn).toHaveBeenCalledWith(
      'Canvas.Root: block "h1" (type "heading") rendered no [data-editor-block] attribute. Spread edit.block on the block\'s root element. A display: contents wrapper is the documented escape when the component has no single root.',
    );
    warn.mockRestore();
  });

  it('stripped HTML matches a local published walk of the same components', () => {
    const { host } = renderCanvas(undefined, {
      schema: heroSchema,
      tree: heroTree,
      components: heroBlocks,
      resolve: { reference: () => featuredRef },
    });
    const published = render(
      <div>
        <PublishedHeroTree />
      </div>,
    );
    expect(strippedHtml(host)).toBe(
      strippedHtml(published.container.firstElementChild as HTMLElement),
    );
  });
});
