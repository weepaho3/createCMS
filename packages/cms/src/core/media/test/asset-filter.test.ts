import { eq, inArray, isNotNull } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { assetFolders, assets } from '../../../schema';
import { setupTestCMS } from '../../../test-utils/cms';

type Seed = Partial<typeof assets.$inferInsert> & { id: string };

async function setup() {
  const ctx = await setupTestCMS();
  const [products] = await ctx.db
    .insert(assetFolders)
    .values({
      name: 'Products',
      path: '/fld_products/',
      depth: 0,
      id: 'fld_products',
    })
    .returning();
  const [shoes] = await ctx.db
    .insert(assetFolders)
    .values({
      name: 'Shoes',
      parentId: products.id,
      path: '/fld_products/fld_shoes/',
      depth: 1,
      id: 'fld_shoes',
    })
    .returning();
  const day = (n: number) => new Date(Date.UTC(2026, 0, n, 12));
  const seed: Seed[] = [
    {
      id: 'ast_harbor',
      originalName: 'Hamburg Hafen.jpg',
      mimeType: 'image/jpeg',
      size: 4_000_000,
      width: 4000,
      height: 3000,
      createdAt: day(1),
      provenance: 'captured',
      status: 'public',
    },
    {
      id: 'ast_logo',
      originalName: 'logo.svg',
      mimeType: 'image/svg+xml',
      size: 2_000,
      width: 512,
      height: 512,
      createdAt: day(2),
      folderId: products.id,
    },
    {
      id: 'ast_portrait',
      originalName: 'Team Portrait.webp',
      mimeType: 'image/webp',
      size: 900_000,
      width: 1200,
      height: 1800,
      createdAt: day(3),
      folderId: shoes.id,
      provenance: 'ai_generated',
      metadata: {
        description: 'Sneaker campaign hero',
        rights: { credit: 'Studio Nord', expiresAt: '2026-01-10' },
      },
    },
    {
      id: 'ast_clip',
      originalName: 'teaser.mp4',
      mimeType: 'video/mp4',
      size: 30_000_000,
      createdAt: day(4),
      folderId: shoes.id,
    },
    {
      id: 'ast_doc',
      originalName: 'Pricelist 2026.pdf',
      mimeType: 'application/pdf',
      size: 120_000,
      createdAt: day(5),
    },
    {
      id: 'ast_zip',
      originalName: 'press-kit.zip',
      mimeType: 'application/zip',
      size: 50_000_000,
      createdAt: day(6),
      uploadedBy: 'usr_1',
    },
    {
      id: 'ast_gone',
      originalName: 'old.png',
      mimeType: 'image/png',
      size: 10,
      createdAt: day(7),
      archivedAt: day(8),
    },
  ];
  await ctx.db.insert(assets).values(
    seed.map((row) => ({
      slug: row.id,
      objectKey: `${row.id}/file`,
      mimeType: 'application/octet-stream',
      size: 1,
      ...row,
    })),
  );
  // A rendition of the harbor photo: never listed on its own.
  await ctx.db.insert(assets).values({
    id: 'ast_harbor_w320',
    slug: 'ast_harbor_w320',
    objectKey: 'ast_harbor/w320.webp',
    mimeType: 'image/webp',
    size: 10,
    variantOf: 'ast_harbor',
    variantKey: 'w320.webp',
  });
  const list = async (query: Record<string, unknown>) =>
    (await ctx.cms.api.media.listAssets({ query })).assets.map((a) => a.id);
  return { ...ctx, list, products, shoes };
}

