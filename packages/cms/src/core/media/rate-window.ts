const RATE_WINDOW_MS = 60_000;

/**
 * Counts hits per key (an actor) over a sliding minute, in this process.
 * Returns the seconds to wait when `count` more would exceed `limit`, else
 * records them and returns 0.
 */
export function createRateWindow(now: () => number = Date.now) {
  const hits = new Map<string, number[]>();
  return (key: string, count: number, limit: number): number => {
    const at = now();
    const recent = (hits.get(key) ?? []).filter((t) => at - t < RATE_WINDOW_MS);
    if (recent.length + count > limit) {
      hits.set(key, recent);
      if (count > limit) return RATE_WINDOW_MS / 1000;
      // The oldest hits that must expire before `count` more fit.
      const freeAt = recent[recent.length + count - limit - 1];
      return Math.max(1, Math.ceil((freeAt + RATE_WINDOW_MS - at) / 1000));
    }
    for (let i = 0; i < count; i++) recent.push(at);
    hits.set(key, recent);
    return 0;
  };
}
