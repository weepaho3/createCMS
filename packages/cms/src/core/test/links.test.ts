import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { allowAnonymous, createCMS } from '../../index';
import { contentUsages } from '../../schema';
import { setupTestDB } from '../../test-utils/db';
import { DUMMY_MEDIA_CONFIG } from '../../test-utils/fixtures';

async function setupLinkCMS() {
  const { db } = await setupTestDB();
  const cms = createCMS({
    db,
    authMiddleware: allowAnonymous(),
    media: { ...DUMMY_MEDIA_CONFIG },
    collections: {
      pages: {
        label: 'Pages',
        slug: { enabled: true, prefix: '/pages' },
        root: {
          properties: {
            title: { type: 'string', label: 'Title', required: true },
          },
        },
        blocks: {
          cta: {
            label: 'CTA',
            properties: {
              link: { type: 'link', label: 'Link' },
            },
          },
        },
      },
    },
  });
  return { cms: cms as { api: any }, db };
}

async function linkOf(
  cms: { api: any },
  rootId: string,
  branchId: string,
  raw: boolean,
): Promise<any> {
  const tree = await cms.api.pages.getBlockTree({
    query: { rootId, branchId, raw },
  });
  return tree.tree.children[0]?.properties?.link;
}

describe('link property type', () => {
  it('resolves an internal link to the target current path (raw keeps the target)', async () => {
    const { cms } = await setupLinkCMS();

    const about = await cms.api.pages.createRoot({
      body: { slug: 'about', properties: { title: 'About' } },
    });
    // Internal links resolve to the target's PUBLISHED path.
    await cms.api.pages.publishBranch({
      body: { rootId: about.rootId, branchId: about.branchId },
    });
    const home = await cms.api.pages.createRoot({
      body: { slug: 'home', properties: { title: 'Home' } },
    });
    await cms.api.pages.createBlock({
      body: {
        rootId: home.rootId,
        branchId: home.branchId,
        parentBlockId: home.rootId,
        type: 'cta',
        properties: {
          link: { kind: 'internal', rootId: about.rootId, collection: 'pages' },
        },
      },
    });

    // raw:false → resolved to the current path.
    expect(await linkOf(cms, home.rootId, home.branchId, false)).toEqual({
      kind: 'internal',
      targetRootId: about.rootId,
      collection: 'pages',
      href: '/pages/about',
    });

    // raw:true → the stored target (editable, survives renames).
    expect(await linkOf(cms, home.rootId, home.branchId, true)).toEqual({
      kind: 'internal',
      rootId: about.rootId,
      collection: 'pages',
    });
  });

  it('follows the target slug when it changes, but only once published', async () => {
    const { cms } = await setupLinkCMS();
    const about = await cms.api.pages.createRoot({
      body: { slug: 'about', properties: { title: 'About' } },
    });
    await cms.api.pages.publishBranch({
      body: { rootId: about.rootId, branchId: about.branchId },
    });
    const home = await cms.api.pages.createRoot({
      body: { slug: 'home', properties: { title: 'Home' } },
    });
    await cms.api.pages.createBlock({
      body: {
        rootId: home.rootId,
        branchId: home.branchId,
        parentBlockId: home.rootId,
        type: 'cta',
        properties: {
          link: { kind: 'internal', rootId: about.rootId, collection: 'pages' },
        },
      },
    });

    // A DRAFT slug edit does NOT change the resolved href.
    await cms.api.pages.updateRoot({
      body: {
        rootId: about.rootId,
        branchId: about.branchId,
        slug: 'about-us',
        properties: { title: 'About' },
      },
    });
    expect((await linkOf(cms, home.rootId, home.branchId, false)).href).toBe(
      '/pages/about',
    );

    // Publishing the rename moves the live URL, and the link follows it.
    await cms.api.pages.publishBranch({
      body: { rootId: about.rootId, branchId: about.branchId },
    });
    expect((await linkOf(cms, home.rootId, home.branchId, false)).href).toBe(
      '/pages/about-us',
    );
  });

  it('normalises external / email / phone to an href', async () => {
    const { cms } = await setupLinkCMS();
    const page = await cms.api.pages.createRoot({
      body: { slug: 'p', properties: { title: 'P' } },
    });

    const make = async (link: unknown) => {
      const p = await cms.api.pages.createRoot({
        body: {
          slug: `p-${Math.random().toString(36).slice(2)}`,
          properties: { title: 'P' },
        },
      });
      await cms.api.pages.createBlock({
        body: {
          rootId: p.rootId,
          branchId: p.branchId,
          parentBlockId: p.rootId,
          type: 'cta',
          properties: { link },
        },
      });
      return linkOf(cms, p.rootId, p.branchId, false);
    };

    expect(
      await make({ kind: 'external', url: 'https://example.com' }),
    ).toEqual({ kind: 'external', href: 'https://example.com' });
    expect(await make({ kind: 'email', email: 'a@b.com' })).toEqual({
      kind: 'email',
      href: 'mailto:a@b.com',
    });
    expect(await make({ kind: 'phone', phone: '+15551234' })).toEqual({
      kind: 'phone',
      href: 'tel:+15551234',
    });
    void page;
  });

  it('resolves a missing target to href null (renderer disables it)', async () => {
    const { cms } = await setupLinkCMS();
    const home = await cms.api.pages.createRoot({
      body: { slug: 'home', properties: { title: 'Home' } },
    });
    await cms.api.pages.createBlock({
      body: {
        rootId: home.rootId,
        branchId: home.branchId,
        parentBlockId: home.rootId,
        type: 'cta',
        properties: {
          link: {
            kind: 'internal',
            rootId: 'rot_missing',
            collection: 'pages',
          },
        },
      },
    });

    const link = await linkOf(cms, home.rootId, home.branchId, false);
    expect(link.kind).toBe('internal');
    expect(link.href).toBeNull();
  });

  it('indexes an internal link target in contentUsages (targetKind link)', async () => {
    const { cms, db } = await setupLinkCMS();
    const about = await cms.api.pages.createRoot({
      body: { slug: 'about', properties: { title: 'About' } },
    });
    const home = await cms.api.pages.createRoot({
      body: { slug: 'home', properties: { title: 'Home' } },
    });
    await cms.api.pages.createBlock({
      body: {
        rootId: home.rootId,
        branchId: home.branchId,
        parentBlockId: home.rootId,
        type: 'cta',
        properties: {
          link: { kind: 'internal', rootId: about.rootId, collection: 'pages' },
        },
      },
    });

    const rows = await db
      .select()
      .from(contentUsages)
      .where(
        and(
          eq(contentUsages.targetKind, 'link'),
          eq(contentUsages.targetKey, about.rootId),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0].rootId).toBe(home.rootId);
    expect(rows[0].propertyKey).toBe('link');
  });
});

