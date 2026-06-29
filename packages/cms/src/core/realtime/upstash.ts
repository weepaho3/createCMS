import type { RealtimeRuntime } from './types';

export type RealtimeConfig = {
  url: string;
  token: string;
};

/**
 * Builds the Upstash-backed {@link RealtimeRuntime} from the `realtime` config
 * (`{ url, token }`). Publishes via `@upstash/realtime` (`channel.emit`) over
 * `@upstash/redis`, and serves the SSE bridge via the library's `handle()`.
 *
 * The underlying `Realtime` is constructed SCHEMA-LESS on purpose — the runtime
 * is a generic pipe; event typing lives where each event is owned and is
 * inferred via `typeof cms`. This is the single place that touches the untyped
 * library surface (one encapsulated cast).
 *
 * Both `@upstash/redis` and `@upstash/realtime` are OPTIONAL peers, imported
 * lazily. If either is absent the runtime is inert: `publish` no-ops and
 * `getSseHandler` returns `null` so the route falls through.
 */
export function createRealtimeRuntime(config: RealtimeConfig): RealtimeRuntime {
  let realtime: any;
  let handleFn: any;
  let initPromise: Promise<void> | null = null;

  // Memoize the in-flight init PROMISE (not a boolean) so concurrent cold-start
  // callers all await the SAME dynamic import. Mirrors the factory's ensureInit.
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
            url: config.url,
            token: config.token,
          });
          realtime = new realtimeMod.Realtime({ redis });
          handleFn = realtimeMod.handle;
        } catch {
          // Peer(s) not installed — runtime stays inert.
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
