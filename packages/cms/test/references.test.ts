import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import type {
  ResolvedReference,
  RevalidateEvent,
} from '../src/core/types/definitions';
import type { CustomMediaConfig } from '../src/core/types/s3';

import { isReferencedByLiveContent } from '../src/core/references';
import { createCMS } from '../src/index';
import { contentUsages } from '../src/schema';
import { setupTestDB } from './utils/db';

type AnyApi = Record<string, (...args: any[]) => Promise<any>>;
type AnyCMS = { api: Record<string, AnyApi> };

const DUMMY_MEDIA: CustomMediaConfig = {
  provider: 'custom',
  hostname: '127.0.0.1:0',
  region: 'us-east-1',
  accessKeyId: 'dummy',
  secretAccessKey: 'dummy',
  bucketName: 'dummy',
  publicUrl: 'https://cdn.test.local',
  secure: false,
  forcePathStyle: true,
};

async function publishBranch(
  api: any,
  input: { rootId: string; branchId: string; publishedBy?: string },
) {
  const request = await api.requestApproval({
    body: {
      branchId: input.branchId,
      requestedReviewers: ['reviewer-1'],
    },
    context: { userId: 'requester-1' },
  });

  await api.approve({
    body: {
      approvalId: request.approvals[0].id,
    },
    context: { userId: 'reviewer-1' },
  });

  return await api.publishBranch({ body: input });
}

async function setupReferenceCMS() {
  const { db } = await setupTestDB();

  const cms = createCMS({
    db,
    media: DUMMY_MEDIA,
    collections: {
      authors: {
        label: 'Authors',
        root: {
          properties: {
            name: {
              type: 'string' as const,
              label: 'Name',
              required: true as const,
            },
            bio: { type: 'string' as const, label: 'Bio' },
          },
        },
      },
      reusableBlocks: {
        label: 'Reusable Blocks',
        root: {
          properties: {
            label: {
              type: 'string' as const,
              label: 'Label',
              required: true as const,
            },
          },
        },
        blocks: {
          emailForm: {
            label: 'Email Form',
            properties: {
              heading: {
                type: 'string' as const,
                label: 'Heading',
                required: true as const,
              },
            },
          },
        },
      },
      pages: {
        label: 'Pages',
        slug: { enabled: true, root: '/pages' },
        root: {
          properties: {
            title: {
              type: 'string' as const,
              label: 'Title',
              required: true as const,
            },
          },
        },
        blocks: {
          paragraph: {
            label: 'Paragraph',
            properties: {
              text: {
                type: 'richText' as const,
                label: 'Text',
                required: true as const,
              },
            },
          },
          authorCard: {
            label: 'Author Card',
            properties: {
              author: {
                type: 'reference' as const,
                collection: 'authors',
                label: 'Author',
                required: true as const,
              },
            },
          },
          reusableContent: {
            label: 'Reusable Content',
            properties: {
              block: {
                type: 'reference' as const,
                collection: 'reusableBlocks',
                label: 'Block',
                required: true as const,
              },
            },
          },
        },
      },
    } as const,
  });

  return { cms: cms as { api: Record<string, AnyApi> }, db };
}

// ============================================================================
// Runtime validation
// ============================================================================

describe('reference validation', () => {
  it('throws at CMS creation when a reference points to a non-existent collection', async () => {
    const { db } = await setupTestDB();

    expect(() =>
      createCMS({
        db,
        media: DUMMY_MEDIA,
        collections: {
          pages: {
            label: 'Pages',
            root: {
              properties: {
                title: {
                  type: 'string' as const,
                  label: 'Title',
                  required: true as const,
                },
              },
            },
            blocks: {
              authorCard: {
                label: 'Author Card',
                properties: {
                  author: {
                    type: 'reference' as const,
                    collection: 'nonExistent',
                    label: 'Author',
                    required: true as const,
                  },
                },
              },
            },
          },
        } as const,
      }),
    ).toThrow(/nonExistent/);
  });

  it('does not throw when all references point to valid collections', async () => {
    const { db } = await setupTestDB();

    expect(() =>
      createCMS({
        db,
        media: DUMMY_MEDIA,
        collections: {
          authors: {
            label: 'Authors',
            root: {
              properties: {
                name: {
                  type: 'string' as const,
                  label: 'Name',
                  required: true as const,
                },
              },
            },
          },
          pages: {
            label: 'Pages',
            root: {
              properties: {
                title: {
                  type: 'string' as const,
                  label: 'Title',
                  required: true as const,
                },
              },
            },
            blocks: {
              authorCard: {
                label: 'Author Card',
                properties: {
                  author: {
                    type: 'reference' as const,
                    collection: 'authors',
                    label: 'Author',
                    required: true as const,
                  },
                },
              },
            },
          },
        } as const,
      }),
    ).not.toThrow();
  });

  it('throws when reference property has no collection specified', async () => {
    const { db } = await setupTestDB();

    expect(() =>
      createCMS({
        db,
        media: DUMMY_MEDIA,
        collections: {
          pages: {
            label: 'Pages',
            root: {
              properties: {
                title: {
                  type: 'string' as const,
                  label: 'Title',
                  required: true as const,
                },
              },
            },
            blocks: {
              authorCard: {
                label: 'Author Card',
                properties: {
                  author: {
                    type: 'reference' as const,
                    label: 'Author',
                  } as any,
                },
              },
            },
          },
        } as const,
      }),
    ).toThrow(/collection/i);
  });
});

