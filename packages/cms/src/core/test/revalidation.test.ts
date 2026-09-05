import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import type { RevalidationRunner } from '../revalidation';
import type { RevalidateEvent } from '../types/definitions';

import { setupTestDB } from '../../test-utils/db';
import { DUMMY_MEDIA_CONFIG } from '../../test-utils/fixtures';
import { allowAnonymous } from '../define';
import { cmsMeta, createCMSEndpoint, toCMSEndpoints } from '../endpoint';
import { createCMS } from '../factory';
import { createHookRunner } from '../hooks';
import { rootRevalidateTag } from '../revalidation';

/**
 * Revalidate-by-tag contract: every revalidation event a root fires
 * (publish/unpublish, plus cascade to hosts) carries the root's cache tag, so
 * the A/B variant-coded render routes (which tag their fetch by it) invalidate
 * their control + all variant cache entries on a content change.
 */

const COLLECTIONS = {
  pages: {
    label: 'Pages',
    slug: { enabled: true, prefix: '/' },
    root: {
      properties: {
        title: {
          type: 'string' as const,
          label: 'Title',
          required: true as const,
        },
      },
    },
  },
} as const;

const NESTED_COLLECTIONS = {
  pages: {
    label: 'Pages',
    slug: { enabled: true, prefix: '/', nested: true },
    root: {
      properties: {
        title: {
          type: 'string' as const,
          label: 'Title',
          required: true as const,
        },
      },
    },
  },
} as const;

type AnyApi = {
  api: Record<string, Record<string, (...a: any[]) => Promise<any>>>;
};

const cleanups: Array<() => Promise<void>> = [];
afterAll(async () => {
  await Promise.allSettled(cleanups.map((fn) => fn()));
});

