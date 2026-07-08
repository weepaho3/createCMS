import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import type { CMSPlugin } from '../src/index';

import {
  buildFullPath,
  normalizeSlug,
  resolvePathToRootId,
  splitPath,
  validateSlugUniqueness,
} from '../src/core/slug';
import { allowAnonymous, createCMS } from '../src/index';
import { setupTestDB } from '../src/test-utils/db';
import { DUMMY_MEDIA_CONFIG } from '../src/test-utils/fixtures';
import { publishApprovedBranch } from '../src/test-utils/helpers';

type Api = Record<string, (...args: any[]) => Promise<any>>;
type CMS = { api: { pages: Api } };

const NESTED_COLLECTIONS = {
  pages: {
    label: 'Pages',
    slug: { enabled: true, root: '/docs', nested: true, normalize: true },
    root: {
      properties: {
        title: { type: 'string', label: 'Title', required: true },
      },
    },
    blocks: {
      paragraph: {
        label: 'Paragraph',
        properties: {
          text: { type: 'richText', label: 'Text', required: true },
        },
      },
    },
  },
} as const;

const FLAT_COLLECTIONS = {
  pages: {
    label: 'Pages',
    slug: { enabled: true, root: '/blog', normalize: true },
    root: {
      properties: {
        title: { type: 'string', label: 'Title', required: true },
      },
    },
    blocks: {},
  },
} as const;

const NO_ROOT_COLLECTIONS = {
  pages: {
    label: 'Pages',
    slug: {
      enabled: true,
      root: '/pages',
      allowRoot: false,
      normalize: true,
      nested: true,
    },
    root: {
      properties: {
        title: { type: 'string', label: 'Title', required: true },
      },
    },
    blocks: {},
  },
} as const;

async function setupNestedCMS(collections: any = NESTED_COLLECTIONS) {
  const { db } = await setupTestDB();
  const cms = createCMS({
    db,
    authMiddleware: allowAnonymous(),
    media: DUMMY_MEDIA_CONFIG,
    collections,
    plugins: [] as CMSPlugin<any>[],
  }) as unknown as CMS;
  return { cms, db };
}

// ============================================================================
// Unit tests for slug helpers
// ============================================================================

describe('normalizeSlug', () => {
  it('lowercases and strips diacritics', () => {
    expect(normalizeSlug('Über Uns')).toBe('uber-uns');
  });

  it('replaces spaces and special chars with hyphens', () => {
    expect(normalizeSlug('Hello World!')).toBe('hello-world');
  });

  it('trims leading/trailing hyphens', () => {
    expect(normalizeSlug('--hello--')).toBe('hello');
  });

  it('collapses multiple non-alphanumeric chars', () => {
    expect(normalizeSlug('a   b---c')).toBe('a-b-c');
  });

  it('returns empty string for empty input', () => {
    expect(normalizeSlug('')).toBe('');
  });
});

describe('buildFullPath', () => {
  const cfg = {
    enabled: true as const,
    root: '/docs',
    allowRoot: true,
    normalize: true,
    nested: true,
  };

  it('builds path from segments', () => {
    expect(buildFullPath(cfg, ['getting-started', 'install'])).toBe(
      '/docs/getting-started/install',
    );
  });

  it('returns root for empty segments', () => {
    expect(buildFullPath(cfg, [])).toBe('/docs');
  });

  it('handles root at /', () => {
    const rootCfg = { ...cfg, root: '/' };
    expect(buildFullPath(rootCfg, ['about'])).toBe('/about');
  });

  it('handles root at / with no segments', () => {
    const rootCfg = { ...cfg, root: '/' };
    expect(buildFullPath(rootCfg, [])).toBe('/');
  });
});

describe('splitPath', () => {
  const cfg = {
    enabled: true as const,
    root: '/docs',
    allowRoot: true,
    normalize: true,
    nested: true,
  };

  it('strips root prefix and splits', () => {
    expect(splitPath(cfg, '/docs/getting-started/install')).toEqual([
      'getting-started',
      'install',
    ]);
  });

  it('returns empty array for root path', () => {
    expect(splitPath(cfg, '/docs')).toEqual([]);
  });

  it('normalizes segments when normalize is true', () => {
    expect(splitPath(cfg, '/docs/Hello World/Install')).toEqual([
      'hello-world',
      'install',
    ]);
  });

  it('preserves case when normalize is false', () => {
    const noNorm = { ...cfg, normalize: false };
    expect(splitPath(noNorm, '/docs/Hello/World')).toEqual(['Hello', 'World']);
  });
});

