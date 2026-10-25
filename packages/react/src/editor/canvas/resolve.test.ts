import { describe, expect, it, vi } from 'vitest';

import { defineEditorSchema } from '../core/schema';
import { storeSchema } from '../core/store/fixtures';
import { canvasEdit, NO_EDIT } from './edit';
import {
  cacheKey,
  createResolveCache,
  readResolved,
  resolveNodeProperties,
} from './resolve';

const schema = defineEditorSchema({
  root: { label: 'Root', fields: {}, slots: { children: {} } },
  components: {
    card: {
      label: 'Card',
      fields: {
        title: { type: 'text' },
        source: { type: 'reference', collection: 'items' },
        image: { type: 'media' },
      },
    },
  },
});

function cache(onTick = vi.fn()) {
  return createResolveCache({ onTick, isMounted: () => true });
}

describe('canvasEdit', () => {
  it('uses the schema field keys, including unused ones', () => {
    expect(canvasEdit('h1', 'heading', storeSchema, false)).toEqual({
      active: true,
      block: { 'data-editor-block': 'h1' },
      field: {
        text: { 'data-editor-field': 'text' },
        level: { 'data-editor-field': 'level' },
      },
    });
  });

  it('adds data-unresolved on the block', () => {
    expect(canvasEdit('h1', 'heading', storeSchema, true).block).toEqual({
      'data-editor-block': 'h1',
      'data-unresolved': '',
    });
  });

  it('adds one slot anchor per declared slot', () => {
    expect(canvasEdit('s1', 'section', storeSchema, false).slot).toEqual({
      children: { 'data-editor-slot': 'children' },
    });
  });
});

describe('NO_EDIT', () => {
  it('is frozen, inactive and empty', () => {
    expect(Object.isFrozen(NO_EDIT)).toBe(true);
    expect(NO_EDIT).toEqual({ active: false, block: {}, field: {} });
  });
});

describe('resolve cache', () => {
  const field = schema.components.card.fields.source;

  it('keys by kind and value', () => {
    expect(cacheKey('reference', { id: 'a' })).toBe('reference\0{"id":"a"}');
    expect(cacheKey('text', 'x')).toBe('text\0x');
  });

  it('a second lookup does not call the resolver', () => {
    const resolver = vi.fn(() => 'ready');
    const c = cache();
    expect(c.lookup('reference', { id: 'a' }, field, resolver)).toEqual({
      status: 'ready',
      value: 'ready',
    });
    c.lookup('reference', { id: 'a' }, field, resolver);
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it('settles a promise and ticks', async () => {
    const onTick = vi.fn();
    const c = cache(onTick);
    const entry = c.lookup('reference', { id: 'a' }, field, () =>
      Promise.resolve('later'),
    );
    expect(entry.status).toBe('pending');
    await Promise.resolve();
    await Promise.resolve();
    expect(onTick).toHaveBeenCalledTimes(1);
    expect(c.lookup('reference', { id: 'a' }, field, vi.fn())).toEqual({
      status: 'ready',
      value: 'later',
    });
  });

  it('treats undefined, a throw and a rejection as a miss', async () => {
    const c = cache();
    expect(c.lookup('reference', { id: 'u' }, field, () => undefined)).toEqual({
      status: 'miss',
    });
    expect(
      c.lookup('reference', { id: 't' }, field, () => {
        throw new Error('x');
      }),
    ).toEqual({ status: 'miss' });
    c.lookup('reference', { id: 'r' }, field, () =>
      Promise.reject(new Error()),
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(c.lookup('reference', { id: 'r' }, field, vi.fn())).toEqual({
      status: 'miss',
    });
  });

  it('is a miss without a resolver', () => {
    expect(cache().lookup('reference', { id: 'a' }, field, undefined)).toEqual({
      status: 'miss',
    });
  });
});

describe('resolveNodeProperties', () => {
  const raw = {
    title: 'Hi {{name}}',
    source: { id: 'abc' },
    image: { assetId: 'img' },
    extra: 1,
  };

  it('renders every prop as stored without resolvers', () => {
    expect(
      resolveNodeProperties('card', raw, schema, undefined, cache()),
    ).toEqual({ properties: raw, unresolved: false });
  });

  it('replaces ready values per kind and keeps the rest', () => {
    const out = resolveNodeProperties(
      'card',
      raw,
      schema,
      {
        text: (value) => String(value).replace('{{name}}', 'Ada'),
        reference: () => ({ title: 'Item' }),
      },
      cache(),
    );
    expect(out).toEqual({
      properties: {
        title: 'Hi Ada',
        source: { title: 'Item' },
        image: { assetId: 'img' },
        extra: 1,
      },
      unresolved: false,
    });
  });

  it('keeps the stored value and flags unresolved while pending or missing', () => {
    const pending = resolveNodeProperties(
      'card',
      raw,
      schema,
      { reference: () => new Promise(() => {}) },
      cache(),
    );
    expect(pending.properties.source).toEqual({ id: 'abc' });
    expect(pending.unresolved).toBe(true);
    const miss = resolveNodeProperties(
      'card',
      raw,
      schema,
      { reference: () => undefined },
      cache(),
    );
    expect(miss.properties.source).toEqual({ id: 'abc' });
    expect(miss.unresolved).toBe(true);
  });

  it('never resolves an empty value', () => {
    const resolver = vi.fn();
    const out = resolveNodeProperties(
      'card',
      { title: '', source: null },
      schema,
      { text: resolver, reference: resolver },
      cache(),
    );
    expect(resolver).not.toHaveBeenCalled();
    expect(out.unresolved).toBe(false);
  });
});

describe('readResolved', () => {
  const field = schema.components.card.fields.title;

  it('returns the ready value, else undefined', () => {
    expect(readResolved('text', 'x', field, { text: () => 'X' }, cache())).toBe(
      'X',
    );
    expect(
      readResolved('text', 'x', field, undefined, cache()),
    ).toBeUndefined();
    expect(
      readResolved('text', 'x', field, { text: () => undefined }, cache()),
    ).toBeUndefined();
  });
});
