import { afterEach, describe, expect, it, vi } from 'vitest';

import { confirmOverwrite } from '../utils/ui';

afterEach(() => vi.restoreAllMocks());

// dx-10: the non-TTY refusal is what makes `generate` exit non-zero (the action
// treats a `false` here as a hard error) instead of silently no-op'ing in CI.
describe('confirmOverwrite (non-TTY)', () => {
  it('refuses (returns false) when no interactive terminal is available', async () => {
    // vitest runs without a TTY, so isTTY is undefined on both streams.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    expect(await confirmOverwrite('/tmp/cms-schema.ts')).toBe(false);

    // The hint points at the escape hatch added in dx-10.
    const printed = log.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toMatch(/--force/);
  });
});
