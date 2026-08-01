import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { setupTestCMS } from '../../../test-utils/cms';
import { setupI18nMultiTenantTestCMS, setupI18nTestCMS } from './utils/cms';

// A self-referential collection for language-aware reference tests.
const REF_I18N = {
  pages: {
    label: 'Pages',
    slug: { enabled: true, prefix: '/pages' },
    root: {
      properties: { title: { type: 'string', label: 'Title', required: true } },
    },
    blocks: {
      link: {
        label: 'Link',
        properties: {
          target: {
            type: 'reference',
            collection: 'pages',
            label: 'Target',
            required: true,
          },
        },
      },
    },
  },
} as const;

// A nested i18n collection for parent-resolution tests.
const NESTED_I18N = {
  pages: {
    label: 'Pages',
    slug: { enabled: true, prefix: '/docs', nested: true, normalize: true },
    root: {
      properties: { title: { type: 'string', label: 'Title', required: true } },
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

// TEST_COLLECTIONS.pages: slug { enabled, root '/pages' } (flat, no normalize),
// so a root with slug 'foo' lives at path '/pages/foo'.

// ============================================================================
// Language stamping + same-slug-per-language (the headline of I2)
// ============================================================================

describe('i18n — language stamping', () => {
  it('stamps the active language on createRoot', async () => {
    const { cms, db, setLanguage } = await setupI18nTestCMS();
    setLanguage('de');

    const root = await cms.api.pages.createRoot({
      body: { slug: 'page', properties: { title: 'Seite' } },
    });

    const rows = await db.execute(
      sql`SELECT language FROM cms.roots WHERE id = ${root.rootId}`,
    );
    expect(rows.rows[0].language).toBe('de');
  });
});

describe('i18n — same slug across languages', () => {
  it('allows the identical slug in two languages (en/blog + de/blog)', async () => {
    const { cms, setLanguage } = await setupI18nTestCMS();

    setLanguage('en');
    const en = await cms.api.pages.createRoot({
      body: { slug: 'blog', properties: { title: 'Blog (EN)' } },
    });

    setLanguage('de');
    const de = await cms.api.pages.createRoot({
      body: { slug: 'blog', properties: { title: 'Blog (DE)' } },
    });

    expect(en.rootId).not.toBe(de.rootId);
  });

  it('rejects the same slug within the SAME language at PUBLISH (drafts may collide)', async () => {
    const { cms, setLanguage } = await setupI18nTestCMS();
    setLanguage('en');

    // cms-05: two unpublished en drafts can share a slug — uniqueness is a
    // publish-time (per-language) concern.
    const first = await cms.api.pages.createRoot({
      body: { slug: 'about', properties: { title: 'A' } },
    });
    const second = await cms.api.pages.createRoot({
      body: { slug: 'about', properties: { title: 'A2' } },
    });

    // Publishing the first materializes its en slug…
    await cms.api.pages.publishBranch({
      body: { rootId: first.rootId, branchId: first.branchId },
    });
    // …so publishing the second (same en slug) now collides.
    await expect(
      cms.api.pages.publishBranch({
        body: { rootId: second.rootId, branchId: second.branchId },
      }),
    ).rejects.toThrow(/PUBLISH_SLUG_CONFLICT|already uses this slug/i);
  });

  it('renaming in one language does not collide with a same-slug sibling in another', async () => {
    const { cms, setLanguage } = await setupI18nTestCMS();

    // de already has /about.
    setLanguage('de');
    await cms.api.pages.createRoot({
      body: { slug: 'about', properties: { title: 'Über uns' } },
    });

    // en has /news; renaming it to /about must NOT collide with de's /about.
    setLanguage('en');
    const enNews = await cms.api.pages.createRoot({
      body: { slug: 'news', properties: { title: 'News' } },
    });
    await expect(
      cms.api.pages.updateRoot({
        body: {
          rootId: enNews.rootId,
          branchId: enNews.branchId,
          slug: 'about',
          properties: { title: 'About' },
        },
      }),
    ).resolves.toBeDefined();
  });

  it('enforces per-language uniqueness at the DB level for NESTED roots (plugin unique)', async () => {
    const { db } = await setupI18nTestCMS();
    // The DB unique only backstops NESTED roots: a NULL parent_root_id is treated
    // as DISTINCT by Postgres, so top-level uniqueness is app-level only (exactly
    // as the demoted core index behaved). Use a real parent here.
    await db.execute(
      sql`INSERT INTO cms.roots (id, collection, slug, language, translation_key) VALUES ('rot_par', 'pages', 'p', 'en', 'tgr_par')`,
    );
    await db.execute(
      sql`INSERT INTO cms.roots (id, collection, parent_root_id, slug, language, translation_key) VALUES ('rot_c1', 'pages', 'rot_par', 'c', 'en', 'tgr_c1')`,
    );
    // Same (language, collection, parent, slug) → the plugin's unique fires.
    await expect(
      db.execute(
        sql`INSERT INTO cms.roots (id, collection, parent_root_id, slug, language, translation_key) VALUES ('rot_c2', 'pages', 'rot_par', 'c', 'en', 'tgr_c2')`,
      ),
    ).rejects.toThrow();
    // Different language under the same parent → allowed.
    await expect(
      db.execute(
        sql`INSERT INTO cms.roots (id, collection, parent_root_id, slug, language, translation_key) VALUES ('rot_c3', 'pages', 'rot_par', 'c', 'de', 'tgr_c3')`,
      ),
    ).resolves.toBeDefined();
  });
});

// ============================================================================
// translationKey (group id)
// ============================================================================

describe('i18n — translationKey group id', () => {
  it('stamps a fresh tgr_ key on each createRoot (distinct logical entries)', async () => {
    const { cms, db, setLanguage } = await setupI18nTestCMS();
    setLanguage('en');

    const a = await cms.api.pages.createRoot({
      body: { slug: 'a', properties: { title: 'A' } },
    });
    const b = await cms.api.pages.createRoot({
      body: { slug: 'b', properties: { title: 'B' } },
    });

    const rows = await db.execute(
      sql`SELECT id, translation_key FROM cms.roots`,
    );
    const byId = new Map(
      rows.rows.map((r) => [r.id as string, r.translation_key as string]),
    );
    const aKey = byId.get(a.rootId)!;
    const bKey = byId.get(b.rootId)!;
    expect(aKey).toMatch(/^tgr_/);
    expect(bKey).toMatch(/^tgr_/);
    expect(aKey).not.toBe(bKey);
  });

  it('a root duplication gets its own fresh translation group', async () => {
    const { cms, db, setLanguage } = await setupI18nTestCMS();
    setLanguage('en');

    const src = await cms.api.pages.createRoot({
      body: { slug: 'src', properties: { title: 'Src' } },
    });
    await cms.api.pages.duplicateRoot({
      body: {
        rootId: src.rootId,
        branchId: src.branchId,
        blockId: src.rootId,
        targetProperties: { title: 'Copy' },
        targetSlug: 'copy',
        message: 'dup',
      },
    });

    const rows = await db.execute(
      sql`SELECT id, translation_key, slug FROM cms.roots`,
    );
    const srcKey = (
      rows.rows.find((r) => r.id === src.rootId) as { translation_key: string }
    ).translation_key;
    // cms-05: the duplicate's slug is a draft (`__slug`), so roots.slug is null;
    // identify the copy by id instead.
    const copy = rows.rows.find((r) => r.id !== src.rootId) as {
      translation_key: string;
    };
    expect(copy.translation_key).toMatch(/^tgr_/);
    expect(copy.translation_key).not.toBe(srcKey);
  });
});

// ============================================================================
// createTranslation
// ============================================================================

describe('i18n — createTranslation', () => {
  it('creates a sibling: inherited translationKey, target language, localized slug', async () => {
    const { cms, db, setLanguage } = await setupI18nTestCMS();
    setLanguage('en');
    const en = await cms.api.pages.createRoot({
      body: { slug: 'about', properties: { title: 'About' } },
    });

    const de = await cms.api.pages.createTranslation({
      body: {
        sourceRootId: en.rootId,
        targetLanguage: 'de',
        targetSlug: 'ueber-uns',
      },
    });
    expect(de.language).toBe('de');

    const rows = await db.execute(
      sql`SELECT id, language, slug, translation_key FROM cms.roots`,
    );
    const enRow = rows.rows.find((r) => r.id === en.rootId) as {
      translation_key: string;
    };
    const deRow = rows.rows.find((r) => r.id === de.rootId) as {
      language: string;
      slug: string | null;
      translation_key: string;
    };
    expect(deRow.translation_key).toBe(enRow.translation_key);
    expect(deRow.language).toBe('de');
    // cms-05: the localized slug is seeded as a DRAFT (`__slug`) — roots.slug
    // stays null until the translation is published.
    expect(deRow.slug).toBeNull();
    setLanguage('de');
    const deTree = await cms.api.pages.getBlockTree({
      query: { rootId: de.rootId, branchId: de.branchId, raw: true },
    });
    expect((deTree.tree.properties as { __slug?: string }).__slug).toBe(
      'ueber-uns',
    );
  });

  it('copy seed (default) copies the source tree as the starting draft', async () => {
    const { cms, setLanguage } = await setupI18nTestCMS({
      collections: NESTED_I18N,
    });
    setLanguage('en');
    const en = await cms.api.pages.createRoot({
      body: { slug: 'guide', properties: { title: 'Guide' } },
    });
    await cms.api.pages.createBlock({
      body: {
        rootId: en.rootId,
        branchId: en.branchId,
        parentBlockId: en.rootId,
        type: 'paragraph',
        properties: { text: 'Hello' },
      },
    });

    const de = await cms.api.pages.createTranslation({
      body: {
        sourceRootId: en.rootId,
        targetLanguage: 'de',
        targetSlug: 'anleitung',
      },
    });
    // The de root is read in the de language context (blanket scope).
    setLanguage('de');
    const tree = await cms.api.pages.getBlockTree({
      query: { rootId: de.rootId, branchId: de.branchId },
    });
    expect(tree.tree.children).toHaveLength(1);
    expect((tree.tree.children[0].properties as { text: string }).text).toBe(
      'Hello',
    );
  });

  it('copy seed honors a custom defaultBranchName (not hard-coded "main")', async () => {
    const { cms, setLanguage } = await setupI18nTestCMS({
      collections: NESTED_I18N,
      defaultBranchName: 'production',
    });
    setLanguage('en');
    const en = await cms.api.pages.createRoot({
      body: { slug: 'guide', properties: { title: 'Guide' } },
    });
    await cms.api.pages.createBlock({
      body: {
        rootId: en.rootId,
        branchId: en.branchId,
        parentBlockId: en.rootId,
        type: 'paragraph',
        properties: { text: 'Hello' },
      },
    });

    const de = await cms.api.pages.createTranslation({
      body: {
        sourceRootId: en.rootId,
        targetLanguage: 'de',
        targetSlug: 'anleitung',
      },
    });
    // The source's default branch is named 'production', not 'main'. Before the
    // fix the copy-seed looked up a branch literally named 'main', found none,
    // and silently produced a blank translation.
    setLanguage('de');
    const tree = await cms.api.pages.getBlockTree({
      query: { rootId: de.rootId, branchId: de.branchId },
    });
    expect(tree.tree.children).toHaveLength(1);
    expect((tree.tree.children[0].properties as { text: string }).text).toBe(
      'Hello',
    );
  });

  it('blank seed starts empty', async () => {
    const { cms, setLanguage } = await setupI18nTestCMS({
      collections: NESTED_I18N,
    });
    setLanguage('en');
    const en = await cms.api.pages.createRoot({
      body: { slug: 'g2', properties: { title: 'G2' } },
    });
    await cms.api.pages.createBlock({
      body: {
        rootId: en.rootId,
        branchId: en.branchId,
        parentBlockId: en.rootId,
        type: 'paragraph',
        properties: { text: 'X' },
      },
    });
    const de = await cms.api.pages.createTranslation({
      body: {
        sourceRootId: en.rootId,
        targetLanguage: 'de',
        targetSlug: 'g2-de',
        seed: 'blank',
      },
    });
    setLanguage('de');
    const tree = await cms.api.pages.getBlockTree({
      query: { rootId: de.rootId, branchId: de.branchId },
    });
    expect(tree.tree.children).toHaveLength(0);
  });

  it('rejects a duplicate translation (target language already exists)', async () => {
    const { cms, setLanguage } = await setupI18nTestCMS();
    setLanguage('en');
    const en = await cms.api.pages.createRoot({
      body: { slug: 'x', properties: { title: 'X' } },
    });
    await cms.api.pages.createTranslation({
      body: {
        sourceRootId: en.rootId,
        targetLanguage: 'de',
        targetSlug: 'x-de',
      },
    });
    await expect(
      cms.api.pages.createTranslation({
        body: {
          sourceRootId: en.rootId,
          targetLanguage: 'de',
          targetSlug: 'x-de2',
        },
      }),
    ).rejects.toThrow();
  });

  it('hangs a nested translation under the target-language sibling of the parent', async () => {
    const { cms, db, setLanguage } = await setupI18nTestCMS({
      collections: NESTED_I18N,
    });
    setLanguage('en');
    const parent = await cms.api.pages.createRoot({
      body: { slug: 'docs', properties: { title: 'Docs' } },
    });
    const child = await cms.api.pages.createRoot({
      body: {
        parentRootId: parent.rootId,
        slug: 'guide',
        properties: { title: 'Guide' },
      },
    });

    const deParent = await cms.api.pages.createTranslation({
      body: {
        sourceRootId: parent.rootId,
        targetLanguage: 'de',
        targetSlug: 'dok',
      },
    });
    const deChild = await cms.api.pages.createTranslation({
      body: {
        sourceRootId: child.rootId,
        targetLanguage: 'de',
        targetSlug: 'anleitung',
      },
    });

    const rows = await db.execute(
      sql`SELECT parent_root_id FROM cms.roots WHERE id = ${deChild.rootId}`,
    );
    expect((rows.rows[0] as { parent_root_id: string }).parent_root_id).toBe(
      deParent.rootId,
    );
  });

  it('refuses to translate a child whose parent is not yet translated', async () => {
    const { cms, setLanguage } = await setupI18nTestCMS({
      collections: NESTED_I18N,
    });
    setLanguage('en');
    const parent = await cms.api.pages.createRoot({
      body: { slug: 'docs2', properties: { title: 'Docs2' } },
    });
    const child = await cms.api.pages.createRoot({
      body: {
        parentRootId: parent.rootId,
        slug: 'guide2',
        properties: { title: 'Guide2' },
      },
    });
    await expect(
      cms.api.pages.createTranslation({
        body: {
          sourceRootId: child.rootId,
          targetLanguage: 'de',
          targetSlug: 'a2',
        },
      }),
    ).rejects.toThrow();
  });

  it('the (translationKey, language) partial unique backstops duplicate siblings', async () => {
    const { db } = await setupI18nTestCMS();
    await db.execute(
      sql`INSERT INTO cms.roots (id, collection, slug, language, translation_key) VALUES ('rot_g1', 'pages', 'g1', 'en', 'tgr_grp')`,
    );
    // Same group + language (active) → the partial unique fires.
    await expect(
      db.execute(
        sql`INSERT INTO cms.roots (id, collection, slug, language, translation_key) VALUES ('rot_g2', 'pages', 'g2', 'en', 'tgr_grp')`,
      ),
    ).rejects.toThrow();
    // Same group, different language → allowed (the actual sibling).
    await expect(
      db.execute(
        sql`INSERT INTO cms.roots (id, collection, slug, language, translation_key) VALUES ('rot_g3', 'pages', 'g3', 'de', 'tgr_grp')`,
      ),
    ).resolves.toBeDefined();
  });

  it('does NOT expose createTranslation without the i18n plugin', async () => {
    const { cms } = await setupTestCMS();
    // createTranslation is contributed by the i18n plugin's collectionEndpoints;
    // without the plugin it must not exist on the collection API — neither at the
    // type level (cms.api.pages has no such key) nor at runtime.
    expect(
      (cms.api.pages as Record<string, unknown>).createTranslation,
    ).toBeUndefined();
  });

  it('rejects a target language outside the configured universe', async () => {
    const { cms, setLanguage } = await setupI18nTestCMS();
    setLanguage('en');
    const en = await cms.api.pages.createRoot({
      body: { slug: 'q', properties: { title: 'Q' } },
    });
    await expect(
      cms.api.pages.createTranslation({
        body: {
          sourceRootId: en.rootId,
          targetLanguage: 'xx',
          targetSlug: 'q-xx',
        },
      }),
    ).rejects.toThrow();
  });
});

// ============================================================================
// Read path: resolution + listing are language-scoped
// ============================================================================

describe('i18n — language-scoped reads', () => {
  it('getPublishedContent resolves a shared path within the active language', async () => {
    const { cms, setLanguage } = await setupI18nTestCMS();

    setLanguage('en');
    const en = await cms.api.pages.createRoot({
      body: { slug: 'foo', properties: { title: 'Foo EN' } },
    });
    await cms.api.pages.publishBranch({
      body: { rootId: en.rootId, branchId: en.branchId },
    });

    setLanguage('de');
    const de = await cms.api.pages.createRoot({
      body: { slug: 'foo', properties: { title: 'Foo DE' } },
    });
    await cms.api.pages.publishBranch({
      body: { rootId: de.rootId, branchId: de.branchId },
    });

    // /pages/foo resolves to the active language's root.
    setLanguage('en');
    const asEn = await cms.api.pages.getPublishedContent({
      query: { path: '/pages/foo' },
    });
    expect(asEn.rootId).toBe(en.rootId);

    setLanguage('de');
    const asDe = await cms.api.pages.getPublishedContent({
      query: { path: '/pages/foo' },
    });
    expect(asDe.rootId).toBe(de.rootId);
  });

  it('listRoots returns only the active language (Strapi-style per-locale list)', async () => {
    const { cms, setLanguage } = await setupI18nTestCMS();

    setLanguage('en');
    await cms.api.pages.createRoot({
      body: { slug: 'a', properties: { title: 'A' } },
    });
    await cms.api.pages.createRoot({
      body: { slug: 'b', properties: { title: 'B' } },
    });

    setLanguage('de');
    await cms.api.pages.createRoot({
      body: { slug: 'a', properties: { title: 'A-de' } },
    });

    setLanguage('en');
    const enRoots = await cms.api.pages.listRoots();
    expect(enRoots.roots).toHaveLength(2);

    setLanguage('de');
    const deRoots = await cms.api.pages.listRoots();
    expect(deRoots.roots).toHaveLength(1);
    expect((deRoots.roots[0].properties as { title?: string }).title).toBe(
      'A-de',
    );
  });

  it("does not expose another language's root by id (scope gate)", async () => {
    const { cms, setLanguage } = await setupI18nTestCMS();

    setLanguage('en');
    const en = await cms.api.pages.createRoot({
      body: { slug: 'secret', properties: { title: 'Secret' } },
    });

    setLanguage('de');
    await expect(
      cms.api.pages.getBlockTree({
        query: { rootId: en.rootId, branchId: en.branchId },
      }),
    ).rejects.toThrow();
  });

  it('rejects publishing a root from another language (scope gate)', async () => {
    const { cms, setLanguage } = await setupI18nTestCMS();

    setLanguage('en');
    const en = await cms.api.pages.createRoot({
      body: { slug: 'pub', properties: { title: 'Pub' } },
    });

    setLanguage('de');
    await expect(
      cms.api.pages.publishBranch({
        body: { rootId: en.rootId, branchId: en.branchId },
      }),
    ).rejects.toThrow();
  });
});

// ============================================================================
// listTranslations (language switcher)
// ============================================================================

describe('i18n — listTranslations', () => {
  it('lists all sibling translations with their per-language paths', async () => {
    const { cms, setLanguage } = await setupI18nTestCMS();
    setLanguage('en');
    const en = await cms.api.pages.createRoot({
      body: { slug: 'about', properties: { title: 'About' } },
    });
    const de = await cms.api.pages.createTranslation({
      body: {
        sourceRootId: en.rootId,
        targetLanguage: 'de',
        targetSlug: 'ueber-uns',
      },
    });
    // cms-05: listTranslations shows the PUBLISHED slug/path, so publish each
    // sibling in its own language scope to materialize them.
    await cms.api.pages.publishBranch({
      body: { rootId: en.rootId, branchId: en.branchId },
    });
    setLanguage('de');
    await cms.api.pages.publishBranch({
      body: { rootId: de.rootId, branchId: de.branchId },
    });
    setLanguage('en');

    const res = await cms.api.pages.listTranslations({
      query: { rootId: en.rootId },
    });
    expect(res.translations).toHaveLength(2);
    const byLang = Object.fromEntries(
      res.translations.map((t) => [t.language, t]),
    );
    expect(byLang.en.rootId).toBe(en.rootId);
    expect(byLang.en.path).toBe('/pages/about');
    expect(byLang.de.slug).toBe('ueber-uns');
    expect(byLang.de.path).toBe('/pages/ueber-uns');
  });

  it('shows the DRAFT slug for an UNPUBLISHED translation (cms-05 fallback)', async () => {
    const { cms, setLanguage } = await setupI18nTestCMS();
    setLanguage('en');
    const en = await cms.api.pages.createRoot({
      body: { slug: 'about', properties: { title: 'About' } },
    });
    const de = await cms.api.pages.createTranslation({
      body: {
        sourceRootId: en.rootId,
        targetLanguage: 'de',
        targetSlug: 'ueber-uns',
      },
    });
    // Publish only the EN sibling. The DE translation stays a draft, so its
    // roots.slug is still null — cms-05 no longer writes it on createTranslation.
    await cms.api.pages.publishBranch({
      body: { rootId: en.rootId, branchId: en.branchId },
    });

    const res = await cms.api.pages.listTranslations({
      query: { rootId: en.rootId },
    });
    const byLang = Object.fromEntries(
      res.translations.map((t) => [t.language, t]),
    );
    // Published EN shows its live slug; unpublished DE falls back to the draft
    // `__slug` instead of listing as null.
    expect(byLang.en.slug).toBe('about');
    expect(byLang.de.rootId).toBe(de.rootId);
    expect(byLang.de.slug).toBe('ueber-uns');
  });

  it("rejects listing another language's root (scope gate)", async () => {
    const { cms, setLanguage } = await setupI18nTestCMS();
    setLanguage('en');
    const en = await cms.api.pages.createRoot({
      body: { slug: 'secret', properties: { title: 'S' } },
    });
    setLanguage('de');
    await expect(
      cms.api.pages.listTranslations({ query: { rootId: en.rootId } }),
    ).rejects.toThrow();
  });

  it('does NOT expose listTranslations without the i18n plugin', async () => {
    const { cms } = await setupTestCMS();
    expect(
      (cms.api.pages as Record<string, unknown>).listTranslations,
    ).toBeUndefined();
  });
});

// ============================================================================
// Redirects are language-aware
// ============================================================================

describe('i18n — redirects', () => {
  it('are per-language: same path, different target per language, no language jump', async () => {
    const { cms, setLanguage } = await setupI18nTestCMS();

    setLanguage('en');
    await cms.api.pages.createRedirect({
      body: {
        sourceType: 'path',
        sourcePath: '/pages/old',
        targetType: 'path',
        targetPath: '/pages/new-en',
      },
    });

    // The SAME source path in another language → a DIFFERENT redirect (allowed;
    // before i18n redirect scoping the app-level check rejected this).
    setLanguage('de');
    await expect(
      cms.api.pages.createRedirect({
        body: {
          sourceType: 'path',
          sourcePath: '/pages/old',
          targetType: 'path',
          targetPath: '/pages/new-de',
        },
      }),
    ).resolves.toBeDefined();

    // Each language resolves /pages/old to ITS OWN target (no language jump).
    setLanguage('en');
    expect(
      (await cms.api.pages.resolveRedirect({ query: { path: '/pages/old' } }))
        .redirect,
    ).toEqual({ status: 301, location: '/pages/new-en' });

    setLanguage('de');
    expect(
      (await cms.api.pages.resolveRedirect({ query: { path: '/pages/old' } }))
        .redirect,
    ).toEqual({ status: 301, location: '/pages/new-de' });
  });

  it('auto-created redirects are per-language (a rename in en does not redirect de)', async () => {
    const { cms, setLanguage } = await setupI18nTestCMS();

    setLanguage('en');
    const en = await cms.api.pages.createRoot({
      body: { slug: 'movers', properties: { title: 'M' } },
    });
    // cms-05: publish the live slug, then publish the rename — the auto-redirect
    // (language=en) is created at publish.
    await cms.api.pages.publishBranch({
      body: { rootId: en.rootId, branchId: en.branchId },
    });
    await cms.api.pages.updateRoot({
      body: {
        rootId: en.rootId,
        branchId: en.branchId,
        slug: 'shakers',
        properties: { title: 'M' },
      },
    });
    await cms.api.pages.publishBranch({
      body: { rootId: en.rootId, branchId: en.branchId },
    });

    // en resolves the old path → the new one (auto-created, language=en).
    expect(
      (
        await cms.api.pages.resolveRedirect({
          query: { path: '/pages/movers' },
        })
      ).redirect,
    ).toEqual({ status: 301, location: '/pages/shakers' });

    // de has no such redirect — the auto-redirect is language-scoped to en.
    setLanguage('de');
    expect(
      (
        await cms.api.pages.resolveRedirect({
          query: { path: '/pages/movers' },
        })
      ).redirect,
    ).toBeNull();
  });
});

// ============================================================================
// Composition: i18n + multi-tenant
// ============================================================================

describe('i18n + multiTenant — composition', () => {
  it('stamps both tenant_slug and language on a root', async () => {
    const { cms, db, set } = await setupI18nMultiTenantTestCMS();
    set('acme', 'de');
    const root = await cms.api.pages.createRoot({
      body: { slug: 'p', properties: { title: 'P' } },
    });
    const rows = await db.execute(
      sql`SELECT tenant_slug, language FROM cms.roots WHERE id = ${root.rootId}`,
    );
    expect(rows.rows[0].tenant_slug).toBe('acme');
    expect(rows.rows[0].language).toBe('de');
  });

  it('enforces slug uniqueness per (tenant, language) at PUBLISH — the compound authority', async () => {
    const { cms, set } = await setupI18nMultiTenantTestCMS();

    const publish = (r: { rootId: string; branchId: string }) =>
      cms.api.pages.publishBranch({
        body: { rootId: r.rootId, branchId: r.branchId },
      });

    set('acme', 'en');
    const acmeEn = await cms.api.pages.createRoot({
      body: { slug: 'blog', properties: { title: 'A en' } },
    });
    await publish(acmeEn);

    // Same slug, different language within the tenant → allowed (publishes fine).
    set('acme', 'de');
    const acmeDe = await cms.api.pages.createRoot({
      body: { slug: 'blog', properties: { title: 'A de' } },
    });
    await expect(publish(acmeDe)).resolves.toBeDefined();

    // Same slug + language, different tenant → allowed.
    set('globex', 'en');
    const globexEn = await cms.api.pages.createRoot({
      body: { slug: 'blog', properties: { title: 'G en' } },
    });
    await expect(publish(globexEn)).resolves.toBeDefined();

    // cms-05: same (tenant, language) drafts may coexist, but the SECOND publish
    // into (acme, en) collides.
    set('acme', 'en');
    const acmeEnDup = await cms.api.pages.createRoot({
      body: { slug: 'blog', properties: { title: 'dup' } },
    });
    await expect(publish(acmeEnDup)).rejects.toThrow(
      /PUBLISH_SLUG_CONFLICT|already uses this slug/i,
    );
  });

  it('does not resolve a reference to another tenant’s content (resolution is tenant-scoped)', async () => {
    const { cms, db, set } = await setupI18nMultiTenantTestCMS({
      collections: REF_I18N,
    });

    // globex owns a target entry.
    set('globex', 'en');
    const gTarget = await cms.api.pages.createRoot({
      body: { slug: 'g-target', properties: { title: 'Globex Target' } },
    });
    const tk = await db.execute(
      sql`SELECT translation_key FROM cms.roots WHERE id = ${gTarget.rootId}`,
    );
    const globexKey = (tk.rows[0] as { translation_key: string })
      .translation_key;
    await cms.api.pages.publishBranch({
      body: { rootId: gTarget.rootId, branchId: gTarget.branchId },
    });

    // acme stores references to globex's translationKey AND globex's rootId
    // (an author can store any string in a reference property).
    set('acme', 'en');
    const aSource = await cms.api.pages.createRoot({
      body: { slug: 'a-source', properties: { title: 'Acme Source' } },
    });
    await cms.api.pages.createBlock({
      body: {
        rootId: aSource.rootId,
        branchId: aSource.branchId,
        parentBlockId: aSource.rootId,
        type: 'link',
        properties: { target: globexKey }, // globex's translationKey
      },
    });
    await cms.api.pages.createBlock({
      body: {
        rootId: aSource.rootId,
        branchId: aSource.branchId,
        parentBlockId: aSource.rootId,
        type: 'link',
        properties: { target: gTarget.rootId }, // globex's rootId
      },
    });
    await cms.api.pages.publishBranch({
      body: { rootId: aSource.rootId, branchId: aSource.branchId },
    });

    // acme reads its own page → NEITHER reference resolves to globex's content;
    // each stays the raw string (the remap + loadPublishedRoots are tenant-scoped).
    const pub = await cms.api.pages.getPublishedContent({
      query: { rootId: aSource.rootId },
    });
    const links = pub.variants[0].tree.children.filter(
      (c: { type: string }) => c.type === 'link',
    );
    expect(links).toHaveLength(2);
    for (const link of links) {
      // Cross-tenant: the reference is NOT resolved, so target stays the raw
      // rootId string at runtime — the resolved-mode type says object, hence
      // the unknown bridge. (This test asserts exactly that it stayed a string.)
      expect(
        typeof (link.properties as unknown as { target: string }).target,
      ).toBe('string');
    }
  });

  it('the reference delete guard is tenant-scoped: a cross-tenant host does not block the owner', async () => {
    const { cms, set } = await setupI18nMultiTenantTestCMS({
      collections: REF_I18N,
    });

    // acme owns a reusable block.
    set('acme', 'en');
    const aBlock = await cms.api.pages.createRoot({
      body: { slug: 'a-blk', properties: { title: 'Acme Block' } },
    });

    // globex embeds acme's rootId (an author can store any string as a reference).
    set('globex', 'en');
    const gHost = await cms.api.pages.createRoot({
      body: { slug: 'g-host', properties: { title: 'Globex Host' } },
    });
    await cms.api.pages.createBlock({
      body: {
        rootId: gHost.rootId,
        branchId: gHost.branchId,
        parentBlockId: gHost.rootId,
        type: 'link',
        properties: { target: aBlock.rootId }, // cross-tenant reference
      },
    });

    // acme inspects + deletes its OWN block: the globex host is out of acme's
    // scope, so it neither shows up in usage nor blocks the delete.
    set('acme', 'en');
    const usage = await cms.api.pages.getReferenceUsages({
      query: { rootId: aBlock.rootId },
    });
    expect(usage.pageCount).toBe(0);

    const del = await cms.api.pages.archiveRoot({
      body: { rootId: aBlock.rootId },
    });
    expect(del.rootId).toBe(aBlock.rootId);
  });

  it('the reference delete guard still blocks a same-tenant embed', async () => {
    const { cms, set } = await setupI18nMultiTenantTestCMS({
      collections: REF_I18N,
    });
    set('acme', 'en');
    const aBlock = await cms.api.pages.createRoot({
      body: { slug: 'a-blk', properties: { title: 'Acme Block' } },
    });
    const aHost = await cms.api.pages.createRoot({
      body: { slug: 'a-host', properties: { title: 'Acme Host' } },
    });
    await cms.api.pages.createBlock({
      body: {
        rootId: aHost.rootId,
        branchId: aHost.branchId,
        parentBlockId: aHost.rootId,
        type: 'link',
        properties: { target: aBlock.rootId },
      },
    });

    await expect(
      cms.api.pages.archiveRoot({ body: { rootId: aBlock.rootId } }),
    ).rejects.toThrow(/embedded/i);
  });

  it('counts a same-tenant host in a SIBLING language (cross-scope reads span language under i18n+multiTenant)', async () => {
    // Regression (P5c/D6): the i18n plugin's crossScopeExclude:['language'] must
    // survive the two-factory scope merge in computeScope. With the registered
    // order [multiTenant(), i18n()], multi-tenant (no crossScopeExclude) is the
    // first roots factory and i18n the second — if the merge drops it, every
    // cross-scope read wrongly filters by the active language and misses a
    // same-tenant host living in a SIBLING language. getReferenceUsages must
    // report the DE host even when inspected from EN.
    const { cms, set } = await setupI18nMultiTenantTestCMS({
      collections: REF_I18N,
    });

    set('acme', 'en');
    const aBlock = await cms.api.pages.createRoot({
      body: { slug: 'a-blk', properties: { title: 'Acme Block (EN)' } },
    });

    // Same tenant, DIFFERENT language: a DE host embeds the EN block.
    set('acme', 'de');
    const deHost = await cms.api.pages.createRoot({
      body: { slug: 'de-host', properties: { title: 'Acme Host (DE)' } },
    });
    await cms.api.pages.createBlock({
      body: {
        rootId: deHost.rootId,
        branchId: deHost.branchId,
        parentBlockId: deHost.rootId,
        type: 'link',
        properties: { target: aBlock.rootId },
      },
    });

    // Inspect from EN — the same-tenant DE host must still count.
    set('acme', 'en');
    const usage = await cms.api.pages.getReferenceUsages({
      query: { rootId: aBlock.rootId },
    });
    expect(usage.pageCount).toBe(1);
  });

  it('the asset archive guard is tenant-scoped: a cross-tenant host does not block the owner', async () => {
    const { cms, db, set } = await setupI18nMultiTenantTestCMS();

    // acme owns an asset.
    const assetId = 'ast_aaaaaaaaaaaaaaaaaaaa';
    await db.execute(sql`
      INSERT INTO cms.assets (id, slug, mime_type, size, object_key, status, tenant_slug)
      VALUES (${assetId}, 'acme-img', 'image/png', 100, 'acme-img', 'private', 'acme')
    `);

    // globex embeds acme's asset id — asset ids are author-controlled raw strings
    // in block properties, and the asset row exists, so it IS indexed into
    // content_usages against the globex host root.
    set('globex', 'en');
    const gHost = await cms.api.pages.createRoot({
      body: { slug: 'g-host', properties: { title: 'Globex Host' } },
    });
    await cms.api.pages.createBlock({
      body: {
        rootId: gHost.rootId,
        branchId: gHost.branchId,
        parentBlockId: gHost.rootId,
        type: 'paragraph',
        properties: { text: assetId }, // cross-tenant asset reference
      },
    });

    // acme inspects + archives its OWN asset: the globex host is out of acme's
    // scope, so it neither shows up in usage nor blocks the archive.
    set('acme', 'en');
    const usage = await cms.api.media.getAssetUsages({ query: { assetId } });
    expect(usage.pageCount).toBe(0);

    const res = await cms.api.media.archiveAssets({
      body: { assetIds: [assetId] },
    });
    expect(res.archived).toBe(1);
    expect(res.skipped).toEqual([]);
  });

  it('the asset archive guard still skips a same-tenant embed', async () => {
    const { cms, db, set } = await setupI18nMultiTenantTestCMS();
    set('acme', 'en');

    const assetId = 'ast_bbbbbbbbbbbbbbbbbbbb';
    await db.execute(sql`
      INSERT INTO cms.assets (id, slug, mime_type, size, object_key, status, tenant_slug)
      VALUES (${assetId}, 'acme-img', 'image/png', 100, 'acme-img', 'private', 'acme')
    `);

    const aHost = await cms.api.pages.createRoot({
      body: { slug: 'a-host', properties: { title: 'Acme Host' } },
    });
    await cms.api.pages.createBlock({
      body: {
        rootId: aHost.rootId,
        branchId: aHost.branchId,
        parentBlockId: aHost.rootId,
        type: 'paragraph',
        properties: { text: assetId },
      },
    });

    // Same tenant → the host is in acme's scope, so it both reports usage and
    // skips (protects) the asset on archive.
    const usage = await cms.api.media.getAssetUsages({ query: { assetId } });
    expect(usage.pageCount).toBe(1);

    const res = await cms.api.media.archiveAssets({
      body: { assetIds: [assetId] },
    });
    expect(res.archived).toBe(0);
    expect(res.skipped).toEqual([assetId]);
  });

  it('isolates redirects per (tenant, language)', async () => {
    const { cms, set } = await setupI18nMultiTenantTestCMS();

    set('acme', 'en');
    await cms.api.pages.createRedirect({
      body: {
        sourceType: 'path',
        sourcePath: '/pages/p',
        targetType: 'path',
        targetPath: '/pages/acme-en',
      },
    });
    // The SAME source path is fine in another language AND another tenant.
    set('acme', 'de');
    await cms.api.pages.createRedirect({
      body: {
        sourceType: 'path',
        sourcePath: '/pages/p',
        targetType: 'path',
        targetPath: '/pages/acme-de',
      },
    });
    set('globex', 'en');
    await cms.api.pages.createRedirect({
      body: {
        sourceType: 'path',
        sourcePath: '/pages/p',
        targetType: 'path',
        targetPath: '/pages/globex-en',
      },
    });

    // Each (tenant, language) resolves /pages/p to ITS OWN target.
    const expectLoc = async (loc: string) =>
      expect(
        (await cms.api.pages.resolveRedirect({ query: { path: '/pages/p' } }))
          .redirect,
      ).toEqual({ status: 301, location: loc });
    set('acme', 'en');
    await expectLoc('/pages/acme-en');
    set('acme', 'de');
    await expectLoc('/pages/acme-de');
    set('globex', 'en');
    await expectLoc('/pages/globex-en');
  });

  it('the ancestor walk stays within scope (a corrupted cross-tenant parent is excluded)', async () => {
    const { cms, db, set } = await setupI18nMultiTenantTestCMS({
      collections: NESTED_I18N,
    });
    set('acme', 'en');
    const parent = await cms.api.pages.createRoot({
      body: { slug: 'docs', properties: { title: 'D' } },
    });
    const child = await cms.api.pages.createRoot({
      body: {
        parentRootId: parent.rootId,
        slug: 'guide',
        properties: { title: 'G' },
      },
    });
    await cms.api.pages.publishBranch({
      body: { rootId: child.rootId, branchId: child.branchId },
    });

    // Normally the child has one ancestor (docs).
    const before = await cms.api.pages.getPublishedContent({
      query: { rootId: child.rootId },
    });
    expect(before.ancestors).toHaveLength(1);

    // Corrupt the data: move the parent to another tenant. The acme ancestor walk
    // matches on tenant_slug + language, so it stops at the boundary — the
    // cross-tenant parent's slug never leaks into the path/breadcrumb.
    await db.execute(
      sql`UPDATE cms.roots SET tenant_slug = 'globex' WHERE id = ${parent.rootId}`,
    );
    const after = await cms.api.pages.getPublishedContent({
      query: { rootId: child.rootId },
    });
    expect(after.ancestors).toHaveLength(0);
  });

  it('a page-target moved out of scope does not leak (resolveTarget is scope-gated)', async () => {
    const { cms, db, set } = await setupI18nMultiTenantTestCMS();

    set('acme', 'en');
    const target = await cms.api.pages.createRoot({
      body: { slug: 'tgt', properties: { title: 'T' } },
    });
    await cms.api.pages.publishBranch({
      body: { rootId: target.rootId, branchId: target.branchId },
    });
    await cms.api.pages.createRedirect({
      body: {
        sourceType: 'path',
        sourcePath: '/pages/old',
        targetType: 'page',
        targetRootId: target.rootId,
      },
    });

    // Resolves to the target's current path.
    expect(
      (await cms.api.pages.resolveRedirect({ query: { path: '/pages/old' } }))
        .redirect,
    ).toEqual({ status: 301, location: '/pages/tgt' });

    // Corrupt the data: move the target root to another tenant. The acme redirect
    // row still points at it, but resolveTarget gates the lookup by scope, so the
    // path no longer leaks — the redirect resolves to nothing.
    await db.execute(
      sql`UPDATE cms.roots SET tenant_slug = 'globex' WHERE id = ${target.rootId}`,
    );
    expect(
      (await cms.api.pages.resolveRedirect({ query: { path: '/pages/old' } }))
        .redirect,
    ).toBeNull();
  });

  it('isolates listTranslations across tenants (input gate rejects another tenant)', async () => {
    const { cms, set } = await setupI18nMultiTenantTestCMS();

    // acme builds an entry with en + de translations.
    set('acme', 'en');
    const acme = await cms.api.pages.createRoot({
      body: { slug: 'shared', properties: { title: 'Acme' } },
    });
    await cms.api.pages.createTranslation({
      body: {
        sourceRootId: acme.rootId,
        targetLanguage: 'de',
        targetSlug: 'geteilt',
      },
    });

    // globex cannot list acme's translations — requireRootInScope rejects the
    // input rootId (not in globex's tenant), so the sibling query is never reached.
    set('globex', 'en');
    await expect(
      cms.api.pages.listTranslations({ query: { rootId: acme.rootId } }),
    ).rejects.toThrow();

    // acme lists its own two translations.
    set('acme', 'en');
    const res = await cms.api.pages.listTranslations({
      query: { rootId: acme.rootId },
    });
    expect(res.translations).toHaveLength(2);
    expect(
      res.translations.map((t: { language: string }) => t.language).sort(),
    ).toEqual(['de', 'en']);
  });
});

// ============================================================================
// Language-aware references (I5)
// ============================================================================

describe('i18n — language-aware references', () => {
  it('resolves a translationKey reference to the active-language sibling (and copied refs follow)', async () => {
    const { cms, db, setLanguage } = await setupI18nTestCMS({
      collections: REF_I18N,
    });

    // Target entry in en + de (siblings sharing one translationKey).
    setLanguage('en');
    const enTarget = await cms.api.pages.createRoot({
      body: { slug: 'target-en', properties: { title: 'Target EN' } },
    });
    const tk = await db.execute(
      sql`SELECT translation_key FROM cms.roots WHERE id = ${enTarget.rootId}`,
    );
    const targetKey = (tk.rows[0] as { translation_key: string })
      .translation_key;
    const deTarget = await cms.api.pages.createTranslation({
      body: {
        sourceRootId: enTarget.rootId,
        targetLanguage: 'de',
        targetSlug: 'target-de',
      },
    });

    // Source page (en) with a link block referencing the target BY translationKey.
    const enSource = await cms.api.pages.createRoot({
      body: { slug: 'source-en', properties: { title: 'Source EN' } },
    });
    await cms.api.pages.createBlock({
      body: {
        rootId: enSource.rootId,
        branchId: enSource.branchId,
        parentBlockId: enSource.rootId,
        type: 'link',
        properties: { target: targetKey },
      },
    });
    // de source via createTranslation — copies the link block (and its
    // translationKey reference) verbatim.
    const deSource = await cms.api.pages.createTranslation({
      body: {
        sourceRootId: enSource.rootId,
        targetLanguage: 'de',
        targetSlug: 'source-de',
      },
    });

    // Publish all four (each in its own language context).
    setLanguage('en');
    await cms.api.pages.publishBranch({
      body: { rootId: enTarget.rootId, branchId: enTarget.branchId },
    });
    await cms.api.pages.publishBranch({
      body: { rootId: enSource.rootId, branchId: enSource.branchId },
    });
    setLanguage('de');
    await cms.api.pages.publishBranch({
      body: { rootId: deTarget.rootId, branchId: deTarget.branchId },
    });
    await cms.api.pages.publishBranch({
      body: { rootId: deSource.rootId, branchId: deSource.branchId },
    });

    // en source read in en → the reference resolves to the EN target.
    setLanguage('en');
    const enPub = await cms.api.pages.getPublishedContent({
      query: { rootId: enSource.rootId },
    });
    const enLink = enPub.variants[0].tree.children.find(
      (c: { type: string }) => c.type === 'link',
    );
    expect(
      (enLink!.properties as { target: { rootId: string } }).target.rootId,
    ).toBe(enTarget.rootId);

    // de source read in de → the SAME stored translationKey resolves to the DE
    // target (a link never jumps languages).
    setLanguage('de');
    const dePub = await cms.api.pages.getPublishedContent({
      query: { rootId: deSource.rootId },
    });
    const deLink = dePub.variants[0].tree.children.find(
      (c: { type: string }) => c.type === 'link',
    );
    expect(
      (deLink!.properties as { target: { rootId: string } }).target.rootId,
    ).toBe(deTarget.rootId);
  });

  // Helper: target has en + de (no fr); a fr page references it; returns the
  // resolved rootId when read in fr.
  async function resolveFrRef(setup: {
    cms: { api: { pages: Record<string, (...a: unknown[]) => Promise<any>> } };
    db: {
      execute: (
        q: unknown,
      ) => Promise<{ rows: Array<{ translation_key: string }> }>;
    };
    setLanguage: (l: string) => void;
  }): Promise<string> {
    const { cms, db, setLanguage } = setup;
    setLanguage('en');
    const enTarget = await cms.api.pages.createRoot({
      body: { slug: 'tgt-en', properties: { title: 'T EN' } },
    });
    const tk = await db.execute(
      sql`SELECT translation_key FROM cms.roots WHERE id = ${enTarget.rootId}`,
    );
    const targetKey = tk.rows[0].translation_key;
    await cms.api.pages.createTranslation({
      body: {
        sourceRootId: enTarget.rootId,
        targetLanguage: 'de',
        targetSlug: 'tgt-de',
      },
    });

    setLanguage('fr');
    const frSource = await cms.api.pages.createRoot({
      body: { slug: 'src-fr', properties: { title: 'S FR' } },
    });
    await cms.api.pages.createBlock({
      body: {
        rootId: frSource.rootId,
        branchId: frSource.branchId,
        parentBlockId: frSource.rootId,
        type: 'link',
        properties: { target: targetKey },
      },
    });
    setLanguage('en');
    await cms.api.pages.publishBranch({
      body: { rootId: enTarget.rootId, branchId: enTarget.branchId },
    });
    // also publish the de target so it's resolvable when the chain prefers de
    const de = await db.execute(
      sql`SELECT id FROM cms.roots WHERE translation_key = ${targetKey} AND language = 'de'`,
    );
    const deId = (de.rows[0] as unknown as { id: string }).id;
    setLanguage('de');
    const deBranch = await db.execute(
      sql`SELECT id FROM cms.branches WHERE root_id = ${deId} AND name = 'main'`,
    );
    await cms.api.pages.publishBranch({
      body: {
        rootId: deId,
        branchId: (deBranch.rows[0] as unknown as { id: string }).id,
      },
    });
    setLanguage('fr');
    await cms.api.pages.publishBranch({
      body: { rootId: frSource.rootId, branchId: frSource.branchId },
    });
    const pub = await cms.api.pages.getPublishedContent({
      query: { rootId: frSource.rootId },
    });
    const link = pub.variants[0].tree.children.find(
      (c: { type: string }) => c.type === 'link',
    );
    return (link.properties.target as { rootId: string }).rootId;
  }

  it('falls back to defaultLanguage when the active-language sibling is missing', async () => {
    const setup = await setupI18nTestCMS({ collections: REF_I18N });
    const resolved = await resolveFrRef(setup as never);
    // fr has no target sibling → default chain [fr, en] → en target.
    const enRow = await setup.db.execute(
      sql`SELECT id FROM cms.roots WHERE language = 'en' AND slug = 'tgt-en'`,
    );
    expect(resolved).toBe((enRow.rows[0] as unknown as { id: string }).id);
  });

  it('uses an explicit per-language fallback chain (fr → de → en)', async () => {
    const setup = await setupI18nTestCMS({
      collections: REF_I18N,
      fallback: { fr: ['de', 'en'] },
    });
    const resolved = await resolveFrRef(setup as never);
    // chain [fr, de, en]; fr missing → de preferred over en.
    const deRow = await setup.db.execute(
      sql`SELECT id FROM cms.roots WHERE language = 'de' AND slug = 'tgt-de'`,
    );
    expect(resolved).toBe((deRow.rows[0] as unknown as { id: string }).id);
  });

  it('an explicit empty fallback [] opts out (missing translation stays unresolved)', async () => {
    const setup = await setupI18nTestCMS({
      collections: REF_I18N,
      fallback: { fr: [] },
    });
    const resolved = await resolveFrRef(setup as never);
    // fr:[] disables fallback; fr has no target sibling → the ref is left as the
    // raw translationKey string, so the resolved object's rootId is undefined.
    expect(resolved).toBeUndefined();
  });

  it('rejects a fallback config that references an unknown language', async () => {
    await expect(
      setupI18nTestCMS({ fallback: { de: ['xx'] } }),
    ).rejects.toThrow(/fallback/i);
  });
});

// ============================================================================
// Reference usage is group-level across language siblings (RB2)
// ============================================================================

describe('i18n — reference usage is group-level (RB2)', () => {
  it('getReferenceUsages aggregates across language siblings (any sibling sees the whole group)', async () => {
    const { cms, db, setLanguage } = await setupI18nTestCMS({
      collections: REF_I18N,
    });

    // A reusable target with en + de siblings in one translation group.
    setLanguage('en');
    const enTarget = await cms.api.pages.createRoot({
      body: { slug: 'tgt-en', properties: { title: 'T EN' } },
    });
    await cms.api.pages.createTranslation({
      body: {
        sourceRootId: enTarget.rootId,
        targetLanguage: 'de',
        targetSlug: 'tgt-de',
      },
    });
    const deRow = await db.execute(sql`
      SELECT id FROM cms.roots
      WHERE translation_key = (
        SELECT translation_key FROM cms.roots WHERE id = ${enTarget.rootId}
      )
        AND language = 'de'
    `);
    const deTargetId = (deRow.rows[0] as unknown as { id: string }).id;

    // en host embeds the en sibling (anchor rootId); de host embeds the de sibling.
    setLanguage('en');
    const enHost = await cms.api.pages.createRoot({
      body: { slug: 'host-en', properties: { title: 'H EN' } },
    });
    await cms.api.pages.createBlock({
      body: {
        rootId: enHost.rootId,
        branchId: enHost.branchId,
        parentBlockId: enHost.rootId,
        type: 'link',
        properties: { target: enTarget.rootId },
      },
    });

    setLanguage('de');
    const deHost = await cms.api.pages.createRoot({
      body: { slug: 'host-de', properties: { title: 'H DE' } },
    });
    await cms.api.pages.createBlock({
      body: {
        rootId: deHost.rootId,
        branchId: deHost.branchId,
        parentBlockId: deHost.rootId,
        type: 'link',
        properties: { target: deTargetId },
      },
    });

    // Inspecting the EN sibling: the group expands to {en, de} → BOTH hosts.
    setLanguage('en');
    const enUsage = await cms.api.pages.getReferenceUsages({
      query: { rootId: enTarget.rootId },
    });
    expect(enUsage.pageCount).toBe(2);

    // Inspecting the DE sibling reports the SAME group-level count (not just its
    // own host) — the property RB2's query-time group expansion exists to deliver.
    setLanguage('de');
    const deUsage = await cms.api.pages.getReferenceUsages({
      query: { rootId: deTargetId },
    });
    expect(deUsage.pageCount).toBe(2);
  });
});

// ============================================================================
// RB3 — a rot_ embed auto-upgrades to the active-language sibling (else anchor)
// ============================================================================

describe('i18n — reference auto-upgrade (RB3)', () => {
  // Builds an en target with an optional de translation, an en host embedding the
  // en anchor (rot_), translates the host to de (the ref is copied verbatim), and
  // publishes everything needed. Returns the resolved target rootId when the de
  // host is read in `de`.
  async function readDeHostTarget(opts: { translateBlock: boolean }) {
    const { cms, db, setLanguage } = await setupI18nTestCMS({
      collections: REF_I18N,
    });
    const idOf = async (tk: string, lang: string) =>
      (
        (await db.execute(
          sql`SELECT id FROM cms.roots WHERE translation_key = ${tk} AND language = ${lang}`,
        )) as { rows: Array<Record<string, string>> }
      ).rows[0].id;
    const branchOf = async (rootId: string) =>
      (
        (await db.execute(
          sql`SELECT id FROM cms.branches WHERE root_id = ${rootId} AND name = 'main'`,
        )) as { rows: Array<Record<string, string>> }
      ).rows[0].id;

    setLanguage('en');
    const enBlock = await cms.api.pages.createRoot({
      body: { slug: 'blk-en', properties: { title: 'Block EN' } },
    });
    const blockKey = (
      (await db.execute(
        sql`SELECT translation_key FROM cms.roots WHERE id = ${enBlock.rootId}`,
      )) as { rows: Array<Record<string, string>> }
    ).rows[0].translation_key;
    if (opts.translateBlock) {
      await cms.api.pages.createTranslation({
        body: {
          sourceRootId: enBlock.rootId,
          targetLanguage: 'de',
          targetSlug: 'blk-de',
        },
      });
    }

    const enHost = await cms.api.pages.createRoot({
      body: { slug: 'host-en', properties: { title: 'Host EN' } },
    });
    await cms.api.pages.createBlock({
      body: {
        rootId: enHost.rootId,
        branchId: enHost.branchId,
        parentBlockId: enHost.rootId,
        type: 'link',
        properties: { target: enBlock.rootId }, // store the ANCHOR rootId
      },
    });
    const hostKey = (
      (await db.execute(
        sql`SELECT translation_key FROM cms.roots WHERE id = ${enHost.rootId}`,
      )) as { rows: Array<Record<string, string>> }
    ).rows[0].translation_key;
    await cms.api.pages.createTranslation({
      body: {
        sourceRootId: enHost.rootId,
        targetLanguage: 'de',
        targetSlug: 'host-de',
      },
    });
    const deHostId = await idOf(hostKey, 'de');

    // Publish the en block (anchor), the de host, and the de block if it exists.
    setLanguage('en');
    await cms.api.pages.publishBranch({
      body: { rootId: enBlock.rootId, branchId: enBlock.branchId },
    });
    if (opts.translateBlock) {
      const deBlockId = await idOf(blockKey, 'de');
      setLanguage('de');
      await cms.api.pages.publishBranch({
        body: { rootId: deBlockId, branchId: await branchOf(deBlockId) },
      });
    }
    setLanguage('de');
    await cms.api.pages.publishBranch({
      body: { rootId: deHostId, branchId: await branchOf(deHostId) },
    });

    const read = await cms.api.pages.getPublishedContent({
      query: { rootId: deHostId },
    });
    const link = read.variants[0].tree.children.find(
      (c: { type: string }) => c.type === 'link',
    );
    return {
      resolved: (link!.properties as { target: { rootId: string } }).target
        .rootId,
      enBlockId: enBlock.rootId,
      deBlockId: opts.translateBlock ? await idOf(blockKey, 'de') : null,
    };
  }

  it('upgrades a rot_ embed to the active-language sibling when one exists', async () => {
    const { resolved, deBlockId } = await readDeHostTarget({
      translateBlock: true,
    });
    expect(resolved).toBe(deBlockId);
  });

  it('falls back to the stored anchor when no active-language sibling exists', async () => {
    const { resolved, enBlockId } = await readDeHostTarget({
      translateBlock: false,
    });
    expect(resolved).toBe(enBlockId);
  });

  it('throws REFERENCE_DEPTH_EXCEEDED on a reference chain deeper than the cap', async () => {
    const { cms, setLanguage } = await setupI18nTestCMS({
      collections: REF_I18N,
    });
    setLanguage('en');

    const DEPTH = 22; // > MAX_REFERENCE_DEPTH (20)
    const ids: string[] = [];
    const branchOf: Record<string, string> = {};
    for (let i = 0; i < DEPTH; i++) {
      const p = await cms.api.pages.createRoot({
        body: { slug: `chain-${i}`, properties: { title: `C${i}` } },
      });
      ids.push(p.rootId);
      branchOf[p.rootId] = p.branchId;
    }
    // page[i] embeds page[i+1] → a long ACYCLIC chain (the visited-set cycle guard
    // does not catch this; only the depth cap does).
    for (let i = 0; i < DEPTH - 1; i++) {
      await cms.api.pages.createBlock({
        body: {
          rootId: ids[i],
          branchId: branchOf[ids[i]],
          parentBlockId: ids[i],
          type: 'link',
          properties: { target: ids[i + 1] },
        },
      });
    }
    for (const id of ids) {
      await cms.api.pages.publishBranch({
        body: { rootId: id, branchId: branchOf[id] },
      });
    }

    await expect(
      cms.api.pages.getPublishedContent({ query: { rootId: ids[0] } }),
    ).rejects.toThrow(/too deep/i);
  });
});

// ============================================================================
// RB4 — the delete guard is ANCHOR-only across language siblings
// ============================================================================

describe('i18n — delete guard is anchor-only (RB4)', () => {
  it('allows deleting a translation sibling but blocks deleting the referenced anchor', async () => {
    const { cms, db, setLanguage } = await setupI18nTestCMS({
      collections: REF_I18N,
    });

    setLanguage('en');
    const enBlock = await cms.api.pages.createRoot({
      body: { slug: 'blk-en', properties: { title: 'B EN' } },
    });
    await cms.api.pages.createTranslation({
      body: {
        sourceRootId: enBlock.rootId,
        targetLanguage: 'de',
        targetSlug: 'blk-de',
      },
    });
    const deBlockId = (
      (await db.execute(sql`
        SELECT id FROM cms.roots
        WHERE translation_key = (
          SELECT translation_key FROM cms.roots WHERE id = ${enBlock.rootId}
        ) AND language = 'de'
      `)) as { rows: Array<{ id: string }> }
    ).rows[0].id;

    // A host embeds the EN anchor (rot_).
    const host = await cms.api.pages.createRoot({
      body: { slug: 'host-en', properties: { title: 'H' } },
    });
    await cms.api.pages.createBlock({
      body: {
        rootId: host.rootId,
        branchId: host.branchId,
        parentBlockId: host.rootId,
        type: 'link',
        properties: { target: enBlock.rootId },
      },
    });

    // The DE sibling is not a stored anchor → deletable (hosts fall back to en).
    setLanguage('de');
    const delDe = await cms.api.pages.archiveRoot({
      body: { rootId: deBlockId },
    });
    expect(delDe.rootId).toBe(deBlockId);

    // The EN anchor IS the directly-referenced value → blocked.
    setLanguage('en');
    await expect(
      cms.api.pages.archiveRoot({ body: { rootId: enBlock.rootId } }),
    ).rejects.toThrow(/embedded/i);
  });
});

// ============================================================================
// Config / middleware guards
// ============================================================================

describe('i18n — config & middleware guards', () => {
  it('throws LANGUAGE_REQUIRED when the middleware provides no language', async () => {
    const { cms } = await setupI18nTestCMS({
      authMiddleware: async () => ({}),
    });
    await expect(
      cms.api.pages.createRoot({
        body: { slug: 'x', properties: { title: 'X' } },
      }),
    ).rejects.toThrow(/language is required/i);
  });

  it('throws LANGUAGE_NOT_ENABLED for a language outside the configured universe', async () => {
    const { cms, setLanguage } = await setupI18nTestCMS();
    setLanguage('xx');
    await expect(
      cms.api.pages.createRoot({
        body: { slug: 'x', properties: { title: 'X' } },
      }),
    ).rejects.toThrow(/not one of the configured/i);
  });

  it('rejects a defaultLanguage outside languages at construction', async () => {
    await expect(
      setupI18nTestCMS({
        languages: ['en', 'de'] as const,
        defaultLanguage: 'fr',
      }),
    ).rejects.toThrow(/defaultLanguage/i);
  });
});

describe('i18n — templates are per-language', () => {
  it('isolates template CRUD per language (same key allowed in each)', async () => {
    const { cms, setLanguage } = await setupI18nTestCMS();

    setLanguage('en');
    await cms.api.templates.createTemplate({
      body: {
        collection: 'pages',
        blockType: 'signupForm',
        propertyKey: 'trackingId',
        template: 'EN-DEFAULT',
      },
    });

    // Same (collection, blockType, propertyKey) in another language is NOT a
    // duplicate — uniqueness is per-language.
    setLanguage('de');
    await cms.api.templates.createTemplate({
      body: {
        collection: 'pages',
        blockType: 'signupForm',
        propertyKey: 'trackingId',
        template: 'DE-DEFAULT',
      },
    });

    // Each language sees only its own templates.
    setLanguage('en');
    const en = await cms.api.templates.list({});
    expect(en.templates).toHaveLength(1);
    expect(en.templates[0].template).toBe('EN-DEFAULT');

    setLanguage('de');
    const de = await cms.api.templates.list({});
    expect(de.templates).toHaveLength(1);
    expect(de.templates[0].template).toBe('DE-DEFAULT');

    // But a real duplicate within the SAME language is still rejected.
    await expect(
      cms.api.templates.createTemplate({
        body: {
          collection: 'pages',
          blockType: 'signupForm',
          propertyKey: 'trackingId',
          template: 'DE-AGAIN',
        },
      }),
    ).rejects.toThrow();
  });

  it('createBlock applies the active language template', async () => {
    const { cms, setLanguage } = await setupI18nTestCMS();

    setLanguage('en');
    await cms.api.templates.createTemplate({
      body: {
        collection: 'pages',
        blockType: 'signupForm',
        propertyKey: 'trackingId',
        template: 'EN-DEFAULT',
      },
    });
    setLanguage('de');
    await cms.api.templates.createTemplate({
      body: {
        collection: 'pages',
        blockType: 'signupForm',
        propertyKey: 'trackingId',
        template: 'DE-DEFAULT',
      },
    });

    const trackingIdOf = async (lang: string) => {
      setLanguage(lang);
      const root = await cms.api.pages.createRoot({
        body: { slug: `/${lang}`, properties: { title: 'Home' } },
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
      return (tree.tree.children[0]?.properties as { trackingId?: unknown })
        ?.trackingId;
    };

    expect(await trackingIdOf('en')).toBe('EN-DEFAULT');
    expect(await trackingIdOf('de')).toBe('DE-DEFAULT');
  });

  it('scopes templates by tenant AND language together (both plugins)', async () => {
    const { cms, set } = await setupI18nMultiTenantTestCMS();

    const make = (template: string) =>
      cms.api.templates.createTemplate({
        body: {
          collection: 'pages',
          blockType: 'signupForm',
          propertyKey: 'trackingId',
          template,
        },
      });

    set('acme', 'de');
    await make('ACME-DE');
    // Same key in a different (tenant, language) cell is not a duplicate.
    set('acme', 'en');
    await make('ACME-EN');
    set('globex', 'de');
    await make('GLOBEX-DE');

    const only = async (tenant: string, lang: string, expected: string) => {
      set(tenant, lang);
      const { templates } = await cms.api.templates.list({});
      expect(templates).toHaveLength(1);
      expect(templates[0].template).toBe(expected);
    };
    await only('acme', 'de', 'ACME-DE');
    await only('acme', 'en', 'ACME-EN');
    await only('globex', 'de', 'GLOBEX-DE');

    // The (globex, en) cell has none.
    set('globex', 'en');
    const { templates: none } = await cms.api.templates.list({});
    expect(none).toHaveLength(0);
  });
});

describe('i18n — variables resolve with language fallback', () => {
  it('uses the active-language value, falling back through the chain', async () => {
    const { cms, setLanguage } = await setupI18nTestCMS();

    // companyName only in the default language 'en'; cta has a 'de' override.
    setLanguage('en');
    await cms.api.variables.createVariable({
      body: { key: 'companyName', value: 'Acme' },
    });
    await cms.api.variables.createVariable({
      body: { key: 'cta', value: 'Buy now' },
    });
    setLanguage('de');
    // Same key, different language cell → not a duplicate.
    await cms.api.variables.createVariable({
      body: { key: 'cta', value: 'Jetzt kaufen' },
    });

    // A German page referencing both variables.
    const root = await cms.api.pages.createRoot({
      body: { slug: '/de', properties: { title: 'Home' } },
    });
    await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: '{{companyName}} — {{cta}}' },
      },
    });
    const tree = await cms.api.pages.getBlockTree({
      query: { rootId: root.rootId, branchId: root.branchId },
    });
    // companyName falls back to 'en' (Acme); cta uses the 'de' override.
    expect((tree.tree.children[0].properties as { text: string }).text).toBe(
      'Acme — Jetzt kaufen',
    );
  });

  it('manages the exact active-language cell (no fallback in CRUD)', async () => {
    const { cms, setLanguage } = await setupI18nTestCMS();
    setLanguage('en');
    await cms.api.variables.createVariable({
      body: { key: 'companyName', value: 'Acme' },
    });

    // In 'de', the management view shows only the 'de' cell — companyName (en
    // only) is NOT listed even though content would fall back to it.
    setLanguage('de');
    const { variables: deVars } = await cms.api.variables.list({});
    expect(deVars).toHaveLength(0);

    // Creating companyName in 'de' is allowed (different cell) and wins for de.
    await cms.api.variables.createVariable({
      body: { key: 'companyName', value: 'Acme DE' },
    });
    const { variable } = await cms.api.variables.getVariable({
      query: { key: 'companyName' },
    });
    expect(variable.value).toBe('Acme DE');
  });
});