// ============================================================================
// Integration tests for nested pages
// ============================================================================

describe('nested pages', () => {
  describe('createRoot with nesting', () => {
    it('creates a top-level page with slug', async () => {
      const { cms } = await setupNestedCMS();

      const root = await cms.api.pages.createRoot({
        body: {
          slug: 'getting-started',
          properties: { title: 'Getting Started' },
        },
      });

      expect(root.rootId).toBeDefined();
      expect(root.branchId).toBeDefined();
    });

    it('creates a child page under a parent', async () => {
      const { cms } = await setupNestedCMS();

      const parent = await cms.api.pages.createRoot({
        body: {
          slug: 'getting-started',
          properties: { title: 'Getting Started' },
        },
      });

      const child = await cms.api.pages.createRoot({
        body: {
          parentRootId: parent.rootId,
          slug: 'install',
          properties: { title: 'Installation' },
        },
      });

      expect(child.rootId).toBeDefined();
      expect(child.rootId).not.toBe(parent.rootId);
    });

    it('normalizes the draft slug on creation', async () => {
      const { cms } = await setupNestedCMS();

      // cms-05: the slug is a versioned draft — createRoot returns the normalized
      // draft slug; roots.slug stays null until publish.
      const root = await cms.api.pages.createRoot({
        body: { slug: 'Hello World!', properties: { title: 'Hello World' } },
      });
      expect(root.slug).toBe('hello-world');
    });

    it('rejects parentRootId on flat collections', async () => {
      const { cms } = await setupNestedCMS(FLAT_COLLECTIONS);

      const parent = await cms.api.pages.createRoot({
        body: { slug: 'post-1', properties: { title: 'Post' } },
      });

      await expect(
        cms.api.pages.createRoot({
          body: {
            parentRootId: parent.rootId,
            slug: 'child',
            properties: { title: 'Child' },
          },
        }),
      ).rejects.toThrow();
    });

    it('rejects non-existent parentRootId', async () => {
      const { cms } = await setupNestedCMS();

      await expect(
        cms.api.pages.createRoot({
          body: {
            parentRootId: 'root_nonexistent12345678',
            slug: 'child',
            properties: { title: 'Child' },
          },
        }),
      ).rejects.toThrow();
    });
  });

  describe('slug uniqueness', () => {
    it('rejects a duplicate slug among siblings at PUBLISH (drafts may collide)', async () => {
      const { cms } = await setupNestedCMS();

      // cms-05: two draft siblings can share a slug; the conflict fires when the
      // second one publishes into the already-live slug.
      const a = await cms.api.pages.createRoot({
        body: { slug: 'about', properties: { title: 'Page A' } },
      });
      const b = await cms.api.pages.createRoot({
        body: { slug: 'about', properties: { title: 'Page B' } },
      });
      await cms.api.pages.publishBranch({
        body: { rootId: a.rootId, branchId: a.branchId },
      });
      await expect(
        cms.api.pages.publishBranch({
          body: { rootId: b.rootId, branchId: b.branchId },
        }),
      ).rejects.toThrow(/PUBLISH_SLUG_CONFLICT|already uses this slug/i);
    });

    it('allows same slug under different parents', async () => {
      const { cms } = await setupNestedCMS();

      const parentA = await cms.api.pages.createRoot({
        body: { slug: 'section-a', properties: { title: 'Section A' } },
      });

      const parentB = await cms.api.pages.createRoot({
        body: { slug: 'section-b', properties: { title: 'Section B' } },
      });

      await cms.api.pages.createRoot({
        body: {
          parentRootId: parentA.rootId,
          slug: 'overview',
          properties: { title: 'Overview' },
        },
      });

      const child = await cms.api.pages.createRoot({
        body: {
          parentRootId: parentB.rootId,
          slug: 'overview',
          properties: { title: 'Overview' },
        },
      });

      expect(child.rootId).toBeDefined();
    });

    // i18n phase I1: the core slug index was demoted from unique → non-unique so
    // the i18n plugin can later allow the same slug across languages. Uniqueness
    // is now the app-level authority (validateSlugUniqueness), which must cover
    // EVERY slug write — including duplicateBlock, which previously leaned on the
    // (now gone) DB unique.
    it('does NOT core-DB-enforce slug uniqueness (app-level is the authority now)', async () => {
      const { db } = await setupNestedCMS();
      // Two roots with identical (collection, parentRootId, slug) insert fine at
      // the raw DB level — the demoted index is non-unique. Guards against someone
      // re-adding the core unique (which would break same-slug-per-language).
      await db.execute(
        sql`INSERT INTO cms.roots (id, collection, slug) VALUES ('rot_dup_a', 'pages', 'about')`,
      );
      await db.execute(
        sql`INSERT INTO cms.roots (id, collection, slug) VALUES ('rot_dup_b', 'pages', 'about')`,
      );
      const rows = await db.execute(
        sql`SELECT count(*)::int AS n FROM cms.roots WHERE slug = 'about'`,
      );
      expect(Number((rows.rows[0] as { n: number }).n)).toBe(2);
    });

    it('duplicateBlock into a colliding slug is rejected at PUBLISH', async () => {
      const { cms } = await setupNestedCMS();
      const a = await cms.api.pages.createRoot({
        body: { slug: 'about', properties: { title: 'A' } },
      });
      await cms.api.pages.publishBranch({
        body: { rootId: a.rootId, branchId: a.branchId },
      });
      // cms-05: the duplicate seeds 'about' as a DRAFT slug (allowed); publishing
      // it into the already-live 'about' collides.
      const dup = await cms.api.pages.duplicateBlock({
        body: {
          rootId: a.rootId,
          branchId: a.branchId,
          blockId: a.rootId,
          targetProperties: { title: 'A copy' },
          targetSlug: 'about',
          message: 'dup',
        },
      });
      if (dup.mode !== 'root') throw new Error('expected root duplication');
      await expect(
        cms.api.pages.publishBranch({
          body: { rootId: dup.rootId, branchId: dup.branchId },
        }),
      ).rejects.toThrow(/PUBLISH_SLUG_CONFLICT|already uses this slug/i);
    });

    it('validateSlugUniqueness scopes by the given scope columns (e.g. language)', async () => {
      const { db } = await setupNestedCMS();
      // Simulate the i18n plugin's plugin-owned column.
      await db.execute(sql`ALTER TABLE cms.roots ADD COLUMN language text`);
      await db.execute(
        sql`INSERT INTO cms.roots (id, collection, slug, language) VALUES ('rot_en', 'pages', 'blog', 'en')`,
      );

      // Same slug in another language is allowed (no throw).
      await expect(
        validateSlugUniqueness(db, 'pages', null, 'blog', undefined, {
          language: 'de',
        }),
      ).resolves.toBeUndefined();

      // Same slug in the SAME language collides.
      await expect(
        validateSlugUniqueness(db, 'pages', null, 'blog', undefined, {
          language: 'en',
        }),
      ).rejects.toThrow();

      // Without scope columns the check is global (back-compat) → collides.
      await expect(
        validateSlugUniqueness(db, 'pages', null, 'blog'),
      ).rejects.toThrow();
    });

    it('resolvePathToRootId resolves within the active language', async () => {
      const { db } = await setupNestedCMS();
      await db.execute(sql`ALTER TABLE cms.roots ADD COLUMN language text`);
      await db.execute(
        sql`INSERT INTO cms.roots (id, collection, slug, language) VALUES
          ('rot_en2', 'pages', 'blog', 'en'),
          ('rot_de2', 'pages', 'blog', 'de')`,
      );

      expect(
        await resolvePathToRootId(db, 'pages', ['blog'], { language: 'en' }),
      ).toBe('rot_en2');
      expect(
        await resolvePathToRootId(db, 'pages', ['blog'], { language: 'de' }),
      ).toBe('rot_de2');
    });
  });

  describe('allowRoot', () => {
    it('rejects empty slug when allowRoot is false', async () => {
      const { cms } = await setupNestedCMS(NO_ROOT_COLLECTIONS);

      await expect(
        cms.api.pages.createRoot({
          body: { slug: '', properties: { title: 'Index' } },
        }),
      ).rejects.toThrow();
    });

    it('allows empty slug when allowRoot is true (default)', async () => {
      const { cms } = await setupNestedCMS();

      const root = await cms.api.pages.createRoot({
        body: { slug: '', properties: { title: 'Index' } },
      });

      expect(root.rootId).toBeDefined();
    });
  });

  describe('listRoots with parentRootId filter', () => {
    it('lists only top-level roots when parentRootId is null', async () => {
      const { cms } = await setupNestedCMS();

      const parent = await cms.api.pages.createRoot({
        body: { slug: 'parent', properties: { title: 'Parent' } },
      });

      await cms.api.pages.createRoot({
        body: {
          parentRootId: parent.rootId,
          slug: 'child',
          properties: { title: 'Child' },
        },
      });

      const result = await cms.api.pages.listRoots({
        query: { parentRootId: 'null' },
      });

      expect(result.roots).toHaveLength(1);
      expect(result.roots[0].rootId).toBe(parent.rootId);
    });

    it('lists children of a specific parent', async () => {
      const { cms } = await setupNestedCMS();

      const parent = await cms.api.pages.createRoot({
        body: { slug: 'parent', properties: { title: 'Parent' } },
      });

      const child1 = await cms.api.pages.createRoot({
        body: {
          parentRootId: parent.rootId,
          slug: 'child-1',
          properties: { title: 'Child 1' },
        },
      });

      const child2 = await cms.api.pages.createRoot({
        body: {
          parentRootId: parent.rootId,
          slug: 'child-2',
          properties: { title: 'Child 2' },
        },
      });

      const result = await cms.api.pages.listRoots({
        query: { parentRootId: parent.rootId },
      });

      expect(result.roots).toHaveLength(2);
      const ids = result.roots.map((r: any) => r.rootId);
      expect(ids).toContain(child1.rootId);
      expect(ids).toContain(child2.rootId);
    });

    it('includes parentRootId and slug in response', async () => {
      const { cms } = await setupNestedCMS();

      const parent = await cms.api.pages.createRoot({
        body: { slug: 'parent', properties: { title: 'Parent' } },
      });

      const child = await cms.api.pages.createRoot({
        body: {
          parentRootId: parent.rootId,
          slug: 'child',
          properties: { title: 'Child' },
        },
      });
      // cms-05: listRoots reflects the PUBLISHED slug, so publish the child.
      await cms.api.pages.publishBranch({
        body: { rootId: child.rootId, branchId: child.branchId },
      });

      const result = await cms.api.pages.listRoots({
        query: { parentRootId: parent.rootId },
      });

      expect(result.roots[0].parentRootId).toBe(parent.rootId);
      expect(result.roots[0].slug).toBe('child');
    });
  });

  describe('path resolution via getPublishedContent', () => {
    it('resolves a top-level path', async () => {
      const { cms } = await setupNestedCMS();

      const root = await cms.api.pages.createRoot({
        body: { slug: 'overview', properties: { title: 'Overview' } },
      });

      await publishApprovedBranch(cms, {
        rootId: root.rootId,
        branchId: root.branchId,
        publishedBy: 'user-1',
      });

      const result = await cms.api.pages.getPublishedContent({
        query: { path: '/docs/overview' },
      });

      expect(result.rootId).toBe(root.rootId);
    });

    it('includes ancestors in response for nested collections', async () => {
      const { cms } = await setupNestedCMS();

      const parent = await cms.api.pages.createRoot({
        body: { slug: 'guide', properties: { title: 'Guide' } },
      });

      await publishApprovedBranch(cms, {
        rootId: parent.rootId,
        branchId: parent.branchId,
        publishedBy: 'user-1',
      });

      const child = await cms.api.pages.createRoot({
        body: {
          parentRootId: parent.rootId,
          slug: 'setup',
          properties: { title: 'Setup' },
        },
      });

      await publishApprovedBranch(cms, {
        rootId: child.rootId,
        branchId: child.branchId,
        publishedBy: 'user-1',
      });

      const result = await cms.api.pages.getPublishedContent({
        query: { path: '/docs/guide/setup' },
      });

      expect(result.rootId).toBe(child.rootId);
      expect(result.ancestors).toBeDefined();
      expect(result.ancestors).toHaveLength(1);
      expect(result.ancestors[0].rootId).toBe(parent.rootId);
      expect(result.ancestors[0].slug).toBe('guide');
    });

    it('rejects non-existent path', async () => {
      const { cms } = await setupNestedCMS();

      await expect(
        cms.api.pages.getPublishedContent({
          query: { path: '/docs/nonexistent' },
        }),
      ).rejects.toThrow();
    });
  });

  describe('moveRoot', () => {
    it('moves a page to a new parent', async () => {
      const { cms } = await setupNestedCMS();

      const parentA = await cms.api.pages.createRoot({
        body: { slug: 'section-a', properties: { title: 'Section A' } },
      });

      const parentB = await cms.api.pages.createRoot({
        body: { slug: 'section-b', properties: { title: 'Section B' } },
      });

      const child = await cms.api.pages.createRoot({
        body: {
          parentRootId: parentA.rootId,
          slug: 'page',
          properties: { title: 'Page' },
        },
      });

      const result = await cms.api.pages.moveRoot({
        body: {
          rootId: child.rootId,
          newParentRootId: parentB.rootId,
        },
      });

      expect(result.rootId).toBe(child.rootId);
      expect(result.newParentRootId).toBe(parentB.rootId);

      // Verify the child is now under parentB
      const children = await cms.api.pages.listRoots({
        query: { parentRootId: parentB.rootId },
      });
      expect(children.roots).toHaveLength(1);
      expect(children.roots[0].rootId).toBe(child.rootId);
    });

    it('moves a page to top-level', async () => {
      const { cms } = await setupNestedCMS();

      const parent = await cms.api.pages.createRoot({
        body: { slug: 'parent', properties: { title: 'Parent' } },
      });

      const child = await cms.api.pages.createRoot({
        body: {
          parentRootId: parent.rootId,
          slug: 'child',
          properties: { title: 'Child' },
        },
      });

      await cms.api.pages.moveRoot({
        body: {
          rootId: child.rootId,
          newParentRootId: null,
        },
      });

      const topLevel = await cms.api.pages.listRoots({
        query: { parentRootId: 'null' },
      });
      const ids = topLevel.roots.map((r: any) => r.rootId);
      expect(ids).toContain(child.rootId);
    });

    it('rejects circular reference (move into own descendant)', async () => {
      const { cms } = await setupNestedCMS();

      const parent = await cms.api.pages.createRoot({
        body: { slug: 'parent', properties: { title: 'Parent' } },
      });

      const child = await cms.api.pages.createRoot({
        body: {
          parentRootId: parent.rootId,
          slug: 'child',
          properties: { title: 'Child' },
        },
      });

      await expect(
        cms.api.pages.moveRoot({
          body: {
            rootId: parent.rootId,
            newParentRootId: child.rootId,
          },
        }),
      ).rejects.toThrow();
    });

    it('rejects move when slug conflicts at new parent', async () => {
      const { cms } = await setupNestedCMS();

      const parentA = await cms.api.pages.createRoot({
        body: { slug: 'section-a', properties: { title: 'Section A' } },
      });

      const parentB = await cms.api.pages.createRoot({
        body: { slug: 'section-b', properties: { title: 'Section B' } },
      });

      const childA = await cms.api.pages.createRoot({
        body: {
          parentRootId: parentA.rootId,
          slug: 'page',
          properties: { title: 'Page' },
        },
      });

      // Create a page with the same slug under parentB
      const childB = await cms.api.pages.createRoot({
        body: {
          parentRootId: parentB.rootId,
          slug: 'page',
          properties: { title: 'Page' },
        },
      });

      // cms-05: moveRoot validates against the LIVE slug set (roots.slug), so both
      // must be published for the conflict to exist.
      for (const c of [childA, childB]) {
        await cms.api.pages.publishBranch({
          body: { rootId: c.rootId, branchId: c.branchId },
        });
      }

      await expect(
        cms.api.pages.moveRoot({
          body: {
            rootId: childA.rootId,
            newParentRootId: parentB.rootId,
          },
        }),
      ).rejects.toThrow();
    });

    it('rejects moveRoot on flat collections', async () => {
      const { cms } = await setupNestedCMS(FLAT_COLLECTIONS);

      const root = await cms.api.pages.createRoot({
        body: { slug: 'post-1', properties: { title: 'Post' } },
      });

      await expect(
        cms.api.pages.moveRoot({
          body: {
            rootId: root.rootId,
            newParentRootId: null,
          },
        }),
      ).rejects.toThrow();
    });
  });

  describe('slug sync on update', () => {
    it('syncs slug into roots.slug when the rename is published', async () => {
      const { cms, db } = await setupNestedCMS();

      const root = await cms.api.pages.createRoot({
        body: { slug: 'old-slug', properties: { title: 'Old Title' } },
      });
      await cms.api.pages.publishBranch({
        body: { rootId: root.rootId, branchId: root.branchId },
      });

      await cms.api.pages.updateRoot({
        body: {
          rootId: root.rootId,
          branchId: root.branchId,
          slug: 'new-slug',
          properties: {},
        },
      });
      // cms-05: the draft rename is not live yet…
      let result = await db.execute(
        /* sql */ `SELECT slug FROM cms.roots WHERE id = '${root.rootId}'`,
      );
      expect((result.rows[0] as any).slug).toBe('old-slug');

      // …publishing materializes it.
      await cms.api.pages.publishBranch({
        body: { rootId: root.rootId, branchId: root.branchId },
      });
      result = await db.execute(
        /* sql */ `SELECT slug FROM cms.roots WHERE id = '${root.rootId}'`,
      );
      expect((result.rows[0] as any).slug).toBe('new-slug');
    });

    it('normalizes the draft slug on update', async () => {
      const { cms } = await setupNestedCMS();

      const root = await cms.api.pages.createRoot({
        body: { slug: 'page', properties: { title: 'Page' } },
      });

      // cms-05: updateRoot returns the normalized DRAFT slug.
      const upd = await cms.api.pages.updateRoot({
        body: {
          rootId: root.rootId,
          branchId: root.branchId,
          slug: 'New Slug Name!',
          properties: {},
        },
      });
      expect(upd.slug).toBe('new-slug-name');
    });

    it('rejects a slug rename into a live slug at PUBLISH', async () => {
      const { cms } = await setupNestedCMS();

      const pageA = await cms.api.pages.createRoot({
        body: { slug: 'taken', properties: { title: 'Page A' } },
      });
      const pageB = await cms.api.pages.createRoot({
        body: { slug: 'page-b', properties: { title: 'Page B' } },
      });
      await cms.api.pages.publishBranch({
        body: { rootId: pageA.rootId, branchId: pageA.branchId },
      });
      await cms.api.pages.publishBranch({
        body: { rootId: pageB.rootId, branchId: pageB.branchId },
      });

      // The draft rename into 'taken' is allowed; publishing it collides.
      await cms.api.pages.updateRoot({
        body: {
          rootId: pageB.rootId,
          branchId: pageB.branchId,
          slug: 'taken',
          properties: {},
        },
      });
      await expect(
        cms.api.pages.publishBranch({
          body: { rootId: pageB.rootId, branchId: pageB.branchId },
        }),
      ).rejects.toThrow(/PUBLISH_SLUG_CONFLICT|already uses this slug/i);
    });
  });

  describe('breadcrumbs (3 levels deep)', () => {
    it('resolves a 3-level nested path with correct ancestors', async () => {
      const { cms } = await setupNestedCMS();

      const level1 = await cms.api.pages.createRoot({
        body: { slug: 'docs', properties: { title: 'Docs' } },
      });
      await publishApprovedBranch(cms, {
        rootId: level1.rootId,
        branchId: level1.branchId,
        publishedBy: 'user-1',
      });

      const level2 = await cms.api.pages.createRoot({
        body: {
          parentRootId: level1.rootId,
          slug: 'api',
          properties: { title: 'API' },
        },
      });
      await publishApprovedBranch(cms, {
        rootId: level2.rootId,
        branchId: level2.branchId,
        publishedBy: 'user-1',
      });

      const level3 = await cms.api.pages.createRoot({
        body: {
          parentRootId: level2.rootId,
          slug: 'endpoints',
          properties: { title: 'Endpoints' },
        },
      });
      await publishApprovedBranch(cms, {
        rootId: level3.rootId,
        branchId: level3.branchId,
        publishedBy: 'user-1',
      });

      const result = await cms.api.pages.getPublishedContent({
        query: { path: '/docs/docs/api/endpoints' },
      });

      expect(result.rootId).toBe(level3.rootId);
      expect(result.ancestors).toHaveLength(2);
      expect(result.ancestors[0].rootId).toBe(level1.rootId);
      expect(result.ancestors[0].slug).toBe('docs');
      expect(result.ancestors[1].rootId).toBe(level2.rootId);
      expect(result.ancestors[1].slug).toBe('api');
    });
  });

  describe('deleteRoot (soft-archive)', () => {
    it('archives a root: gone from listRoots, getRoot 404s', async () => {
      const { cms } = await setupNestedCMS();
      const page = await cms.api.pages.createRoot({
        body: { slug: 'to-delete', properties: { title: 'To Delete' } },
      });

      const res = await cms.api.pages.archiveRoot({
        body: { rootId: page.rootId },
      });
      expect(res.rootId).toBe(page.rootId);

      const list = await cms.api.pages.listRoots();
      expect(list.roots.map((r: any) => r.rootId)).not.toContain(page.rootId);

      await expect(
        cms.api.pages.getRoot({ query: { rootId: page.rootId } }),
      ).rejects.toThrow(/not found/i);
    });

    it('rejects archiving a page that still has live child pages', async () => {
      const { cms } = await setupNestedCMS();
      const parent = await cms.api.pages.createRoot({
        body: { slug: 'parent', properties: { title: 'Parent' } },
      });
      await cms.api.pages.createRoot({
        body: {
          parentRootId: parent.rootId,
          slug: 'child',
          properties: { title: 'Child' },
        },
      });

      await expect(
        cms.api.pages.archiveRoot({ body: { rootId: parent.rootId } }),
      ).rejects.toThrow(/child pages/i);

      const list = await cms.api.pages.listRoots();
      expect(list.roots.map((r: any) => r.rootId)).toContain(parent.rootId);
    });

    it('allows archiving the parent once the child is archived', async () => {
      const { cms } = await setupNestedCMS();
      const parent = await cms.api.pages.createRoot({
        body: { slug: 'parent', properties: { title: 'Parent' } },
      });
      const child = await cms.api.pages.createRoot({
        body: {
          parentRootId: parent.rootId,
          slug: 'child',
          properties: { title: 'Child' },
        },
      });

      await cms.api.pages.archiveRoot({ body: { rootId: child.rootId } });
      const res = await cms.api.pages.archiveRoot({
        body: { rootId: parent.rootId },
      });
      expect(res.rootId).toBe(parent.rootId);
    });

    it('404s when re-deleting an already-archived root', async () => {
      const { cms } = await setupNestedCMS();
      const page = await cms.api.pages.createRoot({
        body: { slug: 'once', properties: { title: 'Once' } },
      });
      await cms.api.pages.archiveRoot({ body: { rootId: page.rootId } });
      await expect(
        cms.api.pages.archiveRoot({ body: { rootId: page.rootId } }),
      ).rejects.toThrow(/not found/i);
    });
  });

  describe('listRoots full path', () => {
    it('resolves each root full ancestor path (with the slug-config root)', async () => {
      const { cms } = await setupNestedCMS(); // root: '/docs', nested

      const parent = await cms.api.pages.createRoot({
        body: {
          slug: 'getting-started',
          properties: { title: 'Getting Started' },
        },
      });
      const child = await cms.api.pages.createRoot({
        body: {
          parentRootId: parent.rootId,
          slug: 'install',
          properties: { title: 'Installation' },
        },
      });
      // cms-05: listRoots paths are built from the PUBLISHED slug chain (roots.slug).
      for (const r of [parent, child]) {
        await cms.api.pages.publishBranch({
          body: { rootId: r.rootId, branchId: r.branchId },
        });
      }

      const { roots } = await cms.api.pages.listRoots({
        query: { limit: 100 },
      });
      const byId = Object.fromEntries(roots.map((r: any) => [r.rootId, r]));

      // Full path = slug-config root + ancestor slugs; slug stays the segment.
      expect(byId[parent.rootId].path).toBe('/docs/getting-started');
      expect(byId[child.rootId].path).toBe('/docs/getting-started/install');
      expect(byId[child.rootId].slug).toBe('install');
    });

    it('uses the collection root for a flat (non-nested) collection', async () => {
      const { cms } = await setupNestedCMS(FLAT_COLLECTIONS); // root: '/blog'

      const page = await cms.api.pages.createRoot({
        body: { slug: 'hello', properties: { title: 'Hello' } },
      });
      await cms.api.pages.publishBranch({
        body: { rootId: page.rootId, branchId: page.branchId },
      });

      const { roots } = await cms.api.pages.listRoots({
        query: { limit: 100 },
      });
      const row = roots.find((r: any) => r.rootId === page.rootId);
      expect(row.path).toBe('/blog/hello');
    });
  });
});