describe('listAssets filters', () => {
  it('finds "Hamb" in Hamburg Hafen.jpg and full-text matches description and credit', async () => {
    const { list } = await setup();
    expect(await list({ q: 'Hamb' })).toEqual(['ast_harbor']);
    expect(await list({ q: 'sneaker' })).toEqual(['ast_portrait']);
    expect(await list({ q: 'studio nord' })).toEqual(['ast_portrait']);
    expect(await list({ q: 'does-not-exist' })).toEqual([]);
  });

  it('never lists variants, and archived assets only with archived', async () => {
    const { list } = await setup();
    const all = await list({ limit: 100 });
    expect(all).not.toContain('ast_harbor_w320');
    expect(all).not.toContain('ast_gone');
    expect(await list({ archived: true })).toEqual(['ast_gone']);
  });

  it('filters by kind, type prefix, provenance, visibility and uploader', async () => {
    const { list } = await setup();
    expect(await list({ kinds: 'video,archive' })).toEqual([
      'ast_zip',
      'ast_clip',
    ]);
    expect(await list({ kinds: 'document' })).toEqual(['ast_doc']);
    expect(await list({ mime: 'image/*', limit: 100 })).toEqual([
      'ast_portrait',
      'ast_logo',
      'ast_harbor',
    ]);
    expect(await list({ provenance: 'ai_generated' })).toEqual([
      'ast_portrait',
    ]);
    expect(await list({ visibility: 'public' })).toEqual(['ast_harbor']);
    expect(await list({ uploadedBy: 'usr_1' })).toEqual(['ast_zip']);
  });

  it('filters by folder recursively, dates, size, dimensions, orientation and expiring rights', async () => {
    const { list, products } = await setup();
    expect(await list({ folderId: products.id })).toEqual(['ast_logo']);
    expect(await list({ folderId: products.id, recursive: true })).toEqual([
      'ast_clip',
      'ast_portrait',
      'ast_logo',
    ]);
    expect(
      await list({ createdFrom: '2026-01-02', createdTo: '2026-01-03' }),
    ).toEqual(['ast_portrait', 'ast_logo']);
    expect(await list({ sizeMin: 1_000_000, sizeMax: 40_000_000 })).toEqual([
      'ast_clip',
      'ast_harbor',
    ]);
    expect(await list({ widthMin: 1000, heightMin: 1500 })).toEqual([
      'ast_portrait',
      'ast_harbor',
    ]);
    expect(
      await list({ widthMin: 1000, heightMin: 1500, orientation: 'portrait' }),
    ).toEqual(['ast_portrait']);
    expect(await list({ orientation: 'square' })).toEqual(['ast_logo']);
    expect(await list({ orientation: 'landscape' })).toEqual(['ast_harbor']);
    expect(await list({ expiringWithinDays: 30 })).toEqual(['ast_portrait']);
  });

  it('pages every filter and sort with the keyset cursor', async () => {
    const { cms } = await setup();
    for (const [sortBy, sortDirection] of [
      ['createdAt', 'desc'],
      ['createdAt', 'asc'],
      ['originalName', 'asc'],
      ['size', 'desc'],
      ['updatedAt', 'desc'],
      ['width', 'desc'],
    ] as const) {
      const seen: string[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 10; page++) {
        const query: {
          limit: number;
          sortBy: typeof sortBy;
          sortDirection: typeof sortDirection;
          mime: string;
          cursor?: string;
        } = {
          limit: 2,
          sortBy,
          sortDirection,
          mime: 'image/*,video/*,application/*',
        };
        if (cursor) query.cursor = cursor;
        const result = await cms.api.media.listAssets({ query });
        seen.push(...result.assets.map((a) => a.id));
        if (!result.nextCursor) break;
        cursor = result.nextCursor;
      }
      expect(new Set(seen).size, `${sortBy} ${sortDirection}`).toBe(6);
      expect(seen).toHaveLength(6);
      if (sortBy === 'originalName') {
        expect(seen.slice(0, 2)).toEqual(['ast_harbor', 'ast_logo']);
      }
      if (sortBy === 'width') {
        expect(seen[0]).toBe('ast_harbor');
      }
    }
  });

  it('skips the count with includeTotal: false', async () => {
    const { cms } = await setup();
    const counted = await cms.api.media.listAssets({ query: { limit: 2 } });
    expect(counted.total).toBe(6);
    const uncounted = await cms.api.media.listAssets({
      query: { limit: 2, includeTotal: false },
    });
    expect(uncounted.total).toBeNull();
    expect(uncounted.hasMore).toBe(true);
  });
});

describe('getAssetFacets', () => {
  it('counts each dimension without its own filter', async () => {
    const { cms } = await setup();
    const facets = await cms.api.media.getAssetFacets({
      query: { kinds: 'image', provenance: 'captured' },
    });
    expect(facets.kinds).toEqual({ image: 1 });
    expect(facets.provenance).toEqual({
      captured: 1,
      unknown: 1,
      ai_generated: 1,
    });
    expect(facets.visibility).toEqual({ public: 1 });
  });
});

describe('bulk allMatching', () => {
  it('archives every match on the server, loaded or not, minus except', async () => {
    const { cms, db } = await setup();
    const result = await cms.api.media.archiveAssets({
      body: {
        allMatching: { query: { mime: 'image/*' }, except: ['ast_logo'] },
      },
    });
    expect([...result.archivedIds].sort()).toEqual([
      'ast_harbor',
      'ast_harbor_w320',
      'ast_portrait',
    ]);
    const archived = await db
      .select({ id: assets.id })
      .from(assets)
      .where(isNotNull(assets.archivedAt));
    expect(archived.map((a) => a.id).sort()).toEqual([
      'ast_gone',
      'ast_harbor',
      'ast_harbor_w320',
      'ast_portrait',
    ]);
  });

  it('moves, updates status and restores by filter', async () => {
    const { cms, db, shoes } = await setup();
    await cms.api.media.moveAssets({
      body: {
        allMatching: { query: { kinds: 'document,archive' }, except: [] },
        folderId: shoes.id,
      },
    });
    const moved = await db
      .select({ id: assets.id })
      .from(assets)
      .where(eq(assets.folderId, shoes.id));
    expect(moved.map((a) => a.id).sort()).toEqual([
      'ast_clip',
      'ast_doc',
      'ast_portrait',
      'ast_zip',
    ]);
    const status = await cms.api.media.updateAssetsStatus({
      body: {
        allMatching: { query: { folderId: shoes.id }, except: ['ast_clip'] },
        status: 'public',
      },
    });
    expect([...status.updatedIds].sort()).toEqual([
      'ast_doc',
      'ast_portrait',
      'ast_zip',
    ]);
    const restored = await cms.api.media.restoreAssets({
      body: { allMatching: { query: {}, except: [] } },
    });
    expect(restored.restoredIds).toEqual(['ast_gone']);
    const rows = await db
      .select({ id: assets.id })
      .from(assets)
      .where(inArray(assets.id, ['ast_gone']));
    expect(rows).toHaveLength(1);
  });

  it('requires assetIds or allMatching', async () => {
    const { cms } = await setup();
    await expect(
      cms.api.media.archiveAssets({ body: {} as never }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('listFolders', () => {
  it('reports direct subfolder counts', async () => {
    const { cms } = await setup();
    const { folders } = await cms.api.media.listFolders({ query: {} });
    expect(folders).toEqual([
      expect.objectContaining({
        id: 'fld_products',
        folderCount: 1,
        assetCount: 1,
        assetCountRecursive: 3,
      }),
    ]);
  });
});
