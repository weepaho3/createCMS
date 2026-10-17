import { describe, expect, it, vi } from 'vitest';

import type { OptimizationConfig } from '../../../core/types/s3';
import type { OptimizeDeps, Raster } from '../optimize';

import { runOptimize } from '../optimize';

function image(name: string, type: string, size = 1000): File {
  return new File([new Uint8Array(size)], name, { type });
}

type RasterOptions = {
  resized?: boolean;
  // Bytes and type of each `toBlob` result, keyed by requested type.
  output?: Record<string, { size: number; type?: string }>;
};

function fakeRaster(options: RasterOptions = {}): Raster {
  return {
    width: 100,
    height: 100,
    resized: options.resized ?? false,
    toBlob: (type) => {
      const out = options.output?.[type] ?? { size: 100 };
      return Promise.resolve(
        new Blob([new Uint8Array(out.size)], { type: out.type ?? type }),
      );
    },
    imageData: () => ({}) as ImageData,
  };
}

function deps(
  raster: Raster | (() => Promise<Raster>) = fakeRaster(),
  nativeWebp = true,
): OptimizeDeps {
  return {
    rasterize: typeof raster === 'function' ? raster : async () => raster,
    supportsNativeWebp: async () => nativeWebp,
  };
}

const WEBP: OptimizationConfig = { convert: { format: 'webp' } };

