import type { RealtimeRuntime } from '../../core/realtime/types';
import type { LiveDelta } from './analytics/types';

/**
 * Publish a single live A/B result delta to the test's public channel
 * (`ab:live:<testId>`, event `delta`) over the shared core realtime transport.
 *
 * Best-effort and fire-and-forget: the durable aggregation (queried by
 * `getResults`) is the source of truth, so a dropped delta only delays the live
 * dashboard until the next poll. No-op when no transport is configured.
 */
export function publishLiveDelta(
  realtime: RealtimeRuntime | undefined,
  testId: string,
  variantId: string,
  eventName: string,
): void {
  if (!realtime) return;
  const delta: LiveDelta = {
    variantId,
    eventType: eventName,
    count: 1,
    timestamp: Date.now(),
  };
  void realtime.publish(`ab:live:${testId}`, 'delta', delta).catch(() => {});
}
