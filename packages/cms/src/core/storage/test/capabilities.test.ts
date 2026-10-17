import { afterEach, describe, expect, it } from 'vitest';

import type { StorageAdapter } from '../adapter';

import { type TestS3, setupTestS3 } from '../../../test-utils/s3';
import { requireCapability } from '../adapter';
import { createS3StorageAdapter, resolveS3Capabilities } from '../s3/adapter';
import { mergeCapabilities, providerCapabilities } from '../s3/presets';

const BODY = new Uint8Array([1, 2, 3, 4]);

const base = {
  accessKeyId: 'k',
  secretAccessKey: 's',
  bucketName: 'bucket',
  publicUrl: 'https://cdn.example.com',
};

describe('provider presets', () => {
  it('maps providers to presets', () => {
    expect(
      resolveS3Capabilities({
        ...base,
        provider: 'cloudflare',
        accountId: 'a',
      }),
    ).toEqual(providerCapabilities.r2);
    expect(
      resolveS3Capabilities({
        ...base,
        provider: 'aws',
        region: 'eu-central-1',
      }),
    ).toEqual(providerCapabilities.aws);
    expect(
      resolveS3Capabilities({
        ...base,
        provider: 'digitalOcean',
        region: 'ams3',
      }),
    ).toEqual(providerCapabilities.doSpaces);
    expect(
      resolveS3Capabilities({
        ...base,
        provider: 'custom',
        hostname: 'minio',
        region: 'us-east-1',
      }),
    ).toEqual(providerCapabilities.generic);
    expect(
      resolveS3Capabilities({
        ...base,
        provider: 'custom',
        preset: 'hetzner',
        hostname: 'fsn1.your-objectstorage.com',
        region: 'fsn1',
      }).requestsPerSecond,
    ).toBe(750);
  });

  it('documents the provider differences', () => {
    expect(providerCapabilities.aws.objectAcl).toBe(true);
    expect(providerCapabilities.r2.objectAcl).toBe(false);
    expect(providerCapabilities.r2.signedPost).toBe(false);
    expect(providerCapabilities.r2.lifecycle).toBe(true);
    expect(providerCapabilities.b2.signedPost).toBe(false);
    expect(providerCapabilities.bunny.corsConfigurable).toBe(false);
    expect(providerCapabilities.bunny.lifecycle).toBe(false);
    expect(providerCapabilities.supabase.checksum.contentMd5Part).toBe(false);
    expect(providerCapabilities.hetzner.maxSinglePutSize).toBe(5 * 1024 ** 3);
  });

  it('overrides single flags, nested ones key by key', () => {
    const merged = resolveS3Capabilities({
      ...base,
      provider: 'cloudflare',
      accountId: 'a',
      capabilities: { objectAcl: true, signedGet: { maxExpiresIn: 60 } },
    });
    expect(merged.objectAcl).toBe(true);
    expect(merged.signedGet).toEqual({
      supported: true,
      disposition: true,
      maxExpiresIn: 60,
    });
    expect(merged.lifecycle).toBe(true);
    expect(mergeCapabilities(providerCapabilities.r2, undefined)).toBe(
      providerCapabilities.r2,
    );
  });

  it('requireCapability throws STORAGE_UNSUPPORTED naming the capability', () => {
    const adapter = {
      name: 'r2',
      capabilities: providerCapabilities.r2,
    } as StorageAdapter;
    expect(() =>
      requireCapability(adapter, (c) => c.signedPost, 'signed POST uploads'),
    ).toThrow(
      expect.objectContaining({
        cmsCode: 'STORAGE_UNSUPPORTED',
        message: 'Storage adapter "r2" does not support signed POST uploads',
      }),
    );
    expect(() =>
      requireCapability(adapter, (c) => c.copy, 'copy'),
    ).not.toThrow();
  });
});

describe('S3 adapter list, copy, deleteMany and cache control', () => {
  let s3: TestS3 | undefined;
  afterEach(async () => {
    await s3?.cleanup();
    s3 = undefined;
  });

  async function put(adapter: StorageAdapter, key: string) {
    await adapter.put(key, BODY, {
      contentType: 'image/png',
      contentLength: BODY.byteLength,
      cacheControl: 'public, max-age=31536000, immutable',
    });
  }

  it('stores and reports Cache-Control', async () => {
    s3 = await setupTestS3();
    const adapter = createS3StorageAdapter(s3.config);
    await put(adapter, 'pub/a.png');
    expect((await adapter.head('pub/a.png'))?.cacheControl).toBe(
      'public, max-age=31536000, immutable',
    );
  });

  it('signs Cache-Control into a presigned PUT', async () => {
    s3 = await setupTestS3();
    const adapter = createS3StorageAdapter(s3.config);
    const signed = await adapter.signPut('prv/a.png', {
      contentType: 'image/png',
      contentLength: BODY.byteLength,
      expiresIn: 60,
      cacheControl: 'private, max-age=31536000, immutable',
    });
    expect(
      new URL(signed.url).searchParams.get('X-Amz-SignedHeaders'),
    ).toContain('cache-control');
    expect(signed.headers['Cache-Control']).toBe(
      'private, max-age=31536000, immutable',
    );
  });

  it('lists keys under a prefix page by page', async () => {
    s3 = await setupTestS3();
    const adapter = createS3StorageAdapter(s3.config);
    for (const key of ['prv/a', 'prv/b', 'prv/c', 'pub/d'])
      await put(adapter, key);

    const first = await adapter.list!('prv/', { limit: 2 });
    expect(first.keys.map((k) => k.key)).toEqual(['prv/a', 'prv/b']);
    expect(first.keys[0].size).toBe(BODY.byteLength);
    expect(first.cursor).not.toBeNull();
    const second = await adapter.list!('prv/', {
      cursor: first.cursor,
      limit: 2,
    });
    expect(second.keys.map((k) => k.key)).toEqual(['prv/c']);
    expect(second.cursor).toBeNull();
  });

  it('copies an object with its metadata', async () => {
    s3 = await setupTestS3();
    const adapter = createS3StorageAdapter(s3.config);
    await put(adapter, 'prv/ast_1/a b.png');
    await adapter.copy!('prv/ast_1/a b.png', 'pub/ast_1/a b.png');
    expect(await adapter.head('pub/ast_1/a b.png')).toEqual({
      contentLength: BODY.byteLength,
      contentType: 'image/png',
      cacheControl: 'public, max-age=31536000, immutable',
    });
  });

  it('reports a failed copy', async () => {
    s3 = await setupTestS3();
    const adapter = createS3StorageAdapter(s3.config);
    await put(adapter, 'prv/x.png');
    s3.failCopyFrom.add('prv/x.png');
    await expect(adapter.copy!('prv/x.png', 'pub/x.png')).rejects.toThrow();
  });

  it('deletes many keys at once', async () => {
    s3 = await setupTestS3();
    const adapter = createS3StorageAdapter(s3.config);
    for (const key of ['a', 'b', 'c']) await put(adapter, key);
    await adapter.deleteMany!(['a', 'c', 'missing']);
    expect(s3.keys()).toEqual(['b']);
  });
});
