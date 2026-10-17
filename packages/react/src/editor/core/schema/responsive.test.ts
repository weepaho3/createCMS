import { describe, expect, it } from 'vitest';

import {
  isLocalizedValue,
  isResponsiveValue,
  resolveLocalized,
  resolveResponsive,
} from './responsive';

describe('resolveResponsive', () => {
  const value = { $r: { base: 1, md: 3 } };

  it.each([
    ['base', 1],
    ['sm', 1],
    ['md', 3],
    ['lg', 3],
    ['xl', 3],
  ] as const)('%s → %s (mobile first)', (breakpoint, expected) => {
    expect(resolveResponsive(value, breakpoint)).toBe(expected);
  });

  it('returns a plain value as is', () => {
    expect(resolveResponsive(5, 'lg')).toBe(5);
  });

  it('detects the wrapper', () => {
    expect(isResponsiveValue(value)).toBe(true);
    expect(isResponsiveValue({ $r: { md: 1 } })).toBe(false);
    expect(isResponsiveValue(1)).toBe(false);
  });
});

describe('resolveLocalized', () => {
  const value = { $l: { de: 'Hallo', en: 'Hello' } };

  it('picks the locale, then the fallback chain', () => {
    expect(resolveLocalized(value, 'de')).toBe('Hallo');
    expect(resolveLocalized(value, 'fr', ['en'])).toBe('Hello');
    expect(resolveLocalized(value, 'fr')).toBeUndefined();
  });

  it('returns a plain value as is and detects the wrapper', () => {
    expect(resolveLocalized('x', 'de')).toBe('x');
    expect(isLocalizedValue(value)).toBe(true);
    expect(isLocalizedValue('x')).toBe(false);
  });
});
