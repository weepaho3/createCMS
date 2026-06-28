import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { assetFolders, assets, roots } from '../../../schema';
import { resolveTenantSlug } from '../index';
import { setupMultiTenantTestCMS } from './utils/cms';

// ============================================================================
// Tenant isolation — Roots / Blocks
// ============================================================================

describe('multiTenant — root isolation', () => {
  it('creates a root with the active tenant slug', async () => {
    const { cms, db, setTenant } = await setupMultiTenantTestCMS();
    setTenant('acme');

    const result = await cms.api.pages.createRoot({
      body: { slug: '/', properties: { title: 'Home' } },
    });

    const rows = await db.execute(
      sql`SELECT tenant_slug FROM cms.roots WHERE id = ${result.rootId}`,
    );
    expect(rows.rows[0].tenant_slug).toBe('acme');
  });

  it('lists only roots belonging to the active tenant', async () => {
    const { cms, setTenant } = await setupMultiTenantTestCMS();

    setTenant('acme');
    await cms.api.pages.createRoot({
      body: { slug: '/acme', properties: { title: 'Acme Home' } },
    });
    await cms.api.pages.createRoot({
      body: { slug: '/acme-about', properties: { title: 'Acme About' } },
    });

    setTenant('globex');
    await cms.api.pages.createRoot({
      body: { slug: '/globex', properties: { title: 'Globex Home' } },
    });

    // Acme should see only its own roots
    setTenant('acme');
    const acmeRoots = await cms.api.pages.listRoots();
    expect(acmeRoots.roots).toHaveLength(2);
    const acmeTitles = acmeRoots.roots
      .map((r) => (r.properties as any).title)
      .sort();
    expect(acmeTitles).toEqual(['Acme About', 'Acme Home']);

    // Globex should see only its own root
    setTenant('globex');
    const globexRoots = await cms.api.pages.listRoots();
    expect(globexRoots.roots).toHaveLength(1);
    expect((globexRoots.roots[0].properties as any).title).toBe('Globex Home');
  });

  it('duplicates a root within the same tenant', async () => {
    const { cms, setTenant } = await setupMultiTenantTestCMS();

    setTenant('acme');
    const created = await cms.api.pages.createRoot({
      body: { slug: '/acme-page', properties: { title: 'Acme Page' } },
    });

    const dup = await cms.api.pages.duplicateBlock({
      body: {
        rootId: created.rootId,
        branchId: created.branchId,
        blockId: created.rootId,
        targetProperties: { title: 'Acme Page Copy' },
        targetSlug: '/acme-page-copy',
        message: 'Duplicate root',
      },
    });
    expect(dup.commitId).toBeDefined();

    // Both roots should be visible to the same tenant
    const roots = await cms.api.pages.listRoots();
    expect(roots.roots).toHaveLength(2);
  });
});

// ============================================================================
// Tenant isolation — Published content (getPublishedContent scope gate)
// ============================================================================

describe('multiTenant — getPublishedContent isolation', () => {
  it("does not expose another tenant's published content by rootId", async () => {
    const { cms, setTenant } = await setupMultiTenantTestCMS();

    setTenant('acme');
    const acmePage = await cms.api.pages.createRoot({
      body: { slug: '/secret', properties: { title: 'Acme Secret' } },
    });
    await cms.api.pages.publishBranch({
      body: { rootId: acmePage.rootId, branchId: acmePage.branchId },
    });

    // The owning tenant can read its own published content.
    const asAcme = await cms.api.pages.getPublishedContent({
      query: { rootId: acmePage.rootId },
    });
    expect(asAcme.rootId).toBe(acmePage.rootId);

    // Another tenant must NOT be able to read it, even with the exact rootId.
    setTenant('globex');
    await expect(
      cms.api.pages.getPublishedContent({
        query: { rootId: acmePage.rootId },
      }),
    ).rejects.toThrow();
  });

  it("does not resolve another tenant's content by an identical slug", async () => {
    const { cms, setTenant } = await setupMultiTenantTestCMS();

    setTenant('acme');
    const acmePage = await cms.api.pages.createRoot({
      body: { slug: '/shared', properties: { title: 'Acme Shared' } },
    });
    await cms.api.pages.publishBranch({
      body: { rootId: acmePage.rootId, branchId: acmePage.branchId },
    });

    // Globex has no page at this slug → must get not-found, never Acme's page.
    setTenant('globex');
    await expect(
      cms.api.pages.getPublishedContent({ query: { slug: '/shared' } }),
    ).rejects.toThrow();
  });
});

// ============================================================================
// Tenant isolation — by-id endpoints (IDOR via requireRootInScope)
// ============================================================================

