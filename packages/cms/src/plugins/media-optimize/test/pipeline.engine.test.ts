import { describe, expect, it } from 'vitest';

import { readImageDimensions } from '../../../core/media/dimensions';
import { sniffType } from '../../../core/media/sniff';
import { parseVariantKey } from '../../../core/media/variant-key';
import { hasGps } from '../container';
import { canEncodeWebpNatively, createBrowserEnv } from '../pipeline/codecs';
import { DEFAULT_SETTINGS, processFile } from '../pipeline/process';
import {
  C2PA,
  concat,
  contains,
  encode,
  jpegSegment,
  tiffWithGps,
} from './fixtures';

const IPTC = 'http://cv.iptc.org/newscodes/digitalsourcetype/';
const AI_XMP = jpegSegment(
  0xe1,
  encode(
    `http://ns.adobe.com/xap/1.0/\0<rdf:Description Iptc4xmpExt:DigitalSourceType="${IPTC}trainedAlgorithmicMedia"/>`,
  ),
);

/** A real JPEG drawn on a canvas, `width` x `height`. */
async function canvasJpeg(width: number, height: number): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d')!;
  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#0b5');
  gradient.addColorStop(1, '#f40');
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  const blob = await canvas.convertToBlob({
    type: 'image/jpeg',
    quality: 0.92,
  });
  return new Uint8Array(await blob.arrayBuffer());
}

/** `jpeg` with segments inserted right after its SOI marker. */
function withSegments(jpeg: Uint8Array, ...segments: Uint8Array[]): Uint8Array {
  return concat(jpeg.subarray(0, 2), ...segments, jpeg.subarray(2));
}

const isWebp = (bytes: Uint8Array) =>
  String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' &&
  String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP';

const env = createBrowserEnv({ webp: () => import('@jsquash/webp/encode') });

describe('optimizer pipeline in this engine', () => {
  it('produces real WebP renditions, natively or through jSquash', async () => {
    const native = await canEncodeWebpNatively();
    const file = new File(
      [new Uint8Array(await canvasJpeg(1600, 1200))],
      'photo.jpg',
      {
        type: 'image/jpeg',
      },
    );
    const started = performance.now();
    const out = await processFile(file, DEFAULT_SETTINGS, env);
    const ms = performance.now() - started;
    console.info(
      `[bench] ${navigator.userAgent.match(/(Firefox|Chrome|Safari)\/[\d.]+/)?.[0]} native WebP: ${native}, 1600x1200 to ${out.renditions.length} renditions in ${Math.round(ms)} ms`,
    );

    expect(out.renditions.map((r) => r.width)).toEqual([320, 640, 1280]);
    for (const rendition of out.renditions) {
      expect(rendition.variantKey).toBe(`w${rendition.width}.webp`);
      // The blob type alone is not trusted (a canvas may fall back to PNG).
      expect(isWebp(new Uint8Array(await rendition.blob.arrayBuffer()))).toBe(
        true,
      );
    }
  });

  it('strips GPS, keeps C2PA byte for byte and writes IPTC into renditions', async () => {
    const gps = jpegSegment(0xe1, concat(encode('Exif\0\0'), tiffWithGps()));
    const bytes = withSegments(await canvasJpeg(800, 600), gps, AI_XMP, C2PA);
    const file = new File([new Uint8Array(bytes)], 'ai.jpg', {
      type: 'image/jpeg',
    });
    expect(hasGps(bytes, 'image/jpeg')).toBe(true);

    const out = await processFile(file, DEFAULT_SETTINGS, env);
    const original = new Uint8Array(await out.file.arrayBuffer());
    expect(hasGps(original, 'image/jpeg')).toBe(false);
    expect(contains(original, [...C2PA])).toBe(true);
    expect(out.hints.provenance).toBe('ai_generated');
    expect(out.renditions.length).toBeGreaterThan(0);
    for (const rendition of out.renditions) {
      const renditionBytes = new Uint8Array(await rendition.blob.arrayBuffer());
      expect(
        contains(renditionBytes, [...encode('trainedAlgorithmicMedia')]),
      ).toBe(true);
    }
  });

  it('adds JPEG XL renditions when they are enabled', async () => {
    const withJxl = createBrowserEnv({
      webp: () => import('@jsquash/webp/encode'),
      jxl: () => import('@jsquash/jxl/encode'),
    });
    const file = new File(
      [new Uint8Array(await canvasJpeg(1600, 1200))],
      'photo.jpg',
      { type: 'image/jpeg' },
    );
    const out = await processFile(
      file,
      { ...DEFAULT_SETTINGS, renditionFormats: ['webp', 'jxl'] },
      withJxl,
    );
    const jxl = out.renditions.filter((r) => r.variantKey.endsWith('.jxl'));
    expect(jxl.map((r) => r.variantKey)).toEqual([
      'w320.jxl',
      'w640.jxl',
      'w1280.jxl',
    ]);
    for (const rendition of jxl) {
      const bytes = new Uint8Array(await rendition.blob.arrayBuffer());
      // The server checks exactly this before it accepts the rendition.
      expect(sniffType(bytes)).toBe('image/jxl');
      expect(readImageDimensions(bytes)?.width).toBe(
        parseVariantKey(rendition.variantKey)?.width,
      );
    }
  });

  it('leaves GIF untouched', async () => {
    const gif = new Uint8Array([
      0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0x80, 0, 0, 0, 0, 0, 0xff,
      0xff, 0xff, 0x21, 0xf9, 4, 1, 0, 0, 0, 0, 0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0,
      2, 2, 0x44, 1, 0, 0x3b,
    ]);
    const file = new File([gif], 'dot.gif', { type: 'image/gif' });
    const out = await processFile(file, DEFAULT_SETTINGS, env);
    expect(out.file).toBe(file);
    expect(out.renditions).toEqual([]);
  });
});
