import type { RealtimeTransport } from './types';

export type UpstashRealtimeOptions = {
  url: string;
  token: string;
};

/**
 * Upstash-backed {@link RealtimeTransport} over `@upstash/realtime` (publish via
 * `realtime.channel(ch).emit(event, data)`, subscribe via its `handle()` SSE
 * bridge), which itself rides `@upstash/redis`.
 *
 * The underlying `Realtime` is constructed SCHEMA-LESS on purpose: the transport
 * is a generic pipe. Event typing lives where each event is owned and is
 * inferred via `typeof cms` — not via this construction-time schema. This is the
 * single place that touches the untyped library surface (one encapsulated cast);
 * every consumer-facing surface is typed by its own Zod event schema.
 *
 * Both `@upstash/redis` and `@upstash/realtime` are OPTIONAL peers, imported
 * lazily. If either is absent the transport is inert: `publish` no-ops and
 * `getSseHandler` returns `null` so the route falls through.
 */
export function upstashRealtime(
  options: UpstashRealtimeOptions,
): RealtimeTransport {
  let realtime: any;
  let handleFn: any;
  let initPromise: Promise<void> | null = null;

  // Memoize the in-flight init PROMISE (not a boolean): concurrent cold-start
  // callers must all await the SAME dynamic import. A boolean flag set before
  // the first `await` would let a racing caller pass through while `realtime` is
  // still undefined — a false "peer unavailable" (dropped publish / 404 route).
  // Mirrors the factory's `ensureInit` pattern.
  function ensure(): Promise<void> {
    if (!initPromise) {
      initPromise = (async () => {
        try {
          const redisMod = (await import('@upstash/redis')) as {
            Redis: new (opts: { url: string; token: string }) => unknown;
          };
          const realtimeMod = (await import('@upstash/realtime')) as {
            Realtime: new (opts: { redis: unknown }) => any;
            handle: any;
          };
          const redis = new redisMod.Redis({
            url: options.url,
            token: options.token,
          });
          realtime = new realtimeMod.Realtime({ redis });
          handleFn = realtimeMod.handle;
        } catch {
          // Peer(s) not installed — transport stays inert.
          realtime = undefined;
        }
      })();
    }
    return initPromise;
  }

  return {
    async publish(channel, event, data) {
      await ensure();
      if (!realtime) return;
      try {
        await realtime.channel(channel).emit(event, data);
      } catch {
        // Best-effort delivery; the durable store is the source of truth.
      }
    },
    async getSseHandler(authorize) {
      await ensure();
      if (!realtime || !handleFn) return null;
      const handler = handleFn({
        realtime,
        middleware: ({
          request,
          channels,
        }: {
          request: Request;
          channels: string[];
        }) => authorize(request, channels),
      });
      return handler as (request: Request) => Promise<Response | void>;
    },
  };
}
