import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { assets } from '../src/schema';
import { setupTestCMS } from './utils/cms';
import { publishApprovedBranch } from './utils/helpers';

// ============================================================================
// Asset State Synchronization
// ============================================================================

describe('asset state sync on publish', () => {
  it('sets referenced assets to public when a branch is published', async () => {
    const { cms, db } = await setupTestCMS();

    // Create an asset (simulating an uploaded image)
    const [asset] = await db
      .insert(assets)
      .values({
        slug: 'hero.png',
        mimeType: 'image/png',
        size: 1024,
        objectKey: 'hero.png',
        status: 'private',
      })
      .returning();

    // Create a page with a block that references the asset
    const root = await cms.api.pages.createRoot({
      body: { slug: '/hero', properties: { title: 'Page' } },
    });

    await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'image',
        properties: { src: asset.id, alt: 'Hero image' },
      },
    });

    // Verify asset is still private before publish
    const [beforePublish] = await db
      .select({ status: assets.status })
      .from(assets)
      .where(eq(assets.id, asset.id));
    expect(beforePublish.status).toBe('private');

    // Publish the branch
    await publishApprovedBranch(cms, {
      rootId: root.rootId,
      branchId: root.branchId,
      publishedBy: 'user-1',
    });

    // Verify asset is now public
    const [afterPublish] = await db
      .select({ status: assets.status })
      .from(assets)
      .where(eq(assets.id, asset.id));
    expect(afterPublish.status).toBe('public');
  });

  it('does not affect assets that are not referenced by the published content', async () => {
    const { cms, db } = await setupTestCMS();

    const [referencedAsset] = await db
      .insert(assets)
      .values({
        slug: 'referenced.png',
        mimeType: 'image/png',
        size: 1024,
        objectKey: 'referenced.png',
        status: 'private',
      })
      .returning();

    const [unreferencedAsset] = await db
      .insert(assets)
      .values({
        slug: 'unreferenced.png',
        mimeType: 'image/png',
        size: 2048,
        objectKey: 'unreferenced.png',
        status: 'private',
      })
      .returning();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/ref', properties: { title: 'Page' } },
    });

    await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'image',
        properties: { src: referencedAsset.id, alt: 'Referenced' },
      },
    });

    await publishApprovedBranch(cms, {
      rootId: root.rootId,
      branchId: root.branchId,
      publishedBy: 'user-1',
    });

    const [refAfter] = await db
      .select({ status: assets.status })
      .from(assets)
      .where(eq(assets.id, referencedAsset.id));
    expect(refAfter.status).toBe('public');

    const [unrefAfter] = await db
      .select({ status: assets.status })
      .from(assets)
      .where(eq(assets.id, unreferencedAsset.id));
    expect(unrefAfter.status).toBe('private');
  });

  it('handles publish with no asset references gracefully', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/text', properties: { title: 'Text Only' } },
    });

    await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'No images here' },
      },
    });

    // Should not throw
    const result = await publishApprovedBranch(cms, {
      rootId: root.rootId,
      branchId: root.branchId,
      publishedBy: 'user-1',
    });

    expect(result.rootId).toBe(root.rootId);
  });
});

