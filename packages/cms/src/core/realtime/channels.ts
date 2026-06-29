/**
 * Built-in channel-authorization policy for the shared realtime route.
 *
 * The security invariant: PRIVATE per-user channels (`notif:<recipientId>`) are
 * readable ONLY by their owner and FAIL CLOSED when the caller is
 * unauthenticated. A/B live channels (`ab:live:<testId>`) are world-readable
 * (aggregate dashboards carry no per-user private data). Every other channel is
 * rejected. Re-evaluated on every (re)connection, so there is no stale
 * authorization across a socket's lifetime.
 *
 * Pure function of (userId, channels) — the route handler resolves `userId` from
 * the request via the configured auth middleware before calling this.
 */
export function defaultAuthorizeChannels(
  userId: string | undefined,
  channels: string[],
): Response | void {
  // Fail closed on an empty channel set so the primitive is safe independent of
  // the transport that feeds it (a zero-iteration loop would otherwise fall
  // through to allow). The bundled Upstash transport never sends an empty set —
  // its handle() substitutes ['default'] — but this is a public, overridable
  // policy guarding private channels, so it must not default-open.
  if (channels.length === 0) {
    return new Response('Forbidden', { status: 403 });
  }
  for (const channel of channels) {
    if (channel.startsWith('notif:')) {
      const owner = channel.slice('notif:'.length);
      // Exact-match the full owner id (not a prefix) and fail closed when the
      // caller is unauthenticated — never default-open for private channels.
      if (!userId || owner !== userId) {
        return new Response('Forbidden', { status: 403 });
      }
    } else if (channel.startsWith('ab:live:')) {
      // World-readable: explicit policy, not a default-open fallthrough.
      continue;
    } else {
      return new Response('Forbidden', { status: 403 });
    }
  }
}
