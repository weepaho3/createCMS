import { afterEach, describe, expect, it, vi } from 'vitest';

import { EDITOR_CODES_URL, resetWarnings, warnOnce } from './codes';

afterEach(() => {
  resetWarnings();
  vi.restoreAllMocks();
});

describe('warnOnce', () => {
  it('prints a coded message with its docs link once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    warnOnce('E005', 'missing anchor');
    warnOnce('E005', 'missing anchor');
    warnOnce('E005', 'another block');
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenNthCalledWith(
      1,
      `[editor:E005] missing anchor (${EDITOR_CODES_URL}#e005)`,
    );
  });
});
