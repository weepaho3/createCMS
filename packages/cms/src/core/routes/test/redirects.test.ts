import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import type { CMSPlugin } from '../../../index';

import { allowAnonymous, createCMS } from '../../../index';
import { redirects, roots } from '../../../schema';
import { setupTestCMS } from '../../../test-utils/cms';
import { setupTestDB } from '../../../test-utils/db';
import { DUMMY_MEDIA_CONFIG } from '../../../test-utils/fixtures';
import { publishApprovedBranch } from '../../../test-utils/helpers';
import { splitPath } from '../../slug';

// A nested collection (root '/docs') for parent-fallback resolution tests.
const NESTED_COLLECTIONS = {
  pages: {
    label: 'Pages',
    slug: { enabled: true, prefix: '/docs', nested: true, normalize: true },
    root: {
      properties: {
        title: { type: 'string', label: 'Title', required: true },
      },
    },
    blocks: {},
  },
} as const;

async function setupNestedCMS() {
  const { db } = await setupTestDB();
  const cms = createCMS({
    db,
    authMiddleware: allowAnonymous(),
    media: DUMMY_MEDIA_CONFIG,
    collections: NESTED_COLLECTIONS,
    plugins: [] as CMSPlugin<any>[],
  });
  return { cms, db };
}

describe('redirects schema (R1)', () => {
  it('cascade-deletes root-referencing redirects on hard-delete, keeps path-only ones', async () => {
    const { cms, db } = await setupTestCMS({
      dataRetention: { keepDays: 7, keepMinCommits: 1, archiveKeepDays: 7 },
    });

    const root = await cms.api.pages.createRoot({
      body: { slug: '/p', properties: { title: 'Page' } },
    });

    await db.insert(redirects).values([
      // page-source → references the root
      {
        collection: 'pages',
        sourceType: 'page',
        sourceRootId: root.rootId,
        targetType: 'path',
        targetPath: '/elsewhere',
      },
      // page-target → references the root
      {
        collection: 'pages',
        sourceType: 'path',
        sourcePath: '/old-a',
        targetType: 'page',
        targetRootId: root.rootId,
      },
      // path-only → no FK to any root, must survive
      {
        collection: 'pages',
        sourceType: 'path',
        sourcePath: '/old-b',
        targetType: 'path',
        targetPath: '/new-b',
      },
    ]);

    // Archive + age the root, then hard-delete it via pruning.
    await cms.api.pages.archiveRoot({ body: { rootId: root.rootId } });
    await db
      .update(roots)
      .set({ archivedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) })
      .where(eq(roots.id, root.rootId));
    const result = await cms.api.admin.runPruning({ body: { dryRun: false } });
    expect(result.deletedRoots).toContain(root.rootId);

    // The two root-referencing redirects cascaded away; the path-only one stays.
    const remaining = await db.select().from(redirects);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].sourcePath).toBe('/old-b');
  });

  it('does NOT core-DB-enforce source-path uniqueness (app-level / per-tenant plugin owns it)', async () => {
    const { db } = await setupTestCMS();
    // A core unique on (collection, sourcePath) would be GLOBAL — it cannot be
    // loosened by a plugin (merge.ts only ADDS indexes), so two tenants could
    // never share a path. So the core has NO such unique: two identical sources
    // insert fine at the raw DB level. Uniqueness is enforced by createRedirect
    // (REDIRECT_SOURCE_EXISTS) and, under a scoping plugin, a per-tenant partial
    // unique. This test guards against someone re-adding the core unique.
    await db.insert(redirects).values({
      collection: 'pages',
      sourceType: 'path',
      sourcePath: '/dup',
      targetType: 'path',
      targetPath: '/a',
    });
    await db.insert(redirects).values({
      collection: 'pages',
      sourceType: 'path',
      sourcePath: '/dup',
      targetType: 'path',
      targetPath: '/b',
    });
    const rows = await db.select().from(redirects);
    expect(rows).toHaveLength(2);
  });

  it('does NOT core-DB-enforce one-redirect-away-per-page (app-level / per-tenant plugin owns it)', async () => {
    const { cms, db } = await setupTestCMS();
    const root = await cms.api.pages.createRoot({
      body: { slug: '/p', properties: { title: 'Page' } },
    });
    // Same rationale as above: no core unique on sourceRootId.
    await db.insert(redirects).values({
      collection: 'pages',
      sourceType: 'page',
      sourceRootId: root.rootId,
      targetType: 'path',
      targetPath: '/a',
    });
    await db.insert(redirects).values({
      collection: 'pages',
      sourceType: 'page',
      sourceRootId: root.rootId,
      targetType: 'path',
      targetPath: '/b',
    });
    const rows = await db.select().from(redirects);
    expect(rows).toHaveLength(2);
  });
});

