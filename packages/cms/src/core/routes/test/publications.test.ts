import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { publications, roots } from '../../../schema';
import { setupTestCMS } from '../../../test-utils/cms';
import { publishApprovedBranch } from '../../../test-utils/helpers';
import { isCMSError } from '../../errors';

describe('publishBranch', () => {
  it('publishes the current head commit of a branch for a root', async () => {
    const { cms, db } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/p', properties: { title: 'Page' } },
    });

    const draft = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'draft',
        sourceBranchId: root.branchId,
      },
    });

    const change = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: draft.branch.id,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Draft content' },
      },
    });

    const result = await publishApprovedBranch(cms, {
      rootId: root.rootId,
      branchId: draft.branch.id,
      publishedBy: 'user-1',
    });

    expect(result.publication.rootId).toBe(root.rootId);
    expect(result.publication.branchId).toBe(draft.branch.id);
    expect(result.publication.commitId).toBe(change.commit.id);
    expect(result.publication.publishedBy).toBe('user-1');
    expect(result.publication.publishedAt).toBeInstanceOf(Date);
    // branchName is carried on the publish result, matching listPublications.
    expect(result.publication.branchName).toBe('draft');

    const [publication] = await db
      .select()
      .from(publications)
      .where(
        and(
          eq(publications.rootId, root.rootId),
          eq(publications.branchId, draft.branch.id),
        ),
      );

    expect(publication.commitId).toBe(change.commit.id);
    expect(publication.publishedBy).toBe('user-1');
  });

  it('updates an existing publication when the same branch is published again', async () => {
    const { cms, db } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/p', properties: { title: 'Page' } },
    });

    const draft = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'draft',
        sourceBranchId: root.branchId,
      },
    });

    const first = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: draft.branch.id,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'First version' },
      },
    });

    await publishApprovedBranch(cms, {
      rootId: root.rootId,
      branchId: draft.branch.id,
      publishedBy: 'user-1',
    });

    const second = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: draft.branch.id,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Second version' },
      },
    });

    const result = await publishApprovedBranch(cms, {
      rootId: root.rootId,
      branchId: draft.branch.id,
      publishedBy: 'user-2',
    });

    expect(result.publication.commitId).toBe(second.commit.id);
    expect(result.publication.publishedBy).toBe('user-2');

    const rows = await db
      .select()
      .from(publications)
      .where(eq(publications.rootId, root.rootId));

    expect(rows).toHaveLength(1);
    expect(rows[0].commitId).toBe(second.commit.id);
    expect(rows[0].commitId).not.toBe(first.commit.id);
    expect(rows[0].publishedBy).toBe('user-2');
  });

  it('uses middleware userId when publishedBy is omitted', async () => {
    const { cms, db } = await setupTestCMS({
      authMiddleware: async () => ({ userId: 'reviewer-1' }),
    });

    const root = await cms.api.pages.createRoot({
      body: { slug: '/p', properties: { title: 'Page' } },
    });

    const draft = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'draft',
        sourceBranchId: root.branchId,
      },
    });

    await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: draft.branch.id,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Draft content' },
      },
    });

    const result = await publishApprovedBranch(cms, {
      rootId: root.rootId,
      branchId: draft.branch.id,
    });

    expect(result.publication.publishedBy).toBe('reviewer-1');

    const [publication] = await db
      .select()
      .from(publications)
      .where(eq(publications.rootId, root.rootId));

    expect(publication.publishedBy).toBe('reviewer-1');
  });

  it('defaults publishedBy to system when omitted', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/p', properties: { title: 'Page' } },
    });

    const result = await publishApprovedBranch(cms, {
      rootId: root.rootId,
      branchId: root.branchId,
    });

    expect(result.publication.publishedBy).toBe('system');
    expect(result.publication.commitId).toBe(root.commit.id);
  });

  it('rejects when the branch does not exist for the root', async () => {
    const { cms } = await setupTestCMS();

    const rootA = await cms.api.pages.createRoot({
      body: { slug: '/a', properties: { title: 'Page A' } },
    });

    const rootB = await cms.api.pages.createRoot({
      body: { slug: '/b', properties: { title: 'Page B' } },
    });

    await expect(
      cms.api.pages.publishBranch({
        body: { rootId: rootA.rootId, branchId: rootB.branchId },
      }),
    ).rejects.toThrow(/Branch not found/);
  });
});

