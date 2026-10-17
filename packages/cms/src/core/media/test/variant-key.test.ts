import { describe, expect, it } from 'vitest';

import {
  formatVariantKey,
  parseLegacyVariantSlug,
  parseVariantKey,
  VARIANT_FORMATS,
  type VariantSpec,
} from '../variant-key';

function* specs(): Generator<VariantSpec> {
  for (const format of VARIANT_FORMATS) {
    for (const width of [1, 320, 1920, 16_384]) {
      yield { kind: 'poster', width, format };
      for (const height of [undefined, 1, 900]) {
        for (const quality of [undefined, 1, 82, 100]) {
          for (const fit of [undefined, 'cover', 'contain'] as const) {
            const spec: VariantSpec = { kind: 'image', width, format };
            if (height !== undefined) spec.height = height;
            if (quality !== undefined) spec.quality = quality;
            if (fit !== undefined) spec.fit = fit;
            yield spec;
          }
        }
      }
    }
  }
}

describe('variant keys', () => {
  it('round-trips every valid spec', () => {
    let count = 0;
    for (const spec of specs()) {
      const key = formatVariantKey(spec);
      expect(parseVariantKey(key)).toEqual(spec);
      expect(formatVariantKey(parseVariantKey(key)!)).toBe(key);
      count++;
    }
    expect(count).toBeGreaterThan(500);
  });

  it('formats in canonical order', () => {
    expect(
      formatVariantKey({
        kind: 'image',
        width: 640,
        height: 480,
        quality: 82,
        fit: 'cover',
        format: 'webp',
      }),
    ).toBe('w640-h480-q82-fitcover.webp');
    expect(
      formatVariantKey({ kind: 'poster', width: 640, format: 'jpeg' }),
    ).toBe('poster-w640.jpeg');
  });

  it.each([
    'W640.webp',
    'w640.WEBP',
    'w640.gif',
    'w0.webp',
    'w0640.webp',
    'w16385.webp',
    'w640-q0.webp',
    'w640-q101.webp',
    'w640-q82-h480.webp',
    'w640-fitfill.webp',
    'poster-w640-h1.webp',
    'w640',
    '',
  ])('rejects %j', (key) => {
    expect(parseVariantKey(key)).toBeNull();
  });

  it('throws when formatting an invalid spec', () => {
    expect(() =>
      formatVariantKey({ kind: 'image', width: 0, format: 'webp' }),
    ).toThrow();
  });
});

describe('parseLegacyVariantSlug', () => {
  it.each([
    [
      'welcome-hero-800-webp.webp',
      'welcome-hero.jpg',
      { width: 800, format: 'webp' },
    ],
    [
      'welcome-hero-800-webp-2.webp',
      'welcome-hero.jpg',
      { width: 800, format: 'webp' },
    ],
    [
      'welcome-hero-800.jpg',
      'welcome-hero.jpg',
      { width: 800, format: 'jpeg' },
    ],
    [
      'welcome-hero-800-3.png',
      'welcome-hero.png',
      { width: 800, format: 'png' },
    ],
    [
      'welcome-hero-1200-jpeg.jpeg',
      'welcome-hero.png',
      { width: 1200, format: 'jpeg' },
    ],
  ])('parses %s', (slug, base, expected) => {
    expect(parseLegacyVariantSlug(slug, base)).toEqual({
      kind: 'image',
      ...expected,
    });
  });

  it.each([
    ['welcome-hero-webp.webp', 'welcome-hero.jpg'],
    ['other-800-webp.webp', 'welcome-hero.jpg'],
    ['welcome-hero-800-webp.png', 'welcome-hero.jpg'],
    ['welcome-hero-800.gif', 'welcome-hero.gif'],
    ['welcome-hero.jpg', 'welcome-hero.jpg'],
  ])('rejects %s', (slug, base) => {
    expect(parseLegacyVariantSlug(slug, base)).toBeNull();
  });
});