// ============================================================================
// Links INSIDE an embedded reusable block (inlined reference)
// ============================================================================

async function publishBranch(
  api: any,
  input: { rootId: string; branchId: string },
): Promise<void> {
  const request = await api.requestApproval({
    body: {
      branchId: input.branchId,
      requestedReviewers: ['reviewer-1'],
    },
    context: { userId: 'requester-1' },
  });
  await api.submitApproval({
    body: { approvalId: request.approvals[0].id },
    context: { userId: 'reviewer-1' },
  });
  await api.publishBranch({ body: input });
}

async function setupRefLinkCMS() {
  const { db } = await setupTestDB();
  const cms = createCMS({
    db,
    authMiddleware: allowAnonymous(),
    media: { ...DUMMY_MEDIA_CONFIG },
    collections: {
      // Reusable blocks have NO slug; their links target the slugged `pages`.
      reusableBlocks: {
        label: 'Reusable Blocks',
        root: {
          properties: {
            label: { type: 'string', label: 'Label', required: true },
          },
        },
        blocks: {
          cta: {
            label: 'CTA',
            properties: { link: { type: 'link', label: 'Link' } },
          },
        },
      },
      pages: {
        label: 'Pages',
        slug: { enabled: true, prefix: '/pages' },
        root: {
          properties: {
            title: { type: 'string', label: 'Title', required: true },
          },
        },
        blocks: {
          embed: {
            label: 'Embed',
            properties: {
              block: {
                type: 'reference',
                collection: 'reusableBlocks',
                label: 'Block',
                required: true,
              },
            },
          },
        },
      },
    },
  });
  return { cms: cms as { api: any }, db };
}

/** A reusable block whose CTA links to `about`, published; a `home` page embeds it. */
async function seedEmbeddedLink(cms: { api: any }) {
  const about = await cms.api.pages.createRoot({
    body: { slug: 'about', properties: { title: 'About' } },
  });
  // The link target resolves to its PUBLISHED path, so publish `about`.
  await publishBranch(cms.api.pages, {
    rootId: about.rootId,
    branchId: about.branchId,
  });
  const reusable = await cms.api.reusableBlocks.createRoot({
    body: { properties: { label: 'Footer CTA' } },
  });
  await cms.api.reusableBlocks.createBlock({
    body: {
      rootId: reusable.rootId,
      branchId: reusable.branchId,
      parentBlockId: reusable.rootId,
      type: 'cta',
      properties: {
        link: { kind: 'internal', rootId: about.rootId, collection: 'pages' },
      },
    },
  });
  await publishBranch(cms.api.reusableBlocks, {
    rootId: reusable.rootId,
    branchId: reusable.branchId,
  });

  const home = await cms.api.pages.createRoot({
    body: { slug: 'home', properties: { title: 'Home' } },
  });
  await cms.api.pages.createBlock({
    body: {
      rootId: home.rootId,
      branchId: home.branchId,
      parentBlockId: home.rootId,
      type: 'embed',
      properties: { block: reusable.rootId },
    },
  });
  return { about, reusable, home };
}

describe('link inside an embedded reference', () => {
  it('resolves links in a reusable-block preview (getBlockTree includeReferencePreviews)', async () => {
    const { cms } = await setupRefLinkCMS();
    const { about, reusable, home } = await seedEmbeddedLink(cms);

    const result = await cms.api.pages.getBlockTree({
      query: {
        rootId: home.rootId,
        branchId: home.branchId,
        raw: true,
        includeReferencePreviews: true,
      },
    });

    const preview = result.references?.[reusable.rootId];
    expect(preview).toBeDefined();
    expect(preview.children[0].properties.link).toEqual({
      kind: 'internal',
      targetRootId: about.rootId,
      collection: 'pages',
      href: '/pages/about',
    });
  });

  it('resolves links inside an inlined reference (getPublishedContent)', async () => {
    const { cms } = await setupRefLinkCMS();
    const { about, home } = await seedEmbeddedLink(cms);
    await publishBranch(cms.api.pages, {
      rootId: home.rootId,
      branchId: home.branchId,
    });

    const result = await cms.api.pages.getPublishedContent({
      query: { rootId: home.rootId },
    });

    // The embed's reference is inlined; the link inside it is resolved too.
    const inlined = result.variants[0].tree.children[0].properties.block;
    expect(inlined.tree.children[0].properties.link).toEqual({
      kind: 'internal',
      targetRootId: about.rootId,
      collection: 'pages',
      href: '/pages/about',
    });
  });
});