// ============================================================================
// Reference field CRUD
// ============================================================================

describe('reference field', () => {
  it('stores a rootId string in a reference property', async () => {
    const { cms } = await setupReferenceCMS();

    const author = await cms.api.authors.createRoot({
      body: { properties: { name: 'Jane Doe' } },
    });

    const page = await cms.api.pages.createRoot({
      body: { slug: '/about', properties: { title: 'About' } },
    });

    const block = await cms.api.pages.createBlock({
      body: {
        rootId: page.rootId,
        branchId: page.branchId,
        parentBlockId: page.rootId,
        type: 'authorCard',
        properties: { author: author.rootId },
      },
    });

    expect(block.blockId).toBeDefined();

    const { tree } = await cms.api.pages.getBlockTree({
      query: { rootId: page.rootId, branchId: page.branchId },
    });

    const authorBlock = tree.children.find((c: any) => c.type === 'authorCard');
    expect(authorBlock).toBeDefined();
    expect(authorBlock!.properties.author).toBe(author.rootId);
  });
});

// ============================================================================
// RB1 — reference usage index (ships dark: rows populate, nothing reads them yet)
// ============================================================================

describe('reference usage index (RB1)', () => {
  it('indexes a reference property value into content_usages as targetKind=reference', async () => {
    const { cms, db } = await setupReferenceCMS();

    const author = await cms.api.authors.createRoot({
      body: { properties: { name: 'Jane Doe' } },
    });
    const page = await cms.api.pages.createRoot({
      body: { slug: '/about', properties: { title: 'About' } },
    });
    const block = await cms.api.pages.createBlock({
      body: {
        rootId: page.rootId,
        branchId: page.branchId,
        parentBlockId: page.rootId,
        type: 'authorCard',
        properties: { author: author.rootId },
      },
    });

    const rows = await db
      .select()
      .from(contentUsages)
      .where(
        and(
          eq(contentUsages.targetKind, 'reference'),
          eq(contentUsages.targetKey, author.rootId),
        ),
      );

    expect(rows).toHaveLength(1);
    expect(rows[0].rootId).toBe(page.rootId);
    expect(rows[0].blockId).toBe(block.blockId);
    expect(rows[0].propertyKey).toBe('author');
  });

  it('indexes a reusable-block embed (reference → reusableBlocks collection)', async () => {
    const { cms, db } = await setupReferenceCMS();

    const reusable = await cms.api.reusableBlocks.createRoot({
      body: { properties: { label: 'Newsletter CTA' } },
    });
    const page = await cms.api.pages.createRoot({
      body: { slug: '/home', properties: { title: 'Home' } },
    });
    await cms.api.pages.createBlock({
      body: {
        rootId: page.rootId,
        branchId: page.branchId,
        parentBlockId: page.rootId,
        type: 'reusableContent',
        properties: { block: reusable.rootId },
      },
    });

    const rows = await db
      .select()
      .from(contentUsages)
      .where(
        and(
          eq(contentUsages.targetKind, 'reference'),
          eq(contentUsages.targetKey, reusable.rootId),
        ),
      );

    expect(rows).toHaveLength(1);
    expect(rows[0].rootId).toBe(page.rootId);
    expect(rows[0].propertyKey).toBe('block');
  });

  it('getBlockTree includeReferencePreviews returns published previews in one call', async () => {
    const { cms } = await setupReferenceCMS();

    // A reusable block with content, published.
    const reusable = await cms.api.reusableBlocks.createRoot({
      body: { properties: { label: 'Newsletter CTA' } },
    });
    await cms.api.reusableBlocks.createBlock({
      body: {
        rootId: reusable.rootId,
        branchId: reusable.branchId,
        parentBlockId: reusable.rootId,
        type: 'emailForm',
        properties: { heading: 'Subscribe now' },
      },
    });
    await publishBranch(cms.api.reusableBlocks, {
      rootId: reusable.rootId,
      branchId: reusable.branchId,
    });

    // A page embedding the reusable block by reference.
    const page = await cms.api.pages.createRoot({
      body: { slug: '/home', properties: { title: 'Home' } },
    });
    await cms.api.pages.createBlock({
      body: {
        rootId: page.rootId,
        branchId: page.branchId,
        parentBlockId: page.rootId,
        type: 'reusableContent',
        properties: { block: reusable.rootId },
      },
    });

    const result = await cms.api.pages.getBlockTree({
      query: {
        rootId: page.rootId,
        branchId: page.branchId,
        raw: true,
        includeReferencePreviews: true,
      },
    });

    // The raw editable tree keeps the reference value (not inlined).
    expect(result.tree.children[0].properties.block).toBe(reusable.rootId);

    // The sidecar carries the PUBLISHED preview, keyed by the stored value.
    const preview = result.references?.[reusable.rootId];
    expect(preview).toBeDefined();
    expect(preview.children[0].type).toBe('emailForm');
    expect(preview.children[0].properties.heading).toBe('Subscribe now');
  });

  it('getBlockTree omits the references sidecar without the flag', async () => {
    const { cms } = await setupReferenceCMS();
    const page = await cms.api.pages.createRoot({
      body: { slug: '/plain', properties: { title: 'Plain' } },
    });

    const result = await cms.api.pages.getBlockTree({
      query: { rootId: page.rootId, branchId: page.branchId, raw: true },
    });
    expect(result.references).toBeUndefined();
  });

  it('does not index non-reference properties', async () => {
    const { cms, db } = await setupReferenceCMS();

    // A page with only a string title + a paragraph (richText) — no references.
    const page = await cms.api.pages.createRoot({
      body: { slug: '/plain', properties: { title: 'Plain' } },
    });
    await cms.api.pages.createBlock({
      body: {
        rootId: page.rootId,
        branchId: page.branchId,
        parentBlockId: page.rootId,
        type: 'paragraph',
        properties: { text: 'just text' },
      },
    });

    const rows = await db
      .select()
      .from(contentUsages)
      .where(eq(contentUsages.targetKind, 'reference'));

    expect(rows).toHaveLength(0);
  });
});