describe('unpublishBranch', () => {
  it('unpublishes a branch successfully', async () => {
    const { cms, db } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/p', properties: { title: 'Page' } },
    });

    await publishApprovedBranch(cms, {
      rootId: root.rootId,
      branchId: root.branchId,
      publishedBy: 'user-1',
    });

    const result = await cms.api.pages.unpublishBranch({
      body: { rootId: root.rootId, branchId: root.branchId },
    });

    expect(result.rootId).toBe(root.rootId);
    expect(result.branchId).toBe(root.branchId);
    // The previously-live commit + when it was unpublished.
    expect(result.unpublishedCommitId).toBe(root.commit.id);
    expect(result.unpublishedAt).toBeInstanceOf(Date);

    const rows = await db
      .select()
      .from(publications)
      .where(eq(publications.rootId, root.rootId));

    expect(rows).toHaveLength(0);
  });

  it('rejects when the publication does not exist', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/p', properties: { title: 'Page' } },
    });

    await expect(
      cms.api.pages.unpublishBranch({
        body: { rootId: root.rootId, branchId: root.branchId },
      }),
    ).rejects.toThrow(/Publication not found/);
  });

  it('only unpublishes the specified branch', async () => {
    const { cms, db } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/p', properties: { title: 'Page' } },
    });

    const draft = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'draft',
        sourceBranchId: root.branchId,
      },
    });

    await publishApprovedBranch(cms, {
      rootId: root.rootId,
      branchId: root.branchId,
      publishedBy: 'user-1',
    });

    await publishApprovedBranch(cms, {
      rootId: root.rootId,
      branchId: draft.branch.id,
      publishedBy: 'user-2',
    });

    const result = await cms.api.pages.unpublishBranch({
      body: { rootId: root.rootId, branchId: root.branchId },
    });

    expect(result.rootId).toBe(root.rootId);

    const rows = await db
      .select()
      .from(publications)
      .where(eq(publications.rootId, root.rootId));

    expect(rows).toHaveLength(1);
    expect(rows[0].branchId).toBe(draft.branch.id);
    expect(rows[0].publishedBy).toBe('user-2');
  });
});