describe('redirect resolution (R2)', () => {
  it('resolves a page-source redirect on a live page (fires before serving)', async () => {
    const { cms, db } = await setupTestCMS();
    const root = await cms.api.pages.createRoot({
      body: { slug: 'foo', properties: { title: 'Foo' } },
    });
    // The slug materializes on publish, so the page is only live at
    // /pages/foo once published.
    await cms.api.pages.publishBranch({
      body: { rootId: root.rootId, branchId: root.branchId },
    });
    await db.insert(redirects).values({
      collection: 'pages',
      sourceType: 'page',
      sourceRootId: root.rootId,
      targetType: 'path',
      targetPath: '/elsewhere',
      statusCode: 302,
    });

    const { redirect } = await cms.api.pages.resolveRedirect({
      query: { path: '/pages/foo' },
    });
    expect(redirect).toEqual({ status: 302, location: '/elsewhere' });
  });

  it('resolves a path-source redirect for a dead path', async () => {
    const { cms, db } = await setupTestCMS();
    await db.insert(redirects).values({
      collection: 'pages',
      sourceType: 'path',
      sourcePath: '/pages/old',
      targetType: 'path',
      targetPath: '/pages/new',
    });

    const { redirect } = await cms.api.pages.resolveRedirect({
      query: { path: '/pages/old' },
    });
    expect(redirect).toEqual({ status: 301, location: '/pages/new' });
  });

  it('a page-target resolves to the target current path and follows a rename', async () => {
    const { cms, db } = await setupTestCMS();
    const target = await cms.api.pages.createRoot({
      body: { slug: 'target', properties: { title: 'T' } },
    });
    // Publish so the target's slug materializes and its live path resolves.
    await cms.api.pages.publishBranch({
      body: { rootId: target.rootId, branchId: target.branchId },
    });
    await db.insert(redirects).values({
      collection: 'pages',
      sourceType: 'path',
      sourcePath: '/pages/old',
      targetType: 'page',
      targetRootId: target.rootId,
    });

    const before = await cms.api.pages.resolveRedirect({
      query: { path: '/pages/old' },
    });
    expect(before.redirect?.location).toBe('/pages/target');

    // A DRAFT slug edit does not move the live URL — the page-target still
    // resolves to /pages/target until the rename is published.
    await cms.api.pages.updateRoot({
      body: {
        rootId: target.rootId,
        branchId: target.branchId,
        slug: 'renamed',
        properties: { title: 'T' },
      },
    });
    expect(
      (await cms.api.pages.resolveRedirect({ query: { path: '/pages/old' } }))
        .redirect?.location,
    ).toBe('/pages/target');

    await cms.api.pages.publishBranch({
      body: { rootId: target.rootId, branchId: target.branchId },
    });

    const after = await cms.api.pages.resolveRedirect({
      query: { path: '/pages/old' },
    });
    expect(after.redirect?.location).toBe('/pages/renamed');
  });

  it('falls back to the parent path when a page-target is archived (nested)', async () => {
    const { cms, db } = await setupNestedCMS();
    const parent = await cms.api.pages.createRoot({
      body: { slug: 'parent', properties: { title: 'P' } },
    });
    const child = await cms.api.pages.createRoot({
      body: {
        parentRootId: parent.rootId,
        slug: 'child',
        properties: { title: 'C' },
      },
    });
    // Publish both so their slugs materialize into the live path chain.
    await cms.api.pages.publishBranch({
      body: { rootId: parent.rootId, branchId: parent.branchId },
    });
    await cms.api.pages.publishBranch({
      body: { rootId: child.rootId, branchId: child.branchId },
    });
    await db.insert(redirects).values({
      collection: 'pages',
      sourceType: 'path',
      sourcePath: '/docs/old',
      targetType: 'page',
      targetRootId: child.rootId,
    });

    const before = await cms.api.pages.resolveRedirect({
      query: { path: '/docs/old' },
    });
    expect(before.redirect?.location).toBe('/docs/parent/child');

    await cms.api.pages.archiveRoot({ body: { rootId: child.rootId } });

    const after = await cms.api.pages.resolveRedirect({
      query: { path: '/docs/old' },
    });
    expect(after.redirect?.location).toBe('/docs/parent');
  });

  it('drops an archived top-level page-target (no parent) → no redirect', async () => {
    const { cms, db } = await setupTestCMS();
    const target = await cms.api.pages.createRoot({
      body: { slug: 'top', properties: { title: 'T' } },
    });
    await db.insert(redirects).values({
      collection: 'pages',
      sourceType: 'path',
      sourcePath: '/pages/old',
      targetType: 'page',
      targetRootId: target.rootId,
    });
    await cms.api.pages.archiveRoot({ body: { rootId: target.rootId } });

    const { redirect } = await cms.api.pages.resolveRedirect({
      query: { path: '/pages/old' },
    });
    expect(redirect).toBeNull();
  });

  it('drops a self-referencing redirect (loop guard)', async () => {
    const { cms, db } = await setupTestCMS();
    const root = await cms.api.pages.createRoot({
      body: { slug: 'loop', properties: { title: 'L' } },
    });
    await db.insert(redirects).values({
      collection: 'pages',
      sourceType: 'page',
      sourceRootId: root.rootId,
      targetType: 'page',
      targetRootId: root.rootId,
    });

    const { redirect } = await cms.api.pages.resolveRedirect({
      query: { path: '/pages/loop' },
    });
    expect(redirect).toBeNull();
  });

  it('returns null for a live page with no redirect and for an unknown path', async () => {
    const { cms } = await setupTestCMS();
    await cms.api.pages.createRoot({
      body: { slug: 'plain', properties: { title: 'P' } },
    });

    const live = await cms.api.pages.resolveRedirect({
      query: { path: '/pages/plain' },
    });
    expect(live.redirect).toBeNull();

    const unknown = await cms.api.pages.resolveRedirect({
      query: { path: '/pages/nothing' },
    });
    expect(unknown.redirect).toBeNull();
  });
});

