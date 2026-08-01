import { describe, expect, it } from 'vitest';

import type { RealtimeRuntime } from '../../../core/realtime/types';

import { publishLiveDelta } from '../realtime';

function recordingTransport() {
  const calls: Array<[string, string, unknown]> = [];
  const transport: RealtimeRuntime = {
    async publish(channel, event, data) {
      calls.push([channel, event, data]);
    },
    async getSseHandler() {
      return null;
    },
  };
  return { transport, calls };
}

describe('publishLiveDelta', () => {
  it('publishes a delta on the test channel as a `delta` event', () => {
    const { transport, calls } = recordingTransport();
    publishLiveDelta(transport, 'test-1', 'var-a', 'conversion');

    expect(calls).toHaveLength(1);
    const [channel, event, data] = calls[0];
    expect(channel).toBe('ab:live:test-1');
    expect(event).toBe('delta');
    expect(data).toMatchObject({
      variantId: 'var-a',
      eventType: 'conversion',
      count: 1,
    });
    expect(typeof (data as { timestamp: number }).timestamp).toBe('number');
  });

  it('is a no-op without a transport', () => {
    expect(() =>
      publishLiveDelta(undefined, 'test-1', 'var-a', 'impression'),
    ).not.toThrow();
  });

  it('swallows a rejecting publish (best-effort, fire-and-forget)', async () => {
    const transport: RealtimeRuntime = {
      async publish() {
        throw new Error('boom');
      },
      async getSseHandler() {
        return null;
      },
    };
    expect(() =>
      publishLiveDelta(transport, 'test-1', 'var-a', 'impression'),
    ).not.toThrow();
    // let the rejected publish promise settle — must not surface as unhandled
    await new Promise((r) => setTimeout(r, 0));
  });
});
