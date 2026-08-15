import { describe, expect, it } from 'vitest';

import { defaultValuesFor } from './defaults';
import { pages } from './fixtures';

describe('defaultValuesFor — core semantics (no fillDefaults)', () => {
  it('emits only declared defaultValue keys: heading → { level: 2 }', () => {
    expect(defaultValuesFor(pages.blocks.heading)).toEqual({ level: 2 });
  });

  it('a declared "" IS emitted: image → { alt: "" }', () => {
    expect(defaultValuesFor(pages.blocks.image)).toEqual({ alt: '' });
  });

  it('a spec with defaultValue: undefined is skipped', () => {
    const result = defaultValuesFor({
      properties: {
        x: { type: 'string', label: 'X', defaultValue: undefined },
      },
    });
    expect(result).toEqual({});
  });

  it('defaultValue: null / false / 0 are emitted', () => {
    const result = defaultValuesFor({
      properties: {
        a: {
          type: 'string',
          label: 'A',
          defaultValue: null as unknown as string,
        },
        b: { type: 'boolean', label: 'B', defaultValue: false },
        c: { type: 'number', label: 'C', defaultValue: 0 },
      },
    });
    expect(result).toEqual({ a: null, b: false, c: 0 });
  });

  it('cta → {} (no declared defaults; nothing filled)', () => {
    expect(defaultValuesFor(pages.blocks.cta)).toEqual({});
  });

  it('root works: defaultValuesFor(pages.root) → {}', () => {
    expect(defaultValuesFor(pages.root)).toEqual({});
  });
});

describe('defaultValuesFor — fillDefaults: true', () => {
  it('cta → { variant: "solid", enabled: false, tags: [], sizes: [] }, target/link absent', () => {
    const result = defaultValuesFor(pages.blocks.cta, { fillDefaults: true });
    expect(result).toEqual({
      variant: 'solid',
      enabled: false,
      tags: [],
      sizes: [],
    });
    expect('target' in result).toBe(false);
    expect('link' in result).toBe(false);
  });

  it('heading → { text: "", level: 2 } (declared wins over fill)', () => {
    expect(
      defaultValuesFor(pages.blocks.heading, { fillDefaults: true }),
    ).toEqual({ text: '', level: 2 });
  });

  it('a select without options stays absent', () => {
    const result = defaultValuesFor(
      {
        properties: {
          s: { type: 'select', label: 'S', options: [] },
        },
      },
      { fillDefaults: true },
    );
    expect('s' in result).toBe(false);
  });

  it('root → { title: "", slugHint: "" }, publishedAt stays absent (date)', () => {
    const result = defaultValuesFor(pages.root, { fillDefaults: true });
    expect(result).toEqual({ title: '', slugHint: '' });
    expect('publishedAt' in result).toBe(false);
  });
});

describe('defaultValuesFor — returns a fresh object each call', () => {
  it('mutating the result does not affect the next call', () => {
    const first = defaultValuesFor(pages.blocks.heading);
    first.level = 999;
    const second = defaultValuesFor(pages.blocks.heading);
    expect(second).toEqual({ level: 2 });
  });
});
