// @vitest-environment happy-dom
import { createElement } from 'react';

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BlockTreeNode } from '../../core/blocks/reconstruct-snapshot';
import type {
  AnyBlockDefinition,
  CollectionDefinition,
} from '../../core/types/definitions';

import { createContentRenderer } from '../blocks';

// A minimal presentational collection: two blocks with a single string
// property, NEITHER declaring `events` — so the renderer never wraps them in a
// <BlockTracker> and no <TrackingRuntimeProvider> is needed to render them.
const blocks = {
  headline: {
    label: 'Headline',
    properties: { text: { type: 'string', label: 'Text' } },
  },
  paragraph: {
    label: 'Paragraph',
    properties: { text: { type: 'string', label: 'Text' } },
  },
} satisfies Record<string, AnyBlockDefinition>;

const collection = {
  label: 'Test Page',
  root: { properties: {} },
  blocks,
} satisfies CollectionDefinition;

// Component map maps headline + paragraph but deliberately OMITS a 'mystery'
// type (allowed — createContentRenderer takes a Partial map).
const RenderPage = createContentRenderer(collection, {
  headline: ({ properties }) => createElement('h1', null, properties?.text),
  paragraph: ({ properties }) => createElement('p', null, properties?.text),
});

// A root tree carrying a headline, a paragraph, and an unmapped 'mystery' block.
const tree: BlockTreeNode = {
  blockId: 'root',
  type: 'root',
  properties: {},
  children: [
    {
      blockId: 'blk_h',
      type: 'headline',
      properties: { text: 'Hello World' },
      children: [],
    },
    {
      blockId: 'blk_p',
      type: 'paragraph',
      properties: { text: 'A paragraph' },
      children: [],
    },
    {
      blockId: 'blk_m',
      type: 'mystery',
      properties: { text: 'unrenderable' },
      children: [],
    },
  ],
};

describe('createContentRenderer', () => {
  afterEach(() => cleanup());

  it('renders mapped blocks, skips the unmapped one, and dev-warns for it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { container } = render(createElement(RenderPage, { tree }));

    // The mapped blocks render their elements + text.
    const h1 = container.querySelector('h1');
    const p = container.querySelector('p');
    expect(h1?.textContent).toBe('Hello World');
    expect(p?.textContent).toBe('A paragraph');

    // The unmapped 'mystery' block renders nothing — only the two mapped
    // blocks' text is present.
    expect(container.textContent).toBe('Hello WorldA paragraph');

    // And it dev-warns exactly once about the missing component.
    expect(warn).toHaveBeenCalledWith(
      '[cms] No component mapped for block type "mystery"',
    );

    warn.mockRestore();
  });
});
