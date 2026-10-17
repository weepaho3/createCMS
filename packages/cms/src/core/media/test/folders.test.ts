import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { setupMultiTenantTestCMS } from '../../../plugins/multi-tenant/test/utils/cms';
import { assetFolders, assets } from '../../../schema';
import { setupTestCMS } from '../../../test-utils/cms';
import { publishApprovedBranch } from '../../../test-utils/helpers';

type Cms = Awaited<ReturnType<typeof setupTestCMS>>['cms'];

async function folder(cms: Cms, name: string, parentFolderId?: string) {
  return (await cms.api.media.createFolder({ body: { name, parentFolderId } }))
    .folder;
}

describe('folder names', () => {
  it('rejects duplicate names among live siblings, roots included', async () => {
    const { cms } = await setupTestCMS();
    const brand = await folder(cms, 'Brand');
    await expect(folder(cms, 'Brand')).rejects.toMatchObject({
      cmsCode: 'FOLDER_NAME_TAKEN',
    });
    await folder(cms, 'Logos', brand.id);
    await expect(folder(cms, 'Logos', brand.id)).rejects.toMatchObject({
      cmsCode: 'FOLDER_NAME_TAKEN',
    });
  });

  it('frees a name once the folder is in the trash', async () => {
    const { cms } = await setupTestCMS();
    const brand = await folder(cms, 'Brand');
    await cms.api.media.deleteFolder({ body: { folderId: brand.id } });
    await expect(folder(cms, 'Brand')).resolves.toBeDefined();
  });

  it('renames, with the same conflict rule', async () => {
    const { cms } = await setupTestCMS();
    const a = await folder(cms, 'A');
    await folder(cms, 'B');
    const { folder: renamed } = await cms.api.media.renameFolder({
      body: { folderId: a.id, name: 'C' },
    });
    expect(renamed.name).toBe('C');
    await expect(
      cms.api.media.renameFolder({ body: { folderId: a.id, name: 'B' } }),
    ).rejects.toMatchObject({ cmsCode: 'FOLDER_NAME_TAKEN' });
  });

  it('lets two tenants own a root folder of the same name', async () => {
    const { cms, setTenant } = await setupMultiTenantTestCMS();
    setTenant('acme');
    await folder(cms as unknown as Cms, 'Brand');
    setTenant('globex');
    await expect(folder(cms as unknown as Cms, 'Brand')).resolves.toBeDefined();
    await expect(folder(cms as unknown as Cms, 'Brand')).rejects.toMatchObject({
      cmsCode: 'FOLDER_NAME_TAKEN',
    });
  });
});

describe('folder paths', () => {
  it('stores path and depth and resolves breadcrumbs', async () => {
    const { cms, db } = await setupTestCMS();
    const a = await folder(cms, 'A');
    const b = await folder(cms, 'B', a.id);
    const c = await folder(cms, 'C', b.id);
    const [row] = await db
      .select({ path: assetFolders.path, depth: assetFolders.depth })
      .from(assetFolders)
      .where(eq(assetFolders.id, c.id));
    expect(row).toEqual({ path: `/${a.id}/${b.id}/${c.id}/`, depth: 2 });

    const { path } = await cms.api.media.getFolderPath({
      query: { folderId: c.id },
    });
    expect(path.map((f) => f.name)).toEqual(['A', 'B', 'C']);
  });

  it('moves a subtree in one path rewrite and blocks cycles', async () => {
    const { cms, db } = await setupTestCMS();
    const a = await folder(cms, 'A');
    const b = await folder(cms, 'B', a.id);
    const c = await folder(cms, 'C', b.id);
    const x = await folder(cms, 'X');

    await cms.api.media.moveFolder({
      body: { folderId: b.id, newParentFolderId: x.id },
    });
    const [row] = await db
      .select({ path: assetFolders.path, depth: assetFolders.depth })
      .from(assetFolders)
      .where(eq(assetFolders.id, c.id));
    expect(row).toEqual({ path: `/${x.id}/${b.id}/${c.id}/`, depth: 2 });

    await expect(
      cms.api.media.moveFolder({
        body: { folderId: x.id, newParentFolderId: c.id },
      }),
    ).rejects.toMatchObject({ cmsCode: 'CANNOT_MOVE_INTO_DESCENDANT' });
  });

  it('backfills paths of folders created without them', async () => {
    const { cms, db } = await setupTestCMS();
    await db.insert(assetFolders).values([
      { id: 'afl_root0000000000000001', name: 'Old' },
      {
        id: 'afl_child000000000000001',
        name: 'Child',
        parentId: 'afl_root0000000000000001',
      },
    ]);
    const { path } = await cms.api.media.getFolderPath({
      query: { folderId: 'afl_child000000000000001' },
    });
    expect(path.map((f) => f.name)).toEqual(['Old', 'Child']);
  });

  it('refuses a raw SQL delete of a parent folder', async () => {
    const { cms, db } = await setupTestCMS();
    const a = await folder(cms, 'A');
    await folder(cms, 'B', a.id);
    await expect(
      db.execute(sql`DELETE FROM cms.asset_folders WHERE id = ${a.id}`),
    ).rejects.toThrow();
  });
});

