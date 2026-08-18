import type { BlockProperty, CollectionDefinition } from '@createcms/schema';

import { describe, expect, it, vi } from 'vitest';

import type { CanvasComponent } from './map';

import { storeSchema } from '../store/fixtures';
import { canvasEdit, NO_EDIT } from './edit';
import { resolveComponentMap } from './map';
import {
  createResolveCache,
  resolveNodeProperties,
  routeProperty,
} from './resolve';

const stub: CanvasComponent = () => null;

const referenceSpec = {
  type: 'reference',
  collection: 'items',
  label: 'Source',
} as BlockProperty;

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

describe('resolveComponentMap', () => {
  it('returns a plain record as the map', () => {
    const components = { heading: stub };
    expect(resolveComponentMap(components)).toBe(components);
  });

  it('unwraps a { _components } record', () => {
    const inner = { heading: stub };
    expect(resolveComponentMap({ _components: inner })).toBe(inner);
  });
});

describe('canvasEdit', () => {
  it('uses schema field keys including unused level', () => {
    const edit = canvasEdit('h1', 'heading', storeSchema, false);
    expect(edit.active).toBe(true);
    expect(edit.block).toEqual({ 'data-editor-block': 'h1' });
    expect(edit.field).toEqual({
      text: { 'data-editor-field': 'text' },
      level: { 'data-editor-field': 'level' },
    });
  });

  it('adds data-unresolved on the block object', () => {
    const edit = canvasEdit('h1', 'heading', storeSchema, true);
    expect(edit.block).toEqual({
      'data-editor-block': 'h1',
      'data-unresolved': '',
    });
  });
});

describe('NO_EDIT', () => {
  it('is frozen with active false', () => {
    expect(NO_EDIT.active).toBe(false);
    expect(Object.isFrozen(NO_EDIT)).toBe(true);
  });
});

describe('resolve cache', () => {
  it('second lookup does not call the resolver', () => {
    const cache = createResolveCache({
      onTick: () => {},
      isMounted: () => true,
    });
    const resolver = vi.fn(() => resolvedRef);
    cache.lookup('reference', 'abc', referenceSpec, resolver);
    cache.lookup('reference', 'abc', referenceSpec, resolver);
    expect(resolver).toHaveBeenCalledTimes(1);
  });
});

describe('routeProperty', () => {
  it('does not route image values', () => {
    const spec = {
      type: 'image',
      label: 'Image',
    } as BlockProperty;
    expect(routeProperty(spec, 'asset_1', {})).toEqual({ keep: true });
  });

  it('keeps a string when no string resolver is present', () => {
    const spec = { type: 'string', label: 'Text' } as BlockProperty;
    expect(routeProperty(spec, 'Hello', {})).toEqual({ keep: true });
  });
});

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

describe('resolveNodeProperties', () => {
  it('omits an unresolved reference', () => {
    const cache = createResolveCache({
      onTick: () => {},
      isMounted: () => true,
    });
    const result = resolveNodeProperties(
      'card',
      { source: 'abc' },
      cardSchema,
      {},
      cache,
    );
    expect(result.properties).toEqual({});
    expect(result.unresolved).toBe(true);
  });

  it('replaces a resolved reference', () => {
    const cache = createResolveCache({
      onTick: () => {},
      isMounted: () => true,
    });
    const result = resolveNodeProperties(
      'card',
      { source: 'abc' },
      cardSchema,
      { reference: () => resolvedRef },
      cache,
    );
    expect(result.properties.source).toBe(resolvedRef);
    expect(result.unresolved).toBe(false);
  });
});

const heroCopySchema = {
  label: 'Pages',
  root: { properties: {} },
  blocks: {
    hero: {
      label: 'Hero',
      properties: {
        headline: { type: 'string', label: 'Headline' },
        cta: { type: 'link', label: 'CTA' },
      },
    },
  },
} satisfies CollectionDefinition;

const rawExternalLink = {
  kind: 'external' as const,
  url: 'https://example.com',
};

describe('resolveNodeProperties string and link misses', () => {
  it('keeps a string when the resolver returns undefined', () => {
    const cache = createResolveCache({
      onTick: () => {},
      isMounted: () => true,
    });
    const result = resolveNodeProperties(
      'hero',
      { headline: 'Get Started' },
      heroCopySchema,
      { string: () => undefined },
      cache,
    );
    expect(result.properties.headline).toBe('Get Started');
    expect(result.unresolved).toBe(true);
  });

  it('keeps a string while the resolver is pending', () => {
    const cache = createResolveCache({
      onTick: () => {},
      isMounted: () => true,
    });
    const result = resolveNodeProperties(
      'hero',
      { headline: 'Get Started' },
      heroCopySchema,
      { string: () => new Promise(() => {}) },
      cache,
    );
    expect(result.properties.headline).toBe('Get Started');
    expect(result.unresolved).toBe(true);
  });

  it('keeps a link when the resolver returns undefined', () => {
    const cache = createResolveCache({
      onTick: () => {},
      isMounted: () => true,
    });
    const result = resolveNodeProperties(
      'hero',
      { cta: rawExternalLink },
      heroCopySchema,
      { link: () => undefined },
      cache,
    );
    expect(result.properties.cta).toEqual(rawExternalLink);
    expect(result.unresolved).toBe(true);
  });

  it('replaces a string when the resolver returns a value', () => {
    const cache = createResolveCache({
      onTick: () => {},
      isMounted: () => true,
    });
    const result = resolveNodeProperties(
      'hero',
      { headline: 'Hello {{brand}}' },
      heroCopySchema,
      { string: () => 'Hello Toerbo' },
      cache,
    );
    expect(result.properties.headline).toBe('Hello Toerbo');
    expect(result.unresolved).toBe(false);
  });
});