// ============================================================================
// RB2 — reference usage queries + endpoint
// ============================================================================

describe('reference usage queries (RB2)', () => {
  it('getReferenceUsages reports every page that embeds a reusable block', async () => {
    const { cms } = await setupReferenceCMS();
    const reusable = await cms.api.reusableBlocks.createRoot({
      body: { properties: { label: 'CTA' } },
    });

    const page1 = await cms.api.pages.createRoot({
      body: { slug: '/a', properties: { title: 'A' } },
    });
    await cms.api.pages.createBlock({
      body: {
        rootId: page1.rootId,
        branchId: page1.branchId,
        parentBlockId: page1.rootId,
        type: 'reusableContent',
        properties: { block: reusable.rootId },
      },
    });
    const page2 = await cms.api.pages.createRoot({
      body: { slug: '/b', properties: { title: 'B' } },
    });
    await cms.api.pages.createBlock({
      body: {
        rootId: page2.rootId,
        branchId: page2.branchId,
        parentBlockId: page2.rootId,
        type: 'reusableContent',
        properties: { block: reusable.rootId },
      },
    });

    const usage = await cms.api.reusableBlocks.getReferenceUsages({
      query: { rootId: reusable.rootId },
    });
    expect(usage.pageCount).toBe(2);
    expect(usage.pages.map((p: any) => p.rootId).sort()).toEqual(
      [page1.rootId, page2.rootId].sort(),
    );
    expect(usage.pages[0].occurrences[0].propertyKey).toBe('block');
  });

  it('drops a page from usage once its live head stops embedding the block', async () => {
    const { cms } = await setupReferenceCMS();
    const reusable = await cms.api.reusableBlocks.createRoot({
      body: { properties: { label: 'CTA' } },
    });
    const page = await cms.api.pages.createRoot({
      body: { slug: '/a', properties: { title: 'A' } },
    });
    const block = await cms.api.pages.createBlock({
      body: {
        rootId: page.rootId,
        branchId: page.branchId,
        parentBlockId: page.rootId,
        type: 'reusableContent',
        properties: { block: reusable.rootId },
      },
    });

    let usage = await cms.api.reusableBlocks.getReferenceUsages({
      query: { rootId: reusable.rootId },
    });
    expect(usage.pageCount).toBe(1);

    await cms.api.pages.deleteBlock({
      body: {
        rootId: page.rootId,
        branchId: page.branchId,
        blockId: block.blockId,
      },
    });

    usage = await cms.api.reusableBlocks.getReferenceUsages({
      query: { rootId: reusable.rootId },
    });
    expect(usage.pageCount).toBe(0);
  });

  it('isReferencedByLiveContent is true only while a live head embeds the anchor', async () => {
    const { cms, db } = await setupReferenceCMS();
    const reusable = await cms.api.reusableBlocks.createRoot({
      body: { properties: { label: 'CTA' } },
    });
    expect(await isReferencedByLiveContent(db, reusable.rootId)).toBe(false);

    const page = await cms.api.pages.createRoot({
      body: { slug: '/a', properties: { title: 'A' } },
    });
    const block = await cms.api.pages.createBlock({
      body: {
        rootId: page.rootId,
        branchId: page.branchId,
        parentBlockId: page.rootId,
        type: 'reusableContent',
        properties: { block: reusable.rootId },
      },
    });
    expect(await isReferencedByLiveContent(db, reusable.rootId)).toBe(true);

    await cms.api.pages.deleteBlock({
      body: {
        rootId: page.rootId,
        branchId: page.branchId,
        blockId: block.blockId,
      },
    });
    expect(await isReferencedByLiveContent(db, reusable.rootId)).toBe(false);
  });
});

