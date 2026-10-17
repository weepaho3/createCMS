import { describe, expect, it } from 'vitest';

import type { StorageCheckDeps } from '../utils/storage-check';

import { DUMMY_MEDIA_CONFIG } from '../../test-utils/fixtures';
import { createMemoryStorage } from '../../test-utils/storage';
import { runStorageCheck } from '../utils/storage-check';

type Reply = {
  status: number;
  headers?: Record<string, string>;
  body?: string;
};

function fakeFetch(route: (url: string, init?: RequestInit) => Reply) {
  return async (url: string, init?: RequestInit) => {
    const reply = route(url, init);
    return new Response(reply.body ?? null, {
      status: reply.status,
      headers: reply.headers,
    });
  };
}

function deps(overrides: Partial<StorageCheckDeps> = {}): StorageCheckDeps {
  const storage = createMemoryStorage({ lifecycle: true });
  return {
    config: { ...DUMMY_MEDIA_CONFIG, visibility: 'prefix' },
    storage,
    s3: {
      bucketUrl: 'https://s3.test/bucket',
      fetch: fakeFetch(() => ({
        status: 200,
        body: '<LifecycleConfiguration><Rule><AbortIncompleteMultipartUpload><DaysAfterInitiation>7</DaysAfterInitiation></AbortIncompleteMultipartUpload></Rule></LifecycleConfiguration>',
      })),
    },
    fetch: fakeFetch((url, init) => {
      if (init?.method === 'OPTIONS') {
        return {
          status: 200,
          headers: {
            'access-control-allow-origin': 'https://admin.test',
            'access-control-allow-headers': 'content-type, cache-control',
          },
        };
      }
      return { status: url.includes('/pub/') ? 200 : 403 };
    }),
    origin: 'https://admin.test',
    randomId: () => 'abc',
    ...overrides,
  };
}

const byName = (results: { name: string; status: string }[]) =>
  Object.fromEntries(results.map((r) => [r.name, r.status]));

describe('runStorageCheck', () => {
  it('passes a complete setup and removes its probe objects', async () => {
    const d = deps();
    const results = await runStorageCheck(d);
    expect(results.every((r) => r.status === 'pass')).toBe(true);
    expect(
      (d.storage as ReturnType<typeof createMemoryStorage>).objects.size,
    ).toBe(0);
  });

  it('reports a missing lifecycle rule with a fix', async () => {
    const results = await runStorageCheck(
      deps({
        s3: {
          bucketUrl: 'https://s3.test/bucket',
          fetch: fakeFetch(() => ({
            status: 404,
            body: '<Error><Code>NoSuchLifecycleConfiguration</Code></Error>',
          })),
        },
      }),
    );
    const lifecycle = results.find((r) => r.name.startsWith('Lifecycle'))!;
    expect(lifecycle.status).toBe('fail');
    expect(lifecycle.fix).toContain('AbortIncompleteMultipartUpload');
  });

  it('skips the lifecycle check for providers without a lifecycle API', async () => {
    const results = await runStorageCheck(
      deps({ storage: createMemoryStorage({ lifecycle: false }) }),
    );
    expect(
      byName(results)['Lifecycle rule for incomplete multipart uploads'],
    ).toBe('skip');
  });

  it('reports a CORS preflight that rejects the origin', async () => {
    const results = await runStorageCheck(
      deps({
        fetch: fakeFetch((url, init) =>
          init?.method === 'OPTIONS'
            ? { status: 403 }
            : { status: url.includes('/pub/') ? 200 : 403 },
        ),
      }),
    );
    const cors = results.find((r) => r.name.startsWith('CORS'))!;
    expect(cors.status).toBe('fail');
    expect(cors.fix).toContain('"AllowedOrigins"');
    expect(cors.fix).toContain('https://admin.test');
  });

  it('skips CORS without an origin', async () => {
    const results = await runStorageCheck(deps({ origin: undefined }));
    expect(byName(results)['CORS for uploads from the admin origin']).toBe(
      'skip',
    );
  });

  it('reports a bucket that serves prv/ publicly', async () => {
    const results = await runStorageCheck(
      deps({
        fetch: fakeFetch((_url, init) =>
          init?.method === 'OPTIONS'
            ? {
                status: 200,
                headers: {
                  'access-control-allow-origin': '*',
                  'access-control-allow-headers': '*',
                },
              }
            : { status: 200 },
        ),
      }),
    );
    const policy = results.find((r) => r.name.startsWith('Public reads'))!;
    expect(policy.status).toBe('fail');
    expect(policy.fix).toContain('pub/*');
  });

  it('reports a failed upload', async () => {
    const storage = createMemoryStorage({ lifecycle: true });
    storage.put = async () => {
      throw new Error('AccessControlListNotSupported');
    };
    const results = await runStorageCheck(deps({ storage }));
    const upload = results.find((r) => r.name.startsWith('Upload'))!;
    expect(upload.status).toBe('fail');
    expect(upload.detail).toContain('AccessControlListNotSupported');
  });

  it('fails prefix visibility without the copy capability', async () => {
    const results = await runStorageCheck(
      deps({ storage: createMemoryStorage({ lifecycle: true, copy: false }) }),
    );
    expect(byName(results).Capabilities).toBe('fail');
  });
});
