import { cleanup, render } from '@testing-library/react';
// @vitest-environment happy-dom
import { createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import type { BlockTreeNode } from '../../core/blocks/reconstruct-snapshot';
import type {
  AnyBlockDefinition,
  CollectionDefinition,
} from '../../core/types/definitions';
import type { EditProps } from '../blocks';

import {
  BlocksRenderer,
  NO_EDIT,
  createBlocksMap,
  createContentRenderer,
} from '../blocks';

// A collection covering a leaf block with two string properties (hero), a
// richText leaf (paragraph), a block with a reference property (card), and a
// children-carrying container (section) — so anchors are exercised on every
// shape the renderer builds elements for.
const blocks = {
  hero: {
    label: 'Hero',
    properties: {
      headline: { type: 'string', label: 'Headline' },
      badge: { type: 'string', label: 'Badge' },
    },
  },
  paragraph: {
    label: 'Paragraph',
    properties: { text: { type: 'richText', label: 'Text' } },
  },
  card: {
    label: 'Card',
    properties: {
      author: { type: 'reference', label: 'Author', collection: 'authors' },
    },
  },
  section: {
    label: 'Section',
    properties: {},
    allowChildren: true,
  },
} satisfies Record<string, AnyBlockDefinition>;

const collection = {
  label: 'Edit Prop Test Page',
  root: { properties: {} },
  blocks,
} satisfies CollectionDefinition;

let seen: EditProps | undefined;

const map = createBlocksMap(collection, {
  hero: ({ properties, edit }) => {
    seen = edit;
    return (
      <section {...edit.block} data-testid="hero">
        <h1 {...edit.field.headline}>{properties.headline}</h1>
        <span {...edit.field.badge}>{properties.badge}</span>
      </section>
    );
  },
  paragraph: ({ properties, edit }) => (
    <p {...edit.block} {...edit.field.text}>
      {properties.text as string}
    </p>
  ),
  card: ({ edit, children }) => (
    <div {...edit.block} data-testid="card">
      {children}
    </div>
  ),
  section: ({ edit, children }) => <div {...edit.block}>{children}</div>,
});

// root → hero (hero_1), section (sec_1) → paragraph (p_1), card (card_1)
// whose `author` property is a RESOLVED reference carrying a nested tree —
// the referenced paragraph must never get anchors, even in preview mode.
const tree: BlockTreeNode = {
  blockId: 'root',
  type: 'root',
  properties: {},
  children: [
    {
      blockId: 'hero_1',
      type: 'hero',
      properties: { headline: 'Hello', badge: 'New' },
      children: [],
    },
    {
      blockId: 'sec_1',
      type: 'section',
      properties: {},
      children: [
        {
          blockId: 'p_1',
          type: 'paragraph',
          properties: { text: 'A paragraph' },
          children: [],
        },
        {
          blockId: 'card_1',
          type: 'card',
          properties: {
            author: {
              rootId: 'rot_a',
              collection: 'authors',
              properties: {},
              tree: {
                blockId: 'rot_a',
                type: 'root',
                properties: {},
                children: [
                  {
                    blockId: 'ref_p',
                    type: 'paragraph',
                    properties: { text: 'From ref' },
                    children: [],
                  },
                ],
              },
            },
          },
          children: [],
        },
      ],
    },
  ],
};

const RenderPage = createContentRenderer(collection, {
  hero: ({ properties, edit }) => {
    seen = edit;
    return (
      <section {...edit.block} data-testid="hero">
        <h1 {...edit.field.headline}>{properties.headline}</h1>
        <span {...edit.field.badge}>{properties.badge}</span>
      </section>
    );
  },
  paragraph: ({ properties, edit }) => (
    <p {...edit.block} {...edit.field.text}>
      {properties.text as string}
    </p>
  ),
  card: ({ edit, children }) => (
    <div {...edit.block} data-testid="card">
      {children}
    </div>
  ),
  section: ({ edit, children }) => <div {...edit.block}>{children}</div>,
});

// A recursive walk that finds any function value reachable from an object —
// the serialisability guard for the RSC boundary.
function containsFunction(value: unknown): boolean {
  if (typeof value === 'function') return true;
  if (value === null || typeof value !== 'object') return false;
  return Object.values(value).some(containsFunction);
}

describe('edit prop', () => {
  afterEach(() => {
    cleanup();
    seen = undefined;
  });

  it('emits no anchors without the edit prop, on BlocksRenderer', () => {
    const { container } = render(
      createElement(BlocksRenderer, { blocks: map, tree }),
    );
    expect(container.querySelectorAll('[data-editor-block]').length).toBe(0);
    expect(container.querySelectorAll('[data-editor-field]').length).toBe(0);
  });

  it('emits no anchors without the edit prop, on createContentRenderer', () => {
    const { container } = render(createElement(RenderPage, { tree }));
    expect(container.querySelectorAll('[data-editor-block]').length).toBe(0);
    expect(container.querySelectorAll('[data-editor-field]').length).toBe(0);
  });

  it('emits anchors with edit="preview" on BlocksRenderer, none on referenced trees', () => {
    const { container } = render(
      createElement(BlocksRenderer, { blocks: map, tree, edit: 'preview' }),
    );

    expect(
      container.querySelector('[data-editor-block="hero_1"]')?.tagName,
    ).toBe('SECTION');
    expect(
      container.querySelector('[data-editor-field="headline"]')?.tagName,
    ).toBe('H1');
    expect(
      container.querySelector('[data-editor-field="badge"]')?.tagName,
    ).toBe('SPAN');

    const paragraph = container.querySelector('[data-editor-block="p_1"]');
    expect(paragraph).not.toBeNull();
    expect(paragraph?.getAttribute('data-editor-field')).toBe('text');

    expect(
      container.querySelector('[data-editor-block="sec_1"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-editor-block="card_1"]'),
    ).not.toBeNull();

    const referencedParagraph = Array.from(
      container.querySelectorAll('p'),
    ).find((p) => p.textContent === 'From ref');
    expect(referencedParagraph).not.toBeUndefined();
    expect(referencedParagraph?.hasAttribute('data-editor-block')).toBe(false);
    expect(referencedParagraph?.hasAttribute('data-editor-field')).toBe(false);
  });

  it('emits anchors with edit="preview" on createContentRenderer, none on referenced trees', () => {
    const { container } = render(
      createElement(RenderPage, { tree, edit: 'preview' }),
    );

    expect(
      container.querySelector('[data-editor-block="hero_1"]')?.tagName,
    ).toBe('SECTION');
    expect(
      container.querySelector('[data-editor-field="headline"]')?.tagName,
    ).toBe('H1');
    expect(
      container.querySelector('[data-editor-field="badge"]')?.tagName,
    ).toBe('SPAN');

    const paragraph = container.querySelector('[data-editor-block="p_1"]');
    expect(paragraph).not.toBeNull();
    expect(paragraph?.getAttribute('data-editor-field')).toBe('text');

    expect(
      container.querySelector('[data-editor-block="sec_1"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-editor-block="card_1"]'),
    ).not.toBeNull();

    const referencedParagraph = Array.from(
      container.querySelectorAll('p'),
    ).find((p) => p.textContent === 'From ref');
    expect(referencedParagraph).not.toBeUndefined();
    expect(referencedParagraph?.hasAttribute('data-editor-block')).toBe(false);
    expect(referencedParagraph?.hasAttribute('data-editor-field')).toBe(false);
  });

  it('hands the block component a plain-data, serialisable edit object', () => {
    render(createElement(BlocksRenderer, { blocks: map, tree }));
    // Read via a cast, not a flow-narrowed reference: `seen` is reassigned by
    // a module-scope closure the renderer invokes, which the compiler cannot
    // see from this callback's own control flow.
    const withoutEdit = seen as EditProps | undefined;
    expect(withoutEdit).toBeDefined();
    expect(withoutEdit?.active).toBe(false);
    expect(containsFunction(withoutEdit)).toBe(false);
    expect(JSON.parse(JSON.stringify(withoutEdit))).toEqual(withoutEdit);
    expect(withoutEdit).toBe(NO_EDIT);

    cleanup();
    seen = undefined;

    render(
      createElement(BlocksRenderer, { blocks: map, tree, edit: 'preview' }),
    );
    const withPreview = seen as EditProps | undefined;
    expect(withPreview).toBeDefined();
    expect(withPreview?.active).toBe(false);
    expect(containsFunction(withPreview)).toBe(false);
    expect(JSON.parse(JSON.stringify(withPreview))).toEqual(withPreview);
    expect(Object.keys(withPreview?.field ?? {}).sort()).toEqual([
      'badge',
      'headline',
    ]);
  });

  it('NO_EDIT is frozen and equals the no-op shape', () => {
    expect(Object.isFrozen(NO_EDIT)).toBe(true);
    expect(NO_EDIT).toEqual({ active: false, block: {}, field: {} });
  });

  it('passes the node object as properties, unchanged', () => {
    let receivedProperties: unknown;
    const collectionWithProbe = collection;
    const ProbeRender = createContentRenderer(collectionWithProbe, {
      hero: (props) => {
        receivedProperties = props.properties;
        return null;
      },
    });
    render(createElement(ProbeRender, { tree }));
    expect(receivedProperties).toBe(tree.children[0]?.properties);
  });
});
