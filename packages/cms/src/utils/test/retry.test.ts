import { describe, expect, it, vi } from 'vitest';

import { isRetryable, parseRetryAfter, retryDelay, withRetry } from '../retry';

describe('retryDelay', () => {
  it('draws from [0, min(cap, base * 2^attempt)]', () => {
    expect(retryDelay(0, {}, () => 1)).toBe(500);
    expect(retryDelay(3, {}, () => 1)).toBe(4000);
    expect(retryDelay(3, {}, () => 0.5)).toBe(2000);
    expect(retryDelay(3, {}, () => 0)).toBe(0);
  });

  it('caps every delay at 30 s by default', () => {
    expect(retryDelay(20, {}, () => 1)).toBe(30_000);
    expect(retryDelay(20, { capMs: 1000 }, () => 1)).toBe(1000);
  });
});

describe('isRetryable', () => {
  it.each([0, 408, 429, 500, 502, 503, 504])('retries status %i', (status) => {
    expect(isRetryable({ status })).toBe(true);
  });

  it.each([400, 401, 403, 404, 413, 501])('stops on status %i', (status) => {
    expect(isRetryable({ status })).toBe(false);
  });

  it('retries S3 RequestTimeout even with a 400', () => {
    expect(isRetryable({ status: 400, code: 'RequestTimeout' })).toBe(true);
  });

  it.each(['BadDigest', 'EntityTooLarge', 'InvalidArgument'])(
    'never retries %s, whatever the status',
    (code) => {
      expect(isRetryable({ status: 500, code })).toBe(false);
    },
  );
});

describe('parseRetryAfter', () => {
  it('reads delta seconds and HTTP dates', () => {
    expect(parseRetryAfter('7')).toBe(7000);
    const now = Date.parse('2026-10-17T10:00:00Z');
    expect(parseRetryAfter('Sat, 17 Oct 2026 10:00:05 GMT', now)).toBe(5000);
    expect(parseRetryAfter('garbage')).toBeUndefined();
    expect(parseRetryAfter(null)).toBeUndefined();
  });
});

describe('withRetry', () => {
  const sleep = vi.fn((_ms: number) => Promise.resolve());

  it('retries until success', async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        if (++calls < 3) throw new Error('flaky');
        return 'ok';
      },
      { classify: () => ({ retry: true }), sleep, random: () => 1 },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(3);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([500, 1000]);
  });

  it('rejects with the last error after the attempts run out', async () => {
    const fn = vi.fn(() => Promise.reject(new Error('down')));
    await expect(
      withRetry(fn, { attempts: 3, classify: () => ({ retry: true }), sleep }),
    ).rejects.toThrow('down');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('stops on a terminal error', async () => {
    const fn = vi.fn(() => Promise.reject(new Error('bad')));
    await expect(
      withRetry(fn, { classify: () => ({ retry: false }), sleep }),
    ).rejects.toThrow('bad');
    expect(fn).toHaveBeenCalledOnce();
  });

  it('lets Retry-After beat the jitter, within the cap', async () => {
    sleep.mockClear();
    let calls = 0;
    await withRetry(
      async () => {
        if (++calls === 1) throw new Error('429');
        if (calls === 2) throw new Error('429 long');
        return 'ok';
      },
      {
        classify: (err) => ({
          retry: true,
          retryAfterMs: (err as Error).message === '429' ? 7000 : 120_000,
        }),
        sleep,
        random: () => 1,
      },
    );
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([7000, 30_000]);
  });

  it('never retries once the signal aborted', async () => {
    const controller = new AbortController();
    const fn = vi.fn(async () => {
      controller.abort();
      throw new Error('aborted mid-flight');
    });
    await expect(
      withRetry(fn, {
        classify: () => ({ retry: true }),
        signal: controller.signal,
        sleep,
      }),
    ).rejects.toThrow('aborted mid-flight');
    expect(fn).toHaveBeenCalledOnce();
  });

  it('interrupts a pending wait on abort', async () => {
    const controller = new AbortController();
    const pending = withRetry(() => Promise.reject(new Error('x')), {
      classify: () => ({ retry: true }),
      signal: controller.signal,
      random: () => 1,
    });
    controller.abort();
    await expect(pending).rejects.toBeDefined();
  });
});