describe('redirect resolution — chains, published, boundary (R2 hardening)', () => {
  it('collapses a redirect chain into one hop (first status, final location)', async () => {
    const { cms, db } = await setupTestCMS();
    await db.insert(redirects).values([
      {
        collection: 'pages',
        sourceType: 'path',
        sourcePath: '/pages/a',
        targetType: 'path',
        targetPath: '/pages/b',
        statusCode: 301,
      },
      {
        collection: 'pages',
        sourceType: 'path',
        sourcePath: '/pages/b',
        targetType: 'path',
        targetPath: '/pages/c',
        statusCode: 302,
      },
    ]);

    const { redirect } = await cms.api.pages.resolveRedirect({
      query: { path: '/pages/a' },
    });
    expect(redirect).toEqual({ status: 301, location: '/pages/c' });
  });

  it('drops a redirect cycle (loop guard)', async () => {
    const { cms, db } = await setupTestCMS();
    await db.insert(redirects).values([
      {
        collection: 'pages',
        sourceType: 'path',
        sourcePath: '/pages/a',
        targetType: 'path',
        targetPath: '/pages/b',
      },
      {
        collection: 'pages',
        sourceType: 'path',
        sourcePath: '/pages/b',
        targetType: 'path',
        targetPath: '/pages/a',
      },
    ]);

    const { redirect } = await cms.api.pages.resolveRedirect({
      query: { path: '/pages/a' },
    });
    expect(redirect).toBeNull();
  });

  it('applies a path-source redirect when an UNPUBLISHED draft sits at the path', async () => {
    const { cms, db } = await setupTestCMS();
    // 'draft' exists but is never published → a 404 to the consumer.
    await cms.api.pages.createRoot({
      body: { slug: 'draft', properties: { title: 'D' } },
    });
    await db.insert(redirects).values({
      collection: 'pages',
      sourceType: 'path',
      sourcePath: '/pages/draft',
      targetType: 'path',
      targetPath: '/pages/new',
    });

    const { redirect } = await cms.api.pages.resolveRedirect({
      query: { path: '/pages/draft' },
    });
    expect(redirect).toEqual({ status: 301, location: '/pages/new' });
  });

  it('a PUBLISHED page wins over a path-source redirect for the same path', async () => {
    const { cms, db } = await setupTestCMS();
    const root = await cms.api.pages.createRoot({
      body: { slug: 'pub', properties: { title: 'P' } },
    });
    await publishApprovedBranch(cms, {
      rootId: root.rootId,
      branchId: root.branchId,
      publishedBy: 'u1',
    });
    await db.insert(redirects).values({
      collection: 'pages',
      sourceType: 'path',
      sourcePath: '/pages/pub',
      targetType: 'path',
      targetPath: '/pages/x',
    });

    const { redirect } = await cms.api.pages.resolveRedirect({
      query: { path: '/pages/pub' },
    });
    expect(redirect).toBeNull();
  });

  it('splitPath strips the collection root only at a path boundary', () => {
    const cfg = { enabled: true, prefix: '/pages', normalize: false } as never;
    // Sibling path sharing the root string prefix must NOT be mangled.
    expect(splitPath(cfg, '/pages-archive/x')).toEqual(['pages-archive', 'x']);
    // Genuine in-collection paths still strip correctly.
    expect(splitPath(cfg, '/pages/x')).toEqual(['x']);
    expect(splitPath(cfg, '/pages')).toEqual([]);
  });
});