describe('multiTenant — by-id endpoint IDOR protection', () => {
  it("rejects cross-tenant read of another tenant's root by id", async () => {
    const { cms, setTenant } = await setupMultiTenantTestCMS();

    setTenant('acme');
    const acme = await cms.api.pages.createRoot({
      body: { slug: '/acme-idor', properties: { title: 'Acme' } },
    });

    // The owner can read its own tree/history.
    await expect(
      cms.api.pages.getBlockTree({
        query: { rootId: acme.rootId, branchId: acme.branchId },
      }),
    ).resolves.toBeDefined();

    // Another tenant cannot, even with the exact ids.
    setTenant('globex');
    await expect(
      cms.api.pages.getBlockTree({
        query: { rootId: acme.rootId, branchId: acme.branchId },
      }),
    ).rejects.toThrow();
    await expect(
      cms.api.pages.getRootHistory({ query: { rootId: acme.rootId } }),
    ).rejects.toThrow();
  });

  it('allows two tenants to use the SAME slug (slug uniqueness is per-tenant)', async () => {
    const { cms, setTenant } = await setupMultiTenantTestCMS();

    setTenant('acme');
    await cms.api.pages.createRoot({
      body: { slug: '/blog', properties: { title: 'Acme Blog' } },
    });

    // globex can use /blog too — validateSlugUniqueness is now per-tenant (the
    // old global "two tenants can't share a slug" quirk is fixed).
    setTenant('globex');
    await expect(
      cms.api.pages.createRoot({
        body: { slug: '/blog', properties: { title: 'Globex Blog' } },
      }),
    ).resolves.toBeDefined();

    // But WITHIN a tenant the same slug is still rejected.
    await expect(
      cms.api.pages.createRoot({
        body: { slug: '/blog', properties: { title: 'Dup' } },
      }),
    ).rejects.toThrow();
  });

  it("rejects cross-tenant publish/unpublish of another tenant's root by id", async () => {
    const { cms, setTenant } = await setupMultiTenantTestCMS();

    setTenant('acme');
    const acme = await cms.api.pages.createRoot({
      body: { slug: '/acme-pub', properties: { title: 'Acme' } },
    });

    // Globex must not be able to publish or unpublish Acme's root, even with the
    // exact ids (the root lookup in publish/unpublishBranch is scope-gated).
    setTenant('globex');
    await expect(
      cms.api.pages.publishBranch({
        body: { rootId: acme.rootId, branchId: acme.branchId },
      }),
    ).rejects.toThrow();
    await expect(
      cms.api.pages.unpublishBranch({
        body: { rootId: acme.rootId, branchId: acme.branchId },
      }),
    ).rejects.toThrow();
  });

  it("rejects cross-tenant mutation of another tenant's root by id", async () => {
    const { cms, setTenant } = await setupMultiTenantTestCMS();

    setTenant('acme');
    const acme = await cms.api.pages.createRoot({
      body: { slug: '/acme-mut', properties: { title: 'Acme' } },
    });

    // Globex must not be able to update Acme's root.
    setTenant('globex');
    await expect(
      cms.api.pages.updateRoot({
        body: {
          rootId: acme.rootId,
          branchId: acme.branchId,
          properties: { title: 'hacked' },
        },
      }),
    ).rejects.toThrow();

    // And the title must be unchanged for the owner.
    setTenant('acme');
    const roots = await cms.api.pages.listRoots();
    expect((roots.roots[0].properties as { title?: string }).title).toBe(
      'Acme',
    );
  });
});

// ============================================================================
// Tenant isolation — list endpoints (raw-SQL scope, no id needed to leak)
// ============================================================================

describe('multiTenant — list endpoints do not leak across tenants', () => {
  it('listMergeRequests / listPublications / listBranches are tenant-scoped', async () => {
    const { cms, setTenant } = await setupMultiTenantTestCMS();

    setTenant('acme');
    const acme = await cms.api.pages.createRoot({
      body: { slug: '/acme-list', properties: { title: 'Acme' } },
    });
    const draft = await cms.api.pages.createBranch({
      body: {
        rootId: acme.rootId,
        name: 'feature',
        sourceBranchId: acme.branchId,
      },
    });
    await cms.api.pages.createMergeRequest({
      body: {
        sourceBranchId: draft.branchId,
        targetBranchId: acme.branchId,
        title: 'Acme MR',
        createdBy: 'acme-user',
      },
    });
    await cms.api.pages.publishBranch({
      body: { rootId: acme.rootId, branchId: acme.branchId },
    });

    // The owner sees its own MRs and publications.
    setTenant('acme');
    expect(
      (await cms.api.pages.listMergeRequests()).mergeRequests.length,
    ).toBeGreaterThan(0);
    expect(
      (await cms.api.pages.listPublications()).publications.length,
    ).toBeGreaterThan(0);

    // Another tenant sees NONE of them — not even with no id passed (the leak
    // that would otherwise list across all tenants).
    setTenant('globex');
    expect(
      (await cms.api.pages.listMergeRequests()).mergeRequests,
    ).toHaveLength(0);
    expect((await cms.api.pages.listPublications()).publications).toHaveLength(
      0,
    );

    // listBranches by another tenant's rootId is rejected outright.
    await expect(
      cms.api.pages.listBranches({ query: { rootId: acme.rootId } }),
    ).rejects.toThrow();
  });
});

// ============================================================================
// Tenant isolation — Media folders
// ============================================================================