// ============================================================================
// RB4 — delete guard (ROOT_IN_USE): an embedded reusable block can't be deleted
// ============================================================================

describe('reference delete guard (RB4)', () => {
  it('blocks deleting a reusable block embedded on a live page', async () => {
    const { cms } = await setupReferenceCMS();
    const reusable = await cms.api.reusableBlocks.createRoot({
      body: { properties: { label: 'CTA' } },
    });
    const page = await cms.api.pages.createRoot({
      body: { slug: '/a', properties: { title: 'A' } },
    });
    await cms.api.pages.createBlock({
      body: {
        rootId: page.rootId,
        branchId: page.branchId,
        parentBlockId: page.rootId,
        type: 'reusableContent',
        properties: { block: reusable.rootId },
      },
    });

    await expect(
      cms.api.reusableBlocks.archiveRoot({ body: { rootId: reusable.rootId } }),
    ).rejects.toThrow(/embedded/i);
  });

  it('allows deleting once the reference leaves the live head', async () => {
    const { cms } = await setupReferenceCMS();
    const reusable = await cms.api.reusableBlocks.createRoot({
      body: { properties: { label: 'CTA' } },
    });
    const page = await cms.api.pages.createRoot({
      body: { slug: '/a', properties: { title: 'A' } },
    });
    const block = await cms.api.pages.createBlock({
      body: {
        rootId: page.rootId,
        branchId: page.branchId,
        parentBlockId: page.rootId,
        type: 'reusableContent',
        properties: { block: reusable.rootId },
      },
    });

    await expect(
      cms.api.reusableBlocks.archiveRoot({ body: { rootId: reusable.rootId } }),
    ).rejects.toThrow();

    await cms.api.pages.deleteBlock({
      body: {
        rootId: page.rootId,
        branchId: page.branchId,
        blockId: block.blockId,
      },
    });

    const res = await cms.api.reusableBlocks.archiveRoot({
      body: { rootId: reusable.rootId },
    });
    expect(res.rootId).toBe(reusable.rootId);
  });
});

// ============================================================================
// Inline resolution in getPublishedContent
// ============================================================================

