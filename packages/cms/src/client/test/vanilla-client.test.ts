import { describe, expect, it } from 'vitest';

import { createCMSClient } from '../vanilla';

describe('vanilla client', () => {
  // media.uploadState must be a real atom available synchronously:
  // subscribe-at-startup is the whole point.
  it('exposes media.uploadState as a real atom immediately (no await)', () => {
    const client = createCMSClient({ baseURL: '/api/cms' });
    const atom = (
      client as unknown as {
        media: { uploadState: { get: () => unknown; subscribe: unknown } };
      }
    ).media.uploadState;

    expect(typeof atom.get).toBe('function');
    expect(typeof atom.subscribe).toBe('function');
    expect(atom.get()).toBeDefined();
  });
});
