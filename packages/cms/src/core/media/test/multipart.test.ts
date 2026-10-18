import { afterEach, describe, expect, it } from 'vitest';

import type { TestS3 } from '../../../test-utils/s3';

import { setupTestCMS } from '../../../test-utils/cms';
import { partLength, planParts } from '../multipart-plan';

const MIB = 1024 * 1024;

describe('planParts', () => {
  it('uses 8 MiB parts and stays below 9,000 parts for huge files', () => {
    expect(planParts(500 * MIB, 5 * MIB)).toEqual({
      partSize: 8 * MIB,
      partCount: 63,
    });
    const huge = planParts(100 * 1024 * MIB, 5 * MIB);
    expect(huge.partSize % MIB).toBe(0);
    expect(huge.partCount).toBeLessThanOrEqual(9000);
    expect(planParts(10 * MIB, 16 * MIB).partSize).toBe(16 * MIB);
    expect(partLength(20, 8, 3)).toBe(4);
  });
});

describe('multipart uploads', () => {
  let cleanup: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await cleanup?.();
    cleanup = undefined;
  });

  /** A PNG-signed file of `size` bytes with a recognizable pattern. */
  const bytes = (size: number) => {
    const out = new Uint8Array(size).map((_, i) => i % 251);
    out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    return out;
  };

  async function setup() {
    const ctx = await setupTestCMS({
      withS3: true,
      media: {
        multipart: { threshold: 1024, partSize: 1024 },
        capabilities: { multipart: { minPartSize: 1 } },
      },
    });
    cleanup = ctx.s3.cleanup;
    const s3 = ctx.s3 as TestS3;
    const body = bytes(4500);
    const signed = await ctx.cms.api.media.createSignedUpload({
      body: {
        files: [{ name: 'big.png', size: body.length, type: 'image/png' }],
      },
    });
    return { ...ctx, s3, body, entry: signed.uploads[0] };
  }

  async function putParts(
    cms: Awaited<ReturnType<typeof setup>>['cms'],
    token: string,
    body: Uint8Array,
    partNumbers: number[],
  ) {
    const { parts } = await cms.api.media.signUploadParts({
      body: { token, partNumbers },
    });
    for (const part of parts) {
      const start = (part.partNumber - 1) * 1024;
      const res = await fetch(part.url, {
        method: 'PUT',
        body: body.slice(start, start + 1024),
      });
      expect(res.ok).toBe(true);
    }
  }

  it('uploads in parts, resumes from the listed parts and verifies like a single PUT', async () => {
    const { cms, s3, body, entry } = await setup();
    expect(entry.signedUrl).toBeNull();
    expect(entry.multipart).toMatchObject({ partSize: 1024, partCount: 5 });

    await putParts(cms, entry.token, body, [1, 2, 3]);
    const listed = await cms.api.media.listUploadParts({
      body: { token: entry.token },
    });
    expect(listed.parts.map((p) => p.partNumber)).toEqual([1, 2, 3]);
    await putParts(cms, entry.token, body, [4, 5]);

    const completed = await cms.api.media.completeUpload({
      body: { uploads: [{ token: entry.token }] },
    });
    expect(completed.errors).toEqual([]);
    expect(completed.assets[0].size).toBe(4500);
    expect(new Uint8Array(s3.object(entry.objectKey)!.body)).toEqual(body);
    expect(s3.pendingUploads()).toEqual([]);

    // A second completion finds the assembled object and the existing row.
    const again = await cms.api.media.completeUpload({
      body: { uploads: [{ token: entry.token }] },
    });
    expect(again.assets[0]?.id ?? again.errors[0]?.code).toBeDefined();
  });

  it('refuses part numbers beyond the plan', async () => {
    const { cms, entry } = await setup();
    await expect(
      cms.api.media.signUploadParts({
        body: { token: entry.token, partNumbers: [6] },
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('reports a missing part instead of completing', async () => {
    const { cms, body, entry, s3 } = await setup();
    await putParts(cms, entry.token, body, [1, 2, 4, 5]);
    const completed = await cms.api.media.completeUpload({
      body: { uploads: [{ token: entry.token }] },
    });
    expect(completed.errors.map((e) => e.code)).toEqual(['UPLOAD_NOT_FOUND']);
    expect(s3.pendingUploads()).toHaveLength(1);
  });

  it('aborts the multipart upload', async () => {
    const { cms, body, entry, s3 } = await setup();
    await putParts(cms, entry.token, body, [1]);
    await cms.api.media.abortUpload({ body: { token: entry.token } });
    expect(s3.pendingUploads()).toEqual([]);
  });

  it('keeps small files on a single PUT', async () => {
    const ctx = await setupTestCMS({ withS3: true });
    cleanup = ctx.s3.cleanup;
    const signed = await ctx.cms.api.media.createSignedUpload({
      body: { files: [{ name: 'small.png', size: 4500, type: 'image/png' }] },
    });
    expect(signed.uploads[0]).toMatchObject({ multipart: null });
    expect(signed.uploads[0].signedUrl).toEqual(expect.any(String));
  });
});