describe('asset state sync on unpublish', () => {
  it('sets assets to private when the only published branch is unpublished', async () => {
    const { cms, db } = await setupTestCMS();

    const [asset] = await db
      .insert(assets)
      .values({
        slug: 'orphan.png',
        mimeType: 'image/png',
        size: 1024,
        objectKey: 'orphan.png',
        status: 'private',
      })
      .returning();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/orphan', properties: { title: 'Page' } },
    });

    await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'image',
        properties: { src: asset.id, alt: 'Will be orphaned' },
      },
    });

    await publishApprovedBranch(cms, {
      rootId: root.rootId,
      branchId: root.branchId,
      publishedBy: 'user-1',
    });

    // Confirm asset is public
    const [afterPublish] = await db
      .select({ status: assets.status })
      .from(assets)
      .where(eq(assets.id, asset.id));
    expect(afterPublish.status).toBe('public');

    // Unpublish
    await cms.api.pages.unpublishBranch({
      body: { rootId: root.rootId, branchId: root.branchId },
    });

    // Confirm asset is now private
    const [afterUnpublish] = await db
      .select({ status: assets.status })
      .from(assets)
      .where(eq(assets.id, asset.id));
    expect(afterUnpublish.status).toBe('private');
  });

  it('keeps assets public when referenced by another published branch', async () => {
    const { cms, db } = await setupTestCMS();

    const [sharedAsset] = await db
      .insert(assets)
      .values({
        slug: 'shared.png',
        mimeType: 'image/png',
        size: 1024,
        objectKey: 'shared.png',
        status: 'private',
      })
      .returning();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/shared', properties: { title: 'Page' } },
    });

    // Add asset to main branch
    await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'image',
        properties: { src: sharedAsset.id, alt: 'Shared image' },
      },
    });

    // Create a second branch that also references the same asset
    const draft = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'draft',
        sourceBranchId: root.branchId,
      },
    });

    // Publish both branches
    await publishApprovedBranch(cms, {
      rootId: root.rootId,
      branchId: root.branchId,
      publishedBy: 'user-1',
    });

    await publishApprovedBranch(cms, {
      rootId: root.rootId,
      branchId: draft.branchId,
      publishedBy: 'user-2',
    });

    // Unpublish main branch
    await cms.api.pages.unpublishBranch({
      body: { rootId: root.rootId, branchId: root.branchId },
    });

    // Asset should STILL be public because draft branch references it
    const [afterUnpublish] = await db
      .select({ status: assets.status })
      .from(assets)
      .where(eq(assets.id, sharedAsset.id));
    expect(afterUnpublish.status).toBe('public');
  });

  it('sets asset to private only after ALL referencing branches are unpublished', async () => {
    const { cms, db } = await setupTestCMS();

    const [asset] = await db
      .insert(assets)
      .values({
        slug: 'multi-ref.png',
        mimeType: 'image/png',
        size: 1024,
        objectKey: 'multi-ref.png',
        status: 'private',
      })
      .returning();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/multi', properties: { title: 'Page' } },
    });

    await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'image',
        properties: { src: asset.id, alt: 'Multi-ref' },
      },
    });

    const draft = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'draft',
        sourceBranchId: root.branchId,
      },
    });

    // Publish both
    await publishApprovedBranch(cms, {
      rootId: root.rootId,
      branchId: root.branchId,
      publishedBy: 'user-1',
    });

    await publishApprovedBranch(cms, {
      rootId: root.rootId,
      branchId: draft.branchId,
      publishedBy: 'user-2',
    });

    // Unpublish first branch - asset stays public
    await cms.api.pages.unpublishBranch({
      body: { rootId: root.rootId, branchId: root.branchId },
    });

    const [afterFirst] = await db
      .select({ status: assets.status })
      .from(assets)
      .where(eq(assets.id, asset.id));
    expect(afterFirst.status).toBe('public');

    // Unpublish second branch - asset goes private
    await cms.api.pages.unpublishBranch({
      body: { rootId: root.rootId, branchId: draft.branchId },
    });

    const [afterSecond] = await db
      .select({ status: assets.status })
      .from(assets)
      .where(eq(assets.id, asset.id));
    expect(afterSecond.status).toBe('private');
  });
});

// ============================================================================
// media.asset (public 302 redirect endpoint)
// ============================================================================