describe('redirect CRUD (R3)', () => {
  it('creates a path→page redirect, canonicalizes the source path, and resolves it', async () => {
    const { cms } = await setupTestCMS();
    const target = await cms.api.pages.createRoot({
      body: { slug: 'dest', properties: { title: 'D' } },
    });
    // Publish so the page-target's slug materializes and resolves.
    await cms.api.pages.publishBranch({
      body: { rootId: target.rootId, branchId: target.branchId },
    });

    const { redirect } = await cms.api.pages.createRedirect({
      body: {
        sourceType: 'path',
        sourcePath: '/pages/old/', // trailing slash → canonicalized away
        targetType: 'page',
        targetRootId: target.rootId,
        statusCode: 302,
      },
    });
    expect(redirect.sourcePath).toBe('/pages/old');

    const res = await cms.api.pages.resolveRedirect({
      query: { path: '/pages/old' },
    });
    expect(res.redirect).toEqual({ status: 302, location: '/pages/dest' });
  });

  it('rejects a page endpoint without a rootId, and a duplicate active source', async () => {
    const { cms } = await setupTestCMS();
    await expect(
      cms.api.pages.createRedirect({
        body: { sourceType: 'page', targetType: 'path', targetPath: '/x' },
      }),
    ).rejects.toThrow();

    await cms.api.pages.createRedirect({
      body: {
        sourceType: 'path',
        sourcePath: '/pages/dup',
        targetType: 'path',
        targetPath: '/a',
      },
    });
    await expect(
      cms.api.pages.createRedirect({
        body: {
          sourceType: 'path',
          sourcePath: '/pages/dup',
          targetType: 'path',
          targetPath: '/b',
        },
      }),
    ).rejects.toThrow();
  });

  it('archive stops resolution and frees the source for re-creation (partial unique)', async () => {
    const { cms } = await setupTestCMS();
    const { redirect } = await cms.api.pages.createRedirect({
      body: {
        sourceType: 'path',
        sourcePath: '/pages/gone',
        targetType: 'path',
        targetPath: '/a',
      },
    });
    expect(
      (await cms.api.pages.resolveRedirect({ query: { path: '/pages/gone' } }))
        .redirect,
    ).toEqual({ status: 301, location: '/a' });

    await cms.api.pages.archiveRedirect({ body: { redirectId: redirect.id } });
    expect(
      (await cms.api.pages.resolveRedirect({ query: { path: '/pages/gone' } }))
        .redirect,
    ).toBeNull();

    // Re-create the same source — the partial unique (archived excluded) allows it.
    const recreated = await cms.api.pages.createRedirect({
      body: {
        sourceType: 'path',
        sourcePath: '/pages/gone',
        targetType: 'path',
        targetPath: '/b',
      },
    });
    expect(recreated.redirect.id).not.toBe(redirect.id);
    expect(
      (await cms.api.pages.resolveRedirect({ query: { path: '/pages/gone' } }))
        .redirect,
    ).toEqual({ status: 301, location: '/b' });
  });

  it('updates a redirect (full replace)', async () => {
    const { cms } = await setupTestCMS();
    const { redirect } = await cms.api.pages.createRedirect({
      body: {
        sourceType: 'path',
        sourcePath: '/pages/u',
        targetType: 'path',
        targetPath: '/a',
      },
    });

    const { redirect: updated } = await cms.api.pages.updateRedirect({
      body: {
        redirectId: redirect.id,
        sourceType: 'path',
        sourcePath: '/pages/u',
        targetType: 'path',
        targetPath: '/b',
        statusCode: 308,
      },
    });
    expect(updated.targetPath).toBe('/b');
    expect(updated.statusCode).toBe(308);
    expect(
      (await cms.api.pages.resolveRedirect({ query: { path: '/pages/u' } }))
        .redirect,
    ).toEqual({ status: 308, location: '/b' });
  });

  it('lists active redirects and resolves page-ref current paths', async () => {
    const { cms } = await setupTestCMS();
    const target = await cms.api.pages.createRoot({
      body: { slug: 'live', properties: { title: 'L' } },
    });
    // Publish so the page-ref's current path materializes.
    await cms.api.pages.publishBranch({
      body: { rootId: target.rootId, branchId: target.branchId },
    });
    const { redirect } = await cms.api.pages.createRedirect({
      body: {
        sourceType: 'path',
        sourcePath: '/pages/old',
        targetType: 'page',
        targetRootId: target.rootId,
      },
    });

    const list = await cms.api.pages.listRedirects({ query: {} });
    expect(list.total).toBe(1);
    expect(list.redirects[0].targetCurrentPath).toBe('/pages/live');

    await cms.api.pages.archiveRedirect({ body: { redirectId: redirect.id } });
    const after = await cms.api.pages.listRedirects({ query: {} });
    expect(after.total).toBe(0);
  });
});