describe('reference resolution in getPublishedContent', () => {
  it('resolves a data-only reference to a ResolvedReference object', async () => {
    const { cms } = await setupReferenceCMS();

    // Create and publish an author
    const author = await cms.api.authors.createRoot({
      body: { properties: { name: 'Jane Doe', bio: 'Writer' } },
    });
    await publishBranch(cms.api.authors, {
      rootId: author.rootId,
      branchId: author.branchId,
      publishedBy: 'admin',
    });

    // Create a page with an authorCard block
    const page = await cms.api.pages.createRoot({
      body: { slug: '/about', properties: { title: 'About' } },
    });
    await cms.api.pages.createBlock({
      body: {
        rootId: page.rootId,
        branchId: page.branchId,
        parentBlockId: page.rootId,
        type: 'authorCard',
        properties: { author: author.rootId },
      },
    });

    // Publish the page
    await publishBranch(cms.api.pages, {
      rootId: page.rootId,
      branchId: page.branchId,
      publishedBy: 'admin',
    });

    const published = await cms.api.pages.getPublishedContent({
      query: { rootId: page.rootId },
    });

    const tree = published.variants[0].tree;
    const authorBlock = tree.children.find((c: any) => c.type === 'authorCard');
    expect(authorBlock).toBeDefined();

    const ref = authorBlock!.properties.author as ResolvedReference;
    expect(ref).toEqual(
      expect.objectContaining({
        rootId: author.rootId,
        collection: 'authors',
        properties: expect.objectContaining({
          name: 'Jane Doe',
          bio: 'Writer',
        }),
      }),
    );
    expect(ref.tree).toBeDefined();
    expect(ref.tree.blockId).toBe(author.rootId);
  });

  it('resolves a reference to a collection with blocks (reusableBlocks)', async () => {
    const { cms } = await setupReferenceCMS();

    // Create and publish a reusable block with child blocks
    const reusable = await cms.api.reusableBlocks.createRoot({
      body: { properties: { label: 'Newsletter Signup' } },
    });
    await cms.api.reusableBlocks.createBlock({
      body: {
        rootId: reusable.rootId,
        branchId: reusable.branchId,
        parentBlockId: reusable.rootId,
        type: 'emailForm',
        properties: { heading: 'Subscribe!' },
      },
    });
    await publishBranch(cms.api.reusableBlocks, {
      rootId: reusable.rootId,
      branchId: reusable.branchId,
      publishedBy: 'admin',
    });

    // Create a page referencing the reusable block
    const page = await cms.api.pages.createRoot({
      body: { slug: '/home', properties: { title: 'Home' } },
    });
    await cms.api.pages.createBlock({
      body: {
        rootId: page.rootId,
        branchId: page.branchId,
        parentBlockId: page.rootId,
        type: 'reusableContent',
        properties: { block: reusable.rootId },
      },
    });
    await publishBranch(cms.api.pages, {
      rootId: page.rootId,
      branchId: page.branchId,
      publishedBy: 'admin',
    });

    const published = await cms.api.pages.getPublishedContent({
      query: { rootId: page.rootId },
    });

    const tree = published.variants[0].tree;
    const reusableBlock = tree.children.find(
      (c: any) => c.type === 'reusableContent',
    );
    expect(reusableBlock).toBeDefined();

    const ref = reusableBlock!.properties.block as ResolvedReference;
    expect(ref.rootId).toBe(reusable.rootId);
    expect(ref.collection).toBe('reusableBlocks');
    expect(ref.properties.label).toBe('Newsletter Signup');
    expect(ref.tree.children).toHaveLength(1);
    expect(ref.tree.children[0].type).toBe('emailForm');
    expect(ref.tree.children[0].properties.heading).toBe('Subscribe!');
  });

  it('leaves reference as raw rootId when referenced content is not published', async () => {
    const { cms } = await setupReferenceCMS();

    const author = await cms.api.authors.createRoot({
      body: { properties: { name: 'Unpublished Author' } },
    });

    const page = await cms.api.pages.createRoot({
      body: { slug: '/about', properties: { title: 'About' } },
    });
    await cms.api.pages.createBlock({
      body: {
        rootId: page.rootId,
        branchId: page.branchId,
        parentBlockId: page.rootId,
        type: 'authorCard',
        properties: { author: author.rootId },
      },
    });
    await publishBranch(cms.api.pages, {
      rootId: page.rootId,
      branchId: page.branchId,
      publishedBy: 'admin',
    });

    const published = await cms.api.pages.getPublishedContent({
      query: { rootId: page.rootId },
    });

    const tree = published.variants[0].tree;
    const authorBlock = tree.children.find((c: any) => c.type === 'authorCard');
    expect(authorBlock!.properties.author).toBe(author.rootId);
  });

  it('resolves multiple references in the same tree', async () => {
    const { cms } = await setupReferenceCMS();

    // Create and publish two authors
    const author1 = await cms.api.authors.createRoot({
      body: { properties: { name: 'Alice' } },
    });
    await publishBranch(cms.api.authors, {
      rootId: author1.rootId,
      branchId: author1.branchId,
      publishedBy: 'admin',
    });

    const author2 = await cms.api.authors.createRoot({
      body: { properties: { name: 'Bob' } },
    });
    await publishBranch(cms.api.authors, {
      rootId: author2.rootId,
      branchId: author2.branchId,
      publishedBy: 'admin',
    });

    // Create a page with two authorCard blocks
    const page = await cms.api.pages.createRoot({
      body: { slug: '/team', properties: { title: 'Team' } },
    });
    await cms.api.pages.createBlock({
      body: {
        rootId: page.rootId,
        branchId: page.branchId,
        parentBlockId: page.rootId,
        type: 'authorCard',
        properties: { author: author1.rootId },
      },
    });
    await cms.api.pages.createBlock({
      body: {
        rootId: page.rootId,
        branchId: page.branchId,
        parentBlockId: page.rootId,
        type: 'authorCard',
        properties: { author: author2.rootId },
      },
    });
    await publishBranch(cms.api.pages, {
      rootId: page.rootId,
      branchId: page.branchId,
      publishedBy: 'admin',
    });

    const published = await cms.api.pages.getPublishedContent({
      query: { rootId: page.rootId },
    });

    const tree = published.variants[0].tree;
    const authorBlocks = tree.children.filter(
      (c: any) => c.type === 'authorCard',
    );
    expect(authorBlocks).toHaveLength(2);

    const ref1 = authorBlocks[0].properties.author as ResolvedReference;
    const ref2 = authorBlocks[1].properties.author as ResolvedReference;
    expect(ref1.properties.name).toBe('Alice');
    expect(ref2.properties.name).toBe('Bob');
  });
});

// ============================================================================
// Optional blocks (data-only collections)
// ============================================================================