describe('media.asset (public endpoint with 302 redirect)', () => {
  it('redirects (302) to the public object URL with cache headers (over real HTTP)', async () => {
    // Drives the real router, because the redirect status + headers come from
    // `ctx.responseHeaders`/`ctx.redirect` — not from the handler's return value,
    // which only the server-side caller can see. (This test used to call the
    // server-side caller and so never observed the actual 200-vs-302 status.)
    const { cms, db } = await setupTestCMS();

    await db.insert(assets).values({
      slug: 'test.png',
      mimeType: 'image/png',
      size: 1024,
      objectKey: 'test.png',
      status: 'public',
    });

    const res = await cms.router.handler(
      new Request('http://localhost/api/cms/media/asset/test.png'),
    );

    expect(res.status).toBe(302);
    const location = res.headers.get('location');
    expect(location).toContain('test.png');
    expect(location).not.toContain('X-Amz-'); // public URL, not a presigned one
    expect(res.headers.get('cache-control')).toContain('immutable');
  });

  it('rejects access to private assets', async () => {
    const { cms, db, s3 } = await setupTestCMS({ withS3: true });

    const [privateAsset] = await db
      .insert(assets)
      .values({
        slug: 'private.png',
        mimeType: 'image/png',
        size: 1024,
        objectKey: 'private.png',
        status: 'private',
      })
      .returning();

    await expect(
      (cms.api.media.asset as any)({
        params: { assetSlug: privateAsset.slug },
        query: {},
      }),
    ).rejects.toThrow(/private.*requires authentication/i);

    await s3.cleanup();
  });

  it('throws when asset does not exist', async () => {
    const { cms, s3 } = await setupTestCMS({ withS3: true });

    await expect(
      (cms.api.media.asset as any)({
        params: { assetSlug: 'nonexistent.png' },
        query: {},
      }),
    ).rejects.toThrow(/Asset not found/i);

    await s3.cleanup();
  });

  it('routes a real GET /media/asset/<slug> URL through the router (regression: rou3 param syntax)', async () => {
    // Regression guard. The route must be registered with rou3's `:param` syntax,
    // not OpenAPI `{param}` braces: better-call passes the path verbatim to rou3,
    // which treats `{assetSlug}` as a literal segment, so EVERY real
    // `/media/asset/<slug>` HTTP request 404'd at the router before the handler
    // ran. The server-side `cms.api.media.asset(...)` caller bypasses URL routing
    // (it sets ctx.params directly), which is why the other tests hid the bug —
    // so this one drives a real Request through `cms.router.handler`.
    const { cms, db } = await setupTestCMS();
    await db.insert(assets).values({
      slug: 'routed.png',
      mimeType: 'image/png',
      size: 1024,
      objectKey: 'routed.png',
      status: 'public',
    });

    const res = await cms.router.handler(
      new Request('http://localhost/api/cms/media/asset/routed.png'),
    );

    // With the brace-param bug this was a 404 route-not-found; fixed → the
    // handler runs and 302-redirects to the public object URL.
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('routed.png');
  });
});

// ============================================================================
// updateAssetStatus
// ============================================================================

describe('media.updateAssetStatus', () => {
  it('updates asset status to public', async () => {
    const { cms, db } = await setupTestCMS();

    const [asset] = await db
      .insert(assets)
      .values({
        slug: 'manual.png',
        mimeType: 'image/png',
        size: 1024,
        objectKey: 'manual.png',
        status: 'private',
      })
      .returning();

    const result = await cms.api.media.updateAssetStatus({
      body: { assetIds: [asset.id], status: 'public' },
    });

    expect(result.updated).toBe(1);

    const [updated] = await db
      .select({ status: assets.status })
      .from(assets)
      .where(eq(assets.id, asset.id));

    expect(updated.status).toBe('public');
  });

  it('updates multiple assets at once', async () => {
    const { cms, db } = await setupTestCMS();

    const [a1] = await db
      .insert(assets)
      .values({
        slug: 'a1.png',
        mimeType: 'image/png',
        size: 1024,
        objectKey: 'a1.png',
        status: 'private',
      })
      .returning();

    const [a2] = await db
      .insert(assets)
      .values({
        slug: 'a2.png',
        mimeType: 'image/png',
        size: 1024,
        objectKey: 'a2.png',
        status: 'private',
      })
      .returning();

    const result = await cms.api.media.updateAssetStatus({
      body: { assetIds: [a1.id, a2.id], status: 'public' },
    });

    expect(result.updated).toBe(2);

    const [u1] = await db
      .select({ status: assets.status })
      .from(assets)
      .where(eq(assets.id, a1.id));
    const [u2] = await db
      .select({ status: assets.status })
      .from(assets)
      .where(eq(assets.id, a2.id));

    expect(u1.status).toBe('public');
    expect(u2.status).toBe('public');
  });

  it('throws when no assets match the given IDs', async () => {
    const { cms } = await setupTestCMS();

    await expect(
      cms.api.media.updateAssetStatus({
        body: { assetIds: ['nonexistent'], status: 'public' },
      }),
    ).rejects.toThrow(/Asset not found|No assets found/i);
  });
});
