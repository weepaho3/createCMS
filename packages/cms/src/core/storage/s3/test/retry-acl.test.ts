import { describe, expect, it, vi } from 'vitest';

import type { S3Client } from '../../../types/s3';

import { createCustomClient } from '../client';
import { deleteObject, headObject, signPutObject } from '../utils';

const client = () =>
  createCustomClient({
    provider: 'custom',
    hostname: 'localhost:9000',
    region: 'us-east-1',
    accessKeyId: 'key',
    secretAccessKey: 'secret',
    bucketName: 'bucket',
    publicUrl: 'http://localhost:9000/bucket',
    secure: false,
    forcePathStyle: true,
  });

function withResponses(...responses: (Response | Error)[]): {
  client: S3Client;
  fetch: ReturnType<typeof vi.fn>;
} {
  const base = client();
  const fetch = vi.fn(async () => {
    const next = responses.shift()!;
    if (next instanceof Error) throw next;
    return next;
  });
  return {
    client: {
      buildBucketUrl: base.buildBucketUrl,
      s3: { fetch } as unknown as S3Client['s3'],
    },
    fetch,
  };
}

describe('signPutObject ACL', () => {
  const params = {
    bucket: 'bucket',
    key: 'a.jpg',
    contentType: 'image/jpeg',
    contentLength: 10,
    expiresIn: 300,
  };

  it('signs x-amz-acl when an ACL is given', async () => {
    const url = new URL(
      await signPutObject(client(), { ...params, acl: 'public-read' }),
    );
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toContain('x-amz-acl');
  });

  it('leaves x-amz-acl out of the signature without an ACL', async () => {
    const url = new URL(await signPutObject(client(), params));
    expect(url.searchParams.get('X-Amz-SignedHeaders')).not.toContain(
      'x-amz-acl',
    );
  });
});

describe('server-side S3 retries', () => {
  it('retries a 503 HEAD and returns the next response', async () => {
    const { client, fetch } = withResponses(
      new Response(null, { status: 503 }),
      new Response(null, {
        status: 200,
        headers: { 'content-length': '5', 'content-type': 'image/png' },
      }),
    );
    await expect(
      headObject(client, { bucket: 'b', key: 'k' }),
    ).resolves.toEqual({
      contentLength: 5,
      contentType: 'image/png',
      cacheControl: null,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('retries a network error on DELETE', async () => {
    const { client, fetch } = withResponses(
      new TypeError('fetch failed'),
      new Response(null, { status: 204 }),
    );
    await deleteObject(client, { bucket: 'b', key: 'k' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('gives up after three attempts and reports the last response', async () => {
    const { client, fetch } = withResponses(
      new Response(null, { status: 500 }),
      new Response(null, { status: 500 }),
      new Response(
        '<Error><Code>InternalError</Code><Message>x</Message></Error>',
        {
          status: 500,
        },
      ),
    );
    await expect(
      deleteObject(client, { bucket: 'b', key: 'k' }),
    ).rejects.toThrow('InternalError');
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('does not retry a 404', async () => {
    const { client, fetch } = withResponses(
      new Response(null, { status: 404 }),
    );
    await expect(headObject(client, { bucket: 'b', key: 'k' })).resolves.toBe(
      null,
    );
    expect(fetch).toHaveBeenCalledOnce();
  });
});
