import type { RealtimeRuntime } from '../realtime/types';
import type { OnNotificationHandler } from './types';

/**
 * Built-in {@link OnNotificationHandler} that pushes every notification to its
 * recipient's PRIVATE realtime channel (`notif:<recipientId>`, event
 * `notification`). One handler covers all notification origins because they all
 * funnel through `notify`/`notifyMany`.
 *
 * Best-effort: the transport swallows delivery errors and the dispatcher
 * isolates handler failures, so a dropped push never breaks `notify()` — the
 * durable notifications row + `list` poll stay the source of truth.
 */
export function makeNotificationPublishHandler(
  transport: RealtimeRuntime,
): OnNotificationHandler {
  return (notification) =>
    transport.publish(
      `notif:${notification.recipientId}`,
      'notification',
      notification,
    );
}