describe('redirect auto-creation (R4)', () => {
  it('a slug rename auto-creates a redirect at PUBLISH (not at the draft edit)', async () => {
    const { cms } = await setupTestCMS();
    const root = await cms.api.pages.createRoot({
      body: { slug: 'old-slug', properties: { title: 'P' } },
    });
    // Establish the live slug by publishing first.
    await cms.api.pages.publishBranch({
      body: { rootId: root.rootId, branchId: root.branchId },
    });

    // The draft rename does NOT yet move the live URL or create a redirect.
    await cms.api.pages.updateRoot({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        slug: 'new-slug',
        properties: { title: 'P' },
      },
    });
    expect(
      (
        await cms.api.pages.resolveRedirect({
          query: { path: '/pages/old-slug' },
        })
      ).redirect,
    ).toBeNull();
    expect((await cms.api.pages.listRedirects({ query: {} })).total).toBe(0);

    // Publishing the rename materializes it and auto-creates the old→new redirect.
    await cms.api.pages.publishBranch({
      body: { rootId: root.rootId, branchId: root.branchId },
    });
    const res = await cms.api.pages.resolveRedirect({
      query: { path: '/pages/old-slug' },
    });
    expect(res.redirect).toEqual({ status: 301, location: '/pages/new-slug' });
  });

  it('a never-published slug edit creates no redirect', async () => {
    const { cms } = await setupTestCMS();
    const root = await cms.api.pages.createRoot({
      body: { slug: 'draft-a', properties: { title: 'P' } },
    });
    // Edit the draft slug repeatedly without ever publishing.
    await cms.api.pages.updateRoot({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        slug: 'draft-b',
        properties: { title: 'P' },
      },
    });

    // No redirect exists — the page was never live at any slug.
    expect((await cms.api.pages.listRedirects({ query: {} })).total).toBe(0);
    expect(
      (
        await cms.api.pages.resolveRedirect({
          query: { path: '/pages/draft-a' },
        })
      ).redirect,
    ).toBeNull();
  });

  it('keeps every old path working across successive renames (page-target follows)', async () => {
    const { cms } = await setupTestCMS();
    const root = await cms.api.pages.createRoot({
      body: { slug: 'a', properties: { title: 'P' } },
    });
    // Each rename becomes live (and auto-redirects) only when published.
    const publish = () =>
      cms.api.pages.publishBranch({
        body: { rootId: root.rootId, branchId: root.branchId },
      });
    await publish();
    await cms.api.pages.updateRoot({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        slug: 'b',
        properties: { title: 'P' },
      },
    });
    await publish();
    await cms.api.pages.updateRoot({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        slug: 'c',
        properties: { title: 'P' },
      },
    });
    await publish();

    expect(
      (await cms.api.pages.resolveRedirect({ query: { path: '/pages/a' } }))
        .redirect,
    ).toEqual({ status: 301, location: '/pages/c' });
    expect(
      (await cms.api.pages.resolveRedirect({ query: { path: '/pages/b' } }))
        .redirect,
    ).toEqual({ status: 301, location: '/pages/c' });
  });

  it('does not create a redirect when the slug is unchanged', async () => {
    const { cms } = await setupTestCMS();
    const root = await cms.api.pages.createRoot({
      body: { slug: 'same', properties: { title: 'P' } },
    });
    await cms.api.pages.updateRoot({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        slug: 'same',
        properties: { title: 'Changed' },
      },
    });

    const list = await cms.api.pages.listRedirects({ query: {} });
    expect(list.total).toBe(0);
  });

  it('archiving a page auto-creates a redirect to its parent (nested)', async () => {
    const { cms } = await setupNestedCMS();
    const parent = await cms.api.pages.createRoot({
      body: { slug: 'parent', properties: { title: 'P' } },
    });
    const child = await cms.api.pages.createRoot({
      body: {
        parentRootId: parent.rootId,
        slug: 'child',
        properties: { title: 'C' },
      },
    });
    // Publish so the live path chain exists before archiving. archiveRoot
    // still fires its redirect immediately (it reads the live roots.slug).
    await cms.api.pages.publishBranch({
      body: { rootId: parent.rootId, branchId: parent.branchId },
    });
    await cms.api.pages.publishBranch({
      body: { rootId: child.rootId, branchId: child.branchId },
    });

    await cms.api.pages.archiveRoot({ body: { rootId: child.rootId } });

    const res = await cms.api.pages.resolveRedirect({
      query: { path: '/docs/parent/child' },
    });
    expect(res.redirect).toEqual({ status: 301, location: '/docs/parent' });
  });

  it('moving a subtree auto-creates redirects for the node AND its descendants', async () => {
    const { cms } = await setupNestedCMS();
    const a = await cms.api.pages.createRoot({
      body: { slug: 'a', properties: { title: 'A' } },
    });
    const b = await cms.api.pages.createRoot({
      body: { slug: 'b', properties: { title: 'B' } },
    });
    const x = await cms.api.pages.createRoot({
      body: { parentRootId: a.rootId, slug: 'x', properties: { title: 'X' } },
    });
    const y = await cms.api.pages.createRoot({
      body: { parentRootId: x.rootId, slug: 'y', properties: { title: 'Y' } },
    });
    // Publish the whole subtree so its live slugs materialize before the
    // move. moveRoot still reparents + redirects immediately (it reads roots.slug).
    for (const p of [a, b, x, y]) {
      await cms.api.pages.publishBranch({
        body: { rootId: p.rootId, branchId: p.branchId },
      });
    }

    // /docs/a/x and /docs/a/x/y → move x under b → /docs/b/x and /docs/b/x/y
    await cms.api.pages.moveRoot({
      body: { rootId: x.rootId, newParentRootId: b.rootId },
    });

    expect(
      (await cms.api.pages.resolveRedirect({ query: { path: '/docs/a/x' } }))
        .redirect,
    ).toEqual({ status: 301, location: '/docs/b/x' });
    expect(
      (await cms.api.pages.resolveRedirect({ query: { path: '/docs/a/x/y' } }))
        .redirect,
    ).toEqual({ status: 301, location: '/docs/b/x/y' });
  });

  it('a same-parent sort reorder creates no redirect', async () => {
    const { cms } = await setupNestedCMS();
    const parent = await cms.api.pages.createRoot({
      body: { slug: 'parent', properties: { title: 'P' } },
    });
    const child = await cms.api.pages.createRoot({
      body: {
        parentRootId: parent.rootId,
        slug: 'child',
        properties: { title: 'C' },
      },
    });

    // Re-"move" under the SAME parent (a sort reorder) — paths don't shift.
    await cms.api.pages.moveRoot({
      body: {
        rootId: child.rootId,
        newParentRootId: parent.rootId,
        position: 5,
      },
    });

    const list = await cms.api.pages.listRedirects({ query: {} });
    expect(list.total).toBe(0);
  });

  it('does not clobber an existing redirect for a reused path (first-writer-wins)', async () => {
    const { cms } = await setupTestCMS();
    const x = await cms.api.pages.createRoot({
      body: { slug: 'keep', properties: { title: 'X' } },
    });
    // Publish so /pages/keep is the page's live path.
    await cms.api.pages.publishBranch({
      body: { rootId: x.rootId, branchId: x.branchId },
    });
    // A manual redirect already owns /pages/keep.
    await cms.api.pages.createRedirect({
      body: {
        sourceType: 'path',
        sourcePath: '/pages/keep',
        targetType: 'path',
        targetPath: '/manual',
      },
    });

    // Publishing a rename of X away from /pages/keep would auto-create
    // /pages/keep → X, but the existing manual redirect is kept.
    await cms.api.pages.updateRoot({
      body: {
        rootId: x.rootId,
        branchId: x.branchId,
        slug: 'moved',
        properties: { title: 'X' },
      },
    });
    await cms.api.pages.publishBranch({
      body: { rootId: x.rootId, branchId: x.branchId },
    });

    const res = await cms.api.pages.resolveRedirect({
      query: { path: '/pages/keep' },
    });
    expect(res.redirect).toEqual({ status: 301, location: '/manual' });
  });
});
