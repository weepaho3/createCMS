import { describe, expect, it } from 'vitest';

import {
  detectIOS,
  fileTimeoutMs,
  workerConcurrency,
} from '../pipeline/budget';
import { detectType } from '../pipeline/detect';
import {
  decideOriginal,
  fitLongEdge,
  renditionWidthsFor,
} from '../pipeline/policy';

const limits = { maxOriginalMegapixels: 40, maxOriginalBytes: 25_000_000 };

describe('decideOriginal', () => {
  const base = {
    width: 4000,
    height: 3000,
    bytes: 5_000_000,
    provenance: 'unknown' as const,
    limits,
  };

  it('keeps by default and turns keep into master above the limits', () => {
    expect(decideOriginal({ ...base, policy: 'keep' })).toEqual({
      action: 'keep',
    });
    expect(
      decideOriginal({ ...base, policy: 'keep', width: 8000, height: 6000 }),
    ).toEqual({ action: 'master' });
    expect(
      decideOriginal({ ...base, policy: 'keep', bytes: 30_000_000 }),
    ).toEqual({ action: 'master' });
  });

  it('never discards an AI original', () => {
    for (const provenance of ['ai_generated', 'ai_edited'] as const) {
      const decision = decideOriginal({
        ...base,
        policy: 'discard',
        provenance,
      });
      expect(decision.action).toBe('keep');
      expect(decision.warning?.code).toBe('optimize_discard_blocked');
    }
    expect(decideOriginal({ ...base, policy: 'discard' }).action).toBe(
      'discard',
    );
  });
});

describe('sizes', () => {
  it('fits the long edge without upscaling', () => {
    expect(fitLongEdge(8000, 6000, 4096)).toEqual({
      width: 4096,
      height: 3072,
    });
    expect(fitLongEdge(3000, 6000, 4096)).toEqual({
      width: 2048,
      height: 4096,
    });
    expect(fitLongEdge(1000, 800, 4096)).toEqual({ width: 1000, height: 800 });
  });

  it('picks ladder widths below 0.9 of the source', () => {
    const ladder = [320, 640, 1280, 1920];
    expect(renditionWidthsFor(4000, ladder)).toEqual(ladder);
    expect(renditionWidthsFor(1000, ladder)).toEqual([320, 640]);
    expect(renditionWidthsFor(1400, ladder)).toEqual([320, 640]);
    expect(renditionWidthsFor(300, ladder)).toEqual([]);
  });
});

describe('budget', () => {
  it('limits concurrency by cores, memory and iOS', () => {
    expect(workerConcurrency({ hardwareConcurrency: 8 })).toBe(2);
    expect(workerConcurrency({ hardwareConcurrency: 2 })).toBe(1);
    expect(workerConcurrency({ hardwareConcurrency: 8, deviceMemory: 4 })).toBe(
      1,
    );
    expect(workerConcurrency({ hardwareConcurrency: 8, isIOS: true })).toBe(1);
  });

  it('gives 3 s plus a per-megapixel share', () => {
    expect(
      fileTimeoutMs(4000, 3000, { msPerMegapixel: 1500, avif: false }),
    ).toBe(21_000);
    expect(
      fileTimeoutMs(4000, 3000, { msPerMegapixel: 1500, avif: true }),
    ).toBe(39_000);
  });

  it('detects iOS and iPadOS', () => {
    expect(
      detectIOS({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)' }),
    ).toBe(true);
    expect(
      detectIOS({ userAgent: 'Mozilla/5.0 (Macintosh)', maxTouchPoints: 5 }),
    ).toBe(true);
    expect(
      detectIOS({ userAgent: 'Mozilla/5.0 (Macintosh)', maxTouchPoints: 0 }),
    ).toBe(false);
  });
});

describe('detectType', () => {
  const bytes = (...parts: (string | number[])[]) =>
    new Uint8Array(
      parts.flatMap((p) =>
        typeof p === 'string'
          ? Array.from({ length: p.length }, (_, i) => p.charCodeAt(i))
          : p,
      ),
    );

  it.each([
    [bytes([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg'],
    [bytes([0x89], 'PNG\r\n\x1a\n'), 'image/png'],
    [bytes('GIF89a'), 'image/gif'],
    [bytes('RIFF\0\0\0\0WEBP'), 'image/webp'],
    [bytes('\0\0\0\x1cftypavif'), 'image/avif'],
    [bytes('\0\0\0\x18ftypheic'), 'image/heic'],
    [bytes('\0\0\0\x18ftypmif1'), 'image/heic'],
    [bytes('\0\0\0\x18ftypisom'), 'video/mp4'],
    [bytes([0x1a, 0x45, 0xdf, 0xa3]), 'video/webm'],
    [bytes('%PDF-1.7'), 'application/pdf'],
    [bytes('BM'), 'image/bmp'],
    [bytes('  <svg xmlns="http://www.w3.org/2000/svg">'), 'image/svg+xml'],
    [bytes('hello'), undefined],
  ])('detects %#', (input, expected) => {
    expect(detectType(input)).toBe(expected);
  });
});

describe('downsamplePeaks', () => {
  it('keeps the peak of each window', async () => {
    const { downsamplePeaks } = await import('../pipeline/posters');
    const channel = new Float32Array([0.1, -0.9, 0.2, 0.3, -0.25, 0.5]);
    expect(downsamplePeaks(channel, 3)).toEqual([0.9, 0.3, 0.5]);
    expect(downsamplePeaks(channel, 100)).toHaveLength(6);
  });
});