describe('multiTenant — folder isolation', () => {
  it('creates a folder with the active tenant slug', async () => {
    const { cms, db, setTenant } = await setupMultiTenantTestCMS();
    setTenant('acme');

    const result = await cms.api.media.createFolder({
      body: { name: 'Images' },
    });

    const rows = await db.execute(
      sql`SELECT tenant_slug FROM cms.asset_folders WHERE id = ${result.folder.id}`,
    );
    expect(rows.rows[0].tenant_slug).toBe('acme');
  });

  it('isolates folders per tenant at the DB level', async () => {
    const { cms, db, setTenant } = await setupMultiTenantTestCMS();

    setTenant('acme');
    const acmeFolder = await cms.api.media.createFolder({
      body: { name: 'Acme Images' },
    });

    setTenant('globex');
    const globexFolder = await cms.api.media.createFolder({
      body: { name: 'Globex Images' },
    });

    const allFolders = await db.execute(
      sql`SELECT id, tenant_slug FROM cms.asset_folders`,
    );
    expect(allFolders.rows).toHaveLength(2);

    const acmeRow = allFolders.rows.find(
      (f: any) => f.id === acmeFolder.folder.id,
    );
    const globexRow = allFolders.rows.find(
      (f: any) => f.id === globexFolder.folder.id,
    );
    expect((acmeRow as any).tenant_slug).toBe('acme');
    expect((globexRow as any).tenant_slug).toBe('globex');
  });

  it('allows same folder name across different tenants', async () => {
    const { cms, setTenant } = await setupMultiTenantTestCMS();

    setTenant('acme');
    const acmeFolder = await cms.api.media.createFolder({
      body: { name: 'Images' },
    });
    expect(acmeFolder.folder.name).toBe('Images');

    setTenant('globex');
    const globexFolder = await cms.api.media.createFolder({
      body: { name: 'Images' },
    });
    expect(globexFolder.folder.name).toBe('Images');

    expect(acmeFolder.folder.id).not.toBe(globexFolder.folder.id);
  });

  it('moves a folder within the same tenant', async () => {
    const { cms, setTenant } = await setupMultiTenantTestCMS();
    setTenant('acme');

    const parent = await cms.api.media.createFolder({
      body: { name: 'Parent' },
    });
    const child = await cms.api.media.createFolder({
      body: { name: 'Child' },
    });

    const result = await cms.api.media.moveFolder({
      body: {
        folderId: child.folder.id,
        newParentFolderId: parent.folder.id,
      },
    });

    expect(result.folder.parentId).toBe(parent.folder.id);
  });

  it('deletes a folder within the active tenant', async () => {
    const { cms, db, setTenant } = await setupMultiTenantTestCMS();
    setTenant('acme');

    const folder = await cms.api.media.createFolder({
      body: { name: 'ToDelete' },
    });

    await cms.api.media.deleteFolder({
      body: { folderId: folder.folder.id },
    });

    const remaining = await db
      .select()
      .from(assetFolders)
      .where(eq(assetFolders.id, folder.folder.id));
    expect(remaining).toHaveLength(0);
  });
});

// ============================================================================
// Tenant isolation — Assets
// ============================================================================

describe('multiTenantPlugin — asset isolation', () => {
  it('lists only assets belonging to the active tenant', async () => {
    const { cms, db, setTenant } = await setupMultiTenantTestCMS();

    // Insert directly via raw SQL since the package's generated Drizzle schema
    // doesn't include the plugin-added tenant_slug column.
    await db.execute(sql`
      INSERT INTO cms.assets (id, slug, mime_type, size, object_key, status, tenant_slug)
      VALUES
        ('asset-acme-1', 'acme-logo', 'image/png', 1024, 'acme/logo.png', 'private', 'acme'),
        ('asset-globex-1', 'globex-logo', 'image/png', 2048, 'globex/logo.png', 'private', 'globex')
    `);

    setTenant('acme');
    const acmeAssets = await cms.api.media.listAssets();
    expect(acmeAssets.assets).toHaveLength(1);
    expect(acmeAssets.assets[0].slug).toBe('acme-logo');

    setTenant('globex');
    const globexAssets = await cms.api.media.listAssets();
    expect(globexAssets.assets).toHaveLength(1);
    expect(globexAssets.assets[0].slug).toBe('globex-logo');
  });

  it('updates asset status only for the active tenant', async () => {
    const { cms, db, setTenant } = await setupMultiTenantTestCMS();

    await db.execute(sql`
      INSERT INTO cms.assets (id, slug, mime_type, size, object_key, status, tenant_slug)
      VALUES
        ('asset-acme-1', 'acme-file', 'application/pdf', 512, 'acme/file.pdf', 'private', 'acme'),
        ('asset-globex-1', 'globex-file', 'application/pdf', 512, 'globex/file.pdf', 'private', 'globex')
    `);

    setTenant('acme');
    await cms.api.media.updateAssetStatus({
      body: { assetIds: ['asset-acme-1'], status: 'public' },
    });

    const [acmeAsset] = await db
      .select()
      .from(assets)
      .where(eq(assets.id, 'asset-acme-1'));
    expect(acmeAsset.status).toBe('public');

    const [globexAsset] = await db
      .select()
      .from(assets)
      .where(eq(assets.id, 'asset-globex-1'));
    expect(globexAsset.status).toBe('private');
  });

  it('resolves an in-scope image but nulls a cross-tenant one (no slug leak)', async () => {
    const { cms, db, setTenant } = await setupMultiTenantTestCMS();

    // One asset per tenant (tenant_slug is the plugin-added scope column).
    await db.execute(sql`
      INSERT INTO cms.assets (id, slug, mime_type, size, object_key, status, tenant_slug)
      VALUES
        ('asset-acme-hero', 'acme-hero', 'image/png', 1024, 'acme/hero.png', 'public', 'acme'),
        ('asset-globex-secret', 'globex-secret', 'image/png', 1024, 'globex/secret.png', 'public', 'globex')
    `);

    // Acme authors a page: one hero references its OWN asset, another references
    // a (forged) globex asset id — both are author-controlled strings.
    setTenant('acme');
    const page = await cms.api.pages.createRoot({
      body: { slug: '/heroes', properties: { title: 'Heroes' } },
    });
    await cms.api.pages.createBlock({
      body: {
        rootId: page.rootId,
        branchId: page.branchId,
        parentBlockId: page.rootId,
        type: 'hero',
        properties: { title: 'Mine', backgroundImage: 'asset-acme-hero' },
      },
    });
    await cms.api.pages.createBlock({
      body: {
        rootId: page.rootId,
        branchId: page.branchId,
        parentBlockId: page.rootId,
        type: 'hero',
        properties: { title: 'Theirs', backgroundImage: 'asset-globex-secret' },
      },
    });

    // Resolved read as acme: own asset → { id, slug }; cross-tenant id → null.
    // The scope gate (assetScopeConditions) never leaks globex's slug.
    const { tree } = await cms.api.pages.getBlockTree({
      query: { rootId: page.rootId, branchId: page.branchId, raw: false },
    });
    // `properties` is the union of all block types' props; narrow to the hero
    // field under test.
    const bgImage = (i: number) =>
      (tree.children[i].properties as { backgroundImage: unknown })
        .backgroundImage;
    expect(bgImage(0)).toEqual({ id: 'asset-acme-hero', slug: 'acme-hero' });
    expect(bgImage(1)).toBeNull();
  });
});

