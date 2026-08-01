import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { publications } from '../../../schema';
import { setupTestCMS } from '../../../test-utils/cms';

describe('releases — atomic multi-page publish', () => {
  it('publishRelease publishes every item and flips the release to published', async () => {
    const { cms, db } = await setupTestCMS();

    const r1 = await cms.api.pages.createRoot({
      body: { slug: '/a', properties: { title: 'A' } },
    });
    const r2 = await cms.api.pages.createRoot({
      body: { slug: '/b', properties: { title: 'B' } },
    });

    const { release } = await cms.api.releases.createRelease({
      body: { title: 'Launch' },
    });
    expect(release.status).toBe('draft');

    await cms.api.releases.addToRelease({
      body: { releaseId: release.id, rootId: r1.rootId, branchId: r1.branchId },
    });
    await cms.api.releases.addToRelease({
      body: { releaseId: release.id, rootId: r2.rootId, branchId: r2.branchId },
    });

    const outcome = await cms.api.releases.publishRelease({
      body: { releaseId: release.id },
    });

    expect(outcome.release.status).toBe('published');
    expect(outcome.release.publishedAt).toBeInstanceOf(Date);
    expect(outcome.publications).toHaveLength(2);

    // Both roots are live.
    for (const rootId of [r1.rootId, r2.rootId]) {
      const pubs = await db
        .select()
        .from(publications)
        .where(eq(publications.rootId, rootId));
      expect(pubs).toHaveLength(1);
    }
  });

  it('rolls the WHOLE release back when one item fails to publish (atomicity)', async () => {
    // Global policy: publishing requires approval. r1 will be approved, r2 will
    // not — so publishing the release must fail on r2 and undo r1 too.
    const { cms, db } = await setupTestCMS({
      branchProtection: { requireApprovalBeforePublish: true },
    });

    const r1 = await cms.api.pages.createRoot({
      body: { slug: '/a', properties: { title: 'A' } },
    });
    const r2 = await cms.api.pages.createRoot({
      body: { slug: '/b', properties: { title: 'B' } },
    });

    // Approve r1's branch only.
    const req = await cms.api.pages.requestApproval({
      body: { branchId: r1.branchId, requestedReviewers: ['reviewer-1'] },
      context: { userId: 'requester-1' },
    });
    await cms.api.pages.submitApproval({
      body: { approvalId: req.approvals[0].id },
      context: { userId: 'reviewer-1' },
    });

    const { release } = await cms.api.releases.createRelease({
      body: { title: 'Half-approved' },
    });
    await cms.api.releases.addToRelease({
      body: { releaseId: release.id, rootId: r1.rootId, branchId: r1.branchId },
    });
    await cms.api.releases.addToRelease({
      body: { releaseId: release.id, rootId: r2.rootId, branchId: r2.branchId },
    });

    await expect(
      cms.api.releases.publishRelease({ body: { releaseId: release.id } }),
    ).rejects.toThrow();

    // Nothing went live — not even the approved r1 (rolled back with the tx).
    for (const rootId of [r1.rootId, r2.rootId]) {
      const pubs = await db
        .select()
        .from(publications)
        .where(eq(publications.rootId, rootId));
      expect(pubs).toHaveLength(0);
    }

    // The release stays a draft, so it can be fixed and retried.
    const { release: after } = await cms.api.releases.getRelease({
      query: { releaseId: release.id },
    });
    expect(after.status).toBe('draft');
    expect(after.publishedAt).toBeNull();
  });

  it('addToRelease upserts: re-adding a root swaps its branch', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/a', properties: { title: 'A' } },
    });
    const other = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'draft',
        sourceBranchId: root.branchId,
      },
    });

    const { release } = await cms.api.releases.createRelease({
      body: { title: 'Swap' },
    });
    await cms.api.releases.addToRelease({
      body: {
        releaseId: release.id,
        rootId: root.rootId,
        branchId: root.branchId,
      },
    });
    await cms.api.releases.addToRelease({
      body: {
        releaseId: release.id,
        rootId: root.rootId,
        branchId: other.branch.id,
      },
    });

    const { items } = await cms.api.releases.getRelease({
      query: { releaseId: release.id },
    });
    // Still one item for the root, now pointing at the second branch.
    expect(items).toHaveLength(1);
    expect(items[0].branchId).toBe(other.branch.id);
  });

  it('publishRelease refuses an empty release', async () => {
    const { cms } = await setupTestCMS();
    const { release } = await cms.api.releases.createRelease({
      body: { title: 'Empty' },
    });
    await expect(
      cms.api.releases.publishRelease({ body: { releaseId: release.id } }),
    ).rejects.toThrow();
  });

  it('publishRelease is gated by publication:create, not release:update', async () => {
    // A role granted release:update (curation: createRelease/addToRelease) but
    // denied publication:create must NOT be able to ship the release — that
    // was the bypass this plan closes (publishRelease used to declare
    // release:update, the same label as pure curation).
    const { cms } = await setupTestCMS({
      authMiddleware: async (ctx) => {
        if (
          ctx.permissionResource === 'publication' &&
          ctx.operation === 'create'
        ) {
          throw new Error('DENIED: publication:create');
        }
        return {};
      },
    });

    const root = await cms.api.pages.createRoot({
      body: { slug: '/a', properties: { title: 'A' } },
    });

    const { release } = await cms.api.releases.createRelease({
      body: { title: 'Launch' },
    });
    await cms.api.releases.addToRelease({
      body: {
        releaseId: release.id,
        rootId: root.rootId,
        branchId: root.branchId,
      },
    });

    await expect(
      cms.api.releases.publishRelease({ body: { releaseId: release.id } }),
    ).rejects.toThrow(/denied/i);
  });
});
