import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { assetFolders, assets } from '../../../schema';
import { setupTestCMS } from '../../../test-utils/cms';
import { createMemoryStorage } from '../../../test-utils/storage';
import { createRateWindow } from '../../routes/media-assets';

const emitted: { event: string; assetId?: string; folderId?: string }[] = [];
vi.mock('../events', async (importOriginal) => {
  const original = await importOriginal<typeof import('../events')>();
  return {
    ...original,
    emitMediaEvents: vi.fn(
      async (_rt: unknown, _scope: unknown, events: typeof emitted) => {
        emitted.push(...events);
      },
    ),
  };
});

beforeEach(() => {
  emitted.length = 0;
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const png = (name: string) => ({
  name,
  size: PNG.byteLength,
  type: 'image/png',
  buffer: new Blob([PNG]),
});

async function setup() {
  const storage = createMemoryStorage({
    signedGet: { supported: true, disposition: true, maxExpiresIn: 3600 },
  });
  const ctx = await setupTestCMS({ media: { storage } });
  const {
    assets: [asset],
  } = await ctx.cms.api.media.uploadAssets({
    body: { files: [png('team.png')] },
  });
  return { ...ctx, storage, asset };
}

describe('updateAsset', () => {
  it('applies a patch based on the current updatedAt', async () => {
    const { cms, asset } = await setup();
    const { asset: updated } = await cms.api.media.updateAsset({
      body: {
        assetId: asset.id,
        patch: {
          originalName: 'Team Workshop.png',
          metadata: { description: 'Workshop', rights: { credit: 'Jo' } },
        },
        expectedUpdatedAt: new Date(asset.updatedAt).toISOString(),
      },
    });
    expect(updated).toMatchObject({
      originalName: 'Team Workshop.png',
      metadata: { description: 'Workshop', rights: { credit: 'Jo' } },
    });
  });

  it('rejects the second of two edits from the same base with 409', async () => {
    const { cms, asset } = await setup();
    const base = new Date(asset.updatedAt).toISOString();
    await cms.api.media.updateAsset({
      body: {
        assetId: asset.id,
        patch: { originalName: 'A.png' },
        expectedUpdatedAt: base,
      },
    });
    await expect(
      cms.api.media.updateAsset({
        body: {
          assetId: asset.id,
          patch: { originalName: 'B.png' },
          expectedUpdatedAt: base,
        },
      }),
    ).rejects.toMatchObject({
      cmsCode: 'ASSET_CONFLICT',
      statusCode: 409,
      body: { data: { asset: { originalName: 'A.png' } } },
    });
  });

  it('merges metadata key by key and removes keys set to null', async () => {
    const { cms, asset } = await setup();
    const first = await cms.api.media.updateAsset({
      body: {
        assetId: asset.id,
        patch: { metadata: { rights: { credit: 'Jo', license: 'CC-BY' } } },
        expectedUpdatedAt: new Date(asset.updatedAt).toISOString(),
      },
    });
    const second = await cms.api.media.updateAsset({
      body: {
        assetId: asset.id,
        patch: { metadata: { rights: { license: null } } },
        expectedUpdatedAt: new Date(first.asset.updatedAt).toISOString(),
      },
    });
    expect(second.asset.metadata).toEqual({ rights: { credit: 'Jo' } });
  });

  it.each([
    ['GPS data', { exif: { gps: { lat: 1, lng: 2 } } }],
    ['a focal point outside 0..1', { focal: { x: 2, y: 0 } }],
    ['a colour that is not #rrggbb', { dominantColor: 'red' }],
    ['a description over 2,000 characters', { description: 'x'.repeat(2001) }],
  ])('rejects %s', async (_label, metadata) => {
    const { cms, asset } = await setup();
    await expect(
      cms.api.media.updateAsset({
        body: {
          assetId: asset.id,
          patch: { metadata },
          expectedUpdatedAt: new Date(asset.updatedAt).toISOString(),
        },
      }),
    ).rejects.toMatchObject({ body: { code: 'VALIDATION_ERROR' } });
  });
});

describe('focal point, provenance, restore', () => {
  it('sets and clears the focal point', async () => {
    const { cms, asset } = await setup();
    const set = await cms.api.media.setFocalPoint({
      body: { assetId: asset.id, focal: { x: 0.25, y: 0.75 } },
    });
    expect(set.asset.metadata.focal).toEqual({ x: 0.25, y: 0.75 });
    const cleared = await cms.api.media.setFocalPoint({
      body: { assetId: asset.id, focal: null },
    });
    expect(cleared.asset.metadata.focal).toBeUndefined();
  });

  it('records a hand-set provenance as user-sourced', async () => {
    const { cms, asset } = await setup();
    const { asset: updated } = await cms.api.media.setProvenance({
      body: { assetId: asset.id, provenance: 'ai_generated' },
    });
    expect(updated.provenance).toBe('ai_generated');
    expect(updated.metadata.provenanceSource).toBe('user');
  });

  it('restores an asset with the variants archived together with it', async () => {
    const { cms, db, asset } = await setup();
    const [stale] = await db
      .insert(assets)
      .values({
        slug: 'stale.webp',
        mimeType: 'image/webp',
        size: 1,
        objectKey: 'stale.webp',
        variantOf: asset.id,
        variantKey: 'w320.webp',
        archivedAt: new Date(Date.now() - 86_400_000),
      })
      .returning();
    const [fresh] = await db
      .insert(assets)
      .values({
        slug: 'fresh.webp',
        mimeType: 'image/webp',
        size: 1,
        objectKey: 'fresh.webp',
        variantOf: asset.id,
        variantKey: 'w640.webp',
      })
      .returning();
    await cms.api.media.archiveAssets({ body: { assetIds: [asset.id] } });
    const { restoredIds } = await cms.api.media.restoreAssets({
      body: { assetIds: [asset.id] },
    });
    expect(restoredIds).toEqual([asset.id]);
    const rows = new Map(
      (await db.select().from(assets)).map((r) => [r.id, r.archivedAt]),
    );
    expect(rows.get(asset.id)).toBeNull();
    expect(rows.get(fresh.id)).toBeNull();
    expect(rows.get(stale.id)).not.toBeNull();
  });

  it('restores into the root when the folder is in the trash', async () => {
    const { cms, db } = await setup();
    const { folder } = await cms.api.media.createFolder({
      body: { name: 'F' },
    });
    const {
      assets: [inFolder],
    } = await cms.api.media.uploadAssets({
      body: { files: [png('f.png')], folderId: folder.id },
    });
    await cms.api.media.archiveAssets({ body: { assetIds: [inFolder.id] } });
    await cms.api.media.deleteFolder({ body: { folderId: folder.id } });
    await cms.api.media.restoreAssets({ body: { assetIds: [inFolder.id] } });
    const [row] = await db
      .select()
      .from(assets)
      .where(eq(assets.id, inFolder.id));
    expect(row.folderId).toBeNull();
    const [f] = await db
      .select()
      .from(assetFolders)
      .where(eq(assetFolders.id, folder.id));
    expect(f.archivedAt).not.toBeNull();
  });
});

describe('batchAssets', () => {
  it('rejects more than 500 ids', async () => {
    const { cms } = await setup();
    await expect(
      cms.api.media.batchAssets({
        body: {
          assetIds: Array.from({ length: 501 }, (_, i) => `ast_${i}`),
          operation: { op: 'restore' },
        },
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('reports the outcome per id', async () => {
    const { cms, asset } = await setup();
    const { folder } = await cms.api.media.createFolder({
      body: { name: 'F' },
    });
    const { results } = await cms.api.media.batchAssets({
      body: {
        assetIds: [asset.id, 'ast_unknown000000000000'],
        operation: { op: 'move', folderId: folder.id },
      },
    });
    expect(results).toEqual([
      { id: asset.id, ok: true },
      { id: 'ast_unknown000000000000', ok: false, error: 'ASSET_NOT_FOUND' },
    ]);
  });

  it('applies the archive guards', async () => {
    const { cms, asset } = await setup();
    const root = await cms.api.pages.createRoot({
      body: { slug: '/p', properties: { title: 'P' } },
    });
    await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'image',
        properties: { src: asset.id, alt: 'x' },
      },
    });
    const { results } = await cms.api.media.batchAssets({
      body: { assetIds: [asset.id], operation: { op: 'archive' } },
    });
    expect(results).toEqual([{ id: asset.id, ok: false, error: 'in_use' }]);
  });

  it('sets provenance in bulk', async () => {
    const { cms, asset } = await setup();
    const { results } = await cms.api.media.batchAssets({
      body: {
        assetIds: [asset.id],
        operation: { op: 'setProvenance', provenance: 'captured' },
      },
    });
    expect(results[0].ok).toBe(true);
    const { assets: listed } = await cms.api.media.getAssets({
      query: { ids: [asset.id] },
    });
    expect(listed[0]).toMatchObject({
      provenance: 'captured',
      metadata: { provenanceSource: 'user' },
    });
  });
});

describe('revisions', () => {
  it('keeps replaced bytes as a revision and rolls back to them', async () => {
    const { cms, db, asset } = await setup();
    await db.insert(assets).values({
      slug: 'v.webp',
      mimeType: 'image/webp',
      size: 1,
      objectKey: 'v.webp',
      variantOf: asset.id,
      variantKey: 'w320.webp',
    });
    await cms.api.media.replaceAsset({
      body: {
        assetId: asset.id,
        file: png('team-v2.png'),
        revisionNote: 'Recolored',
      },
    });

    const { revisions } = await cms.api.media.listRevisions({
      query: { assetId: asset.id },
    });
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({
      originalName: 'team.png',
      note: 'Recolored',
    });

    const { asset: rolledBack } = await cms.api.media.setCurrentRevision({
      body: { assetId: asset.id, revisionId: revisions[0].id },
    });
    expect(rolledBack.id).toBe(asset.id);
    expect(rolledBack.objectKey).toBe(asset.objectKey);
    expect(rolledBack.originalName).toBe('team.png');

    const after = await cms.api.media.listRevisions({
      query: { assetId: asset.id },
    });
    expect(after.revisions[0].originalName).toBe('team-v2.png');

    // Rolling back again restores the replacement.
    const { asset: again } = await cms.api.media.setCurrentRevision({
      body: { assetId: asset.id, revisionId: after.revisions[0].id },
    });
    expect(again.originalName).toBe('team-v2.png');
    const variants = await db
      .select()
      .from(assets)
      .where(eq(assets.variantOf, asset.id));
    expect(variants.every((v) => v.archivedAt !== null)).toBe(true);
  });

  it('rejects a revision of another asset', async () => {
    const { cms, asset } = await setup();
    const {
      assets: [other],
    } = await cms.api.media.uploadAssets({ body: { files: [png('o.png')] } });
    await cms.api.media.replaceAsset({
      body: { assetId: other.id, file: png('o2.png') },
    });
    const { revisions } = await cms.api.media.listRevisions({
      query: { assetId: other.id },
    });
    await expect(
      cms.api.media.setCurrentRevision({
        body: { assetId: asset.id, revisionId: revisions[0].id },
      }),
    ).rejects.toMatchObject({ cmsCode: 'REVISION_NOT_FOUND' });
  });

  it('serves a pinned revision through the gate with ?rev', async () => {
    const { cms, asset } = await setup();
    await cms.api.media.updateAssetsStatus({
      body: { assetIds: [asset.id], status: 'public' },
    });
    await cms.api.media.replaceAsset({
      body: { assetId: asset.id, file: png('v2.png') },
    });
    const { revisions } = await cms.api.media.listRevisions({
      query: { assetId: asset.id },
    });
    const res = await cms.router.handler(
      new Request(
        `http://localhost/api/cms/media/asset/${asset.id}?rev=${revisions[0].id}`,
      ),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain(asset.objectKey);
    const foreign = await cms.router.handler(
      new Request(
        `http://localhost/api/cms/media/asset/${asset.id}?rev=ast_nope`,
      ),
    );
    expect(foreign.status).toBe(404);
  });
});

describe('asset list fields', () => {
  it('lists dimensions, provenance, metadata and live variants', async () => {
    const { cms, db, asset } = await setup();
    await db.insert(assets).values([
      {
        slug: 'a.webp',
        mimeType: 'image/webp',
        size: 10,
        width: 640,
        height: 480,
        objectKey: 'a',
        variantOf: asset.id,
        variantKey: 'w640.webp',
      },
      {
        slug: 'b.webp',
        mimeType: 'image/webp',
        size: 5,
        width: 320,
        height: 240,
        objectKey: 'b',
        variantOf: asset.id,
        variantKey: 'w320.webp',
      },
      {
        slug: 'c.webp',
        mimeType: 'image/webp',
        size: 1,
        objectKey: 'c',
        variantOf: asset.id,
        variantKey: 'w160.webp',
        archivedAt: new Date(),
      },
    ]);
    const { assets: listed } = await cms.api.media.listAssets();
    const item = listed.find((a) => a.id === asset.id)!;
    expect(item).toMatchObject({
      originalName: 'team.png',
      provenance: 'unknown',
      metadata: {},
      variants: [
        { variantKey: 'w320.webp', width: 320, height: 240, size: 5 },
        { variantKey: 'w640.webp', width: 640, height: 480, size: 10 },
      ],
    });
  });
});

describe('media events', () => {
  afterEach(() => vi.clearAllMocks());

  it('emits one event per change after each write', async () => {
    const { cms, asset } = await setup();
    expect(emitted).toEqual([
      { event: 'media.asset.created', assetId: asset.id },
    ]);
    emitted.length = 0;

    await cms.api.media.setFocalPoint({
      body: { assetId: asset.id, focal: { x: 0.5, y: 0.5 } },
    });
    await cms.api.media.archiveAssets({ body: { assetIds: [asset.id] } });
    await cms.api.media.restoreAssets({ body: { assetIds: [asset.id] } });
    await cms.api.media.replaceAsset({
      body: { assetId: asset.id, file: png('n.png') },
    });
    const { folder } = await cms.api.media.createFolder({
      body: { name: 'F' },
    });
    await cms.api.media.renameFolder({
      body: { folderId: folder.id, name: 'G' },
    });
    await cms.api.media.deleteFolder({ body: { folderId: folder.id } });

    expect(emitted.map((e) => e.event)).toEqual([
      'media.asset.updated',
      'media.asset.archived',
      'media.asset.restored',
      'media.asset.replaced',
      'media.folder.created',
      'media.folder.renamed',
      'media.folder.deleted',
    ]);
  });

  it('emits nothing when the write fails', async () => {
    const { cms, asset } = await setup();
    emitted.length = 0;
    await expect(
      cms.api.media.updateAsset({
        body: {
          assetId: asset.id,
          patch: { originalName: 'x.png' },
          expectedUpdatedAt: new Date(0).toISOString(),
        },
      }),
    ).rejects.toThrow();
    expect(emitted).toEqual([]);
  });
});

describe('downloadIntent', () => {
  it('signs readable assets, reports the rest and calls the audit hook', async () => {
    const onAssetDownload = vi.fn();
    const storage = createMemoryStorage({
      signedGet: { supported: true, disposition: true, maxExpiresIn: 3600 },
    });
    const signGet = vi.spyOn(storage, 'signGet');
    const { cms } = await setupTestCMS({ media: { storage, onAssetDownload } });
    const {
      assets: [asset],
    } = await cms.api.media.uploadAssets({
      body: { files: [png('team.png')] },
    });
    const result = await cms.api.media.downloadIntent({
      body: { assetIds: [asset.id, 'missing'], bulkJobId: 'job_1' },
    });
    expect(result.items).toEqual([
      {
        id: asset.id,
        url: expect.stringMatching(/^memory:\/\//),
        size: PNG.byteLength,
        name: 'team.png',
      },
    ]);
    expect(result.skipped).toEqual(['missing']);
    expect(signGet.mock.calls[0][1]).toMatchObject({
      expiresIn: 300,
      responseContentDisposition: expect.stringContaining('attachment'),
    });
    expect(onAssetDownload).toHaveBeenCalledWith({
      assetIds: [asset.id],
      actorId: null,
      variantKey: null,
      bulkJobId: 'job_1',
      ipHash: null,
    });
  });

  it('answers 429 with Retry-After past the per-minute limit', async () => {
    const storage = createMemoryStorage({
      signedGet: { supported: true, disposition: true, maxExpiresIn: 3600 },
    });
    const { cms } = await setupTestCMS({
      media: { storage, downloadRateLimit: 2 },
    });
    const { assets: uploaded } = await cms.api.media.uploadAssets({
      body: { files: [png('a.png'), png('b.png'), png('c.png')] },
    });
    const ids = uploaded.map((a) => a.id);
    await cms.api.media.downloadIntent({ body: { assetIds: ids.slice(0, 2) } });
    const error = await cms.api.media
      .downloadIntent({ body: { assetIds: [ids[2]] } })
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ cmsCode: 'RATE_LIMITED', statusCode: 429 });
    const headers = new Headers((error as { headers: HeadersInit }).headers);
    expect(Number(headers.get('retry-after'))).toBeGreaterThan(0);
  });
});

describe('allowReplaceWithDifferentType', () => {
  it('rejects a replace of another type when turned off', async () => {
    const storage = createMemoryStorage({
      signedGet: { supported: true, disposition: true, maxExpiresIn: 3600 },
    });
    const { cms } = await setupTestCMS({
      media: { storage, allowReplaceWithDifferentType: false },
    });
    const {
      assets: [asset],
    } = await cms.api.media.uploadAssets({ body: { files: [png('a.png')] } });
    await expect(
      cms.api.media.createSignedReplace({
        body: {
          assetId: asset.id,
          file: { name: 'a.jpg', size: 10, type: 'image/jpeg' },
        },
      }),
    ).rejects.toMatchObject({ cmsCode: 'INVALID_FILE_TYPE' });
  });
});

describe('createRateWindow', () => {
  it('frees capacity as hits leave the minute', () => {
    let now = 0;
    const take = createRateWindow(() => now);
    expect(take('u', 2, 3)).toBe(0);
    now = 30_000;
    expect(take('u', 1, 3)).toBe(0);
    expect(take('u', 2, 3)).toBe(30);
    now = 60_000;
    expect(take('u', 2, 3)).toBe(0);
    expect(take('other', 3, 3)).toBe(0);
    expect(take('u', 5, 3)).toBe(60);
  });
});