// ============================================================================
// Tenant isolation — Redirects
// ============================================================================

describe('multiTenant — redirect isolation', () => {
  it('tags createRedirect with the active tenant and scopes listRedirects', async () => {
    const { cms, db, setTenant } = await setupMultiTenantTestCMS();

    setTenant('acme');
    const acme = await cms.api.pages.createRedirect({
      body: {
        sourceType: 'path',
        sourcePath: '/pages/acme-old',
        targetType: 'path',
        targetPath: '/pages/acme-new',
      },
    });

    setTenant('globex');
    await cms.api.pages.createRedirect({
      body: {
        sourceType: 'path',
        sourcePath: '/pages/globex-old',
        targetType: 'path',
        targetPath: '/pages/globex-new',
      },
    });

    // The DB row carries the creating tenant.
    const rows = await db.execute(
      sql`SELECT tenant_slug FROM cms.redirects WHERE id = ${acme.redirect.id}`,
    );
    expect(rows.rows[0].tenant_slug).toBe('acme');

    // Each tenant lists only its own redirect.
    setTenant('acme');
    const acmeList = await cms.api.pages.listRedirects();
    expect(acmeList.redirects).toHaveLength(1);
    expect(acmeList.redirects[0].sourcePath).toBe('/pages/acme-old');

    setTenant('globex');
    const globexList = await cms.api.pages.listRedirects();
    expect(globexList.redirects).toHaveLength(1);
    expect(globexList.redirects[0].sourcePath).toBe('/pages/globex-old');
  });

  it('allows two tenants to own the SAME source path (the cross-tenant fix)', async () => {
    const { cms, setTenant } = await setupMultiTenantTestCMS();

    setTenant('acme');
    await cms.api.pages.createRedirect({
      body: {
        sourceType: 'path',
        sourcePath: '/pages/promo',
        targetType: 'path',
        targetPath: '/pages/acme-sale',
      },
    });

    // Globex creates a redirect for the IDENTICAL path — must NOT collide.
    setTenant('globex');
    await expect(
      cms.api.pages.createRedirect({
        body: {
          sourceType: 'path',
          sourcePath: '/pages/promo',
          targetType: 'path',
          targetPath: '/pages/globex-sale',
        },
      }),
    ).resolves.toBeDefined();

    // Each tenant resolves /pages/promo to ITS OWN target.
    setTenant('acme');
    expect(
      (await cms.api.pages.resolveRedirect({ query: { path: '/pages/promo' } }))
        .redirect,
    ).toEqual({ status: 301, location: '/pages/acme-sale' });

    setTenant('globex');
    expect(
      (await cms.api.pages.resolveRedirect({ query: { path: '/pages/promo' } }))
        .redirect,
    ).toEqual({ status: 301, location: '/pages/globex-sale' });
  });

  it("does not resolve another tenant's redirect", async () => {
    const { cms, setTenant } = await setupMultiTenantTestCMS();

    setTenant('acme');
    await cms.api.pages.createRedirect({
      body: {
        sourceType: 'path',
        sourcePath: '/pages/secret',
        targetType: 'path',
        targetPath: '/pages/acme-dest',
      },
    });

    // Globex has no redirect for this path → resolves to null, never acme's.
    setTenant('globex');
    const { redirect } = await cms.api.pages.resolveRedirect({
      query: { path: '/pages/secret' },
    });
    expect(redirect).toBeNull();
  });

  it('rejects cross-tenant archive and update of a redirect', async () => {
    const { cms, setTenant } = await setupMultiTenantTestCMS();

    setTenant('acme');
    const acme = await cms.api.pages.createRedirect({
      body: {
        sourceType: 'path',
        sourcePath: '/pages/owned',
        targetType: 'path',
        targetPath: '/pages/dest',
      },
    });

    setTenant('globex');
    await expect(
      cms.api.pages.archiveRedirect({ body: { redirectId: acme.redirect.id } }),
    ).rejects.toThrow();
    await expect(
      cms.api.pages.updateRedirect({
        body: {
          redirectId: acme.redirect.id,
          sourceType: 'path',
          sourcePath: '/pages/hacked',
          targetType: 'path',
          targetPath: '/pages/evil',
        },
      }),
    ).rejects.toThrow();

    // Acme's redirect is intact.
    setTenant('acme');
    const list = await cms.api.pages.listRedirects();
    expect(list.redirects).toHaveLength(1);
    expect(list.redirects[0].sourcePath).toBe('/pages/owned');
  });

  it('auto-creates a tenant-scoped redirect on rename, invisible to other tenants', async () => {
    const { cms, db, setTenant } = await setupMultiTenantTestCMS();

    setTenant('acme');
    const page = await cms.api.pages.createRoot({
      body: { slug: 'movers', properties: { title: 'Movers' } },
    });
    await cms.api.pages.updateRoot({
      body: {
        rootId: page.rootId,
        branchId: page.branchId,
        slug: 'shakers',
        properties: { title: 'Movers' },
      },
    });

    // The auto-created redirect (old path → page) is tagged acme.
    const rows = await db.execute(
      sql`SELECT tenant_slug, source_path FROM cms.redirects WHERE collection = 'pages'`,
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].tenant_slug).toBe('acme');
    expect(rows.rows[0].source_path).toBe('/pages/movers');

    // Acme resolves the old path to the new one.
    setTenant('acme');
    expect(
      (
        await cms.api.pages.resolveRedirect({
          query: { path: '/pages/movers' },
        })
      ).redirect,
    ).toEqual({ status: 301, location: '/pages/shakers' });

    // Globex sees neither the redirect nor a resolution.
    setTenant('globex');
    expect((await cms.api.pages.listRedirects()).redirects).toHaveLength(0);
    expect(
      (
        await cms.api.pages.resolveRedirect({
          query: { path: '/pages/movers' },
        })
      ).redirect,
    ).toBeNull();
  });

  it('enforces per-tenant path-source uniqueness at the APP level (no DB unique — i18n compose)', async () => {
    const { cms, setTenant } = await setupMultiTenantTestCMS();

    setTenant('acme');
    await cms.api.pages.createRedirect({
      body: {
        sourceType: 'path',
        sourcePath: '/pages/x',
        targetType: 'path',
        targetPath: '/a',
      },
    });
    // Same source within the tenant → app-level assertSourceUnique rejects.
    await expect(
      cms.api.pages.createRedirect({
        body: {
          sourceType: 'path',
          sourcePath: '/pages/x',
          targetType: 'path',
          targetPath: '/b',
        },
      }),
    ).rejects.toThrow();

    // A different tenant with the identical path is fine.
    setTenant('globex');
    await expect(
      cms.api.pages.createRedirect({
        body: {
          sourceType: 'path',
          sourcePath: '/pages/x',
          targetType: 'path',
          targetPath: '/c',
        },
      }),
    ).resolves.toBeDefined();
  });

  it('no longer DB-enforces path-source uniqueness (the path unique was dropped for i18n compose)', async () => {
    const { db } = await setupMultiTenantTestCMS();
    // Two identical (tenant, collection, sourcePath) raw inserts now BOTH succeed
    // — path-source uniqueness moved to the app level. Guards against re-adding
    // the per-tenant path unique (which would break per-language redirects).
    await db.execute(sql`
      INSERT INTO cms.redirects (id, collection, source_type, source_path, target_type, target_path, tenant_slug)
      VALUES ('rdr_mt_1', 'pages', 'path', '/pages/x', 'path', '/a', 'acme')
    `);
    await db.execute(sql`
      INSERT INTO cms.redirects (id, collection, source_type, source_path, target_type, target_path, tenant_slug)
      VALUES ('rdr_mt_2', 'pages', 'path', '/pages/x', 'path', '/b', 'acme')
    `);
    const rows = await db.execute(
      sql`SELECT count(*)::int AS n FROM cms.redirects WHERE source_path = '/pages/x' AND tenant_slug = 'acme'`,
    );
    expect(Number((rows.rows[0] as { n: number }).n)).toBe(2);
  });
});

