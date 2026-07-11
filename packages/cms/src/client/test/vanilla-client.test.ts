import { describe, expect, it } from 'vitest';

import { createCMSClient } from '../vanilla';

describe('vanilla client', () => {
  // api-08 + review [7]: media.uploadState must be a REAL atom available
  // synchronously — subscribe-at-startup is the whole point. The old async
  // lazy-init proxy left it as a function stub until the first awaited call.
  it('exposes media.uploadState as a real atom immediately (no await)', () => {
    const client = createCMSClient({ baseURL: '/api/cms' });
    const atom = (client as unknown as {
      media: { uploadState: { get: () => unknown; subscribe: unknown } };
    }).media.uploadState;

    expect(typeof atom.get).toBe('function');
    expect(typeof atom.subscribe).toBe('function');
    // The atom holds the initial upload state, readable synchronously.
    expect(atom.get()).toBeDefined();
  });
});
