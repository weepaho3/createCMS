import type { RealtimeRuntime } from './types';

export type RealtimeConfig = {
  url: string;
  token: string;
};

/**
 * True when a dynamic `import()` failed because the module is absent — i.e. the
 * optional peer is not installed. Distinguishes that (expected → inert) from a
 * real error thrown while loading/constructing an installed peer (→ surfaced).
 */
function isModuleNotFound(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND';
}

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
        let redisMod: {
          Redis: new (opts: { url: string; token: string }) => unknown;
        };
        let realtimeMod: {
          Realtime: new (opts: { redis: unknown }) => any;
          handle: any;
        };
        try {
          redisMod = (await import('@upstash/redis')) as typeof redisMod;
          realtimeMod =
            (await import('@upstash/realtime')) as typeof realtimeMod;
        } catch (err) {
          // Optional peer(s) not installed → runtime stays inert (silent). A
          // module-not-found is expected; anything else is a real load error
          // (e.g. the installed peer threw on import) and must be surfaced.
          realtime = undefined;
          if (!isModuleNotFound(err)) {
            console.warn('[cms:realtime] disabled:', err);
          }
          return;
        }
        try {
          const redis = new redisMod.Redis({
            url: config.url,
            token: config.token,
          });
          realtime = new realtimeMod.Realtime({ redis });
          handleFn = realtimeMod.handle;
        } catch (err) {
          // Imports resolved but construction failed — a real misconfig, not a
          // missing peer. Surface it once so it isn't mistaken for an absent peer.
          realtime = undefined;
          console.warn('[cms:realtime] disabled:', err);
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
