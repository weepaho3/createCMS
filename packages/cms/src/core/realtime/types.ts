import type * as z from 'zod';

/**
 * A realtime event schema: a Zod map keyed by event name, flat
 * (`{ notification: z.object(...) }`) or namespaced by feature
 * (`{ ab: { delta: z.object(...) } }` gives event path `ab.delta`).
 *
 * This types events; the runtime is event-agnostic. Event ownership lives where
 * each event is declared (core notifications, a plugin), and the merged
 * registry is inferred from `typeof cms`.
 */
export type RealtimeEventSchema = Record<
  string,
  z.ZodType | Record<string, z.ZodType>
>;

/**
 * Per-connection channel-authorization gate handed to the runtime's SSE
 * handler. Receives the raw request and the channels it wants; return a
 * `Response` to reject (e.g. 403), or void to allow. Runs once per
 * connection, before any subscription.
 */
export type AuthorizeChannels = (
  request: Request,
  channels: string[],
) => Response | void | Promise<Response | void>;

/**
 * The realtime delivery runtime: a concrete Upstash-backed publish/subscribe
 * pipe (not a pluggable interface; createCMS realtime is Upstash-only). Held on
 * the procedure ctx and consumed by the SSE route, the notification publish
 * handler, and the A/B live-delta publish.
 */
export type RealtimeRuntime = {
  /** Fire-and-forget publish of `data` as `event` on `channel`. Best-effort. */
  publish(channel: string, event: string, data: unknown): Promise<void>;
  /**
   * Builds the SSE request handler, wiring `authorize` as the per-connection
   * channel gate. Resolves to `null` when the subscribe peer
   * (`@upstash/realtime`) is unavailable — the route then falls through.
   */
  getSseHandler(
    authorize: AuthorizeChannels,
  ): Promise<((request: Request) => Promise<Response | void>) | null>;
};
