import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  assetFolders,
  assets,
  publications,
  roots,
  scheduledPublications,
} from '../../../schema';
import { resolveTenantSlug } from '../index';
import { setupMultiTenantTestCMS } from './utils/cms';

// ============================================================================
// Tenant isolation: roots / blocks
// ============================================================================

describe('multiTenant root isolation', () => {
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

    const dup = await cms.api.pages.duplicateRoot({
      body: {
        rootId: created.rootId,
        branchId: created.branchId,
        blockId: created.rootId,
        targetProperties: { title: 'Acme Page Copy' },
        targetSlug: '/acme-page-copy',
        message: 'Duplicate root',
      },
    });
    expect(dup.commit.id).toBeDefined();

    // Both roots should be visible to the same tenant
    const roots = await cms.api.pages.listRoots();
    expect(roots.roots).toHaveLength(2);
  });
});

// ============================================================================
// Tenant isolation: published content (getPublishedContent scope gate)
// ============================================================================

describe('multiTenant getPublishedContent isolation', () => {
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
// Tenant isolation: by-id endpoints (IDOR via requireRootInScope)
// ============================================================================

describe('multiTenant by-id endpoint IDOR protection', () => {
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
    const acme = await cms.api.pages.createRoot({
      body: { slug: '/blog', properties: { title: 'Acme Blog' } },
    });
    await cms.api.pages.publishBranch({
      body: { rootId: acme.rootId, branchId: acme.branchId },
    });

    // globex can use /blog too: publish-time uniqueness is per-tenant.
    setTenant('globex');
    const globex = await cms.api.pages.createRoot({
      body: { slug: '/blog', properties: { title: 'Globex Blog' } },
    });
    await expect(
      cms.api.pages.publishBranch({
        body: { rootId: globex.rootId, branchId: globex.branchId },
      }),
    ).resolves.toBeDefined();

    // But within a tenant the same slug is still rejected, at publish (drafts
    // may collide).
    const globexDup = await cms.api.pages.createRoot({
      body: { slug: '/blog', properties: { title: 'Dup' } },
    });
    await expect(
      cms.api.pages.publishBranch({
        body: { rootId: globexDup.rootId, branchId: globexDup.branchId },
      }),
    ).rejects.toThrow(/PUBLISH_SLUG_CONFLICT|already uses this slug/i);
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
// Tenant isolation: list endpoints (raw-SQL scope, no id needed to leak)
// ============================================================================

describe('multiTenant list endpoints do not leak across tenants', () => {
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
        sourceBranchId: draft.branch.id,
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

    // Another tenant sees none of them, not even with no id passed (the leak
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
// Tenant isolation: media folders
// ============================================================================

describe('multiTenant folder isolation', () => {
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
// Tenant isolation: assets
// ============================================================================

describe('multiTenantPlugin asset isolation', () => {
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
    await cms.api.media.updateAssetsStatus({
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

  it("rejects a variantOf reference to another tenant's asset", async () => {
    const { cms, db, setTenant } = await setupMultiTenantTestCMS();

    await db.execute(sql`
      INSERT INTO cms.assets (id, slug, mime_type, size, object_key, status, tenant_slug)
      VALUES ('asset-globex-1', 'globex-logo', 'image/png', 1024, 'globex/logo.png', 'private', 'globex')
    `);

    setTenant('acme');
    await expect(
      cms.api.media.createSignedUpload({
        body: {
          files: [
            {
              name: 'v.png',
              size: 512,
              type: 'image/png',
              variantOf: 'asset-globex-1',
            },
          ],
        },
      }),
    ).rejects.toThrow(/not found/i);
  });

  it('allows a variantOf reference to an asset owned by the active tenant', async () => {
    const { cms, db, setTenant } = await setupMultiTenantTestCMS();

    await db.execute(sql`
      INSERT INTO cms.assets (id, slug, mime_type, size, object_key, status, tenant_slug)
      VALUES ('asset-acme-1', 'acme-logo', 'image/png', 1024, 'acme/logo.png', 'private', 'acme')
    `);

    setTenant('acme');
    await expect(
      cms.api.media.createSignedUpload({
        body: {
          files: [
            {
              name: 'v.png',
              size: 512,
              type: 'image/png',
              variantOf: 'asset-acme-1',
            },
          ],
        },
      }),
    ).resolves.toBeDefined();
  });
});

// ============================================================================
// Tenant isolation: redirects
// ============================================================================

describe('multiTenant redirect isolation', () => {
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

    // Globex creates a redirect for the identical path; must not collide.
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

    // Each tenant resolves /pages/promo to its own target.
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
    // Publish the live slug, then publish the rename; the tenant-scoped
    // redirect is auto-created at publish.
    await cms.api.pages.publishBranch({
      body: { rootId: page.rootId, branchId: page.branchId },
    });
    await cms.api.pages.updateRoot({
      body: {
        rootId: page.rootId,
        branchId: page.branchId,
        slug: 'shakers',
        properties: { title: 'Movers' },
      },
    });
    await cms.api.pages.publishBranch({
      body: { rootId: page.rootId, branchId: page.branchId },
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

  it('enforces per-tenant path-source uniqueness at the app level (no DB unique, i18n compose)', async () => {
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
    // Two identical (tenant, collection, sourcePath) raw inserts both succeed:
    // path-source uniqueness moved to the app level. Guards against re-adding
    // the per-tenant path unique, which would break per-language redirects.
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
    expect(Number((rows.rows[0] as { n: string }).n)).toBe(2);
  });
});

// ============================================================================
// Error handling
// ============================================================================

describe('multiTenant error handling', () => {
  it('throws TENANT_SLUG_REQUIRED when middleware does not provide tenantSlug', async () => {
    const { cms } = await setupMultiTenantTestCMS({
      authMiddleware: async () => ({}),
    });

    await expect(
      cms.api.pages.createRoot({
        body: { slug: '/no-tenant', properties: { title: 'No Tenant' } },
      }),
    ).rejects.toThrow(/tenantSlug is required/i);
  });

  it('throws TENANT_SLUG_REQUIRED when tenantSlug is empty string', async () => {
    const { cms } = await setupMultiTenantTestCMS({
      authMiddleware: async () => ({ tenantSlug: '' }),
    });

    await expect(
      cms.api.pages.createRoot({
        body: { slug: '/empty', properties: { title: 'Empty Tenant' } },
      }),
    ).rejects.toThrow(/tenantSlug is required/i);
  });
});

// ============================================================================
// Scope conditions: DB-level verification
// ============================================================================

describe('multiTenant scope conditions DB verification', () => {
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
// resolveTenantSlug helper: unit tests
// ============================================================================

describe('resolveTenantSlug', () => {
  // Secure default: request-supplied tenantSlug (body/query) is ignored unless
  // the caller explicitly opts in with { allowRequestOverride: true } after an
  // admin check.
  it('ignores body/query tenantSlug by default, returning the session fallback', () => {
    const result = resolveTenantSlug(
      {
        request: {
          body: { tenantSlug: 'from-body' },
          query: { tenantSlug: 'from-query' },
        },
      },
      'fallback',
    );
    expect(result).toBe('fallback');
  });

  it('returns undefined by default even when body/query supply a tenantSlug (no fallback)', () => {
    const result = resolveTenantSlug({
      request: {
        body: { tenantSlug: 'from-body' },
        query: { tenantSlug: 'from-query' },
      },
    });
    expect(result).toBeUndefined();
  });

  it('returns body.tenantSlug when present and override is opted in', () => {
    const result = resolveTenantSlug(
      {
        request: {
          body: { tenantSlug: 'from-body' },
          query: { tenantSlug: 'from-query' },
        },
      },
      'fallback',
      { allowRequestOverride: true },
    );
    expect(result).toBe('from-body');
  });

  it('falls back to query.tenantSlug when body has none (override opted in)', () => {
    const result = resolveTenantSlug(
      { request: { body: {}, query: { tenantSlug: 'from-query' } } },
      'fallback',
      { allowRequestOverride: true },
    );
    expect(result).toBe('from-query');
  });

  it('falls back to the fallback when neither body nor query has tenantSlug (override opted in)', () => {
    const result = resolveTenantSlug(
      { request: { body: {}, query: {} } },
      'fallback',
      { allowRequestOverride: true },
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

describe('multiTenant cross-tenant access-by-ID', () => {
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
      cms.api.media.updateAssetsStatus({
        body: { assetIds: ['cross-asset-1'], status: 'public' },
      }),
    ).rejects.toThrow();
  });
});

// ============================================================================
// Block CRUD within tenant-scoped roots
// ============================================================================

describe('multiTenant block CRUD within tenant roots', () => {
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
    expect(block.commit.id).toBeDefined();

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

describe('multiTenant special characters in tenant slugs', () => {
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
//
// Request-supplied tenantSlug is ignored by default (secure default). These
// tests pass { allowRequestOverride: true } to opt in, which in production
// must be gated behind an admin authorization check.
// ============================================================================

describe('multiTenant tenant override via request', () => {
  it('overrides tenant via body.tenantSlug when middleware uses resolveTenantSlug', async () => {
    const { cms, db } = await setupMultiTenantTestCMS({
      authMiddleware: async (ctx) => {
        // Opt in to request overrides; in real code this must be gated behind
        // an admin check. These tests simulate an admin-authorized override.
        const tenantSlug = resolveTenantSlug(ctx, 'default-tenant', {
          allowRequestOverride: true,
        });
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
      authMiddleware: async (ctx) => {
        // Opt in to request overrides; in real code this must be gated behind
        // an admin check. These tests simulate an admin-authorized override.
        const tenantSlug = resolveTenantSlug(ctx, 'default-tenant', {
          allowRequestOverride: true,
        });
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
      authMiddleware: async (ctx) => {
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
      authMiddleware: async (ctx) => {
        // Honor the request override, then enforce the tenant check: the
        // intended admin-gated override pattern.
        const tenantSlug = resolveTenantSlug(ctx, 'allowed-tenant', {
          allowRequestOverride: true,
        });
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

describe('multiTenant templates are per-tenant', () => {
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
    const acme = await cms.api.templates.list({});
    expect(acme.templates).toHaveLength(1);
    expect(acme.templates[0].template).toBe('ACME-ID');

    setTenant('globex');
    const globex = await cms.api.templates.list({});
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

describe('multiTenant variables are per-tenant', () => {
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
    const acme = await cms.api.variables.list({ query: {} });
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

describe('multiTenant publishRelease materializes slugs in the tenant scope', () => {
  it('a release slug change: no cross-tenant conflict, redirect tagged with the tenant', async () => {
    const { cms, db, setTenant } = await setupMultiTenantTestCMS();

    // globex already holds the published slug "shared".
    setTenant('globex');
    const globex = await cms.api.pages.createRoot({
      body: { slug: 'shared', properties: { title: 'Globex Shared' } },
    });
    await cms.api.pages.publishBranch({
      body: { rootId: globex.rootId, branchId: globex.branchId },
    });

    // acme publishes a DIFFERENT slug, then renames its draft to "shared"
    // (a change from "original") and publishes the rename through a RELEASE.
    setTenant('acme');
    const acme = await cms.api.pages.createRoot({
      body: { slug: 'original', properties: { title: 'Acme' } },
    });
    await cms.api.pages.publishBranch({
      body: { rootId: acme.rootId, branchId: acme.branchId },
    });
    await cms.api.pages.updateRoot({
      body: {
        rootId: acme.rootId,
        branchId: acme.branchId,
        slug: 'shared',
        properties: { title: 'Acme' },
      },
    });

    const { release } = await cms.api.releases.createRelease({
      body: { title: 'Rename' },
    });
    await cms.api.releases.addToRelease({
      body: {
        releaseId: release.id,
        rootId: acme.rootId,
        branchId: acme.branchId,
      },
    });

    // Before the scope-threading fix this threw a cross-tenant
    // PUBLISH_SLUG_CONFLICT (globex also holds "shared") and, past that, a
    // redirects.tenant_slug NOT-NULL violation on the rename redirect.
    await expect(
      cms.api.releases.publishRelease({ body: { releaseId: release.id } }),
    ).resolves.toBeDefined();

    // acme's live slug is now "shared", the same as globex's (per-tenant
    // unique).
    const [acmeRow] = await db
      .select()
      .from(roots)
      .where(eq(roots.id, acme.rootId));
    expect(acmeRow.slug).toBe('shared');
    const [globexRow] = await db
      .select()
      .from(roots)
      .where(eq(roots.id, globex.rootId));
    expect(globexRow.slug).toBe('shared');

    // The auto-created rename redirect (old path → acme page) is tagged acme.
    const redirectRows = await db.execute(
      sql`SELECT tenant_slug, source_path FROM cms.redirects
          WHERE collection = 'pages' AND target_root_id = ${acme.rootId}`,
    );
    expect(redirectRows.rows).toHaveLength(1);
    expect(redirectRows.rows[0].tenant_slug).toBe('acme');
    expect(redirectRows.rows[0].source_path).toBe('/pages/original');

    // globex sees no cross-tenant redirect leak.
    setTenant('globex');
    expect((await cms.api.pages.listRedirects()).redirects).toHaveLength(0);
  });
});

describe('multiTenant scheduled publishing is scoped per tenant', () => {
  it("a scoped runScheduled processes only its own tenant's due rows", async () => {
    const { cms, db, setTenant } = await setupMultiTenantTestCMS();

    // Each tenant queues a DUE publish.
    setTenant('acme');
    const acme = await cms.api.pages.createRoot({
      body: { slug: 'acme-sched', properties: { title: 'Acme' } },
    });
    await cms.api.pages.schedulePublication({
      body: {
        rootId: acme.rootId,
        branchId: acme.branchId,
        scheduledAt: new Date(Date.now() - 60_000),
      },
    });

    setTenant('globex');
    const globex = await cms.api.pages.createRoot({
      body: { slug: 'globex-sched', properties: { title: 'Globex' } },
    });
    const globexSched = await cms.api.pages.schedulePublication({
      body: {
        rootId: globex.rootId,
        branchId: globex.branchId,
        scheduledAt: new Date(Date.now() - 60_000),
      },
    });

    // Run the queue AS acme: only acme's row is due within its scope.
    setTenant('acme');
    const result = await cms.api.admin.runScheduled({ body: {} });
    expect(result.processed).toBe(1);
    expect(result.published).toBe(1);

    // acme's page is live; globex's is untouched.
    expect(
      await db
        .select()
        .from(publications)
        .where(eq(publications.rootId, acme.rootId)),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(publications)
        .where(eq(publications.rootId, globex.rootId)),
    ).toHaveLength(0);

    // globex's scheduled row is still pending (acme's cron never claimed it).
    const [globexRow] = await db
      .select()
      .from(scheduledPublications)
      .where(eq(scheduledPublications.id, globexSched.scheduled.id));
    expect(globexRow.processedAt).toBeNull();

    // Running AS globex now drains its own row.
    setTenant('globex');
    const globexResult = await cms.api.admin.runScheduled({ body: {} });
    expect(globexResult.processed).toBe(1);
    expect(globexResult.published).toBe(1);
    expect(
      await db
        .select()
        .from(publications)
        .where(eq(publications.rootId, globex.rootId)),
    ).toHaveLength(1);
  });
});

// ============================================================================
// Tenant isolation: comment threads (IDOR via the comments scope-enforcing
// loader)
// ============================================================================

describe('multiTenant comment thread scope isolation', () => {
  // The default multi-tenant middleware only carries tenantSlug; comment
  // endpoints also require a userId, so this test group supplies its own
  // authMiddleware (with a mutable tenant, mirroring setTenant) instead of
  // using the plugin's default.
  async function setupTenantCommentCMS() {
    let tenant = 'acme';
    const { cms } = await setupMultiTenantTestCMS({
      authMiddleware: async () => ({ tenantSlug: tenant, userId: 'user-1' }),
    });

    async function createAcmeThread() {
      const acme = await cms.api.pages.createRoot({
        body: { slug: '/acme-comments', properties: { title: 'Acme' } },
      });
      const { thread } = await cms.api.pages.createCommentThread({
        body: {
          targetType: 'block',
          blockId: acme.rootId,
          rootId: acme.rootId,
          body: 'Acme-only comment',
        },
      });
      return { acme, thread };
    }

    return {
      cms,
      createAcmeThread,
      setTenant(slug: string) {
        tenant = slug;
      },
    };
  }

  it("rejects cross-tenant getCommentThread of another tenant's thread by id", async () => {
    const { cms, setTenant, createAcmeThread } = await setupTenantCommentCMS();

    setTenant('acme');
    const { thread } = await createAcmeThread();

    // The owner can read its own thread.
    await expect(
      cms.api.pages.getCommentThread({ query: { threadId: thread.id } }),
    ).resolves.toBeDefined();

    // Another tenant cannot, even with the exact thread id.
    setTenant('globex');
    await expect(
      cms.api.pages.getCommentThread({ query: { threadId: thread.id } }),
    ).rejects.toThrow(/not found/i);
  });

  it("rejects cross-tenant createCommentMessage on another tenant's thread by id", async () => {
    const { cms, setTenant, createAcmeThread } = await setupTenantCommentCMS();

    setTenant('acme');
    const { thread } = await createAcmeThread();

    setTenant('globex');
    await expect(
      cms.api.pages.createCommentMessage({
        body: { threadId: thread.id, body: 'hijacked reply' },
      }),
    ).rejects.toThrow(/not found/i);
  });

  it("rejects cross-tenant resolveCommentThread on another tenant's thread by id", async () => {
    const { cms, setTenant, createAcmeThread } = await setupTenantCommentCMS();

    setTenant('acme');
    const { thread } = await createAcmeThread();

    setTenant('globex');
    await expect(
      cms.api.pages.resolveCommentThread({ body: { threadId: thread.id } }),
    ).rejects.toThrow(/not found/i);
  });

  it("rejects cross-tenant reopenCommentThread on another tenant's thread by id", async () => {
    const { cms, setTenant, createAcmeThread } = await setupTenantCommentCMS();

    setTenant('acme');
    const { thread } = await createAcmeThread();

    setTenant('globex');
    await expect(
      cms.api.pages.reopenCommentThread({ body: { threadId: thread.id } }),
    ).rejects.toThrow(/not found/i);
  });

  it('rejects createCommentThread with an out-of-scope rootId', async () => {
    const { cms, setTenant } = await setupTenantCommentCMS();

    setTenant('acme');
    const acme = await cms.api.pages.createRoot({
      body: { slug: '/acme-root-guard', properties: { title: 'Acme' } },
    });

    // Globex must not be able to attach a new thread to Acme's root, even by
    // supplying its exact rootId directly.
    setTenant('globex');
    await expect(
      cms.api.pages.createCommentThread({
        body: {
          targetType: 'block',
          blockId: 'irrelevant-block-id',
          rootId: acme.rootId,
          body: "Trying to attach to another tenant's root",
        },
      }),
    ).rejects.toThrow(/not found/i);
  });
});

// ============================================================================
// Tenant isolation: releases
// ============================================================================

describe('multiTenant release isolation', () => {
  it('lists only releases belonging to the active tenant', async () => {
    const { cms, setTenant } = await setupMultiTenantTestCMS();

    setTenant('acme');
    await cms.api.releases.createRelease({ body: { title: 'Acme One' } });
    await cms.api.releases.createRelease({ body: { title: 'Acme Two' } });

    setTenant('globex');
    await cms.api.releases.createRelease({ body: { title: 'Globex One' } });

    const globexList = await cms.api.releases.listReleases();
    expect(globexList.releases).toHaveLength(1);
    expect(globexList.total).toBe(1);
    expect(globexList.releases[0].title).toBe('Globex One');

    setTenant('acme');
    const acmeList = await cms.api.releases.listReleases();
    expect(acmeList.releases).toHaveLength(2);
    expect(acmeList.total).toBe(2);
  });

  it("rejects cross-tenant getRelease of another tenant's release by id", async () => {
    const { cms, setTenant } = await setupMultiTenantTestCMS();

    setTenant('acme');
    const { release } = await cms.api.releases.createRelease({
      body: { title: 'Acme Release' },
    });

    setTenant('globex');
    await expect(
      cms.api.releases.getRelease({ query: { releaseId: release.id } }),
    ).rejects.toThrow(/RELEASE_NOT_FOUND|not found/i);
  });

  it("rejects addToRelease with another tenant's root", async () => {
    const { cms, setTenant } = await setupMultiTenantTestCMS();

    setTenant('acme');
    const acmeRoot = await cms.api.pages.createRoot({
      body: { slug: '/acme-release-root', properties: { title: 'Acme Root' } },
    });

    setTenant('globex');
    const { release } = await cms.api.releases.createRelease({
      body: { title: 'Globex Release' },
    });

    await expect(
      cms.api.releases.addToRelease({
        body: {
          releaseId: release.id,
          rootId: acmeRoot.rootId,
          branchId: acmeRoot.branchId,
        },
      }),
    ).rejects.toThrow(/ROOT_NOT_FOUND|not found/i);
  });

  it("rejects setReleaseItems on another tenant's release", async () => {
    const { cms, setTenant } = await setupMultiTenantTestCMS();

    setTenant('acme');
    const { release } = await cms.api.releases.createRelease({
      body: { title: 'Acme Release' },
    });

    setTenant('globex');
    await expect(
      cms.api.releases.setReleaseItems({
        body: { releaseId: release.id, items: [] },
      }),
    ).rejects.toThrow(/RELEASE_NOT_FOUND|not found/i);
  });

  it("rejects publishRelease on another tenant's release", async () => {
    const { cms, setTenant } = await setupMultiTenantTestCMS();

    setTenant('acme');
    const { release } = await cms.api.releases.createRelease({
      body: { title: 'Acme Release' },
    });

    setTenant('globex');
    await expect(
      cms.api.releases.publishRelease({ body: { releaseId: release.id } }),
    ).rejects.toThrow(/RELEASE_NOT_FOUND|not found/i);
  });

  it('stamps the created release row with the active tenant', async () => {
    const { cms, db, setTenant } = await setupMultiTenantTestCMS();

    setTenant('acme');
    const { release } = await cms.api.releases.createRelease({
      body: { title: 'Acme Release' },
    });

    const rows = await db.execute(
      sql`SELECT tenant_slug FROM cms.releases WHERE id = ${release.id}`,
    );
    expect(rows.rows[0].tenant_slug).toBe('acme');
  });
});
