import { expect } from 'vitest';

export const encode = (text: string) => new TextEncoder().encode(text);
export const LATITUDE = [0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38];

export function concat(...parts: (Uint8Array | number[])[]): Uint8Array {
  const out: number[] = [];
  for (const part of parts) out.push(...part);
  return new Uint8Array(out);
}

/**
 * A little-endian TIFF: IFD0 with Make "Cam", Artist "Ann" and a GPS IFD
 * pointer; the GPS IFD holds a latitude whose 24 rational bytes live out of
 * line.
 */
export function tiffWithGps(): Uint8Array {
  const bytes = new Uint8Array(120);
  const view = new DataView(bytes.buffer);
  bytes.set(encode('II'), 0);
  view.setUint16(2, 42, true);
  view.setUint32(4, 8, true);
  // IFD0 at 8: 3 entries, next IFD 0.
  view.setUint16(8, 3, true);
  const entry = (
    at: number,
    tag: number,
    type: number,
    count: number,
    value: number,
  ) => {
    view.setUint16(at, tag, true);
    view.setUint16(at + 2, type, true);
    view.setUint32(at + 4, count, true);
    view.setUint32(at + 8, value, true);
  };
  entry(10, 0x010f, 2, 4, 0); // Make, value inline
  bytes.set(encode('Cam\0'), 18);
  entry(22, 0x013b, 2, 4, 0); // Artist, value inline
  bytes.set(encode('Ann\0'), 30);
  entry(34, 0x8825, 4, 1, 50); // GPS IFD at 50
  view.setUint32(46, 0, true);
  // GPS IFD at 50: one entry, latitude (3 rationals) at 68.
  view.setUint16(50, 1, true);
  entry(52, 0x0002, 5, 3, 68);
  view.setUint32(64, 0, true);
  for (let i = 0; i < 24; i++) bytes[68 + i] = LATITUDE[i % 8];
  return bytes;
}

export function contains(haystack: Uint8Array, needle: number[]): boolean {
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

export function jpegSegment(marker: number, payload: Uint8Array): Uint8Array {
  const length = payload.length + 2;
  return concat([0xff, marker, length >> 8, length & 0xff], payload);
}

export const XMP = jpegSegment(
  0xe1,
  encode('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>keep me</x:xmpmeta>'),
);
export const C2PA = jpegSegment(
  0xeb,
  encode('JP....jumb....jumdc2pa manifest'),
);

export function jpegWithGps(): Uint8Array {
  return concat(
    [0xff, 0xd8],
    jpegSegment(0xe1, concat(encode('Exif\0\0'), tiffWithGps())),
    XMP,
    C2PA,
    [0xff, 0xda, 0x00, 0x02, 0x11, 0x22, 0xff, 0xd9],
  );
}

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

export function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** Every chunk of a PNG with a valid CRC, by type. */
export function pngTypes(bytes: Uint8Array): string[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const types: string[] = [];
  let offset = 8;
  while (offset < bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const crc = view.getUint32(offset + 8 + length);
    expect(crc).toBe(crc32(bytes.subarray(offset + 4, offset + 8 + length)));
    types.push(type);
    offset += 12 + length;
  }
  return types;
}

export const IHDR = pngChunk(
  'IHDR',
  new Uint8Array([0, 0, 0, 4, 0, 0, 0, 3, 8, 6, 0, 0, 0]),
);

export function pngWithGps(): Uint8Array {
  return concat(
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    IHDR,
    pngChunk('eXIf', tiffWithGps()),
    pngChunk('tEXt', encode('GPSLatitude\x0052.5')),
    pngChunk('tEXt', encode('Comment\0hello')),
    pngChunk('IDAT', new Uint8Array([1, 2, 3])),
    pngChunk('IEND', new Uint8Array()),
  );
}

export function webpChunk(type: string, data: Uint8Array): Uint8Array {
  const pad = data.length % 2;
  const out = new Uint8Array(8 + data.length + pad);
  out.set(encode(type), 0);
  new DataView(out.buffer).setUint32(4, data.length, true);
  out.set(data, 8);
  return out;
}

export function riff(...chunks: Uint8Array[]): Uint8Array {
  const body = concat(encode('WEBP'), ...chunks);
  const out = concat(encode('RIFF'), [0, 0, 0, 0], body);
  new DataView(out.buffer).setUint32(4, out.length - 8, true);
  return out;
}

/** A lossy (VP8) frame header for a 40 x 30 image. */
export const VP8 = webpChunk(
  'VP8 ',
  new Uint8Array([0, 0, 0, 0x9d, 0x01, 0x2a, 40, 0, 30, 0]),
);