describe('data-only collections (no blocks)', () => {
  it('allows creating a collection without blocks', async () => {
    const { db } = await setupTestDB();

    const cms = createCMS({
      db,
      media: DUMMY_MEDIA,
      collections: {
        tags: {
          label: 'Tags',
          root: {
            properties: {
              name: {
                type: 'string' as const,
                label: 'Name',
                required: true as const,
              },
            },
          },
        },
      } as const,
    }) as unknown as AnyCMS;

    const tag = await cms.api.tags.createRoot({
      body: { properties: { name: 'TypeScript' } },
    });

    expect(tag.rootId).toBeDefined();

    const { roots } = await cms.api.tags.listRoots({});
    expect(roots).toHaveLength(1);
  });

  it('does not register block-specific endpoints for blockless collections', async () => {
    const { db } = await setupTestDB();

    const cms = createCMS({
      db,
      media: DUMMY_MEDIA,
      collections: {
        tags: {
          label: 'Tags',
          root: {
            properties: {
              name: {
                type: 'string' as const,
                label: 'Name',
                required: true as const,
              },
            },
          },
        },
      } as const,
    }) as unknown as AnyCMS;

    expect(cms.api.tags.createRoot).toBeDefined();
    expect(cms.api.tags.listRoots).toBeDefined();
    expect(cms.api.tags.updateRoot).toBeDefined();
    expect(cms.api.tags.getBlockTree).toBeDefined();

    expect(cms.api.tags.createBlock).toBeUndefined();
    expect(cms.api.tags.updateBlock).toBeUndefined();
    expect(cms.api.tags.deleteBlock).toBeUndefined();
    expect(cms.api.tags.moveBlock).toBeUndefined();
    expect(cms.api.tags.duplicateBlock).toBeUndefined();
    expect(cms.api.tags.updateBlocks).toBeUndefined();
  });

  it('can publish and fetch data-only collection content', async () => {
    const { db } = await setupTestDB();

    const cms = createCMS({
      db,
      media: DUMMY_MEDIA,
      collections: {
        tags: {
          label: 'Tags',
          root: {
            properties: {
              name: {
                type: 'string' as const,
                label: 'Name',
                required: true as const,
              },
              color: { type: 'string' as const, label: 'Color' },
            },
          },
        },
      } as const,
    }) as unknown as AnyCMS;

    const tag = await cms.api.tags.createRoot({
      body: { properties: { name: 'TypeScript', color: '#3178c6' } },
    });

    await publishBranch(cms.api.tags, {
      rootId: tag.rootId,
      branchId: tag.branchId,
      publishedBy: 'admin',
    });

    const published = await cms.api.tags.getPublishedContent({
      query: { rootId: tag.rootId },
    });

    expect(published.rootId).toBe(tag.rootId);
    const tree = published.variants[0].tree;
    expect(tree.properties.name).toBe('TypeScript');
    expect(tree.properties.color).toBe('#3178c6');
    expect(tree.children).toHaveLength(0);
  });
});

// ============================================================================
// Cascade revalidation
// ============================================================================

