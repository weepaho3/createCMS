import { describe, expect, it } from 'vitest';

import type {
  DecodedImage,
  EncodeFormat,
  OptimizeSettings,
  PipelineEnv,
} from '../pipeline/process';

import { readProvenance } from '../../../core/media/provenance';
import { hasGps } from '../container';
import { DEFAULT_SETTINGS, processFile } from '../pipeline/process';
import {
  concat,
  encode,
  jpegSegment,
  jpegWithGps,
  LATITUDE,
  contains,
  riff,
  webpChunk,
} from './fixtures';

const IPTC = 'http://cv.iptc.org/newscodes/digitalsourcetype/';

/** The bytes of an encoded image: a header the fake decoder reads back. */
function fakeEncoded(format: EncodeFormat, width: number, height: number) {
  if (format === 'jpeg') {
    return concat(
      [0xff, 0xd8],
      jpegSegment(0xfe, encode(`size ${width}x${height}`)),
      [0xff, 0xd9],
    );
  }
  return riff(
    webpChunk(
      'VP8 ',
      new Uint8Array([
        0,
        0,
        0,
        0x9d,
        0x01,
        0x2a,
        width & 0xff,
        width >> 8,
        height & 0xff,
        height >> 8,
      ]),
    ),
  );
}

type Calls = {
  encodes: { format: EncodeFormat; width: number; height: number }[];
};

/**
 * A pipeline environment that "decodes" by name (`sizes`) and encodes into
 * small marker blobs. `failDecode` and `failEncode` inject errors.
 */
function fakeEnv(
  sizes: Record<string, [number, number]>,
  options: {
    failDecode?: boolean;
    failEncode?: (format: EncodeFormat, width: number) => boolean;
    mislabel?: EncodeFormat;
  } = {},
): PipelineEnv & { calls: Calls; closed: number } {
  const env = {
    calls: { encodes: [] } as Calls,
    closed: 0,
    async decode(blob: Blob): Promise<DecodedImage> {
      if (options.failDecode) throw new Error('cannot decode');
      const [width, height] = sizes[(blob as File).name] ?? [100, 100];
      return {
        width,
        height,
        close: () => {
          env.closed++;
        },
      };
    },
    async encode(
      _image: DecodedImage,
      out: { width: number; height: number; format: EncodeFormat },
    ) {
      env.calls.encodes.push(out);
      if (options.failEncode?.(out.format, out.width)) {
        throw new Error('encoder crashed');
      }
      const type =
        options.mislabel === out.format ? 'image/png' : `image/${out.format}`;
      return new Blob(
        [fakeEncoded(out.format, out.width, out.height) as BlobPart],
        {
          type,
        },
      );
    },
    async pixels(_image: DecodedImage, maxEdge: number) {
      const width = maxEdge;
      const height = Math.round(maxEdge / 2);
      const data = new Uint8ClampedArray(width * height * 4);
      for (let i = 0; i < data.length; i += 4) data.set([200, 40, 40, 255], i);
      return { data, width, height };
    },
  };
  return env;
}

function file(bytes: Uint8Array, name: string, type: string): File {
  return new File([bytes as BlobPart], name, { type });
}

const settings = (patch: Partial<OptimizeSettings> = {}): OptimizeSettings => ({
  ...DEFAULT_SETTINGS,
  ...patch,
});

