import { afterEach, describe, expect, it, vi } from 'vitest';

import { runOptimizer } from '../upload-optimizer';

const file = new File(['x'], 'a.jpg', { type: 'image/jpeg' });

describe('runOptimizer', () => {
  afterEach(() => vi.restoreAllMocks());

  it('uploads the original when the optimizer rejects', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await runOptimizer(
      { enabled: true, process: () => Promise.reject(new Error('boom')) },
      file,
    );
    expect(result).toEqual({ file, renditions: [] });
  });

  it('passes the output through and logs its warnings', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const optimized = new File(['y'], 'a.webp', { type: 'image/webp' });
    const output = {
      file: optimized,
      renditions: [],
      info: {
        optimized: true,
        bytesBefore: 1,
        bytesAfter: 1,
        warnings: [{ code: 'rendition_failed', message: 'w640' }],
      },
    };
    expect(
      await runOptimizer({ enabled: true, process: async () => output }, file),
    ).toBe(output);
    expect(warn).toHaveBeenCalledWith('[cms] rendition_failed: a.jpg: w640');
  });
});
