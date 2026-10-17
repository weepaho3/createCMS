import { describe, expect, it } from 'vitest';

import {
  isAnimated,
  isAnimatedGif,
  isAnimatedPng,
  isAnimatedWebp,
} from '../sniff';

const text = new TextEncoder();

function bytes(...parts: (string | number[])[]): Uint8Array {
  const chunks = parts.map((part) =>
    typeof part === 'string' ? text.encode(part) : Uint8Array.from(part),
  );
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function u32(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

function pngChunk(type: string, length = 4): (string | number[])[] {
  return [u32(length), type, Array.from({ length: length + 4 }, () => 0)];
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function png(...chunks: string[]): Uint8Array {
  return bytes(
    PNG_SIGNATURE,
    ...pngChunk('IHDR', 13),
    ...chunks.flatMap((type) => pngChunk(type)),
  );
}

function webpVp8x(flags: number): Uint8Array {
  return bytes(
    'RIFF',
    [0, 0, 0, 0],
    'WEBP',
    'VP8X',
    u32(10).reverse(),
    [flags, 0, 0, 0],
    Array.from({ length: 6 }, () => 0),
  );
}

describe('animation detection', () => {
  it('flags a WebP whose VP8X header sets the animation bit', () => {
    expect(isAnimatedWebp(webpVp8x(0x02))).toBe(true);
    expect(isAnimatedWebp(webpVp8x(0x10))).toBe(false);
  });

  it('flags a WebP with an ANIM chunk', () => {
    expect(isAnimatedWebp(bytes(webpVp8x(0) as never, 'ANIM'))).toBe(true);
  });

  it('flags an APNG by acTL before IDAT', () => {
    expect(isAnimatedPng(png('acTL', 'IDAT'))).toBe(true);
    expect(isAnimatedPng(png('IDAT', 'acTL'))).toBe(false);
    expect(isAnimatedPng(png('IDAT'))).toBe(false);
  });

  it('only inspects WebP and PNG', () => {
    expect(isAnimated('image/png', png('acTL'))).toBe(true);
    expect(isAnimated('image/jpeg', png('acTL'))).toBe(false);
    expect(isAnimated('image/png', bytes('GIF89a'))).toBe(false);
  });
});

describe('isAnimatedGif', () => {
  it('needs a second graphic control extension', () => {
    const gce = [0x21, 0xf9, 4, 0, 0, 0, 0, 0];
    const head: (string | number[])[] = [
      'GIF89a',
      Array.from({ length: 7 }, () => 0),
    ];
    expect(isAnimatedGif(bytes(...head, gce))).toBe(false);
    expect(isAnimatedGif(bytes(...head, gce, gce))).toBe(true);
    expect(isAnimated('image/gif', bytes(...head, gce, gce))).toBe(true);
  });
});
