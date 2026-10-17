import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TestS3 } from '../../../test-utils/s3';

import { setupMultiTenantTestCMS } from '../../../plugins/multi-tenant/test/utils/cms';
import { assets } from '../../../schema';
import { setupTestCMS } from '../../../test-utils/cms';
import { setupTestDB } from '../../../test-utils/db';
import {
  DUMMY_MEDIA_CONFIG,
  TEST_COLLECTIONS,
} from '../../../test-utils/fixtures';
import { publishApprovedBranch } from '../../../test-utils/helpers';
import { createMemoryStorage } from '../../../test-utils/storage';
import { createCMS } from '../../factory';
import { keyWithVisibility } from '../placement';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PUBLIC = 'public, max-age=31536000, immutable';
const PRIVATE = 'private, max-age=31536000, immutable';

type Cms = Awaited<ReturnType<typeof setupTestCMS>>['cms'];

async function upload(cms: Cms, name = 'hero.png') {
  const signed = await cms.api.media.createSignedUpload({
    body: { files: [{ name, size: PNG.byteLength, type: 'image/png' }] },
  });
  const [target] = signed.uploads;
  const res = await fetch(target.signedUrl, {
    method: 'PUT',
    headers: target.headers,
    body: PNG,
  });
  expect(res.ok).toBe(true);
  const completed = await cms.api.media.completeUpload({
    body: { uploads: [{ token: target.token }] },
  });
  return completed.assets[0];
}

describe('keyWithVisibility', () => {
  it('sets the visibility segment and keeps the tenant segment', () => {
    expect(keyWithVisibility('prv/ast_1/a.png', 'public')).toBe(
      'pub/ast_1/a.png',
    );
    expect(keyWithVisibility('t/acme/pub/ast_1/a.png', 'private')).toBe(
      't/acme/prv/ast_1/a.png',
    );
    expect(keyWithVisibility('ast_1/a.png', 'public', 't/acme/')).toBe(
      't/acme/pub/ast_1/a.png',
    );
    expect(keyWithVisibility('hero.png', 'private')).toBe('prv/hero.png');
  });
});

