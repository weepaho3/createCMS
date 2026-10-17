import { describe, expect, it } from 'vitest';

import { defaultValuesFor } from './defaults';
import { pages } from './fixtures';

describe('defaultValuesFor', () => {
  it('seeds declared defaults only', () => {
    expect(defaultValuesFor(pages.components.heading)).toEqual({ level: 2 });
    expect(defaultValuesFor(pages.components.image)).toEqual({ alt: '' });
    expect(defaultValuesFor(pages.components.cta)).toEqual({});
  });

  it('counts null, false, 0 and an empty string as declared', () => {
    expect(
      defaultValuesFor({
        fields: {
          a: { type: 'boolean', defaultValue: false },
          b: { type: 'number', defaultValue: 0 },
          c: { type: 'text', defaultValue: '' },
        },
      }),
    ).toEqual({ a: false, b: 0, c: '' });
  });

  it('fillDefaults adds neutral values for kinds that have one', () => {
    expect(
      defaultValuesFor(pages.components.cta, { fillDefaults: true }),
    ).toEqual({
      variant: 'solid',
      enabled: false,
      tags: [],
      sizes: [],
    });
    expect(
      defaultValuesFor(pages.components.card, { fillDefaults: true }),
    ).toEqual({
      summary: '',
      columns: 0,
      flags: [],
      cta: { label: '', href: '' },
    });
  });

  it('fillDefaults keeps a declared default', () => {
    expect(
      defaultValuesFor(pages.components.heading, { fillDefaults: true }),
    ).toEqual({ text: '', level: 2 });
  });

  it('returns a fresh object per call', () => {
    const a = defaultValuesFor(pages.components.heading);
    const b = defaultValuesFor(pages.components.heading);
    expect(a).not.toBe(b);
  });
});
