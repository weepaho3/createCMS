import { describe, expect, it } from 'vitest';

import { readImageDimensions } from '../dimensions';
import { sniffType } from '../sniff';
import { formatVariantKey, parseVariantKey } from '../variant-key';

/** Packs `[value, bitCount]` pairs LSB first, as a JPEG XL codestream does. */
function bitsOf(fields: [number, number][]): number[] {
  const out: number[] = [];
  let position = 0;
  for (const [value, count] of fields) {
    for (let i = 0; i < count; i++, position++) {
      if ((position & 7) === 0) out.push(0);
      out[out.length - 1] |= (Math.floor(value / 2 ** i) & 1) << (position & 7);
    }
  }
  return out;
}

const codestream = (fields: [number, number][]) =>
  new Uint8Array([0xff, 0x0a, ...bitsOf(fields), 0, 0, 0, 0]);

describe('JPEG XL', () => {
  it('reads the size of bare codestreams', () => {
    // small: 32 x 16 (div8 minus 1 = 3 and 1, ratio 0)
    expect(
      readImageDimensions(
        codestream([
          [1, 1],
          [1, 5],
          [0, 3],
          [3, 5],
        ]),
      ),
    ).toEqual({ width: 32, height: 16 });
    // U32 with 13 bits: height 1080, ratio 16:9 gives width 1920
    expect(
      readImageDimensions(
        codestream([
          [0, 1],
          [1, 2],
          [1079, 13],
          [5, 3],
        ]),
      ),
    ).toEqual({ width: 1920, height: 1080 });
    // height 427 (selector 0, 9 bits) and explicit width 640 (selector 1, 13 bits)
    expect(
      readImageDimensions(
        codestream([
          [0, 1],
          [0, 2],
          [426, 9],
          [0, 3],
          [1, 2],
          [639, 13],
        ]),
      ),
    ).toEqual({ width: 640, height: 427 });
  });

  it('finds the codestream inside the container and sniffs both forms', () => {
    const code = codestream([
      [0, 1],
      [0, 2],
      [479, 9],
      [0, 3],
      [0, 2],
      [319, 9],
    ]);
    const box = (type: string, payload: Uint8Array) => {
      const out = new Uint8Array(8 + payload.length);
      new DataView(out.buffer).setUint32(0, out.length);
      out.set(new TextEncoder().encode(type), 4);
      out.set(payload, 8);
      return out;
    };
    const signature = new Uint8Array([
      0, 0, 0, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a,
    ]);
    const ftyp = box('ftyp', new TextEncoder().encode('jxl \0\0\0\0jxl '));
    const container = new Uint8Array([
      ...signature,
      ...ftyp,
      ...box('jxlc', code),
    ]);
    expect(readImageDimensions(container)).toEqual({ width: 320, height: 480 });
    expect(sniffType(container)).toBe('image/jxl');
    expect(sniffType(code)).toBe('image/jxl');
  });

  it('is a variant format', () => {
    expect(parseVariantKey('w640.jxl')).toEqual({
      kind: 'image',
      width: 640,
      format: 'jxl',
    });
    expect(
      formatVariantKey({ kind: 'image', width: 1280, format: 'jxl' }),
    ).toBe('w1280.jxl');
  });
});
