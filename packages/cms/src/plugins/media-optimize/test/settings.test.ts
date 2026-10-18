import { describe, expect, it } from 'vitest';

import { resolveOptimizeSettings } from '../index';

describe('resolveOptimizeSettings', () => {
  it('keeps JPEG XL off unless it is enabled', () => {
    expect(resolveOptimizeSettings().renditionFormats).toEqual(['webp']);
    expect(
      resolveOptimizeSettings({ renditions: { formats: ['webp', 'jxl'] } })
        .renditionFormats,
    ).toEqual(['webp']);
    const on = resolveOptimizeSettings({
      jxl: { enabled: true, maxWidth: 1280 },
    });
    expect(on.renditionFormats).toEqual(['webp', 'jxl']);
    expect(on.jxlMaxWidth).toBe(1280);
    expect(on.quality.jxl).toBe(80);
  });
});
