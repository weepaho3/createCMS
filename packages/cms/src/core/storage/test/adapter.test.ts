import { afterEach, describe, expect, it } from 'vitest';

import { type TestS3, setupTestS3 } from '../../../test-utils/s3';
import { getStorage } from '../get-storage';
import { createS3StorageAdapter } from '../s3/adapter';
import { providerCapabilities } from '../s3/presets';

const BODY = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('createS3StorageAdapter', () => {
  let s3: TestS3 | undefined;
  afterEach(async () => {
    await s3?.cleanup();
    s3 = undefined;
  });

  it('constructs without credentials and fails on the first call', async () => {
    const adapter = createS3StorageAdapter({
      provider: 'custom',
      hostname: '',
      region: 'us-east-1',
      accessKeyId: '',
      secretAccessKey: '',
      bucketName: 'bucket',
      publicUrl: 'http://localhost/bucket',
    });
    await expect(adapter.head('x')).rejects.toMatchObject({
      cmsCode: 'MISSING_REQUIRED_S3_PARAMETERS',
    });
  });

  it('put, head, getRange, signPut, signGet and delete round-trip', async () => {
    s3 = await setupTestS3();
    const adapter = createS3StorageAdapter(s3.config);

    await adapter.put('a/img.png', BODY, {
      contentType: 'image/png',
      contentLength: BODY.byteLength,
      acl: 'public-read',
    });
    expect(await adapter.head('a/img.png')).toEqual({
      contentLength: BODY.byteLength,
      contentType: 'image/png',
      cacheControl: null,
    });
    expect(await adapter.getRange('a/img.png', 1, 3)).toEqual(BODY.slice(1, 4));

    const signed = await adapter.signPut('b/img.png', {
      contentType: 'image/png',
      contentLength: BODY.byteLength,
      expiresIn: 60,
      acl: 'public-read',
    });
    expect(signed.headers).toEqual({
      'Content-Type': 'image/png',
      'x-amz-acl': 'public-read',
    });
    const put = await fetch(signed.url, {
      method: 'PUT',
      headers: {
        ...signed.headers,
        'content-length': String(BODY.byteLength),
      },
      body: BODY,
    });
    expect(put.ok).toBe(true);
    expect(await adapter.head('b/img.png')).toMatchObject({
      contentLength: BODY.byteLength,
    });

    const url = await adapter.signGet('a/img.png', {
      expiresIn: 60,
      responseContentDisposition: 'attachment;filename="img.png"',
    });
    const got = await fetch(url);
    expect(got.ok).toBe(true);
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(BODY);

    await adapter.delete('a/img.png');
    expect(await adapter.head('a/img.png')).toBeNull();
  });

  it('declares the S3 capabilities', () => {
    const adapter = createS3StorageAdapter({
      provider: 'aws',
      region: 'us-east-1',
      accessKeyId: 'k',
      secretAccessKey: 's',
      bucketName: 'bucket',
      publicUrl: 'https://cdn.example.com',
    });
    expect(adapter.name).toBe('s3:aws');
    expect(adapter.capabilities).toEqual(providerCapabilities.aws);
  });
});

describe('getStorage', () => {
  it('returns the same adapter for the same config object', () => {
    const config = {
      provider: 'aws' as const,
      region: 'us-east-1',
      accessKeyId: 'k',
      secretAccessKey: 's',
      bucketName: 'bucket',
      publicUrl: 'https://cdn.example.com',
    };
    expect(getStorage(config)).toBe(getStorage(config));
    expect(getStorage({ ...config })).not.toBe(getStorage(config));
  });

  it('prefers a configured adapter', () => {
    const custom = {
      name: 'memory',
      capabilities: providerCapabilities.generic,
      put: async () => {},
      delete: async () => {},
      head: async () => null,
      getRange: async () => null,
      signPut: async () => ({ url: '', headers: {} }),
      signGet: async () => '',
    };
    expect(
      getStorage({
        provider: 'aws',
        region: 'us-east-1',
        accessKeyId: 'k',
        secretAccessKey: 's',
        bucketName: 'bucket',
        publicUrl: 'https://cdn.example.com',
        storage: custom,
      }),
    ).toBe(custom);
  });
});
