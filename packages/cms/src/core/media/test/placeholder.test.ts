import { describe, expect, it } from 'vitest';

import {
  dominantColorOf,
  encodeThumbHash,
  placeholderDataUrl,
} from '../placeholder';

/** A 40 x 20 bitmap, red on the left half and blue on the right. */
function halves(): Uint8Array {
  const rgba = new Uint8Array(40 * 20 * 4);
  for (let y = 0; y < 20; y++) {
    for (let x = 0; x < 40; x++) {
      const i = (y * 40 + x) * 4;
      rgba.set(x < 20 ? [255, 0, 0, 255] : [0, 0, 255, 255], i);
    }
  }
  return rgba;
}

describe('placeholder', () => {
  it('encodes a short base64 hash', () => {
    const hash = encodeThumbHash(halves(), 40, 20);
    expect(hash).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(hash.length).toBeLessThanOrEqual(40);
  });

  it('renders a PNG data URL', () => {
    const url = placeholderDataUrl(encodeThumbHash(halves(), 40, 20));
    expect(url.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('averages the colours', () => {
    const color = dominantColorOf(encodeThumbHash(halves(), 40, 20));
    expect(color).toMatch(/^#[0-9a-f]{6}$/);
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
    expect(r).toBeGreaterThan(80);
    expect(b).toBeGreaterThan(80);
    expect(g).toBeLessThan(40);
  });
});
