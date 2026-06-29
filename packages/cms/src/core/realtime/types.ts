import type * as z from 'zod';

/**
 * A realtime event schema: a Zod map keyed by event name, flat
 * (`{ notification: z.object(...) }`) or namespaced by feature
 * (`{ ab: { delta: z.object(...) } }` → event path `ab.delta`).
 *
 * This types events; the runtime {@link RealtimeTransport} is event-AGNOSTIC.
 * Event ownership lives where each event is declared (core notifications, a
 * plugin), and the merged registry is INFERRED from `typeof cms` — there is no
 * runtime merge into the transport.
 */
export type RealtimeEventSchema = Record<
  string,
  z.ZodType | Record<string, z.ZodType>
>;

/**
 * Per-connection channel-authorization gate. Receives the raw request (to
 * resolve the caller) and the channels it wants to subscribe to. Return a
 * `Response` to REJECT the connection (e.g. 403); return void to allow. Runs
 * once per connection, before any subscription is established.
 */
export type AuthorizeChannels = (
  request: Request,
  channels: string[],
) => Response | void | Promise<Response | void>;

/**
 * The realtime delivery transport: a generic publish/subscribe pipe. It does
 * NOT know event shapes — those are owned and typed where each event lives.
 */
export type RealtimeTransport = {
  /**
   * Fire-and-forget publish of `data` as `event` on `channel`. Best-effort:
   * swallows transport errors (the durable store stays the source of truth).
   */
  publish(channel: string, event: string, data: unknown): Promise<void>;
  /**
   * Builds the SSE request handler, wiring `authorize` as the per-connection
   * channel-authorization gate. Resolves to `null` when the subscribe peer
   * (`@upstash/realtime`) is unavailable — callers then fall through.
   */
  getSseHandler(
    authorize: AuthorizeChannels,
  ): Promise<((request: Request) => Promise<Response | void>) | null>;
};