describe('revalidation tags', () => {
  it('fires a publishBranch event carrying the root cache tag', async () => {
    const events: RevalidateEvent<typeof COLLECTIONS>[] = [];
    const { db, cleanup } = await setupTestDB({ plugins: [] });
    cleanups.push(cleanup);

    const cms = createCMS({
      db,
      authMiddleware: allowAnonymous(),
      media: DUMMY_MEDIA_CONFIG,
      collections: COLLECTIONS,
      onRevalidate: (event) => {
        events.push(event);
      },
    }) as AnyApi;

    const root = await cms.api.pages.createRoot({
      body: { slug: 'home', properties: { title: 'Home' } },
    });
    const req = await cms.api.pages.requestApproval({
      body: {
        branchId: root.branchId,
        requestedReviewers: ['rev'],
      },
      context: { userId: 'r' },
    });
    await cms.api.pages.submitApproval({
      body: { approvalId: req.approvals[0].id },
      context: { userId: 'rev' },
    });
    await cms.api.pages.publishBranch({
      body: { rootId: root.rootId, branchId: root.branchId, publishedBy: 'a' },
    });

    const published = events.filter((e) => e.action === 'publishBranch');
    expect(published.length).toBeGreaterThan(0);
    expect(published[0].tags).toContain(rootRevalidateTag(root.rootId));
  });

  it('revalidates the OLD path on a published slug change (so the auto-redirect surfaces immediately)', async () => {
    const events: RevalidateEvent<typeof COLLECTIONS>[] = [];
    const { db, cleanup } = await setupTestDB({ plugins: [] });
    cleanups.push(cleanup);

    const cms = createCMS({
      db,
      authMiddleware: allowAnonymous(),
      media: DUMMY_MEDIA_CONFIG,
      collections: COLLECTIONS,
      onRevalidate: (event) => {
        events.push(event);
      },
    }) as AnyApi;

    const root = await cms.api.pages.createRoot({
      body: { slug: 'home', properties: { title: 'Home' } },
    });
    const req = await cms.api.pages.requestApproval({
      body: {
        branchId: root.branchId,
        requestedReviewers: ['rev'],
      },
      context: { userId: 'r' },
    });
    await cms.api.pages.submitApproval({
      body: { approvalId: req.approvals[0].id },
      context: { userId: 'rev' },
    });
    await cms.api.pages.publishBranch({
      body: { rootId: root.rootId, branchId: root.branchId, publishedBy: 'a' },
    });

    // The draft rename is not live yet; it materializes on publish, which is
    // where the old-path-to-page redirect is auto-created.
    await cms.api.pages.updateRoot({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        slug: 'home-2',
        properties: { title: 'Home' },
      },
    });
    await cms.api.pages.publishBranch({
      body: { rootId: root.rootId, branchId: root.branchId, publishedBy: 'a' },
    });

    // The publish that materialized the rename revalidates old + new paths.
    const ev = [...events].reverse().find((e) => e.action === 'publishBranch');
    expect(ev).toBeDefined();
    // The new path is revalidated …
    expect(ev!.paths.some((p) => p.includes('home-2'))).toBe(true);
    // … AND the OLD path too, or its cached 404/old-page would shadow the
    // freshly-created redirect until the ISR TTL.
    expect(
      ev!.paths.some((p) => p.includes('home') && !p.includes('home-2')),
    ).toBe(true);
  });

  it('revalidates the archived path on deleteRoot (so the redirect-to-parent surfaces immediately)', async () => {
    const events: RevalidateEvent<typeof COLLECTIONS>[] = [];
    const { db, cleanup } = await setupTestDB({ plugins: [] });
    cleanups.push(cleanup);

    const cms = createCMS({
      db,
      authMiddleware: allowAnonymous(),
      media: DUMMY_MEDIA_CONFIG,
      collections: COLLECTIONS,
      onRevalidate: (event) => {
        events.push(event);
      },
    }) as AnyApi;

    const root = await cms.api.pages.createRoot({
      body: { slug: 'gone', properties: { title: 'Gone' } },
    });
    const req = await cms.api.pages.requestApproval({
      body: {
        branchId: root.branchId,
        requestedReviewers: ['rev'],
      },
      context: { userId: 'r' },
    });
    await cms.api.pages.submitApproval({
      body: { approvalId: req.approvals[0].id },
      context: { userId: 'rev' },
    });
    await cms.api.pages.publishBranch({
      body: { rootId: root.rootId, branchId: root.branchId, publishedBy: 'a' },
    });

    // Archive (soft-delete) the published page → auto-creates old-path → parent.
    // archiveRoot carries no branchId, so the runner resolves the published branch.
    await cms.api.pages.archiveRoot({ body: { rootId: root.rootId } });

    const ev = events.find((e) => e.action === 'archiveRoot');
    expect(ev).toBeDefined();
    expect(ev!.paths.some((p) => p.includes('gone'))).toBe(true);
  });

  it('revalidates the OLD path on moveRoot/reparent (nested, branch-agnostic)', async () => {
    const events: RevalidateEvent<typeof NESTED_COLLECTIONS>[] = [];
    const { db, cleanup } = await setupTestDB({ plugins: [] });
    cleanups.push(cleanup);

    const cms = createCMS({
      db,
      authMiddleware: allowAnonymous(),
      media: DUMMY_MEDIA_CONFIG,
      collections: NESTED_COLLECTIONS,
      onRevalidate: (event) => {
        events.push(event);
      },
    }) as AnyApi;

    const parentA = await cms.api.pages.createRoot({
      body: { slug: 'a', properties: { title: 'A' } },
    });
    const parentB = await cms.api.pages.createRoot({
      body: { slug: 'b', properties: { title: 'B' } },
    });
    const child = await cms.api.pages.createRoot({
      body: {
        slug: 'c',
        parentRootId: parentA.rootId,
        properties: { title: 'C' },
      },
    });
    // Publish the whole chain so its slugs materialize into the live
    // /docs/a/c path before the reparent (moveRoot reads roots.slug).
    for (const r of [parentA, parentB, child]) {
      await cms.api.pages.publishBranch({
        body: { rootId: r.rootId, branchId: r.branchId, publishedBy: 'a' },
      });
    }

    // Reparent A→B: old path /a/c, new path /b/c; auto-creates the /a/c → page redirect.
    await cms.api.pages.moveRoot({
      body: { rootId: child.rootId, newParentRootId: parentB.rootId },
    });

    const ev = events.find((e) => e.action === 'moveRoot');
    expect(ev).toBeDefined();
    // OLD path (under parent A) is revalidated …
    expect(ev!.paths.some((p) => p.includes('a/c'))).toBe(true);
    // … alongside the new path (under parent B).
    expect(ev!.paths.some((p) => p.includes('b/c'))).toBe(true);
  });
});