describe('getPublishedContent', () => {
  it('returns the published tree when looked up by rootId', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/about', properties: { title: 'Page' } },
    });

    await publishApprovedBranch(cms, {
      rootId: root.rootId,
      branchId: root.branchId,
      publishedBy: 'user-1',
    });

    const result = await cms.api.pages.getPublishedContent({
      query: { rootId: root.rootId },
    });

    expect(result.rootId).toBe(root.rootId);
    expect(result.collection).toBe('pages');
    expect(result.variants).toHaveLength(1);
    expect(result.variants[0].branchId).toBe(root.branchId);
    expect(result.variants[0].branchName).toBe('main');
    expect(result.variants[0].commitId).toBe(root.commit.id);
    expect(result.variants[0].publishedBy).toBe('user-1');
    expect(result.variants[0].tree.blockId).toBe(root.rootId);
    expect(result.variants[0].tree.properties).toEqual({
      title: 'Page',
    });
  });

  it('does not invert raw when the wire string "false" is passed', async () => {
    // Regression guard for the z.coerce.boolean() wire trap: over HTTP a
    // client serializes booleans to strings, and `Boolean('false') === true`.
    // The string 'false' must NOT skip variable substitution.
    const { cms } = await setupTestCMS();

    await cms.api.variables.createVariable({
      body: { key: 'brandName', value: 'Toerbo' },
    });

    const root = await cms.api.pages.createRoot({
      body: { slug: '/raw-wire', properties: { title: '{{brandName}} Home' } },
    });

    await publishApprovedBranch(cms, {
      rootId: root.rootId,
      branchId: root.branchId,
      publishedBy: 'user-1',
    });

    const resolved = await cms.api.pages.getPublishedContent({
      query: { rootId: root.rootId, raw: 'false' as unknown as boolean },
    });
    expect(resolved.variants[0].tree.properties).toEqual({
      title: 'Toerbo Home',
    });

    const raw = await cms.api.pages.getPublishedContent({
      query: { rootId: root.rootId, raw: 'true' as unknown as boolean },
    });
    expect(raw.variants[0].tree.properties).toEqual({
      title: '{{brandName}} Home',
    });
  });

  it('returns the published tree when looked up by slug', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/about-us', properties: { title: 'About Us' } },
    });

    await publishApprovedBranch(cms, {
      rootId: root.rootId,
      branchId: root.branchId,
      publishedBy: 'user-1',
    });

    const result = await cms.api.pages.getPublishedContent({
      query: { slug: '/about-us' },
    });

    expect(result.rootId).toBe(root.rootId);
    expect(result.collection).toBe('pages');
    expect(result.variants).toHaveLength(1);
    expect(result.variants[0].tree.properties).toEqual({
      title: 'About Us',
    });
  });

  it('returns multiple variants when two branches are published (A/B)', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/ab', properties: { title: 'Page' } },
    });

    const variant = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'variant-b',
        sourceBranchId: root.branchId,
      },
    });

    await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: variant.branch.id,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Variant B content' },
      },
    });

    await publishApprovedBranch(cms, {
      rootId: root.rootId,
      branchId: root.branchId,
      publishedBy: 'user-1',
    });

    await publishApprovedBranch(cms, {
      rootId: root.rootId,
      branchId: variant.branch.id,
      publishedBy: 'user-2',
    });

    const result = await cms.api.pages.getPublishedContent({
      query: { rootId: root.rootId },
    });

    expect(result.variants).toHaveLength(2);

    const names = result.variants.map((v) => v.branchName).sort();
    expect(names).toEqual(['main', 'variant-b']);

    const variantB = result.variants.find((v) => v.branchName === 'variant-b');
    expect(variantB!.tree.children).toHaveLength(1);
    expect(variantB!.tree.children[0].properties).toEqual({
      text: 'Variant B content',
    });

    const main = result.variants.find((v) => v.branchName === 'main');
    expect(main!.tree.children).toHaveLength(0);
  });

  it('returns multiple variants via slug lookup', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/ab-slug', properties: { title: 'Page' } },
    });

    const variant = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'variant-b',
        sourceBranchId: root.branchId,
      },
    });

    await publishApprovedBranch(cms, {
      rootId: root.rootId,
      branchId: root.branchId,
      publishedBy: 'user-1',
    });

    await publishApprovedBranch(cms, {
      rootId: root.rootId,
      branchId: variant.branch.id,
      publishedBy: 'user-2',
    });

    const result = await cms.api.pages.getPublishedContent({
      query: { slug: '/ab-slug' },
    });

    expect(result.variants).toHaveLength(2);
  });

  it('rejects when no publication exists for the given rootId', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/unpublished', properties: { title: 'Page' } },
    });

    const err = await cms.api.pages
      .getPublishedContent({ query: { rootId: root.rootId } })
      .catch((e: unknown) => e);
    expect(isCMSError(err, 'PUBLISHED_CONTENT_NOT_FOUND')).toBe(true);
  });

  it('rejects when no publication exists for the given slug', async () => {
    const { cms } = await setupTestCMS();

    const err = await cms.api.pages
      .getPublishedContent({ query: { slug: '/nonexistent' } })
      .catch((e: unknown) => e);
    expect(isCMSError(err, 'PUBLISHED_CONTENT_NOT_FOUND')).toBe(true);
  });

  it('rejects the index slug with PUBLISHED_CONTENT_NOT_FOUND', async () => {
    const { cms } = await setupTestCMS();

    const err = await cms.api.pages
      .getPublishedContent({ query: { slug: '/' } })
      .catch((e: unknown) => e);
    expect(isCMSError(err, 'PUBLISHED_CONTENT_NOT_FOUND')).toBe(true);
  });

  it('uses rootId when both rootId and slug are provided', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/both', properties: { title: 'Page' } },
    });

    await publishApprovedBranch(cms, {
      rootId: root.rootId,
      branchId: root.branchId,
      publishedBy: 'user-1',
    });

    const result = await cms.api.pages.getPublishedContent({
      query: {
        rootId: root.rootId,
        slug: '/wrong-slug',
      },
    });

    expect(result.rootId).toBe(root.rootId);
    expect(result.variants).toHaveLength(1);
  });
});

