import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { assetFolders, assets } from '../../../schema';
import { setupTestCMS } from '../../../test-utils/cms';
import { createMemoryStorage } from '../../../test-utils/storage';
import { readImageDimensions } from '../dimensions';

function png(width: number, height: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  b.set(new TextEncoder().encode('IHDR'), 12);
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  return b;
}

function gif(width: number, height: number): Uint8Array {
  const b = new Uint8Array(13);
  b.set(new TextEncoder().encode('GIF89a'));
  new DataView(b.buffer).setUint16(6, width, true);
  new DataView(b.buffer).setUint16(8, height, true);
  return b;
}

function jpeg(width: number, height: number): Uint8Array {
  // SOI, an APP0 segment of 16 bytes, then SOF0.
  const b = new Uint8Array(2 + 18 + 19);
  b.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  const sof = 20;
  b.set([0xff, 0xc0, 0x00, 0x11, 0x08], sof);
  new DataView(b.buffer).setUint16(sof + 5, height);
  new DataView(b.buffer).setUint16(sof + 7, width);
  return b;
}

function webpVp8x(width: number, height: number): Uint8Array {
  const b = new Uint8Array(30);
  const t = new TextEncoder();
  b.set(t.encode('RIFF'));
  b.set(t.encode('WEBPVP8X'), 8);
  const w = width - 1;
  const h = height - 1;
  b.set([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff], 24);
  b.set([h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff], 27);
  return b;
}

describe('readImageDimensions', () => {
  it.each([
    ['PNG', png(1920, 1080)],
    ['GIF', gif(1920, 1080)],
    ['JPEG', jpeg(1920, 1080)],
    ['WebP VP8X', webpVp8x(1920, 1080)],
  ])('reads %s', (_label, bytes) => {
    expect(readImageDimensions(bytes)).toEqual({ width: 1920, height: 1080 });
  });

  it('returns null for unknown or truncated data', () => {
    expect(
      readImageDimensions(new TextEncoder().encode('%PDF-1.7')),
    ).toBeNull();
    expect(readImageDimensions(png(1, 1).subarray(0, 10))).toBeNull();
  });
});

describe('runMediaBackfill', () => {
  async function setup() {
    const storage = createMemoryStorage();
    const ctx = await setupTestCMS({ media: { storage } });
    await storage.put('hero.png', png(800, 600), {
      contentType: 'image/png',
      contentLength: 33,
    });
    const [hero] = await ctx.db
      .insert(assets)
      .values({
        slug: 'hero.png',
        mimeType: 'image/png',
        size: 33,
        objectKey: 'hero.png',
      })
      .returning();
    const variant = (slug: string) =>
      ctx.db
        .insert(assets)
        .values({
          slug,
          mimeType: 'image/webp',
          size: 1,
          objectKey: slug,
          variantOf: hero.id,
        })
        .returning()
        .then(([row]) => row);
    const v800 = await variant('hero-800-webp.webp');
    const v800dup = await variant('hero-800-webp-2.webp');
    const formatOnly = await variant('hero-webp.webp');
    await ctx.db
      .insert(assetFolders)
      .values({ id: 'afl_old000000000000000001', name: 'Old' });
    return { ...ctx, hero, v800, v800dup, formatOnly };
  }

  it('reports without writing in a dry run', async () => {
    const { cms, db, hero } = await setup();
    const report = await cms.api.admin.runMediaBackfill({
      body: { dryRun: true },
    });
    expect(report).toMatchObject({ dryRun: true, done: true, processed: 4 });
    expect(report.updated.originalName).toBe(4);
    const [row] = await db.select().from(assets).where(eq(assets.id, hero.id));
    expect(row.originalName).toBeNull();
    expect(row.width).toBeNull();
  });

  it('fills names, keys, dimensions and folder paths, and is idempotent', async () => {
    const { cms, db, hero, v800, v800dup, formatOnly } = await setup();
    const report = await cms.api.admin.runMediaBackfill({ body: {} });
    expect(report.updated).toMatchObject({
      originalName: 4,
      variantKey: 1,
      dimensions: 1,
      folderPaths: 1,
    });
    expect(report.detachedVariants.sort()).toEqual(
      [v800dup.id, formatOnly.id].sort(),
    );

    const rows = new Map(
      (await db.select().from(assets)).map((r) => [r.id, r]),
    );
    expect(rows.get(hero.id)).toMatchObject({
      originalName: 'hero.png',
      width: 800,
      height: 600,
    });
    expect(rows.get(v800.id)!.variantKey).toBe('w800.webp');
    expect(rows.get(formatOnly.id)!.variantOf).toBeNull();
    const [folder] = await db.select().from(assetFolders);
    expect(folder.path).toBe('/afl_old000000000000000001/');

    const again = await cms.api.admin.runMediaBackfill({ body: {} });
    expect(again.updated).toEqual({
      originalName: 0,
      variantKey: 0,
      dimensions: 0,
      folderPaths: 0,
    });
    expect(again.detachedVariants).toEqual([]);
  });

  it('continues from a cursor', async () => {
    const { cms } = await setup();
    const first = await cms.api.admin.runMediaBackfill({ body: { limit: 3 } });
    expect(first).toMatchObject({ processed: 3, done: false });
    const second = await cms.api.admin.runMediaBackfill({
      body: { limit: 3, cursor: first.cursor },
    });
    expect(second).toMatchObject({ processed: 1, done: true, cursor: null });
  });
});