describe('revalidation is best-effort', () => {
  it('carries the pre-resolved slug through to the unpublishBranch event (publication row is gone by postProcess)', async () => {
    const events: RevalidateEvent<typeof COLLECTIONS>[] = [];
    const { db, cleanup } = await setupTestDB({ plugins: [] });
    cleanups.push(cleanup);

    const cms = createCMS({
      db,
      authMiddleware: allowAnonymous(),
      media: DUMMY_MEDIA_CONFIG,
      collections: COLLECTIONS,
      onRevalidate: (event) => {
        events.push(event);
      },
    }) as AnyApi;

    const root = await cms.api.pages.createRoot({
      body: { slug: 'unpub-me', properties: { title: 'Unpub' } },
    });
    const req = await cms.api.pages.requestApproval({
      body: {
        branchId: root.branchId,
        requestedReviewers: ['rev'],
      },
      context: { userId: 'r' },
    });
    await cms.api.pages.submitApproval({
      body: { approvalId: req.approvals[0].id },
      context: { userId: 'rev' },
    });
    await cms.api.pages.publishBranch({
      body: { rootId: root.rootId, branchId: root.branchId, publishedBy: 'a' },
    });

    // The publication row is gone before postProcess runs, so the slug must
    // come from the preProcess result.
    await cms.api.pages.unpublishBranch({
      body: { rootId: root.rootId, branchId: root.branchId },
    });

    const ev = events.find((e) => e.action === 'unpublishBranch');
    expect(ev).toBeDefined();
    expect(ev!.storedSlug).toBe('unpub-me');
  });

  it('does not fail a committed publishBranch when postProcess (revalidation) throws', async () => {
    const events: RevalidateEvent<typeof COLLECTIONS>[] = [];
    const { db, cleanup } = await setupTestDB({ plugins: [] });
    cleanups.push(cleanup);

    const cms = createCMS({
      db,
      authMiddleware: allowAnonymous(),
      media: DUMMY_MEDIA_CONFIG,
      collections: COLLECTIONS,
      onRevalidate: (event) => {
        events.push(event);
      },
    }) as AnyApi;

    const root = await cms.api.pages.createRoot({
      body: { slug: 'resilient', properties: { title: 'Resilient' } },
    });
    const req = await cms.api.pages.requestApproval({
      body: {
        branchId: root.branchId,
        requestedReviewers: ['rev'],
      },
      context: { userId: 'r' },
    });
    await cms.api.pages.submitApproval({
      body: { approvalId: req.approvals[0].id },
      context: { userId: 'rev' },
    });
    await cms.api.pages.publishBranch({
      body: { rootId: root.rootId, branchId: root.branchId, publishedBy: 'a' },
    });

    // publishBranch's postProcess reads cms.redirects (subtreeInboundRedirectPaths)
    // and the republish itself does not, so dropping the table fails only
    // postProcess.
    await db.execute(sql`DROP TABLE cms.redirects CASCADE`);

    const result = await cms.api.pages.publishBranch({
      body: { rootId: root.rootId, branchId: root.branchId, publishedBy: 'a' },
    });
    expect(result).toBeDefined();
  });

  it('does not fail the endpoint when preProcess or postProcess throws (stub runner)', async () => {
    const preErr = new Error('preProcess boom');
    const postErr = new Error('postProcess boom');
    const stubRunner: RevalidationRunner = {
      shouldProcess: () => true,
      preProcess: async () => {
        throw preErr;
      },
      postProcess: async () => {
        throw postErr;
      },
      fireManual: async () => {},
      fireManualUnpublish: async () => {},
    };

    const testEndpoint = createCMSEndpoint(
      '/test/action',
      {
        method: 'POST',
        metadata: cmsMeta({}, { operation: 'update', scope: 'system' }),
      },
      async () => ({ ok: true }),
    );

    const wrapped = toCMSEndpoints(
      { testAction: testEndpoint },
      { db: undefined as never, collections: {} },
      undefined,
      createHookRunner([], []),
      stubRunner,
    );

    await expect(
      (wrapped.testAction as unknown as (ctx: unknown) => Promise<unknown>)({
        body: {},
      }),
    ).resolves.toEqual({ ok: true });
  });
});