describe('folder counts and delete modes', () => {
  async function tree() {
    const ctx = await setupTestCMS();
    const top = await folder(ctx.cms, 'Top');
    const sub = await folder(ctx.cms, 'Sub', top.id);
    const insert = (slug: string, folderId: string) =>
      ctx.db
        .insert(assets)
        .values({
          slug,
          mimeType: 'image/png',
          size: 1,
          objectKey: slug,
          folderId,
        })
        .returning()
        .then(([row]) => row);
    const inTop = await insert('top.png', top.id);
    const inSub = await insert('sub.png', sub.id);
    const used = await insert('used.png', sub.id);
    return { ...ctx, top, sub, inTop, inSub, used };
  }

  async function useAsset(cms: Cms, assetId: string) {
    const root = await cms.api.pages.createRoot({
      body: { slug: '/p', properties: { title: 'P' } },
    });
    await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'image',
        properties: { src: assetId, alt: 'x' },
      },
    });
    await publishApprovedBranch(cms, {
      rootId: root.rootId,
      branchId: root.branchId,
      publishedBy: 'u',
    });
  }

  it('counts assets directly and recursively', async () => {
    const { cms } = await tree();
    const { folders } = await cms.api.media.listFolders();
    expect(folders[0]).toMatchObject({
      name: 'Top',
      assetCount: 1,
      assetCountRecursive: 3,
    });
  });

  it('previews a deletion with dryRun without changing anything', async () => {
    const { cms, db, top, used } = await tree();
    await useAsset(cms, used.id);
    const preview = await cms.api.media.deleteFolder({
      body: { folderId: top.id, mode: 'archive-contents', dryRun: true },
    });
    expect(preview).toMatchObject({ folders: 1, assets: 3, assetsInUse: 1 });
    const [row] = await db
      .select()
      .from(assetFolders)
      .where(eq(assetFolders.id, top.id));
    expect(row.archivedAt).toBeNull();
  });

  it('refuses empty-only on a folder with content', async () => {
    const { cms, top } = await tree();
    await expect(
      cms.api.media.deleteFolder({ body: { folderId: top.id } }),
    ).rejects.toMatchObject({ cmsCode: 'FOLDER_HAS_CONTENT' });
  });

  it('move-to-parent lifts subfolders and assets one level', async () => {
    const { cms, db, top, sub, inSub } = await tree();
    await cms.api.media.deleteFolder({
      body: { folderId: sub.id, mode: 'move-to-parent' },
    });
    const [asset] = await db
      .select()
      .from(assets)
      .where(eq(assets.id, inSub.id));
    expect(asset.folderId).toBe(top.id);
    const { folders } = await cms.api.media.listFolders({
      query: { parentFolderId: top.id },
    });
    expect(folders).toEqual([]);
  });

  it('archive-contents archives the subtree but keeps assets in use', async () => {
    const { cms, db, top, inTop, inSub, used } = await tree();
    await useAsset(cms, used.id);
    const result = await cms.api.media.deleteFolder({
      body: { folderId: top.id, mode: 'archive-contents' },
    });
    expect(result.skipped).toEqual([used.id]);
    const rows = await db.select().from(assets);
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(inTop.id)!.archivedAt).not.toBeNull();
    expect(byId.get(inSub.id)!.archivedAt).not.toBeNull();
    expect(byId.get(used.id)!.archivedAt).toBeNull();
    expect(byId.get(used.id)!.folderId).toBeNull();
    expect((await cms.api.media.listFolders()).folders).toEqual([]);
  });
});

describe('recursive counts per folder', () => {
  it('counts each folder subtree separately', async () => {
    const { cms, db } = await setupTestCMS();
    const a = await folder(cms, 'A');
    const b = await folder(cms, 'B');
    await db.insert(assets).values([
      {
        slug: 'a1.png',
        mimeType: 'image/png',
        size: 1,
        objectKey: 'a1',
        folderId: a.id,
      },
      {
        slug: 'a2.png',
        mimeType: 'image/png',
        size: 1,
        objectKey: 'a2',
        folderId: a.id,
      },
      {
        slug: 'b1.png',
        mimeType: 'image/png',
        size: 1,
        objectKey: 'b1',
        folderId: b.id,
      },
    ]);
    const { folders } = await cms.api.media.listFolders();
    expect(
      folders.map((f) => [f.name, f.assetCount, f.assetCountRecursive]),
    ).toEqual([
      ['A', 2, 2],
      ['B', 1, 1],
    ]);
  });
});