// ============================================================================
// Error handling
// ============================================================================

describe('multiTenant — error handling', () => {
  it('throws TENANT_SLUG_REQUIRED when middleware does not provide tenantSlug', async () => {
    const { cms } = await setupMultiTenantTestCMS({
      middleware: async () => ({}),
    });

    await expect(
      cms.api.pages.createRoot({
        body: { slug: '/no-tenant', properties: { title: 'No Tenant' } },
      }),
    ).rejects.toThrow(/tenantSlug is required/i);
  });

  it('throws TENANT_SLUG_REQUIRED when tenantSlug is empty string', async () => {
    const { cms } = await setupMultiTenantTestCMS({
      middleware: async () => ({ tenantSlug: '' }),
    });

    await expect(
      cms.api.pages.createRoot({
        body: { slug: '/empty', properties: { title: 'Empty Tenant' } },
      }),
    ).rejects.toThrow(/tenantSlug is required/i);
  });
});

// ============================================================================
// Scope conditions — DB-level verification
// ============================================================================

describe('multiTenant — scope conditions DB verification', () => {
  it('inserts tenant_slug into roots and asset_folders tables', async () => {
    const { cms, db, setTenant } = await setupMultiTenantTestCMS();
    setTenant('tenant-a');

    const root = await cms.api.pages.createRoot({
      body: { slug: '/page', properties: { title: 'Page' } },
    });

    const folder = await cms.api.media.createFolder({
      body: { name: 'Folder' },
    });

    const rootRows = await db.execute(
      sql`SELECT tenant_slug FROM cms.roots WHERE id = ${root.rootId}`,
    );
    expect(rootRows.rows[0].tenant_slug).toBe('tenant-a');

    const folderRows = await db.execute(
      sql`SELECT tenant_slug FROM cms.asset_folders WHERE id = ${folder.folder.id}`,
    );
    expect(folderRows.rows[0].tenant_slug).toBe('tenant-a');
  });

  it('filters queries by tenant_slug at the DB level', async () => {
    const { db, cms, setTenant } = await setupMultiTenantTestCMS();
    setTenant('tenant-a');

    await cms.api.pages.createRoot({
      body: { slug: '/a', properties: { title: 'A Page' } },
    });

    setTenant('tenant-b');
    await cms.api.pages.createRoot({
      body: { slug: '/b', properties: { title: 'B Page' } },
    });

    // Verify at DB level that both rows exist
    const allRoots = await db.select().from(roots);
    expect(allRoots).toHaveLength(2);

    // But the API only returns the scoped tenant's roots
    setTenant('tenant-a');
    const aRoots = await cms.api.pages.listRoots();
    expect(aRoots.roots).toHaveLength(1);
    expect((aRoots.roots[0].properties as any).title).toBe('A Page');

    setTenant('tenant-b');
    const bRoots = await cms.api.pages.listRoots();
    expect(bRoots.roots).toHaveLength(1);
    expect((bRoots.roots[0].properties as any).title).toBe('B Page');
  });

  it('tenant-scoped roots count in pagination reflects only the active tenant', async () => {
    const { cms, setTenant } = await setupMultiTenantTestCMS();

    setTenant('alpha');
    for (let i = 0; i < 5; i++) {
      await cms.api.pages.createRoot({
        body: { slug: `/alpha-${i}`, properties: { title: `Alpha ${i}` } },
      });
    }

    setTenant('beta');
    for (let i = 0; i < 3; i++) {
      await cms.api.pages.createRoot({
        body: { slug: `/beta-${i}`, properties: { title: `Beta ${i}` } },
      });
    }

    setTenant('alpha');
    const alphaResult = await cms.api.pages.listRoots({
      query: { limit: 10, offset: 0 },
    });
    expect(alphaResult.roots).toHaveLength(5);
    expect(alphaResult.total).toBe(5);

    setTenant('beta');
    const betaResult = await cms.api.pages.listRoots({
      query: { limit: 10, offset: 0 },
    });
    expect(betaResult.roots).toHaveLength(3);
    expect(betaResult.total).toBe(3);
  });
});