describe('revalidation for scheduled and release publishes', () => {
  it('fires a publishBranch event when a scheduled publish goes live via admin.runScheduled', async () => {
    const events: RevalidateEvent<typeof COLLECTIONS>[] = [];
    const { db, cleanup } = await setupTestDB({ plugins: [] });
    cleanups.push(cleanup);

    const cms = createCMS({
      db,
      authMiddleware: allowAnonymous(),
      media: DUMMY_MEDIA_CONFIG,
      collections: COLLECTIONS,
      onRevalidate: (event) => {
        events.push(event);
      },
    }) as AnyApi;

    const root = await cms.api.pages.createRoot({
      body: { slug: 'scheduled-pub', properties: { title: 'Scheduled' } },
    });
    await cms.api.pages.schedulePublication({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        scheduledAt: new Date(Date.now() - 60_000),
      },
    });

    events.length = 0;
    const result = await cms.api.admin.runScheduled({ body: {} });
    expect(result.published).toBe(1);

    const ev = events.find(
      (e) => e.action === 'publishBranch' && e.rootId === root.rootId,
    );
    expect(ev).toBeDefined();
  });

  it('fires an unpublishBranch event (with the pre-published slug) when a scheduled unpublish fires', async () => {
    const events: RevalidateEvent<typeof COLLECTIONS>[] = [];
    const { db, cleanup } = await setupTestDB({ plugins: [] });
    cleanups.push(cleanup);

    const cms = createCMS({
      db,
      authMiddleware: allowAnonymous(),
      media: DUMMY_MEDIA_CONFIG,
      collections: COLLECTIONS,
      onRevalidate: (event) => {
        events.push(event);
      },
    }) as AnyApi;

    const root = await cms.api.pages.createRoot({
      body: { slug: 'scheduled-unpub', properties: { title: 'Scheduled' } },
    });
    await cms.api.pages.publishBranch({
      body: { rootId: root.rootId, branchId: root.branchId, publishedBy: 'a' },
    });
    await cms.api.pages.scheduleUnpublish({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        scheduledAt: new Date(Date.now() - 60_000),
      },
    });

    events.length = 0;
    const result = await cms.api.admin.runScheduled({ body: {} });
    expect(result.unpublished).toBe(1);

    const ev = events.find(
      (e) => e.action === 'unpublishBranch' && e.rootId === root.rootId,
    );
    expect(ev).toBeDefined();
    expect(ev!.storedSlug).toBe('scheduled-unpub');
  });

  it('fires one publishBranch event per item when a release publishes', async () => {
    const events: RevalidateEvent<typeof COLLECTIONS>[] = [];
    const { db, cleanup } = await setupTestDB({ plugins: [] });
    cleanups.push(cleanup);

    const cms = createCMS({
      db,
      authMiddleware: allowAnonymous(),
      media: DUMMY_MEDIA_CONFIG,
      collections: COLLECTIONS,
      onRevalidate: (event) => {
        events.push(event);
      },
    }) as AnyApi;

    const r1 = await cms.api.pages.createRoot({
      body: { slug: 'release-a', properties: { title: 'A' } },
    });
    const r2 = await cms.api.pages.createRoot({
      body: { slug: 'release-b', properties: { title: 'B' } },
    });

    const { release } = await cms.api.releases.createRelease({
      body: { title: 'Launch' },
    });
    await cms.api.releases.addToRelease({
      body: { releaseId: release.id, rootId: r1.rootId, branchId: r1.branchId },
    });
    await cms.api.releases.addToRelease({
      body: { releaseId: release.id, rootId: r2.rootId, branchId: r2.branchId },
    });

    events.length = 0;
    await cms.api.releases.publishRelease({ body: { releaseId: release.id } });

    const published = events.filter((e) => e.action === 'publishBranch');
    expect(published.map((e) => e.rootId).sort()).toEqual(
      [r1.rootId, r2.rootId].sort(),
    );
  });

  it('does not fail runScheduled when the onRevalidate handler throws', async () => {
    const { db, cleanup } = await setupTestDB({ plugins: [] });
    cleanups.push(cleanup);

    const cms = createCMS({
      db,
      authMiddleware: allowAnonymous(),
      media: DUMMY_MEDIA_CONFIG,
      collections: COLLECTIONS,
      onRevalidate: () => {
        throw new Error('boom');
      },
    }) as AnyApi;

    const root = await cms.api.pages.createRoot({
      body: { slug: 'resilient-scheduled', properties: { title: 'R' } },
    });
    await cms.api.pages.schedulePublication({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        scheduledAt: new Date(Date.now() - 60_000),
      },
    });

    const result = await cms.api.admin.runScheduled({ body: {} });
    expect(result.published).toBe(1);
  });
});