describe('runOptimize', () => {
  it('passes non-images through without a warning', async () => {
    const pdf = image('doc.pdf', 'application/pdf');
    const result = await runOptimize(pdf, WEBP, deps());
    expect(result).toEqual({
      file: pdf,
      optimized: false,
      bytesBefore: 1000,
      bytesAfter: 1000,
    });
  });

  it.each([
    'image/gif',
    'image/svg+xml',
    'image/x-icon',
    'image/vnd.microsoft.icon',
    'image/heic',
    'image/heif',
    'image/avif',
  ])('uploads %s unchanged with optimize_unsupported', async (type) => {
    const rasterize = vi.fn();
    const file = image('in', type);
    const result = await runOptimize(file, WEBP, {
      rasterize,
      supportsNativeWebp: async () => true,
    });
    expect(result.file).toBe(file);
    expect(result.warning?.code).toBe('optimize_unsupported');
    expect(rasterize).not.toHaveBeenCalled();
  });

  it('never re-encodes an animated WebP', async () => {
    const header = new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8X');
    const bytes = new Uint8Array(30);
    bytes.set(header);
    bytes[20] = 0x02;
    const file = new File([bytes], 'anim.webp', { type: 'image/webp' });
    const result = await runOptimize(file, WEBP, deps());
    expect(result.file).toBe(file);
    expect(result.warning?.code).toBe('optimize_unsupported');
  });

  it('uploads files with provenance markers byte-identical', async () => {
    const file = new File(
      ['<x:xmpmeta Iptc4xmpExt:DigitalSourceType="trainedAlgorithmicMedia"/>'],
      'ai.jpg',
      { type: 'image/jpeg' },
    );
    const result = await runOptimize(file, WEBP, deps());
    expect(result.file).toBe(file);
    expect(result.warning?.code).toBe('optimize_skipped_provenance');
  });

  it('turns a decode error into optimize_failed', async () => {
    const file = image('broken.jpg', 'image/jpeg');
    const result = await runOptimize(
      file,
      WEBP,
      deps(() => Promise.reject(new Error('decode failed'))),
    );
    expect(result.file).toBe(file);
    expect(result.warning).toMatchObject({
      code: 'optimize_failed',
      message: 'decode failed',
    });
  });

  it('rejects a mislabelled encode and keeps the original', async () => {
    const file = image('photo.png', 'image/png');
    const raster = fakeRaster({
      output: { 'image/png': { size: 10, type: 'image/jpeg' } },
    });
    const result = await runOptimize(
      file,
      { compress: { quality: 70 } },
      deps(raster),
    );
    expect(result.file).toBe(file);
    expect(result.warning?.code).toBe('optimize_mislabel');
  });

  it('names and types the output after the encoded format', async () => {
    const result = await runOptimize(
      image('photo.jpeg', 'image/jpeg'),
      WEBP,
      deps(),
    );
    expect(result.optimized).toBe(true);
    expect(result.file.name).toBe('photo.webp');
    expect(result.file.type).toBe('image/webp');
    expect(result).toMatchObject({ bytesBefore: 1000, bytesAfter: 100 });
  });

  it('encodes at quality 82 by default', async () => {
    const toBlob = vi.fn(async (type: string) => new Blob(['x'], { type }));
    await runOptimize(
      image('a.jpg', 'image/jpeg'),
      WEBP,
      deps({ ...fakeRaster(), toBlob }),
    );
    expect(toBlob).toHaveBeenCalledWith('image/webp', 0.82);
  });

  describe('keep if smaller', () => {
    it.each([
      [1200, false],
      [950, false],
      [900, true],
      [500, true],
    ])('output of %i bytes for 1000 in: optimized=%s', async (size, used) => {
      const file = image('a.webp', 'image/webp');
      const result = await runOptimize(
        file,
        { compress: { quality: 80 } },
        deps(fakeRaster({ output: { 'image/webp': { size } } })),
      );
      expect(result.optimized).toBe(used);
      expect(result.file === file).toBe(!used);
      expect(result.warning).toBeUndefined();
    });

    it('keeps a larger output when the image was downscaled', async () => {
      const result = await runOptimize(
        image('a.png', 'image/png'),
        { resize: { maxSize: 100 } },
        deps(
          fakeRaster({
            resized: true,
            output: { 'image/png': { size: 5000 } },
          }),
        ),
      );
      expect(result.optimized).toBe(true);
    });

    it('honours a custom ratio', async () => {
      const result = await runOptimize(
        image('a.jpg', 'image/jpeg'),
        { compress: { quality: 80 }, keepIfSmallerRatio: 0.5 },
        deps(fakeRaster({ output: { 'image/jpeg': { size: 600 } } })),
      );
      expect(result.optimized).toBe(false);
    });
  });

  describe('WebP fallback encoder', () => {
    const file = image('a.jpg', 'image/jpeg');

    it('reports optimize_unsupported when no encoder is configured', async () => {
      const result = await runOptimize(file, WEBP, deps(fakeRaster(), false));
      expect(result.file).toBe(file);
      expect(result.warning?.code).toBe('optimize_unsupported');
    });

    it('never loads the encoder when the browser encodes WebP', async () => {
      const webpEncoder = vi.fn();
      await runOptimize(file, { ...WEBP, webpEncoder }, deps());
      expect(webpEncoder).not.toHaveBeenCalled();
    });

    it('encodes through the configured module', async () => {
      const encode = vi.fn(async () => new ArrayBuffer(10));
      const init = vi.fn(async () => undefined);
      const result = await runOptimize(
        file,
        {
          ...WEBP,
          compress: { quality: 75 },
          webpEncoder: async () => ({ default: encode, init }),
        },
        deps(fakeRaster(), false),
      );
      expect(init).toHaveBeenCalledOnce();
      expect(encode).toHaveBeenCalledWith(expect.anything(), { quality: 75 });
      expect(result.file.type).toBe('image/webp');
      expect(result.bytesAfter).toBe(10);
    });

    it.each([
      [
        'import',
        () => Promise.reject(new Error('Cannot find module')),
        /could not be imported: Cannot find module/,
      ],
      [
        'WASM init',
        async () => ({
          default: async () => new ArrayBuffer(1),
          init: () => Promise.reject(new Error('404 webp_enc.wasm')),
        }),
        /could not load its WASM binary: 404 webp_enc.wasm/,
      ],
      [
        'encode',
        async () => ({
          default: () => Promise.reject(new Error('Encoding error.')),
        }),
        /fallback encode failed: Encoding error\./,
      ],
    ])('classifies a failed %s step', async (_step, webpEncoder, message) => {
      const result = await runOptimize(
        file,
        { ...WEBP, webpEncoder },
        deps(fakeRaster(), false),
      );
      expect(result.file).toBe(file);
      expect(result.warning?.code).toBe('optimize_failed');
      expect(result.warning?.message).toMatch(message);
    });
  });

  it('adds an original-format variant only when converting', async () => {
    const converted = await runOptimize(
      image('a.jpg', 'image/jpeg'),
      { convert: { format: 'webp', storeOriginal: true } },
      deps(),
    );
    expect(converted.originalVariant?.type).toBe('image/jpeg');
    expect(converted.originalVariant?.name).toBe('a.jpg');

    const sameFormat = await runOptimize(
      image('a.webp', 'image/webp'),
      { convert: { format: 'webp', storeOriginal: true } },
      deps(),
    );
    expect(sameFormat.originalVariant).toBeUndefined();
  });
});
