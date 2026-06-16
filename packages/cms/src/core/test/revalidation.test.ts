import { afterAll, describe, expect, it } from 'vitest';

import type { RevalidateEvent } from '../types/definitions';

import { setupTestDB } from '../../../test/utils/db';
import { DUMMY_MEDIA_CONFIG } from '../../../test/utils/fixtures';
import { createCMS } from '../factory';
import { rootRevalidateTag } from '../revalidation';

/**
 * AB_FANOUT FA3b — revalidate-by-tag. Every revalidation event a root fires
 * (publish/unpublish, + cascade to hosts) now carries the root's cache tag, so
 * the A/B variant-coded render routes (which tag their fetch by it) invalidate
 * their control + all variant cache entries on a content change.
 */

const COLLECTIONS = {
  pages: {
    label: 'Pages',
    slug: { enabled: true, root: '/' },
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
    slug: { enabled: true, root: '/', nested: true },
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

describe('revalidation tags (FA3b)', () => {
  it('fires a publishBranch event carrying the root cache tag', async () => {
    const events: RevalidateEvent<typeof COLLECTIONS>[] = [];
    const { db, cleanup } = await setupTestDB({ plugins: [] });
    cleanups.push(cleanup);

    const cms = createCMS({
      db,
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
        requestedBy: 'r',
        requestedReviewers: ['rev'],
      },
    });
    await cms.api.pages.approve({
      body: { approvalId: req.approvals[0].id, reviewedBy: 'rev' },
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
        requestedBy: 'r',
        requestedReviewers: ['rev'],
      },
    });
    await cms.api.pages.approve({
      body: { approvalId: req.approvals[0].id, reviewedBy: 'rev' },
    });
    await cms.api.pages.publishBranch({
      body: { rootId: root.rootId, branchId: root.branchId, publishedBy: 'a' },
    });

    // Rename the published page: auto-creates the OLD-path → page redirect.
    await cms.api.pages.updateRoot({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        slug: 'home-2',
        properties: { title: 'Home' },
      },
    });

    const ev = events.find((e) => e.action === 'updateRoot');
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
        requestedBy: 'r',
        requestedReviewers: ['rev'],
      },
    });
    await cms.api.pages.approve({
      body: { approvalId: req.approvals[0].id, reviewedBy: 'rev' },
    });
    await cms.api.pages.publishBranch({
      body: { rootId: root.rootId, branchId: root.branchId, publishedBy: 'a' },
    });

    // Archive (soft-delete) the published page → auto-creates old-path → parent.
    // deleteRoot carries no branchId, so the runner resolves the published branch.
    await cms.api.pages.deleteRoot({ body: { rootId: root.rootId } });

    const ev = events.find((e) => e.action === 'deleteRoot');
    expect(ev).toBeDefined();
    expect(ev!.paths.some((p) => p.includes('gone'))).toBe(true);
  });

  it('revalidates the OLD path on moveRoot/reparent (nested, branch-agnostic)', async () => {
    const events: RevalidateEvent<typeof NESTED_COLLECTIONS>[] = [];
    const { db, cleanup } = await setupTestDB({ plugins: [] });
    cleanups.push(cleanup);

    const cms = createCMS({
      db,
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
    const req = await cms.api.pages.requestApproval({
      body: {
        branchId: child.branchId,
        requestedBy: 'r',
        requestedReviewers: ['rev'],
      },
    });
    await cms.api.pages.approve({
      body: { approvalId: req.approvals[0].id, reviewedBy: 'rev' },
    });
    await cms.api.pages.publishBranch({
      body: {
        rootId: child.rootId,
        branchId: child.branchId,
        publishedBy: 'a',
      },
    });

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
