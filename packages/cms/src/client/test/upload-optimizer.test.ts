import { afterEach, describe, expect, it, vi } from 'vitest';

import { annotateUpload } from '../upload-annotations';
import { optimizeOrPassThrough } from '../upload-optimizer';

function file(name: string): File {
  return new File(['x'], name, { type: 'image/jpeg' });
}

describe('optimizeOrPassThrough', () => {
  afterEach(() => vi.restoreAllMocks());

  it('uploads the originals when the optimizer rejects', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const files = [file('a.jpg'), file('b.heic'), file('c.jpg')];
    const result = await optimizeOrPassThrough(
      { enabled: true, optimize: () => Promise.reject(new Error('boom')) },
      files,
    );
    expect(result).toBe(files);
  });

  it('falls back when the optimizer drops a file', async () => {
    const files = [file('a.jpg'), file('b.jpg')];
    const result = await optimizeOrPassThrough(
      { enabled: true, optimize: async (input) => input.slice(1) },
      files,
    );
    expect(result).toBe(files);
  });

  it('logs annotated warnings outside production', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = file('b.heic');
    annotateUpload(out, {
      optimized: false,
      bytesBefore: 1,
      bytesAfter: 1,
      warnings: [{ code: 'optimize_unsupported', message: 'HEIC' }],
    });
    const result = await optimizeOrPassThrough(
      { enabled: true, optimize: async () => [out] },
      [file('b.heic')],
    );
    expect(result).toEqual([out]);
    expect(warn).toHaveBeenCalledWith(
      '[cms] optimize_unsupported: b.heic: HEIC',
    );
  });
});
