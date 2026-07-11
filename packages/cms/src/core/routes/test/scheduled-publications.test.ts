import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { publications, scheduledPublications } from '../../../schema';
import { setupTestCMS } from '../../../test-utils/cms';

describe('scheduled publishing', () => {
  it('runScheduled publishes a DUE intent and leaves a not-yet-due one queued', async () => {
    const { cms, db } = await setupTestCMS();

    const dueRoot = await cms.api.pages.createRoot({
      body: { slug: '/due', properties: { title: 'Due' } },
    });
    const futureRoot = await cms.api.pages.createRoot({
      body: { slug: '/future', properties: { title: 'Future' } },
    });

    const dueSched = await cms.api.pages.schedulePublication({
      body: {
        rootId: dueRoot.rootId,
        branchId: dueRoot.branchId,
        // Already past → due this pass.
        scheduledAt: new Date(Date.now() - 60_000),
      },
    });
    const futureSched = await cms.api.pages.scheduleUnpublish({
      body: {
        rootId: futureRoot.rootId,
        branchId: futureRoot.branchId,
        // Far in the future → must NOT be processed this pass.
        scheduledAt: new Date(Date.now() + 60 * 60_000),
      },
    });

    expect(dueSched.scheduled.action).toBe('publish');
    expect(dueSched.scheduled.processedAt).toBeNull();

    const result = await cms.api.admin.runScheduled({ body: {} });

    expect(result.processed).toBe(1);
    expect(result.published).toBe(1);
    expect(result.unpublished).toBe(0);
    expect(result.failed).toEqual([]);

    // Due root is now published.
    const duePubs = await db
      .select()
      .from(publications)
      .where(eq(publications.rootId, dueRoot.rootId));
    expect(duePubs).toHaveLength(1);

    // Future root is untouched.
    const futurePubs = await db
      .select()
      .from(publications)
      .where(eq(publications.rootId, futureRoot.rootId));
    expect(futurePubs).toHaveLength(0);

    // Due row stamped processed; future row still pending.
    const [dueRow] = await db
      .select()
      .from(scheduledPublications)
      .where(eq(scheduledPublications.id, dueSched.scheduled.id));
    expect(dueRow.processedAt).toBeInstanceOf(Date);

    const [futureRow] = await db
      .select()
      .from(scheduledPublications)
      .where(eq(scheduledPublications.id, futureSched.scheduled.id));
    expect(futureRow.processedAt).toBeNull();

    // A second pass finds no due work and is a no-op.
    const second = await cms.api.admin.runScheduled({ body: {} });
    expect(second.processed).toBe(0);
  });

  it('runScheduled unpublishes a live page when a due expiry (scheduled unpublish) fires', async () => {
    const { cms, db } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/x', properties: { title: 'X' } },
    });
    await cms.api.pages.publishBranch({
      body: { rootId: root.rootId, branchId: root.branchId },
    });

    // Sanity: it is live.
    expect(
      await db
        .select()
        .from(publications)
        .where(eq(publications.rootId, root.rootId)),
    ).toHaveLength(1);

    await cms.api.pages.scheduleUnpublish({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        scheduledAt: new Date(Date.now() - 1_000),
      },
    });

    const result = await cms.api.admin.runScheduled({ body: {} });
    expect(result.unpublished).toBe(1);
    expect(result.failed).toEqual([]);

    // The publication is gone (content expired).
    expect(
      await db
        .select()
        .from(publications)
        .where(eq(publications.rootId, root.rootId)),
    ).toHaveLength(0);
  });

  it('rejects scheduling for a branch that does not belong to the root', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/y', properties: { title: 'Y' } },
    });

    await expect(
      cms.api.pages.schedulePublication({
        body: {
          rootId: root.rootId,
          branchId: 'branch_does_not_exist',
          scheduledAt: new Date(),
        },
      }),
    ).rejects.toThrow();
  });
});