describe('cascade revalidation', () => {
  async function setupCascadeCMS() {
    const { db } = await setupTestDB();
    const events: RevalidateEvent[] = [];

    const cms = createCMS({
      db,
      media: DUMMY_MEDIA,
      collections: {
        authors: {
          label: 'Authors',
          root: {
            properties: {
              name: {
                type: 'string' as const,
                label: 'Name',
                required: true as const,
              },
            },
          },
        },
        reusableBlocks: {
          label: 'Reusable Blocks',
          root: {
            properties: {
              label: {
                type: 'string' as const,
                label: 'Label',
                required: true as const,
              },
            },
          },
          blocks: {
            emailForm: {
              label: 'Email Form',
              properties: {
                heading: {
                  type: 'string' as const,
                  label: 'Heading',
                  required: true as const,
                },
              },
            },
          },
        },
        pages: {
          label: 'Pages',
          slug: { enabled: true, root: '/pages' },
          root: {
            properties: {
              title: {
                type: 'string' as const,
                label: 'Title',
                required: true as const,
              },
            },
          },
          blocks: {
            paragraph: {
              label: 'Paragraph',
              properties: {
                text: {
                  type: 'richText' as const,
                  label: 'Text',
                  required: true as const,
                },
              },
            },
            authorCard: {
              label: 'Author Card',
              properties: {
                author: {
                  type: 'reference' as const,
                  collection: 'authors',
                  label: 'Author',
                  required: true as const,
                },
              },
            },
            reusableContent: {
              label: 'Reusable Content',
              properties: {
                block: {
                  type: 'reference' as const,
                  collection: 'reusableBlocks',
                  label: 'Block',
                  required: true as const,
                },
              },
            },
          },
        },
      } as const,
      onRevalidate: async (event: RevalidateEvent) => {
        events.push({ ...event });
      },
    }) as unknown as AnyCMS;

    return { cms, db, events };
  }

  it('fires cascade revalidation for pages referencing a published reusable block', async () => {
    const { cms, events } = await setupCascadeCMS();

    // Create and publish a reusable block
    const reusable = await cms.api.reusableBlocks.createRoot({
      body: { properties: { label: 'Newsletter' } },
    });
    await cms.api.reusableBlocks.createBlock({
      body: {
        rootId: reusable.rootId,
        branchId: reusable.branchId,
        parentBlockId: reusable.rootId,
        type: 'emailForm',
        properties: { heading: 'Subscribe' },
      },
    });
    await publishBranch(cms.api.reusableBlocks, {
      rootId: reusable.rootId,
      branchId: reusable.branchId,
      publishedBy: 'admin',
    });

    // Create a page referencing the reusable block and publish it
    const page = await cms.api.pages.createRoot({
      body: { slug: '/home', properties: { title: 'Home' } },
    });
    await cms.api.pages.createBlock({
      body: {
        rootId: page.rootId,
        branchId: page.branchId,
        parentBlockId: page.rootId,
        type: 'reusableContent',
        properties: { block: reusable.rootId },
      },
    });
    await publishBranch(cms.api.pages, {
      rootId: page.rootId,
      branchId: page.branchId,
      publishedBy: 'admin',
    });

    // Clear events from initial setup
    events.length = 0;

    // Re-publish the reusable block (simulating an update)
    await cms.api.reusableBlocks.createBlock({
      body: {
        rootId: reusable.rootId,
        branchId: reusable.branchId,
        parentBlockId: reusable.rootId,
        type: 'emailForm',
        properties: { heading: 'Subscribe Now!' },
      },
    });
    await publishBranch(cms.api.reusableBlocks, {
      rootId: reusable.rootId,
      branchId: reusable.branchId,
      publishedBy: 'admin',
    });

    // Should have 2 events: one for the reusable block itself, one cascade for the page
    const publishEvents = events.filter((e) => e.action === 'publishBranch');
    expect(publishEvents).toHaveLength(2);

    const reusableEvent = publishEvents.find(
      (e) => e.collection === 'reusableBlocks',
    );
    expect(reusableEvent).toBeDefined();
    expect(reusableEvent!.rootId).toBe(reusable.rootId);

    const cascadeEvent = publishEvents.find((e) => e.collection === 'pages');
    expect(cascadeEvent).toBeDefined();
    expect(cascadeEvent!.rootId).toBe(page.rootId);
    expect(cascadeEvent!.slug).toBe('home');
  });

  it('fires cascade revalidation for pages referencing a published author', async () => {
    const { cms, events } = await setupCascadeCMS();

    // Create and publish an author
    const author = await cms.api.authors.createRoot({
      body: { properties: { name: 'Jane' } },
    });
    await publishBranch(cms.api.authors, {
      rootId: author.rootId,
      branchId: author.branchId,
      publishedBy: 'admin',
    });

    // Create a page with an authorCard and publish it
    const page = await cms.api.pages.createRoot({
      body: { slug: '/about', properties: { title: 'About' } },
    });
    await cms.api.pages.createBlock({
      body: {
        rootId: page.rootId,
        branchId: page.branchId,
        parentBlockId: page.rootId,
        type: 'authorCard',
        properties: { author: author.rootId },
      },
    });
    await publishBranch(cms.api.pages, {
      rootId: page.rootId,
      branchId: page.branchId,
      publishedBy: 'admin',
    });

    events.length = 0;

    // Re-publish the author
    await cms.api.authors.updateRoot({
      body: {
        rootId: author.rootId,
        branchId: author.branchId,
        properties: { name: 'Jane Doe' },
      },
    });
    await publishBranch(cms.api.authors, {
      rootId: author.rootId,
      branchId: author.branchId,
      publishedBy: 'admin',
    });

    const publishEvents = events.filter((e) => e.action === 'publishBranch');
    expect(publishEvents).toHaveLength(2);

    const authorEvent = publishEvents.find((e) => e.collection === 'authors');
    expect(authorEvent).toBeDefined();
    expect(authorEvent!.rootId).toBe(author.rootId);

    const cascadeEvent = publishEvents.find((e) => e.collection === 'pages');
    expect(cascadeEvent).toBeDefined();
    expect(cascadeEvent!.rootId).toBe(page.rootId);
  });

  it('does not cascade when no published content references the updated root', async () => {
    const { cms, events } = await setupCascadeCMS();

    // Create and publish an author (not referenced by any page)
    const author = await cms.api.authors.createRoot({
      body: { properties: { name: 'Orphan Author' } },
    });
    await publishBranch(cms.api.authors, {
      rootId: author.rootId,
      branchId: author.branchId,
      publishedBy: 'admin',
    });

    events.length = 0;

    // Re-publish the author
    await cms.api.authors.updateRoot({
      body: {
        rootId: author.rootId,
        branchId: author.branchId,
        properties: { name: 'Still Orphan' },
      },
    });
    await publishBranch(cms.api.authors, {
      rootId: author.rootId,
      branchId: author.branchId,
      publishedBy: 'admin',
    });

    const publishEvents = events.filter((e) => e.action === 'publishBranch');
    expect(publishEvents).toHaveLength(1);
    expect(publishEvents[0].collection).toBe('authors');
  });

  it('cascades to multiple pages referencing the same reusable block', async () => {
    const { cms, events } = await setupCascadeCMS();

    // Create and publish a reusable block
    const reusable = await cms.api.reusableBlocks.createRoot({
      body: { properties: { label: 'CTA' } },
    });
    await cms.api.reusableBlocks.createBlock({
      body: {
        rootId: reusable.rootId,
        branchId: reusable.branchId,
        parentBlockId: reusable.rootId,
        type: 'emailForm',
        properties: { heading: 'Sign Up' },
      },
    });
    await publishBranch(cms.api.reusableBlocks, {
      rootId: reusable.rootId,
      branchId: reusable.branchId,
      publishedBy: 'admin',
    });

    // Create and publish two pages referencing the same reusable block
    const page1 = await cms.api.pages.createRoot({
      body: { slug: '/home', properties: { title: 'Home' } },
    });
    await cms.api.pages.createBlock({
      body: {
        rootId: page1.rootId,
        branchId: page1.branchId,
        parentBlockId: page1.rootId,
        type: 'reusableContent',
        properties: { block: reusable.rootId },
      },
    });
    await publishBranch(cms.api.pages, {
      rootId: page1.rootId,
      branchId: page1.branchId,
      publishedBy: 'admin',
    });

    const page2 = await cms.api.pages.createRoot({
      body: { slug: '/contact', properties: { title: 'Contact' } },
    });
    await cms.api.pages.createBlock({
      body: {
        rootId: page2.rootId,
        branchId: page2.branchId,
        parentBlockId: page2.rootId,
        type: 'reusableContent',
        properties: { block: reusable.rootId },
      },
    });
    await publishBranch(cms.api.pages, {
      rootId: page2.rootId,
      branchId: page2.branchId,
      publishedBy: 'admin',
    });

    events.length = 0;

    // Make a change to the reusable block and re-publish
    await cms.api.reusableBlocks.createBlock({
      body: {
        rootId: reusable.rootId,
        branchId: reusable.branchId,
        parentBlockId: reusable.rootId,
        type: 'emailForm',
        properties: { heading: 'Updated CTA' },
      },
    });
    await publishBranch(cms.api.reusableBlocks, {
      rootId: reusable.rootId,
      branchId: reusable.branchId,
      publishedBy: 'admin',
    });

    const publishEvents = events.filter((e) => e.action === 'publishBranch');
    // 1 for the reusable block + 2 cascade events for the two pages
    expect(publishEvents).toHaveLength(3);

    const cascadeEvents = publishEvents.filter((e) => e.collection === 'pages');
    expect(cascadeEvents).toHaveLength(2);

    const cascadeRootIds = cascadeEvents.map((e) => e.rootId).sort();
    const expectedRootIds = [page1.rootId, page2.rootId].sort();
    expect(cascadeRootIds).toEqual(expectedRootIds);
  });
});

