import { describe, expect, it } from 'vitest';

import { makeNotificationPublishHandler } from '../src/core/notifications/realtime';
import type { NotificationPayload } from '../src/core/notifications/types';
import type { RealtimeTransport } from '../src/core/realtime/types';

function payload(recipientId: string): NotificationPayload {
  return {
    id: 'n1',
    recipientId,
    actorId: null,
    type: 'custom',
    title: 't',
    body: null,
    resourceType: null,
    resourceId: null,
    collection: null,
    meta: null,
    createdAt: new Date(),
  };
}

describe('makeNotificationPublishHandler', () => {
  it('publishes to the recipient private channel as a `notification` event', async () => {
    const calls: Array<[string, string, unknown]> = [];
    const transport: RealtimeTransport = {
      async publish(channel, event, data) {
        calls.push([channel, event, data]);
      },
      async getSseHandler() {
        return null;
      },
    };
    const handler = makeNotificationPublishHandler(transport);
    const p = payload('u42');
    await handler(p);

    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe('notif:u42');
    expect(calls[0][1]).toBe('notification');
    expect(calls[0][2]).toBe(p);
  });

  it('forwards transport rejection (failure isolation is the dispatcher\'s job)', async () => {
    const transport: RealtimeTransport = {
      async publish() {
        throw new Error('boom');
      },
      async getSseHandler() {
        return null;
      },
    };
    const handler = makeNotificationPublishHandler(transport);
    await expect(handler(payload('u1'))).rejects.toThrow('boom');
  });
});