// ============================================================================
// resolveTenantSlug helper — unit tests
// ============================================================================

describe('resolveTenantSlug', () => {
  it('returns body.tenantSlug when present', () => {
    const result = resolveTenantSlug(
      {
        request: {
          body: { tenantSlug: 'from-body' },
          query: { tenantSlug: 'from-query' },
        },
      },
      'fallback',
    );
    expect(result).toBe('from-body');
  });

  it('falls back to query.tenantSlug when body has none', () => {
    const result = resolveTenantSlug(
      { request: { body: {}, query: { tenantSlug: 'from-query' } } },
      'fallback',
    );
    expect(result).toBe('from-query');
  });

  it('falls back to the fallback when neither body nor query has tenantSlug', () => {
    const result = resolveTenantSlug(
      { request: { body: {}, query: {} } },
      'fallback',
    );
    expect(result).toBe('fallback');
  });

  it('returns undefined when no request and no fallback', () => {
    const result = resolveTenantSlug({});
    expect(result).toBeUndefined();
  });

  it('returns fallback when request is undefined', () => {
    const result = resolveTenantSlug({}, 'session-default');
    expect(result).toBe('session-default');
  });
});

// ============================================================================
// Cross-tenant access-by-ID
// ============================================================================

describe('multiTenant — cross-tenant access-by-ID', () => {
  it('listRoots hides other tenant roots even when IDs are known', async () => {
    const { cms, setTenant } = await setupMultiTenantTestCMS();

    setTenant('acme');
    await cms.api.pages.createRoot({
      body: { slug: '/acme-secret', properties: { title: 'Acme Secret' } },
    });

    setTenant('globex');
    const globexRoots = await cms.api.pages.listRoots();
    expect(globexRoots.roots).toHaveLength(0);
  });

  it('cannot move a folder from another tenant', async () => {
    const { cms, setTenant } = await setupMultiTenantTestCMS();

    setTenant('acme');
    const acmeFolder = await cms.api.media.createFolder({
      body: { name: 'Acme Folder' },
    });

    setTenant('globex');
    const globexParent = await cms.api.media.createFolder({
      body: { name: 'Globex Parent' },
    });

    await expect(
      cms.api.media.moveFolder({
        body: {
          folderId: acmeFolder.folder.id,
          newParentFolderId: globexParent.folder.id,
        },
      }),
    ).rejects.toThrow();
  });

  it('cannot delete a folder from another tenant', async () => {
    const { cms, setTenant } = await setupMultiTenantTestCMS();

    setTenant('acme');
    const acmeFolder = await cms.api.media.createFolder({
      body: { name: 'Acme Private' },
    });

    setTenant('globex');
    await expect(
      cms.api.media.deleteFolder({
        body: { folderId: acmeFolder.folder.id },
      }),
    ).rejects.toThrow();

    // Verify folder still exists
    setTenant('acme');
    const acmeFolders = await cms.api.media.listAssets({
      query: { folderId: acmeFolder.folder.id },
    });
    expect(acmeFolders).toBeDefined();
  });

  it('cannot update asset status from another tenant', async () => {
    const { cms, db, setTenant } = await setupMultiTenantTestCMS();

    await db.execute(sql`
      INSERT INTO cms.assets (id, slug, mime_type, size, object_key, status, tenant_slug)
      VALUES ('cross-asset-1', 'acme-doc', 'application/pdf', 512, 'acme/doc.pdf', 'private', 'acme')
    `);

    setTenant('globex');
    await expect(
      cms.api.media.updateAssetStatus({
        body: { assetIds: ['cross-asset-1'], status: 'public' },
      }),
    ).rejects.toThrow();
  });

  it('listAssets hides other tenant assets', async () => {
    const { cms, db, setTenant } = await setupMultiTenantTestCMS();

    await db.execute(sql`
      INSERT INTO cms.assets (id, slug, mime_type, size, object_key, status, tenant_slug)
      VALUES
        ('iso-asset-1', 'acme-only', 'image/png', 1024, 'acme/only.png', 'private', 'acme'),
        ('iso-asset-2', 'globex-only', 'image/png', 1024, 'globex/only.png', 'private', 'globex')
    `);

    setTenant('acme');
    const acmeAssets = await cms.api.media.listAssets();
    expect(acmeAssets.assets).toHaveLength(1);
    expect(acmeAssets.assets[0].slug).toBe('acme-only');

    setTenant('globex');
    const globexAssets = await cms.api.media.listAssets();
    expect(globexAssets.assets).toHaveLength(1);
    expect(globexAssets.assets[0].slug).toBe('globex-only');
  });
});

// ============================================================================
// Block CRUD within tenant-scoped roots
// ============================================================================

