import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import type { ScanAdapter, ScanVerdict } from '../../types/s3';

import { assets } from '../../../schema';
import { setupTestCMS } from '../../../test-utils/cms';
import { createMemoryStorage } from '../../../test-utils/storage';
import { scanPendingAssets } from '../scan';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const png = (name: string) => ({
  name,
  size: PNG.byteLength,
  type: 'image/png',
  buffer: new Blob([PNG]),
});

async function setup(verdict: ScanVerdict | Error = 'clean') {
  const storage = createMemoryStorage({
    signedGet: { supported: true, disposition: true, maxExpiresIn: 3600 },
  });
  const scan: ScanAdapter = {
    scan: vi.fn(async () => {
      if (verdict instanceof Error) throw verdict;
      return verdict;
    }),
  };
  const ctx = await setupTestCMS({ media: { storage, scan } });
  const {
    assets: [asset],
  } = await ctx.cms.api.media.uploadAssets({ body: { files: [png('a.png')] } });
  const gate = (id: string) =>
    ctx.cms.router.handler(
      new Request(`http://localhost/api/cms/media/asset/${id}`),
    );
  const row = async (id: string) =>
    (await ctx.db.select().from(assets).where(eq(assets.id, id)))[0];
  const sweep = () =>
    scanPendingAssets(ctx.db, ctx.s3.config, {
      limit: 10,
      deadline: Date.now() + 10_000,
    });
  return { ...ctx, storage, scan, asset, gate, row, sweep };
}

describe('malware scan', () => {
  it('keeps a new upload pending, private and undelivered until scanned', async () => {
    const { cms, asset, gate, row } = await setup();
    expect(asset.processingState).toBe('pending');
    expect((await gate(asset.id)).status).toBe(409);

    const published = await cms.api.media.updateAssetsStatus({
      body: { assetIds: [asset.id], status: 'public' },
    });
    expect(published.updatedIds).toEqual([]);
    expect((await row(asset.id)).status).toBe('private');
  });

  it('makes clean assets ready and deliverable', async () => {
    const { asset, gate, row, sweep, scan } = await setup('clean');
    const result = await sweep();
    expect(result.ready).toEqual([asset.id]);
    expect(scan.scan).toHaveBeenCalledWith(
      expect.objectContaining({ assetId: asset.id, mimeType: 'image/png' }),
    );
    expect((await row(asset.id)).processingState).toBe('ready');
    expect((await gate(asset.id)).status).not.toBe(409);
    // Idempotent: nothing is left to scan.
    expect((await sweep()).ready).toEqual([]);
  });

  it('deletes infected objects and marks the asset failed', async () => {
    const { asset, row, sweep, storage } = await setup('infected');
    const key = (await row(asset.id)).objectKey;
    const result = await sweep();
    expect(result.failed).toEqual([asset.id]);
    expect((await row(asset.id)).processingState).toBe('failed');
    expect(storage.objects.has(key)).toBe(false);
  });

  it('leaves the asset pending when the scanner throws', async () => {
    const { asset, row, sweep } = await setup(new Error('clamd down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await sweep();
    expect(result.errored).toEqual([asset.id]);
    expect((await row(asset.id)).processingState).toBe('pending');
  });

  it('filters the listing by processing state', async () => {
    const { cms, asset } = await setup();
    const pending = await cms.api.media.listAssets({
      query: { processingState: 'pending' },
    });
    expect(pending.assets.map((a) => a.id)).toEqual([asset.id]);
    const ready = await cms.api.media.listAssets({
      query: { processingState: 'ready' },
    });
    expect(ready.assets).toEqual([]);
  });
});

describe('malware scan with visibility prefixes', () => {
  it('moves a public asset to the public prefix once it is clean', async () => {
    const storage = createMemoryStorage();
    const scan: ScanAdapter = { scan: async () => 'clean' };
    const ctx = await setupTestCMS({
      media: { storage, scan, visibility: 'prefix' },
    });
    const {
      assets: [asset],
    } = await ctx.cms.api.media.uploadAssets({
      body: { files: [png('a.png')] },
    });
    // A replace of a public asset leaves its row public with pending bytes.
    await ctx.db
      .update(assets)
      .set({ status: 'public' })
      .where(eq(assets.id, asset.id));
    expect([...storage.objects.keys()]).toEqual([
      expect.stringMatching(/^prv\//),
    ]);

    await scanPendingAssets(ctx.db, ctx.s3.config, {
      limit: 10,
      deadline: Date.now() + 10_000,
    });
    expect([...storage.objects.keys()]).toEqual([
      expect.stringMatching(/^pub\//),
    ]);
  });
});

describe('without a scanner', () => {
  it('stores uploads as ready', async () => {
    const { cms } = await setupTestCMS({
      media: { storage: createMemoryStorage() },
    });
    const {
      assets: [asset],
    } = await cms.api.media.uploadAssets({ body: { files: [png('a.png')] } });
    expect(asset.processingState).toBe('ready');
  });
});