describe('listPublications', () => {
  it('returns paginated list of all publications', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/list', properties: { title: 'Page' } },
    });

    const draft = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'draft',
        sourceBranchId: root.branchId,
      },
    });

    await publishApprovedBranch(cms, {
      rootId: root.rootId,
      branchId: root.branchId,
      publishedBy: 'user-1',
    });

    await publishApprovedBranch(cms, {
      rootId: root.rootId,
      branchId: draft.branch.id,
      publishedBy: 'user-2',
    });

    const result = await cms.api.pages.listPublications({ query: {} });

    expect(result.publications).toHaveLength(2);
    expect(result.total).toBe(2);
    expect(result.hasMore).toBe(false);

    const branchNames = result.publications.map((p) => p.branchName).sort();
    expect(branchNames).toEqual(['draft', 'main']);
  });

  it('filters by rootId', async () => {
    const { cms } = await setupTestCMS();

    const rootA = await cms.api.pages.createRoot({
      body: { slug: '/a', properties: { title: 'Page A' } },
    });

    const rootB = await cms.api.pages.createRoot({
      body: { slug: '/b', properties: { title: 'Page B' } },
    });

    await publishApprovedBranch(cms, {
      rootId: rootA.rootId,
      branchId: rootA.branchId,
      publishedBy: 'user-1',
    });

    await publishApprovedBranch(cms, {
      rootId: rootB.rootId,
      branchId: rootB.branchId,
      publishedBy: 'user-2',
    });

    const result = await cms.api.pages.listPublications({
      query: { rootId: rootA.rootId },
    });

    expect(result.publications).toHaveLength(1);
    expect(result.publications[0].rootId).toBe(rootA.rootId);
    expect(result.publications[0].publishedBy).toBe('user-1');
  });

  it('filters by branchId', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/filter-branch', properties: { title: 'Page' } },
    });

    const draft = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'draft',
        sourceBranchId: root.branchId,
      },
    });

    await publishApprovedBranch(cms, {
      rootId: root.rootId,
      branchId: root.branchId,
      publishedBy: 'user-1',
    });

    await publishApprovedBranch(cms, {
      rootId: root.rootId,
      branchId: draft.branch.id,
      publishedBy: 'user-2',
    });

    const result = await cms.api.pages.listPublications({
      query: { branchId: draft.branch.id },
    });

    expect(result.publications).toHaveLength(1);
    expect(result.publications[0].branchId).toBe(draft.branch.id);
    expect(result.publications[0].branchName).toBe('draft');
  });

  it('respects limit and offset pagination', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/pagination', properties: { title: 'Page' } },
    });

    // Create and publish 3 branches
    for (let i = 1; i <= 2; i++) {
      const branch = await cms.api.pages.createBranch({
        body: {
          rootId: root.rootId,
          name: `branch-${i}`,
          sourceBranchId: root.branchId,
        },
      });

      await publishApprovedBranch(cms, {
        rootId: root.rootId,
        branchId: branch.branch.id,
        publishedBy: `user-${i}`,
      });
    }

    // Also publish main
    await publishApprovedBranch(cms, {
      rootId: root.rootId,
      branchId: root.branchId,
      publishedBy: 'user-main',
    });

    // Get first page with limit 2
    const page1 = await cms.api.pages.listPublications({
      query: { rootId: root.rootId, limit: 2, offset: 0 },
    });

    expect(page1.publications).toHaveLength(2);
    expect(page1.total).toBe(3);
    expect(page1.hasMore).toBe(true);

    // Get second page
    const page2 = await cms.api.pages.listPublications({
      query: { rootId: root.rootId, limit: 2, offset: 2 },
    });

    expect(page2.publications).toHaveLength(1);
    expect(page2.total).toBe(3);
    expect(page2.hasMore).toBe(false);
  });

  it('returns empty array when no publications match filters', async () => {
    const { cms } = await setupTestCMS();

    const result = await cms.api.pages.listPublications({
      query: { rootId: 'nonexistent-root-id' },
    });

    expect(result.publications).toHaveLength(0);
    expect(result.total).toBe(0);
    expect(result.hasMore).toBe(false);
  });

  it('includes rootProperties in response', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/test-props', properties: { title: 'Test Title' } },
    });

    await publishApprovedBranch(cms, {
      rootId: root.rootId,
      branchId: root.branchId,
      publishedBy: 'user-1',
    });

    const result = await cms.api.pages.listPublications({
      query: { rootId: root.rootId },
    });

    expect(result.publications).toHaveLength(1);
    expect(result.publications[0].rootProperties).toEqual({
      title: 'Test Title',
    });
  });

  it('supports sorting by publishedAt in both directions', async () => {
    const { cms, db } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/sort', properties: { title: 'Page' } },
    });

    const draft = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'draft',
        sourceBranchId: root.branchId,
      },
    });

    // Publish main first
    await publishApprovedBranch(cms, {
      rootId: root.rootId,
      branchId: root.branchId,
      publishedBy: 'user-1',
    });

    // Backdate main's publication so the draft publish below is deterministically
    // newer, without a real sleep. (rootId, branchId) is the publications PK, so
    // this targets exactly the main row.
    await db
      .update(publications)
      .set({ publishedAt: new Date(Date.now() - 60_000) })
      .where(
        and(
          eq(publications.rootId, root.rootId),
          eq(publications.branchId, root.branchId),
        ),
      );

    await publishApprovedBranch(cms, {
      rootId: root.rootId,
      branchId: draft.branch.id,
      publishedBy: 'user-2',
    });

    // Sort desc (default) - draft should be first
    const descResult = await cms.api.pages.listPublications({
      query: { rootId: root.rootId, sortDirection: 'desc' },
    });

    expect(descResult.publications[0].branchName).toBe('draft');

    // Sort asc - main should be first
    const ascResult = await cms.api.pages.listPublications({
      query: { rootId: root.rootId, sortDirection: 'asc' },
    });

    expect(ascResult.publications[0].branchName).toBe('main');
  });

  it('filters by publishedAfter and publishedBefore', async () => {
    const { cms, db } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/date-filters', properties: { title: 'Page' } },
    });

    await publishApprovedBranch(cms, {
      rootId: root.rootId,
      branchId: root.branchId,
      publishedBy: 'user-1',
    });

    // Backdate main's publication so it is deterministically older than the
    // draft publish below, without a real sleep. The ±1ms boundary filters
    // asserted on later only partition the two rows if their timestamps differ.
    await db
      .update(publications)
      .set({ publishedAt: new Date(Date.now() - 60_000) })
      .where(
        and(
          eq(publications.rootId, root.rootId),
          eq(publications.branchId, root.branchId),
        ),
      );

    const firstPublication = await cms.api.pages.listPublications({
      query: { rootId: root.rootId },
    });
    const firstPublishedAt = firstPublication.publications[0]
      .publishedAt as Date;

    const draft = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'draft',
        sourceBranchId: root.branchId,
      },
    });

    await publishApprovedBranch(cms, {
      rootId: root.rootId,
      branchId: draft.branch.id,
      publishedBy: 'user-2',
    });

    const secondPublication = await cms.api.pages.listPublications({
      query: { branchId: draft.branch.id },
    });
    const secondPublishedAt = secondPublication.publications[0]
      .publishedAt as Date;

    const afterFirst = await cms.api.pages.listPublications({
      query: {
        rootId: root.rootId,
        publishedAfter: new Date(firstPublishedAt.getTime() + 1),
      },
    });
    const beforeSecond = await cms.api.pages.listPublications({
      query: {
        rootId: root.rootId,
        publishedBefore: new Date(secondPublishedAt.getTime() - 1),
      },
    });

    expect(afterFirst.publications).toHaveLength(1);
    expect(afterFirst.publications[0].branchId).toBe(draft.branch.id);
    expect(afterFirst.total).toBe(1);

    expect(beforeSecond.publications).toHaveLength(1);
    expect(beforeSecond.publications[0].branchId).toBe(root.branchId);
    expect(beforeSecond.total).toBe(1);
  });

  it('excludes publications whose root was soft-deleted', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/del-pub', properties: { title: 'Page' } },
    });
    await publishApprovedBranch(cms, {
      rootId: root.rootId,
      branchId: root.branchId,
      publishedBy: 'user-1',
    });

    const before = await cms.api.pages.listPublications({ query: {} });
    expect(before.total).toBeGreaterThan(0);

    // Soft-delete the page; its publications must drop out of the list.
    await cms.api.pages.archiveRoot({ body: { rootId: root.rootId } });

    const after = await cms.api.pages.listPublications({ query: {} });
    expect(after.total).toBe(0);
    expect(after.publications).toHaveLength(0);
  });
});