describe('multiTenant — block CRUD within tenant roots', () => {
  it('creates and reads blocks within a tenant-scoped root', async () => {
    const { cms, setTenant } = await setupMultiTenantTestCMS();
    setTenant('acme');

    const root = await cms.api.pages.createRoot({
      body: { slug: '/acme-blocks', properties: { title: 'Acme Page' } },
    });

    const block = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Hello from Acme' },
      },
    });
    expect(block.commitId).toBeDefined();

    const tree = await cms.api.pages.getBlockTree({
      query: { rootId: root.rootId, branchId: root.branchId },
    });
    expect(tree.tree).toBeDefined();
    expect(tree.tree!.children.length).toBe(1);
    expect((tree.tree!.children[0].properties as { text: string }).text).toBe(
      'Hello from Acme',
    );
  });

  it('updates a block within a tenant-scoped root', async () => {
    const { cms, setTenant } = await setupMultiTenantTestCMS();
    setTenant('acme');

    const root = await cms.api.pages.createRoot({
      body: { slug: '/acme-update', properties: { title: 'Acme Page' } },
    });

    await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Original' },
      },
    });

    const tree = await cms.api.pages.getBlockTree({
      query: { rootId: root.rootId, branchId: root.branchId },
    });
    const blockId = tree.tree!.children[0].blockId;

    await cms.api.pages.updateBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        blockId,
        type: 'paragraph',
        properties: { text: 'Updated' },
      },
    });

    const updatedTree = await cms.api.pages.getBlockTree({
      query: { rootId: root.rootId, branchId: root.branchId },
    });
    expect(
      (updatedTree.tree!.children[0].properties as { text: string }).text,
    ).toBe('Updated');
  });

  it('deletes a block within a tenant-scoped root', async () => {
    const { cms, setTenant } = await setupMultiTenantTestCMS();
    setTenant('acme');

    const root = await cms.api.pages.createRoot({
      body: { slug: '/acme-delete', properties: { title: 'Acme Page' } },
    });

    await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'To be deleted' },
      },
    });

    const tree = await cms.api.pages.getBlockTree({
      query: { rootId: root.rootId, branchId: root.branchId },
    });
    const blockId = tree.tree!.children[0].blockId;

    await cms.api.pages.deleteBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        blockId,
      },
    });

    const afterDelete = await cms.api.pages.getBlockTree({
      query: { rootId: root.rootId, branchId: root.branchId },
    });
    expect(afterDelete.tree!.children).toHaveLength(0);
  });
});

// ============================================================================
// SQL injection / special characters in tenant slugs
// ============================================================================

describe('multiTenant — special characters in tenant slugs', () => {
  it('handles tenant slugs with special SQL characters safely', async () => {
    const { cms, db, setTenant } = await setupMultiTenantTestCMS();

    setTenant("tenant'; DROP TABLE cms.roots; --");
    const root = await cms.api.pages.createRoot({
      body: { slug: '/injection', properties: { title: 'Injection Test' } },
    });

    const rows = await db.execute(
      sql`SELECT tenant_slug FROM cms.roots WHERE id = ${root.rootId}`,
    );
    expect(rows.rows[0].tenant_slug).toBe("tenant'; DROP TABLE cms.roots; --");

    const allRoots = await db.execute(
      sql`SELECT count(*)::int AS cnt FROM cms.roots`,
    );
    expect(Number(allRoots.rows[0].cnt)).toBeGreaterThanOrEqual(1);
  });

  it('handles tenant slugs with unicode characters', async () => {
    const { cms, db, setTenant } = await setupMultiTenantTestCMS();

    setTenant('日本語テナント');
    const root = await cms.api.pages.createRoot({
      body: { slug: '/unicode', properties: { title: 'Unicode Test' } },
    });

    const rows = await db.execute(
      sql`SELECT tenant_slug FROM cms.roots WHERE id = ${root.rootId}`,
    );
    expect(rows.rows[0].tenant_slug).toBe('日本語テナント');

    const listed = await cms.api.pages.listRoots();
    expect(listed.roots).toHaveLength(1);
  });

  it('handles tenant slugs with percent and underscore (LIKE wildcards)', async () => {
    const { cms, setTenant } = await setupMultiTenantTestCMS();

    setTenant('tenant_with%wildcards');
    const root = await cms.api.pages.createRoot({
      body: { slug: '/wildcard', properties: { title: 'Wildcard Test' } },
    });
    expect(root.rootId).toBeDefined();

    const listed = await cms.api.pages.listRoots();
    expect(listed.roots).toHaveLength(1);
  });
});

// ============================================================================
// Tenant override via request context
// ============================================================================

