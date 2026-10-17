import { describe, expect, it } from 'vitest';

import { readImageDimensions } from '../../../core/media/dimensions';
import { readProvenance } from '../../../core/media/provenance';
import { hasGps, provenanceXmp, stripGps, writeXmp } from '../container';
import {
  encode,
  LATITUDE,
  concat,
  tiffWithGps,
  contains,
  XMP,
  C2PA,
  jpegWithGps,
  pngTypes,
  pngWithGps,
  webpChunk,
  riff,
  VP8,
} from './fixtures';

describe('stripGps', () => {
  it('removes the GPS IFD of a JPEG and leaves XMP and C2PA byte-identical', () => {
    const input = jpegWithGps();
    expect(hasGps(input, 'image/jpeg')).toBe(true);
    const { bytes, stripped } = stripGps(input, 'image/jpeg');
    expect(stripped).toBe(true);
    expect(hasGps(bytes, 'image/jpeg')).toBe(false);
    expect(bytes.length).toBe(input.length);
    expect(contains(bytes, [...XMP])).toBe(true);
    expect(contains(bytes, [...C2PA])).toBe(true);
    expect(contains(bytes, LATITUDE)).toBe(false);
    expect(contains(bytes, [...encode('Cam\0')])).toBe(true);
    expect(contains(bytes, [...encode('Ann\0')])).toBe(true);
    // The input is not modified.
    expect(hasGps(input, 'image/jpeg')).toBe(true);
  });

  it('drops Artist and Copyright when keepCopyright is false', () => {
    const { bytes } = stripGps(jpegWithGps(), 'image/jpeg', {
      keepCopyright: false,
    });
    expect(contains(bytes, [...encode('Cam\0')])).toBe(true);
    // The inline value went with its entry.
    expect(contains(bytes, [...encode('Ann\0')])).toBe(false);
  });

  it('returns the same bytes when there is no GPS', () => {
    const input = concat([0xff, 0xd8], XMP, [0xff, 0xd9]);
    const result = stripGps(input, 'image/jpeg');
    expect(result).toEqual({ bytes: input, stripped: false });
  });

  it('removes GPS from a PNG eXIf chunk and GPS text chunks', () => {
    const { bytes, stripped } = stripGps(pngWithGps(), 'image/png');
    expect(stripped).toBe(true);
    expect(hasGps(bytes, 'image/png')).toBe(false);
    expect(pngTypes(bytes)).toEqual(['IHDR', 'eXIf', 'tEXt', 'IDAT', 'IEND']);
    expect(contains(bytes, [...encode('hello')])).toBe(true);
  });

  it('removes GPS from a WebP EXIF chunk', () => {
    const input = riff(VP8, webpChunk('EXIF', tiffWithGps()));
    expect(hasGps(input, 'image/webp')).toBe(true);
    const { bytes, stripped } = stripGps(input, 'image/webp');
    expect(stripped).toBe(true);
    expect(hasGps(bytes, 'image/webp')).toBe(false);
    expect(bytes.length).toBe(input.length);
  });
});

describe('writeXmp', () => {
  const xmp = provenanceXmp('trainedAlgorithmicMedia');

  it('builds a packet the provenance reader understands', () => {
    expect(readProvenance(encode(xmp)).provenance).toBe('ai_generated');
  });

  it('adds an XMP APP1 to a JPEG and replaces an existing one', () => {
    const input = jpegWithGps();
    const once = writeXmp(input, 'image/jpeg', xmp)!;
    const twice = writeXmp(once, 'image/jpeg', xmp)!;
    expect(readProvenance(twice).provenance).toBe('ai_generated');
    expect(contains(twice, [...encode('keep me')])).toBe(false);
    expect(twice.length).toBe(once.length);
    expect(contains(twice, [...C2PA])).toBe(true);
  });

  it('adds an iTXt chunk before IDAT of a PNG', () => {
    const out = writeXmp(pngWithGps(), 'image/png', xmp)!;
    const types = pngTypes(out);
    expect(types.indexOf('iTXt')).toBe(types.indexOf('IDAT') - 1);
    expect(readProvenance(out).provenance).toBe('ai_generated');
    const again = writeXmp(out, 'image/png', xmp)!;
    expect(pngTypes(again).filter((t) => t === 'iTXt')).toHaveLength(1);
  });

  it('turns a simple WebP into an extended one with an XMP chunk', () => {
    const out = writeXmp(riff(VP8), 'image/webp', xmp)!;
    expect(String.fromCharCode(...out.subarray(12, 16))).toBe('VP8X');
    expect(out[20] & 0x04).toBe(0x04);
    expect(readImageDimensions(out)).toEqual({ width: 40, height: 30 });
    expect(new DataView(out.buffer).getUint32(4, true)).toBe(out.length - 8);
    expect(readProvenance(out).provenance).toBe('ai_generated');
  });
});