describe('processFile', () => {
  it('strips GPS, describes the image and produces the width ladder', async () => {
    const env = fakeEnv({ 'photo.jpg': [4000, 3000] });
    const input = file(jpegWithGps(), 'photo.jpg', 'image/jpeg');
    const out = await processFile(input, settings(), env);

    expect(out.warnings).toEqual([]);
    const bytes = new Uint8Array(await out.file.arrayBuffer());
    expect(hasGps(bytes, 'image/jpeg')).toBe(false);
    expect(contains(bytes, LATITUDE)).toBe(false);
    expect(out.file.name).toBe('photo.jpg');

    expect(
      out.renditions.map((r) => [r.variantKey, r.width, r.height]),
    ).toEqual([
      ['w320.webp', 320, 240],
      ['w640.webp', 640, 480],
      ['w1280.webp', 1280, 960],
      ['w1920.webp', 1920, 1440],
    ]);
    expect(out.hints.metadata).toMatchObject({
      exif: { camera: { make: 'Cam' }, creator: 'Ann', gpsStripped: true },
      placeholder: { thumbhash: expect.any(String) },
      dominantColor: expect.stringMatching(/^#[0-9a-f]{6}$/),
    });
    expect(out.optimized).toBe(true);
    expect(env.closed).toBe(1);
  });

  it('never upscales: a 1000 px image gets 320 and 640 only', async () => {
    const env = fakeEnv({ 'small.png': [1000, 500] });
    const out = await processFile(
      file(encode('\x89PNG\r\n\x1a\n'), 'small.png', 'image/png'),
      settings(),
      env,
    );
    expect(out.renditions.map((r) => r.variantKey)).toEqual([
      'w320.webp',
      'w640.webp',
    ]);
  });

  it('writes AI provenance back into every rendition', async () => {
    const xmp = jpegSegment(
      0xe1,
      encode(
        `http://ns.adobe.com/xap/1.0/\0<rdf:Description Iptc4xmpExt:DigitalSourceType="${IPTC}trainedAlgorithmicMedia"/>`,
      ),
    );
    const env = fakeEnv({ 'ai.jpg': [2000, 1000] });
    const out = await processFile(
      file(concat([0xff, 0xd8], xmp, [0xff, 0xd9]), 'ai.jpg', 'image/jpeg'),
      settings(),
      env,
    );
    expect(out.hints.provenance).toBe('ai_generated');
    expect(out.renditions).toHaveLength(3);
    for (const rendition of out.renditions) {
      const bytes = new Uint8Array(await rendition.blob.arrayBuffer());
      expect(readProvenance(bytes).provenance).toBe('ai_generated');
    }
  });

  it('replaces an oversized original with a 4096 px master', async () => {
    const env = fakeEnv({ 'huge.jpg': [8000, 6000] });
    const out = await processFile(
      file(jpegWithGps(), 'huge.jpg', 'image/jpeg'),
      settings(),
      env,
    );
    expect(out.file.name).toBe('huge.jpg');
    expect(out.file.type).toBe('image/jpeg');
    expect(env.calls.encodes[0]).toMatchObject({
      format: 'jpeg',
      width: 4096,
      height: 3072,
    });
  });

  it('keeps the original of an AI image even with discard', async () => {
    const xmp = jpegSegment(
      0xe1,
      encode(`<x Iptc4xmpExt:DigitalSourceType="${IPTC}algorithmicMedia"/>`),
    );
    const input = file(
      concat([0xff, 0xd8], xmp, [0xff, 0xd9]),
      'ai.jpg',
      'image/jpeg',
    );
    const out = await processFile(
      input,
      settings({ original: 'discard' }),
      fakeEnv({ 'ai.jpg': [1200, 800] }),
    );
    expect(out.file).toBe(input);
    expect(out.warnings.map((w) => w.code)).toEqual([
      'optimize_discard_blocked',
    ]);
  });

  it('replaces a discarded original with a WebP', async () => {
    const out = await processFile(
      file(encode('\x89PNG\r\n\x1a\n'), 'shot.png', 'image/png'),
      settings({ original: 'discard' }),
      fakeEnv({ 'shot.png': [1200, 800] }),
    );
    expect(out.file.name).toBe('shot.webp');
    expect(out.file.type).toBe('image/webp');
  });

  it('uploads the original when decoding fails', async () => {
    const input = file(encode('\x89PNG\r\n\x1a\n'), 'x.png', 'image/png');
    const out = await processFile(
      input,
      settings(),
      fakeEnv({}, { failDecode: true }),
    );
    expect(out.file).toBe(input);
    expect(out.renditions).toEqual([]);
    expect(out.warnings[0].code).toBe('optimize_unsupported');
  });

  it('passes an animated GIF through', async () => {
    const gif = concat(
      encode('GIF89a'),
      new Uint8Array(7),
      [0x21, 0xf9, 4, 0, 0, 0, 0, 0],
      [0x21, 0xf9, 4, 0, 0, 0, 0, 0],
    );
    const input = file(gif, 'anim.gif', 'image/gif');
    const out = await processFile(input, settings(), fakeEnv({}));
    expect(out.file).toBe(input);
    expect(out.hints.metadata.media).toEqual({ isAnimated: true });
    expect(out.warnings).toEqual([]);
  });

  it('keeps going when one rendition fails or is mislabeled', async () => {
    const out = await processFile(
      file(encode('\x89PNG\r\n\x1a\n'), 'a.png', 'image/png'),
      settings({ renditionFormats: ['webp', 'avif'] }),
      fakeEnv(
        { 'a.png': [3000, 2000] },
        {
          failEncode: (format, width) => format === 'webp' && width === 640,
          mislabel: 'avif',
        },
      ),
    );
    expect(out.renditions.map((r) => r.variantKey)).toEqual([
      'w320.webp',
      'w1280.webp',
      'w1920.webp',
    ]);
    expect(out.warnings.map((w) => w.code)).toEqual([
      'rendition_failed',
      'rendition_failed',
      'rendition_failed',
      'rendition_failed',
    ]);
  });

  it('skips images above 100 megapixels', async () => {
    const input = file(encode('\x89PNG\r\n\x1a\n'), 'big.png', 'image/png');
    const out = await processFile(
      input,
      settings(),
      fakeEnv({ 'big.png': [12000, 9000] }),
    );
    expect(out.file).toBe(input);
    expect(out.warnings[0].code).toBe('optimize_too_large');
  });
});
