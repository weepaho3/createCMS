import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { setupTestCMS } from '../../test-utils/cms';
import { createCMSClient } from '../vanilla';

// Drives the real vanilla browser client against an in-memory CMS by routing
// `globalThis.fetch` into the better-call router, exercising the full round
// trip: proxy dispatch -> better-call -> router -> handler -> DB -> response.
function buildTestClient(cms: Awaited<ReturnType<typeof setupTestCMS>>['cms']) {
  return createCMSClient<typeof cms>({ baseURL: 'http://localhost/api/cms' });
}

describe('vanilla client — HTTP round-trip against the in-memory router', () => {
  let harness: Awaited<ReturnType<typeof setupTestCMS>>;
  let client: ReturnType<typeof buildTestClient>;

  beforeAll(async () => {
    harness = await setupTestCMS({
      authMiddleware: async () => ({ userId: 'tester' }),
    });
    client = buildTestClient(harness.cms);
  });

  afterAll(async () => {
    await harness.s3.cleanup();
  });

  beforeEach(() => {
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
      harness.cms.router.handler(new Request(input, init)),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('round-trips a POST create + GET read, matching the server-side api', async () => {
    const created = await client.pages.createRoot({
      body: { slug: 'home', properties: { title: 'Home' } },
    });
    expect(typeof created.rootId).toBe('string');

    const clientRead = await client.pages.getRoot({
      query: { rootId: created.rootId },
    });
    const serverRead = await harness.cms.api.pages.getRoot({
      query: { rootId: created.rootId },
    });

    expect(clientRead.id).toBe(created.rootId);
    expect(serverRead.id).toBe(created.rootId);
    expect(clientRead.properties).toEqual(serverRead.properties);
    expect(clientRead.properties.title).toBe('Home');
  });

  it('round-trips a GET listRoots with the same shape as the server api', async () => {
    const clientRoots = await client.pages.listRoots();
    const serverRoots = await harness.cms.api.pages.listRoots();

    expect(Object.keys(clientRoots).sort()).toEqual(
      Object.keys(serverRoots).sort(),
    );
    expect(Array.isArray(clientRoots.roots)).toBe(true);
    expect(typeof clientRoots.total).toBe('number');
    expect(typeof clientRoots.hasMore).toBe('boolean');
    expect(clientRoots.total).toBe(serverRoots.total);
    expect(clientRoots.total).toBeGreaterThan(0);
  });
});