describe('multiTenant — tenant override via request', () => {
  it('overrides tenant via body.tenantSlug when middleware uses resolveTenantSlug', async () => {
    const { cms, db } = await setupMultiTenantTestCMS({
      middleware: async (ctx) => {
        const tenantSlug = resolveTenantSlug(ctx, 'default-tenant');
        return { tenantSlug };
      },
    });

    // Create a root for "default-tenant"
    await cms.api.pages.createRoot({
      body: { slug: '/default', properties: { title: 'Default Page' } },
    });

    // Create a root for "override-tenant" via body override.
    // Cast to `any` because tenantSlug is not in the Zod body schema --
    // it passes through at runtime and the middleware reads it from
    // requestContext.body.
    const result = await cms.api.pages.createRoot({
      body: {
        tenantSlug: 'override-tenant',
        slug: '/override',
        properties: { title: 'Override Page' },
      } as any,
    });

    const rows = await db.execute(
      sql`SELECT tenant_slug FROM cms.roots WHERE id = ${result.rootId}`,
    );
    expect(rows.rows[0].tenant_slug).toBe('override-tenant');
  });

  it('overrides tenant via query.tenantSlug on GET endpoints', async () => {
    const { cms } = await setupMultiTenantTestCMS({
      middleware: async (ctx) => {
        const tenantSlug = resolveTenantSlug(ctx, 'default-tenant');
        return { tenantSlug };
      },
    });

    await cms.api.pages.createRoot({
      body: {
        tenantSlug: 'tenant-a',
        slug: '/a',
        properties: { title: 'A Page' },
      } as any,
    });
    await cms.api.pages.createRoot({
      body: {
        tenantSlug: 'tenant-b',
        slug: '/b',
        properties: { title: 'B Page' },
      } as any,
    });

    const aRoots = await cms.api.pages.listRoots({
      query: { tenantSlug: 'tenant-a' } as any,
    });
    expect(aRoots.roots).toHaveLength(1);
    expect((aRoots.roots[0].properties as any).title).toBe('A Page');

    const bRoots = await cms.api.pages.listRoots({
      query: { tenantSlug: 'tenant-b' } as any,
    });
    expect(bRoots.roots).toHaveLength(1);
    expect((bRoots.roots[0].properties as any).title).toBe('B Page');
  });

  it('falls back to middleware default when no override in request', async () => {
    const { cms } = await setupMultiTenantTestCMS({
      middleware: async (ctx) => {
        const tenantSlug = resolveTenantSlug(ctx, 'session-tenant');
        return { tenantSlug };
      },
    });

    const result = await cms.api.pages.createRoot({
      body: { slug: '/fallback', properties: { title: 'Fallback Page' } },
    });

    expect(result.rootId).toBeDefined();

    const roots = await cms.api.pages.listRoots();
    expect(roots.roots).toHaveLength(1);
    expect((roots.roots[0].properties as any).title).toBe('Fallback Page');
  });

  it('middleware can deny access to an overridden tenant', async () => {
    const { cms } = await setupMultiTenantTestCMS({
      middleware: async (ctx) => {
        const tenantSlug = resolveTenantSlug(ctx, 'allowed-tenant');
        if (tenantSlug !== 'allowed-tenant') {
          throw new Error('Forbidden: cross-tenant access denied');
        }
        return { tenantSlug };
      },
    });

    await expect(
      cms.api.pages.createRoot({
        body: {
          tenantSlug: 'other-tenant',
          slug: '/denied',
          properties: { title: 'Denied' },
        } as any,
      }),
    ).rejects.toThrow(/cross-tenant access denied/i);
  });
});

describe('multiTenant — templates are per-tenant', () => {
  it('isolates template CRUD per tenant (same key allowed in each)', async () => {
    const { cms, setTenant } = await setupMultiTenantTestCMS();

    setTenant('acme');
    await cms.api.templates.createTemplate({
      body: {
        collection: 'pages',
        blockType: 'signupForm',
        propertyKey: 'trackingId',
        template: 'ACME-ID',
      },
    });

    // Same key for a different tenant is NOT a duplicate.
    setTenant('globex');
    await cms.api.templates.createTemplate({
      body: {
        collection: 'pages',
        blockType: 'signupForm',
        propertyKey: 'trackingId',
        template: 'GLOBEX-ID',
      },
    });

    setTenant('acme');
    const acme = await cms.api.templates.listTemplates({});
    expect(acme.templates).toHaveLength(1);
    expect(acme.templates[0].template).toBe('ACME-ID');

    setTenant('globex');
    const globex = await cms.api.templates.listTemplates({});
    expect(globex.templates).toHaveLength(1);
    expect(globex.templates[0].template).toBe('GLOBEX-ID');

    // A duplicate within the SAME tenant is still rejected.
    await expect(
      cms.api.templates.createTemplate({
        body: {
          collection: 'pages',
          blockType: 'signupForm',
          propertyKey: 'trackingId',
          template: 'GLOBEX-AGAIN',
        },
      }),
    ).rejects.toThrow();
  });

  it('createBlock applies the active tenant template', async () => {
    const { cms, setTenant } = await setupMultiTenantTestCMS();

    setTenant('acme');
    await cms.api.templates.createTemplate({
      body: {
        collection: 'pages',
        blockType: 'signupForm',
        propertyKey: 'trackingId',
        template: 'ACME-ID',
      },
    });

    const root = await cms.api.pages.createRoot({
      body: { slug: '/', properties: { title: 'Home' } },
    });
    await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'signupForm',
        properties: { cta: 'Sign up' },
      },
    });
    const tree = await cms.api.pages.getBlockTree({
      query: { rootId: root.rootId, branchId: root.branchId },
    });
    expect(
      (tree.tree.children[0]?.properties as { trackingId?: unknown })
        ?.trackingId,
    ).toBe('ACME-ID');
  });
});

describe('multiTenant — variables are per-tenant', () => {
  it('partitions variables per tenant (same key, isolated values)', async () => {
    const { cms, setTenant } = await setupMultiTenantTestCMS();

    setTenant('acme');
    await cms.api.variables.createVariable({
      body: { key: 'companyName', value: 'Acme Inc' },
    });
    // Same key for a different tenant is not a duplicate.
    setTenant('globex');
    await cms.api.variables.createVariable({
      body: { key: 'companyName', value: 'Globex Corp' },
    });

    setTenant('acme');
    const acme = await cms.api.variables.listVariables({});
    expect(acme.variables).toHaveLength(1);
    expect(acme.variables[0].value).toBe('Acme Inc');

    // Content resolves the active tenant's value.
    const root = await cms.api.pages.createRoot({
      body: { slug: '/', properties: { title: 'Home' } },
    });
    await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: '{{companyName}}' },
      },
    });
    const tree = await cms.api.pages.getBlockTree({
      query: { rootId: root.rootId, branchId: root.branchId },
    });
    expect((tree.tree.children[0].properties as { text: string }).text).toBe(
      'Acme Inc',
    );
  });
});