// ============================================================================
// F0 — embedded reference resolves to a deterministic branch (multi-branch block)
// ============================================================================

describe('reference resolution determinism (F0)', () => {
  it('resolves a multi-branch embedded block to a stable, oldest-published branch', async () => {
    const { cms } = await setupReferenceCMS();

    // A reusable block with TWO published branches: main (published FIRST, no
    // child blocks) and a variant (published second, with an extra child block).
    const reusable = await cms.api.reusableBlocks.createRoot({
      body: { properties: { label: 'CTA' } },
    });
    await publishBranch(cms.api.reusableBlocks, {
      rootId: reusable.rootId,
      branchId: reusable.branchId,
    });

    const variant = await cms.api.reusableBlocks.createBranch({
      body: {
        rootId: reusable.rootId,
        name: 'variant',
        sourceBranchId: reusable.branchId,
      },
    });
    await cms.api.reusableBlocks.createBlock({
      body: {
        rootId: reusable.rootId,
        branchId: variant.branch.id,
        parentBlockId: reusable.rootId,
        type: 'emailForm',
        properties: { heading: 'Variant-only block' },
      },
    });
    await publishBranch(cms.api.reusableBlocks, {
      rootId: reusable.rootId,
      branchId: variant.branch.id,
    });

    // Embed it in a page and publish.
    const page = await cms.api.pages.createRoot({
      body: { slug: '/p', properties: { title: 'P' } },
    });
    await cms.api.pages.createBlock({
      body: {
        rootId: page.rootId,
        branchId: page.branchId,
        parentBlockId: page.rootId,
        type: 'reusableContent',
        properties: { block: reusable.rootId },
      },
    });
    await publishBranch(cms.api.pages, {
      rootId: page.rootId,
      branchId: page.branchId,
    });

    const resolvedChildCount = async () => {
      const pub = await cms.api.pages.getPublishedContent({
        query: { rootId: page.rootId },
      });
      const ref = (
        pub.variants[0].tree.children.find(
          (c: any) => c.type === 'reusableContent',
        ) as any
      ).properties.block;
      return ref.tree.children.length;
    };

    const first = await resolvedChildCount();
    const second = await resolvedChildCount();
    const third = await resolvedChildCount();

    // Stable across reads (deterministic ORDER BY) and the OLDEST-published branch
    // (main, 0 child blocks) wins over the later variant (1 child block).
    expect(first).toBe(second);
    expect(second).toBe(third);
    expect(first).toBe(0);
  });
});
