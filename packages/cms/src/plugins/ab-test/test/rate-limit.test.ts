import { describe, expect, it } from 'vitest';

import { abTest } from '../index';
import {
  createInMemoryRateLimitStore,
  defaultRateLimitKey,
  enforceTrackEventRateLimit,
  type AbTestRateLimitOptions,
  type RateLimitStore,
} from '../rate-limit';

function req(headers: Record<string, string> = {}): Request {
  return new Request('http://x/api/cms/abTest/trackEvent', {
    method: 'POST',
    headers,
  });
}

describe('createInMemoryRateLimitStore (fixed window)', () => {
  it('counts hits within a window and resets after it elapses', () => {
    const store = createInMemoryRateLimitStore();
    expect(store.hit('k', 1000, 0)).toBe(1);
    expect(store.hit('k', 1000, 200)).toBe(2);
    expect(store.hit('k', 1000, 999)).toBe(3);
    // At or after windowMs from the window start: new window.
    expect(store.hit('k', 1000, 1000)).toBe(1);
    expect(store.hit('k', 1000, 1200)).toBe(2);
  });

  it('keys are independent', () => {
    const store = createInMemoryRateLimitStore();
    expect(store.hit('a', 1000, 0)).toBe(1);
    expect(store.hit('b', 1000, 0)).toBe(1);
    expect(store.hit('a', 1000, 0)).toBe(2);
  });

  it('hard-caps at maxKeys, evicting the oldest entry even when all keys are live', () => {
    // Bounds memory under a within-window distinct-key flood (an IP-rotating
    // attacker): the cap holds without waiting for windows to expire.
    const store = createInMemoryRateLimitStore(2);
    expect(store.hit('a', 1000, 0)).toBe(1); // {a}
    expect(store.hit('b', 1000, 0)).toBe(1); // {a,b} at cap
    expect(store.hit('c', 1000, 0)).toBe(1); // evicts oldest 'a' -> {b,c}
    // 'b' is still resident, so its window/count survive.
    expect(store.hit('b', 1000, 0)).toBe(2);
    // 'a' was dropped, so it starts a fresh window.
    expect(store.hit('a', 1000, 0)).toBe(1);
  });
});

describe('defaultRateLimitKey', () => {
  it('uses the rightmost x-forwarded-for hop (the proxy-appended IP)', () => {
    // '1.2.3.4' is whatever the client sent; '5.6.7.8' is what the proxy appended.
    expect(
      defaultRateLimitKey(req({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' })),
    ).toBe('5.6.7.8');
  });
  it('x-forwarded-for takes precedence over x-real-ip', () => {
    expect(
      defaultRateLimitKey(
        req({ 'x-forwarded-for': '8.8.8.8', 'x-real-ip': '9.9.9.9' }),
      ),
    ).toBe('8.8.8.8');
  });
  it('falls back to x-real-ip when there is no x-forwarded-for', () => {
    expect(defaultRateLimitKey(req({ 'x-real-ip': '9.9.9.9' }))).toBe(
      '9.9.9.9',
    );
  });
  it('returns null when no proxy IP header is present (fail-open)', () => {
    expect(defaultRateLimitKey(req())).toBeNull();
  });
});

describe('enforceTrackEventRateLimit', () => {
  const opts: AbTestRateLimitOptions = { limit: 2, windowMs: 1000 };

  it('allows up to the limit, then returns a 429 with Retry-After', async () => {
    const store = createInMemoryRateLimitStore();
    const r = () => req({ 'x-forwarded-for': '1.1.1.1' });
    expect(await enforceTrackEventRateLimit(r(), opts, store, 0)).toBeNull(); // 1
    expect(await enforceTrackEventRateLimit(r(), opts, store, 0)).toBeNull(); // 2
    const blocked = await enforceTrackEventRateLimit(r(), opts, store, 0); // 3
    expect(blocked).toBeInstanceOf(Response);
    expect(blocked!.status).toBe(429);
    expect(blocked!.headers.get('retry-after')).toBe('1');
    expect((await blocked!.json()).error).toBe('rate_limited');
  });

  it('does not limit when the key cannot be resolved (no IP)', async () => {
    const store = createInMemoryRateLimitStore();
    // Many hits but no IP header: key null, never limited.
    for (let i = 0; i < 10; i++) {
      expect(
        await enforceTrackEventRateLimit(req(), opts, store, 0),
      ).toBeNull();
    }
  });

  it('honors a custom getKey and a custom store', async () => {
    const hits: Array<{ key: string }> = [];
    const store: RateLimitStore = {
      hit(key) {
        hits.push({ key });
        return 99; // always over any sane limit
      },
    };
    const custom: AbTestRateLimitOptions = {
      limit: 5,
      windowMs: 1000,
      getKey: () => 'tenant-A',
      store,
    };
    const blocked = await enforceTrackEventRateLimit(req(), custom, store, 0);
    expect(blocked!.status).toBe(429);
    expect(hits[0]!.key).toBe('tenant-A');
  });

  it('separate keys do not share a budget', async () => {
    const store = createInMemoryRateLimitStore();
    const a = req({ 'x-forwarded-for': '1.1.1.1' });
    const b = req({ 'x-forwarded-for': '2.2.2.2' });
    await enforceTrackEventRateLimit(a, opts, store, 0);
    await enforceTrackEventRateLimit(a, opts, store, 0);
    // a is now at the limit; b is fresh, so still allowed.
    expect(await enforceTrackEventRateLimit(b, opts, store, 0)).toBeNull();
  });
});

describe('plugin onRequest wiring', () => {
  // onRequest ignores its ctx arg; a bare object is enough to drive it.
  const run = (plugin: ReturnType<typeof abTest>, request: Request) =>
    (plugin.onRequest as (r: Request, c: unknown) => Promise<unknown>)(
      request,
      {},
    );
  const trackReq = (ip = '1.1.1.1') =>
    new Request('http://x/api/cms/abTest/trackEvent', {
      method: 'POST',
      headers: { 'x-forwarded-for': ip },
    });

  it('returns a 429 once the trackEvent ingest exceeds the limit', async () => {
    const plugin = abTest({ rateLimit: { limit: 1, windowMs: 60_000 } });
    expect(await run(plugin, trackReq())).toBeUndefined(); // 1st allowed
    const res = (await run(plugin, trackReq())) as { response?: Response };
    expect(res?.response).toBeInstanceOf(Response);
    expect(res.response!.status).toBe(429);
  });

  it('does not rate-limit other paths or non-POST methods', async () => {
    const plugin = abTest({ rateLimit: { limit: 1, windowMs: 60_000 } });
    const get = new Request('http://x/api/cms/abTest/trackEvent', {
      method: 'GET',
    });
    expect(await run(plugin, get)).toBeUndefined();
    const other = new Request('http://x/api/cms/abTest/getResults', {
      method: 'POST',
      headers: { 'x-forwarded-for': '1.1.1.1' },
    });
    for (let i = 0; i < 5; i++)
      expect(await run(plugin, other)).toBeUndefined();
  });

  it('never blocks the ingest when rateLimit is not configured', async () => {
    const plugin = abTest();
    const t = trackReq();
    for (let i = 0; i < 10; i++) expect(await run(plugin, t)).toBeUndefined();
  });
});