// ============================================================================
// Slug materialization on publish
// ============================================================================

describe('slug materialization on publish', () => {
  const dbSlug = async (db: any, rootId: string): Promise<string | null> => {
    const [r] = await db.select().from(roots).where(eq(roots.id, rootId));
    return r.slug;
  };

  it('publishing the default branch materializes the draft slug into roots.slug', async () => {
    const { cms, db } = await setupTestCMS();
    const root = await cms.api.pages.createRoot({
      body: { slug: '/about', properties: { title: 'About' } },
    });
    expect(await dbSlug(db, root.rootId)).toBeNull();

    await cms.api.pages.publishBranch({
      body: { rootId: root.rootId, branchId: root.branchId },
    });
    expect(await dbSlug(db, root.rootId)).toBe('about');

    // getPublishedContent now resolves by slug AND by path.
    const bySlug = await cms.api.pages.getPublishedContent({
      query: { slug: '/about' },
    });
    expect(bySlug.rootId).toBe(root.rootId);
    const byPath = await cms.api.pages.getPublishedContent({
      query: { path: '/pages/about' },
    });
    expect(byPath.rootId).toBe(root.rootId);
    // __slug never leaks into the public tree.
    expect(
      (bySlug.variants[0].tree.properties as { __slug?: string }).__slug,
    ).toBeUndefined();
  });

  it('re-publishing a renamed default branch moves roots.slug to the new slug', async () => {
    const { cms, db } = await setupTestCMS();
    const root = await cms.api.pages.createRoot({
      body: { slug: '/old', properties: { title: 'P' } },
    });
    await cms.api.pages.publishBranch({
      body: { rootId: root.rootId, branchId: root.branchId },
    });
    await cms.api.pages.updateRoot({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        slug: 'new',
        properties: { title: 'P' },
      },
    });
    // Draft rename not yet live.
    expect(await dbSlug(db, root.rootId)).toBe('old');
    await cms.api.pages.publishBranch({
      body: { rootId: root.rootId, branchId: root.branchId },
    });
    expect(await dbSlug(db, root.rootId)).toBe('new');
  });

  it('throws PUBLISH_SLUG_CONFLICT when publishing a slug already live on another page', async () => {
    const { cms } = await setupTestCMS();
    const a = await cms.api.pages.createRoot({
      body: { slug: '/dup', properties: { title: 'A' } },
    });
    const b = await cms.api.pages.createRoot({
      body: { slug: '/dup', properties: { title: 'B' } },
    });
    // Drafts may collide — first publish wins.
    await cms.api.pages.publishBranch({
      body: { rootId: a.rootId, branchId: a.branchId },
    });
    await expect(
      cms.api.pages.publishBranch({
        body: { rootId: b.rootId, branchId: b.branchId },
      }),
    ).rejects.toThrow(/PUBLISH_SLUG_CONFLICT|already uses this slug/i);
  });

  it('only the DEFAULT branch materializes roots.slug — a variant publish does not', async () => {
    const { cms, db } = await setupTestCMS();
    const root = await cms.api.pages.createRoot({
      body: { slug: '/base', properties: { title: 'P' } },
    });
    // Establish the live slug via the default (main) branch.
    await cms.api.pages.publishBranch({
      body: { rootId: root.rootId, branchId: root.branchId },
    });
    expect(await dbSlug(db, root.rootId)).toBe('base');

    // A variant branch with a DIFFERENT draft slug, published live (A/B).
    const variant = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'variant-b',
        sourceBranchId: root.branchId,
      },
    });
    await cms.api.pages.updateRoot({
      body: {
        rootId: root.rootId,
        branchId: variant.branch.id,
        slug: 'variant-slug',
        properties: { title: 'P' },
      },
    });
    await cms.api.pages.publishBranch({
      body: { rootId: root.rootId, branchId: variant.branch.id },
    });
    // The live URL is unchanged — a non-default publish never overwrites roots.slug.
    expect(await dbSlug(db, root.rootId)).toBe('base');
  });

  it('the FIRST publish of ANY branch seeds a still-null roots.slug', async () => {
    const { cms, db } = await setupTestCMS();
    const root = await cms.api.pages.createRoot({
      body: { slug: '/seed-me', properties: { title: 'P' } },
    });
    expect(await dbSlug(db, root.rootId)).toBeNull();

    // Publish a NON-default branch first, while roots.slug is still null → seeds.
    const variant = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'variant-b',
        sourceBranchId: root.branchId,
      },
    });
    await cms.api.pages.publishBranch({
      body: { rootId: root.rootId, branchId: variant.branch.id },
    });
    expect(await dbSlug(db, root.rootId)).toBe('seed-me');
  });

  it('end-to-end: a draft slug edit does not change the live URL until publish', async () => {
    const { cms } = await setupTestCMS();
    const root = await cms.api.pages.createRoot({
      body: { slug: '/old', properties: { title: 'P' } },
    });
    await cms.api.pages.publishBranch({
      body: { rootId: root.rootId, branchId: root.branchId },
    });
    // Live at /pages/old.
    expect(
      (
        await cms.api.pages.getPublishedContent({
          query: { path: '/pages/old' },
        })
      ).rootId,
    ).toBe(root.rootId);

    // Draft-rename the slug — the live URL is UNCHANGED.
    await cms.api.pages.updateRoot({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        slug: 'new',
        properties: { title: 'P' },
      },
    });
    expect(
      (
        await cms.api.pages.getPublishedContent({
          query: { path: '/pages/old' },
        })
      ).rootId,
    ).toBe(root.rootId);
    await expect(
      cms.api.pages.getPublishedContent({ query: { path: '/pages/new' } }),
    ).rejects.toThrow(/No published content found/);

    // Publish → the live URL moves to /pages/new (and /pages/old redirects).
    await cms.api.pages.publishBranch({
      body: { rootId: root.rootId, branchId: root.branchId },
    });
    expect(
      (
        await cms.api.pages.getPublishedContent({
          query: { path: '/pages/new' },
        })
      ).rootId,
    ).toBe(root.rootId);
    const redirect = await cms.api.pages.resolveRedirect({
      query: { path: '/pages/old' },
    });
    expect(redirect.redirect).toEqual({
      status: 301,
      location: '/pages/new',
    });
  });
});
