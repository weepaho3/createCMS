// Anonymous trackEvent ingest rate-limit (opt-in).
//
// `/abTest/trackEvent` is the one unauthenticated write path: anonymous and
// consent-free by design, since fresh ad traffic must record aggregate
// impression and conversion counts without a session. Open plus unauthenticated
// means a flood can skew the aggregate that decides the A/B winner (no visitor
// id, so volume is the only thing to defend on), bloat the `ab_test_events`
// table, and amplify into one outbound GA4 POST per event when GA4 forwarding
// is configured. This caps the ingest per client key as early as possible, in
// the plugin `onRequest` before any routing or DB work. The default counter is
// in-memory per instance; inject a distributed `store` for multi-instance or
// serverless deployments.

export type RateLimitStore = {
  /**
   * Records one hit for `key` and returns how many hits fall in the current
   * `windowMs` window (this one included). The default store is in-memory
   * (fixed window). Provide a distributed store (e.g. Redis/Upstash) when
   * running multiple instances or serverless: an in-memory count is per
   * instance and resets on cold start, so it only bounds a single instance.
   */
  hit(key: string, windowMs: number, now: number): number | Promise<number>;
};

export type AbTestRateLimitOptions = {
  /** Max `/abTest/trackEvent` requests allowed per `windowMs` per key. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /**
   * Derive the rate-limit key from the request. Default
   * {@link defaultRateLimitKey}: the trusted client IP (rightmost
   * `x-forwarded-for` hop, else `x-real-ip`). Two caveats:
   * - The default assumes one trusted appending proxy (Vercel and most CDNs).
   *   Behind multiple proxies, or a proxy that does not append, override this.
   * - Keying on IP means a shared egress (CGNAT, corporate NAT) shares one
   *   budget; size `limit` for the busiest legitimate egress.
   * Return null to skip limiting a request (the default does so when no proxy
   * header is present).
   */
  getKey?: (request: Request) => string | null;
  /** Counter store. Default: in-memory fixed-window (per instance). */
  store?: RateLimitStore;
};

/**
 * In-memory fixed-window counter. Memory is hard-bounded at `maxKeys`: when a
 * new key would exceed the cap, the oldest-inserted entry is evicted in O(1)
 * (Map preserves insertion order), so even a within-window flood of distinct
 * keys cannot grow the map past `maxKeys` and there is no O(maxKeys) scan on
 * the hot path. Eviction can reset an old key's window under such a flood (the
 * standard bounded-limiter tradeoff). Per-instance only; inject a distributed
 * store for multi-instance or serverless deployments.
 */
export function createInMemoryRateLimitStore(maxKeys = 10_000): RateLimitStore {
  const windows = new Map<string, { count: number; windowStart: number }>();
  return {
    hit(key, windowMs, now) {
      const entry = windows.get(key);
      if (entry && now - entry.windowStart < windowMs) {
        entry.count += 1;
        return entry.count;
      }
      // New key, or its window expired: start a fresh window. Delete first so
      // a re-set moves the key to the most-recent insertion position (it must
      // not be the next eviction victim).
      windows.delete(key);
      if (windows.size >= maxKeys) {
        // Hard cap: evict the oldest-inserted entry (front of the Map), O(1),
        // bounding memory even when every resident key is within its window.
        const oldest = windows.keys().next().value;
        if (oldest !== undefined) windows.delete(oldest);
      }
      windows.set(key, { count: 1, windowStart: now });
      return 1;
    },
  };
}

/**
 * Default rate-limit key: the trusted client IP.
 *
 * `x-forwarded-for` is a client-to-proxy-to-server chain. An appending proxy
 * (Vercel, most CDNs) appends the real connecting IP as the last entry; the
 * first entry is whatever the client sent and is trivially spoofable, so the
 * rightmost entry is taken. Using the leftmost would let an attacker rotate
 * `x-forwarded-for` to mint a fresh bucket per request and evade the limit
 * entirely. This assumes one trusted appending proxy. Falls back to
 * `x-real-ip` (set by nginx and Vercel to the connecting IP).
 *
 * Returns null when neither header is present, and the caller then does not
 * limit (fail-open): a directly exposed server with no proxy headers gets no
 * limiting from this default, so provide a `getKey` reading the real client IP.
 */
export function defaultRateLimitKey(request: Request): string | null {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) {
    const parts = xff
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1]!;
  }
  const realIp = request.headers.get('x-real-ip')?.trim();
  return realIp ? realIp : null;
}

/**
 * Enforces the ingest rate-limit for one request. Returns a 429 Response to
 * short-circuit when the limit is exceeded, or null to let the request proceed.
 * No-ops (null) when the key cannot be resolved. The caller (plugin onRequest)
 * binds this to POST `/abTest/trackEvent`. `store` must be created once per
 * plugin instance so the window survives across requests.
 */
export async function enforceTrackEventRateLimit(
  request: Request,
  options: AbTestRateLimitOptions,
  store: RateLimitStore,
  now: number = Date.now(),
): Promise<Response | null> {
  const getKey = options.getKey ?? defaultRateLimitKey;
  const key = getKey(request);
  if (key === null) return null; // no resolvable key, not rate-limited

  const count = await store.hit(key, options.windowMs, now);
  if (count <= options.limit) return null;

  const retryAfterSec = Math.max(1, Math.ceil(options.windowMs / 1000));
  return new Response(
    JSON.stringify({
      error: 'rate_limited',
      message: 'Too many A/B events; slow down.',
    }),
    {
      status: 429,
      headers: {
        'content-type': 'application/json',
        'retry-after': String(retryAfterSec),
      },
    },
  );
}
