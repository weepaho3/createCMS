import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { createCMS } from '../src/index';
import { assets } from '../src/schema';
import { setupTestDB } from './utils/db';
import { DUMMY_MEDIA_CONFIG } from './utils/fixtures';

async function setupImageCMS() {
  const { db } = await setupTestDB();
  const cms = createCMS({
    db,
    media: { ...DUMMY_MEDIA_CONFIG },
    collections: {
      pages: {
        label: 'Pages',
        slug: { enabled: true, root: '/pages' },
        root: {
          properties: {
            title: { type: 'string', label: 'Title', required: true },
          },
        },
        blocks: {
          hero: {
            label: 'Hero',
            properties: {
              image: { type: 'image', label: 'Image' },
            },
          },
        },
      },
    },
  });
  return { cms: cms as { api: any }, db };
}

async function insertAsset(
  db: any,
  slug: string,
): Promise<{ id: string; slug: string }> {
  const [row] = await db
    .insert(assets)
    .values({
      slug,
      mimeType: 'image/png',
      size: 1024,
      objectKey: slug,
      status: 'public',
    })
    .returning({ id: assets.id, slug: assets.slug });
  return row;
}

async function imageOf(
  cms: { api: any },
  rootId: string,
  branchId: string,
  raw: boolean,
): Promise<any> {
  const tree = await cms.api.pages.getBlockTree({
    query: { rootId, branchId, raw },
  });
  return tree.tree.children[0]?.properties?.image;
}

async function pageWithImage(
  cms: { api: any },
  imageValue: string,
): Promise<{ rootId: string; branchId: string }> {
  const page = await cms.api.pages.createRoot({
    body: { slug: `p-${imageValue.slice(-8)}`, properties: { title: 'P' } },
  });
  await cms.api.pages.createBlock({
    body: {
      rootId: page.rootId,
      branchId: page.branchId,
      parentBlockId: page.rootId,
      type: 'hero',
      properties: { image: imageValue },
    },
  });
  return page;
}

describe('image property type', () => {
  it('resolves an image id to { id, slug } (raw keeps the stored id)', async () => {
    const { cms, db } = await setupImageCMS();
    const asset = await insertAsset(db, 'hero-image');
    const page = await pageWithImage(cms, asset.id);

    // raw:false → resolved to { id, slug } for the gate URL.
    expect(await imageOf(cms, page.rootId, page.branchId, false)).toEqual({
      id: asset.id,
      slug: 'hero-image',
    });

    // raw:true → the stored id (editable, for re-picking).
    expect(await imageOf(cms, page.rootId, page.branchId, true)).toBe(asset.id);
  });

  it('resolves multiple distinct image blocks in one tree (batch)', async () => {
    const { cms, db } = await setupImageCMS();
    const first = await insertAsset(db, 'first-image');
    const second = await insertAsset(db, 'second-image');
    const page = await cms.api.pages.createRoot({
      body: { slug: 'gallery', properties: { title: 'Gallery' } },
    });
    for (const id of [first.id, second.id]) {
      await cms.api.pages.createBlock({
        body: {
          rootId: page.rootId,
          branchId: page.branchId,
          parentBlockId: page.rootId,
          type: 'hero',
          properties: { image: id },
        },
      });
    }

    const { tree } = await cms.api.pages.getBlockTree({
      query: { rootId: page.rootId, branchId: page.branchId, raw: false },
    });
    expect(tree.children[0].properties.image).toEqual({
      id: first.id,
      slug: 'first-image',
    });
    expect(tree.children[1].properties.image).toEqual({
      id: second.id,
      slug: 'second-image',
    });
  });

  it('resolves a missing asset to null (renderer omits it)', async () => {
    const { cms } = await setupImageCMS();
    const page = await pageWithImage(cms, 'ast_00000000000000000000');

    expect(await imageOf(cms, page.rootId, page.branchId, false)).toBeNull();
  });

  it('resolves an archived asset to null', async () => {
    const { cms, db } = await setupImageCMS();
    const asset = await insertAsset(db, 'archived-image');
    const page = await pageWithImage(cms, asset.id);

    await db
      .update(assets)
      .set({ archivedAt: new Date() })
      .where(eq(assets.id, asset.id));

    expect(await imageOf(cms, page.rootId, page.branchId, false)).toBeNull();
  });

  it('resolves an image in published content (getPublishedContent)', async () => {
    const { cms, db } = await setupImageCMS();
    const asset = await insertAsset(db, 'published-image');
    const page = await pageWithImage(cms, asset.id);
    await publishBranch(cms.api.pages, {
      rootId: page.rootId,
      branchId: page.branchId,
    });

    const result = await cms.api.pages.getPublishedContent({
      query: { rootId: page.rootId },
    });

    expect(result.variants[0].tree.children[0].properties.image).toEqual({
      id: asset.id,
      slug: 'published-image',
    });
  });
});

// ============================================================================
// Images INSIDE an embedded reusable block (inlined reference)
// ============================================================================

async function publishBranch(
  api: any,
  input: { rootId: string; branchId: string },
): Promise<void> {
  const request = await api.requestApproval({
    body: {
      branchId: input.branchId,
      requestedBy: 'requester-1',
      requestedReviewers: ['reviewer-1'],
    },
  });
  await api.approve({
    body: { approvalId: request.approvals[0].id, reviewedBy: 'reviewer-1' },
  });
  await api.publishBranch({ body: input });
}

async function setupRefImageCMS() {
  const { db } = await setupTestDB();
  const cms = createCMS({
    db,
    media: { ...DUMMY_MEDIA_CONFIG },
    collections: {
      reusableBlocks: {
        label: 'Reusable Blocks',
        root: {
          properties: {
            label: { type: 'string', label: 'Label', required: true },
          },
        },
        blocks: {
          hero: {
            label: 'Hero',
            properties: { image: { type: 'image', label: 'Image' } },
          },
        },
      },
      pages: {
        label: 'Pages',
        slug: { enabled: true, root: '/pages' },
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

/** A reusable block whose hero holds an image, published; a `home` page embeds it. */
async function seedEmbeddedImage(cms: { api: any }, db: any) {
  const asset = await insertAsset(db, 'embedded-image');
  const reusable = await cms.api.reusableBlocks.createRoot({
    body: { properties: { label: 'Footer Hero' } },
  });
  await cms.api.reusableBlocks.createBlock({
    body: {
      rootId: reusable.rootId,
      branchId: reusable.branchId,
      parentBlockId: reusable.rootId,
      type: 'hero',
      properties: { image: asset.id },
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
  return { asset, reusable, home };
}

describe('image inside an embedded reference', () => {
  it('resolves images in a reusable-block preview (getBlockTree includeReferencePreviews)', async () => {
    const { cms, db } = await setupRefImageCMS();
    const { asset, reusable, home } = await seedEmbeddedImage(cms, db);

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
    expect(preview.children[0].properties.image).toEqual({
      id: asset.id,
      slug: 'embedded-image',
    });
  });

  it('resolves images inside an inlined reference (getPublishedContent)', async () => {
    const { cms, db } = await setupRefImageCMS();
    const { asset, home } = await seedEmbeddedImage(cms, db);
    await publishBranch(cms.api.pages, {
      rootId: home.rootId,
      branchId: home.branchId,
    });

    const result = await cms.api.pages.getPublishedContent({
      query: { rootId: home.rootId },
    });

    // The embed's reference is inlined; the image inside it is resolved too.
    const inlined = result.variants[0].tree.children[0].properties.block;
    expect(inlined.tree.children[0].properties.image).toEqual({
      id: asset.id,
      slug: 'embedded-image',
    });
  });
});