describe("visibility: 'prefix'", () => {
  let cleanup: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await cleanup?.();
    cleanup = undefined;
  });

  async function setup(media = {}) {
    const ctx = await setupTestCMS({ withS3: true, media });
    const s3 = ctx.s3 as TestS3;
    cleanup = s3.cleanup;
    // Bucket policy: anonymous reads only under pub/.
    s3.publicRead.allows = (key) => key.startsWith('pub/');
    return { ...ctx, s3 };
  }

  const anonymousGet = (url: string) => fetch(url).then((r) => r.status);

  it('uploads into prv/, unreadable through the bucket URL', async () => {
    const { cms, s3 } = await setup();
    const asset = await upload(cms);
    expect(asset.objectKey).toMatch(/^prv\//);
    expect(s3.object(asset.objectKey)?.cacheControl).toBe(PRIVATE);
    expect(
      await anonymousGet(`${s3.config.publicUrl}/${asset.objectKey}`),
    ).toBe(403);
  });

  it('moves the object to pub/ and back with the status', async () => {
    const onPurge = vi.fn();
    const { cms, db, s3 } = await setup({ onPurge });
    const asset = await upload(cms);

    await cms.api.media.updateAssetsStatus({
      body: { assetIds: [asset.id], status: 'public' },
    });
    const [pub] = await db.select().from(assets).where(eq(assets.id, asset.id));
    expect(pub.status).toBe('public');
    expect(pub.objectKey).toBe(asset.objectKey.replace(/^prv\//, 'pub/'));
    expect(s3.keys()).toEqual([pub.objectKey]);
    expect(s3.object(pub.objectKey)?.cacheControl).toBe(PUBLIC);
    expect(s3.object(pub.objectKey)?.contentType).toBe('image/png');
    expect(await anonymousGet(`${s3.config.publicUrl}/${pub.objectKey}`)).toBe(
      200,
    );
    expect(onPurge).toHaveBeenCalledWith([`/media/asset/${asset.id}`]);

    await cms.api.media.updateAssetsStatus({
      body: { assetIds: [asset.id], status: 'private' },
    });
    const [prv] = await db.select().from(assets).where(eq(assets.id, asset.id));
    expect(prv.objectKey).toBe(asset.objectKey);
    expect(s3.keys()).toEqual([asset.objectKey]);
    expect(s3.object(prv.objectKey)?.cacheControl).toBe(PRIVATE);
  });

  it('moves variants together with their asset', async () => {
    const { cms, db, s3 } = await setup();
    const asset = await upload(cms);
    const variantSigned = await cms.api.media.createSignedUpload({
      body: {
        files: [
          {
            name: 'hero-w320.png',
            size: PNG.byteLength,
            type: 'image/png',
            variantOf: asset.id,
          },
        ],
      },
    });
    await fetch(variantSigned.uploads[0].signedUrl, {
      method: 'PUT',
      headers: variantSigned.uploads[0].headers,
      body: PNG,
    });
    const {
      assets: [variant],
    } = await cms.api.media.completeUpload({
      body: { uploads: [{ token: variantSigned.uploads[0].token }] },
    });

    await cms.api.media.updateAssetsStatus({
      body: { assetIds: [asset.id], status: 'public' },
    });
    const [row] = await db
      .select()
      .from(assets)
      .where(eq(assets.id, variant.id));
    expect(row.objectKey).toMatch(/^pub\//);
    expect(s3.keys().every((k) => k.startsWith('pub/'))).toBe(true);
  });

  it('keeps status and keys when the copy fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { cms, db, s3 } = await setup();
    const asset = await upload(cms);
    s3.failCopyFrom.add(asset.objectKey);

    const res = await cms.api.media.updateAssetsStatus({
      body: { assetIds: [asset.id], status: 'public' },
    });
    expect(res.updatedIds).toEqual([]);
    expect(res.skipped).toEqual([asset.id]);
    const [row] = await db.select().from(assets).where(eq(assets.id, asset.id));
    expect(row.status).toBe('private');
    expect(row.objectKey).toBe(asset.objectKey);
    expect(s3.keys()).toEqual([asset.objectKey]);
    error.mockRestore();
  });

  it('publishing content moves the referenced asset to pub/', async () => {
    const { cms, db } = await setup();
    const asset = await upload(cms);
    const root = await cms.api.pages.createRoot({
      body: { slug: '/hero', properties: { title: 'Page' } },
    });
    await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'image',
        properties: { src: asset.id, alt: 'Hero' },
      },
    });
    await publishApprovedBranch(cms, {
      rootId: root.rootId,
      branchId: root.branchId,
      publishedBy: 'user-1',
    });
    const [published] = await db
      .select()
      .from(assets)
      .where(eq(assets.id, asset.id));
    expect(published.status).toBe('public');
    expect(published.objectKey).toMatch(/^pub\//);

    await cms.api.pages.unpublishBranch({
      body: { rootId: root.rootId, branchId: root.branchId },
    });
    const [unpublished] = await db
      .select()
      .from(assets)
      .where(eq(assets.id, asset.id));
    expect(unpublished.objectKey).toMatch(/^prv\//);
  });

  it('puts the tenant segment first under the multi-tenant plugin', async () => {
    const ctx = await setupMultiTenantTestCMS({ withS3: true });
    cleanup = ctx.s3.cleanup;
    ctx.setTenant('acme');
    const asset = await upload(ctx.cms as unknown as Cms);
    expect(asset.objectKey).toMatch(/^t\/acme\/prv\/ast_/);
  });
});

describe('construction', () => {
  it("rejects visibility 'prefix' without the copy capability", async () => {
    const { db } = await setupTestDB();
    const storage = createMemoryStorage({ copy: false });
    expect(() =>
      createCMS({
        db,
        media: { ...DUMMY_MEDIA_CONFIG, visibility: 'prefix', storage },
        collections: TEST_COLLECTIONS,
        authMiddleware: async () => ({}),
      }),
    ).toThrow(/needs a storage adapter with the copy capability/);
    expect(() =>
      createCMS({
        db,
        media: { ...DUMMY_MEDIA_CONFIG, visibility: 'legacy', storage },
        collections: TEST_COLLECTIONS,
        authMiddleware: async () => ({}),
      }),
    ).not.toThrow();
  });
});
