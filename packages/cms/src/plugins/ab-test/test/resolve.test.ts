import { afterAll, describe, expect, it } from 'vitest';

import { allowAnonymous } from '../../../core/define';
import { createCMS } from '../../../core/factory';
import { setupTestDB } from '../../../test-utils/db';
import { DUMMY_MEDIA_CONFIG } from '../../../test-utils/fixtures';
import { abTest } from '../index';
import { buildSchema } from '../schema';

/**
 * AB_FANOUT FA1 — the edge-readable resolve seam. `cms.api.<collection>.
 * resolveAbVariant({ query: { path } })` returns the single running test that
 * varies the page's render (page root OR a transitively-embedded block, XOR
 * <=1), with its variants — the data the edge middleware needs to bucket.
 */

const RESOLVE_COLLECTIONS = {
  reusableblocks: {
    label: 'Reusable Blocks',
    reusableBlock: true,
    root: {
      properties: {
        label: {
          type: 'string' as const,
          label: 'Label',
          required: true as const,
        },
      },
    },
  },
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
    blocks: {
      reusableContent: {
        label: 'Reusable Content',
        properties: {
          block: {
            type: 'reference' as const,
            collection: 'reusableblocks',
            label: 'Block',
            required: true as const,
          },
        },
      },
    },
  },
} as const;

type AnyApi = {
  api: Record<string, Record<string, (...a: any[]) => Promise<any>>>;
};

const schemaCleanups: Array<() => Promise<void>> = [];
afterAll(async () => {
  await Promise.allSettled(schemaCleanups.map((fn) => fn()));
});

async function setupResolveCMS() {
  const { db, cleanup } = await setupTestDB({
    plugins: [{ name: 'ab-test', schema: buildSchema() }],
  });
  schemaCleanups.push(cleanup);
  const cms = createCMS({
    db,
    authMiddleware: allowAnonymous(),
    media: DUMMY_MEDIA_CONFIG,
    collections: RESOLVE_COLLECTIONS,
    plugins: [abTest()],
  }) as AnyApi;
  return { cms };
}

async function publish(
  cms: AnyApi,
  collection: string,
  rootId: string,
  branchId: string,
) {
  const req = await cms.api[collection].requestApproval({
    body: { branchId, requestedReviewers: ['rev1'] },
    context: { userId: 'r1' },
  });
  await cms.api[collection].submitApproval({
    body: { approvalId: req.approvals[0].id },
    context: { userId: 'rev1' },
  });
  return cms.api[collection].publishBranch({
    body: { rootId, branchId, publishedBy: 'admin' },
  });
}

/** A root with a published main + a published variant branch. */
async function rootWithVariant(
  cms: AnyApi,
  collection: string,
  props: Record<string, unknown>,
  slug?: string,
) {
  const root = await cms.api[collection].createRoot({
    body: { ...(slug ? { slug } : {}), properties: props },
  });
  await publish(cms, collection, root.rootId, root.branchId);
  const variant = await cms.api[collection].createBranch({
    body: {
      rootId: root.rootId,
      name: 'variant',
      sourceBranchId: root.branchId,
    },
  });
  await publish(cms, collection, root.rootId, variant.branch.id);
  return {
    rootId: root.rootId,
    mainBranchId: root.branchId,
    variantBranchId: variant.branch.id,
  };
}

async function startTest(
  cms: AnyApi,
  collection: string,
  root: { rootId: string; mainBranchId: string; variantBranchId: string },
) {
  const { testId } = await cms.api.abTest.createTest({
    body: {
      rootId: root.rootId,
      collection,
      name: `${collection} test`,
      variants: [
        {
          branchId: root.mainBranchId,
          name: 'Control',
          weight: 50,
          isControl: true,
        },
        { branchId: root.variantBranchId, name: 'Variant', weight: 50 },
      ],
    },
  });
  await cms.api.abTest.updateTest({ body: { testId, status: 'running' } });
  return testId as string;
}

describe('A/B resolve seam (FA1)', () => {
  it('resolves a PAGE-level running test by path', async () => {
    const { cms } = await setupResolveCMS();
    const page = await rootWithVariant(
      cms,
      'pages',
      { title: 'Promo' },
      'promo',
    );
    const testId = await startTest(cms, 'pages', page);

    const res = await cms.api.pages.resolveAbVariant({
      query: { path: '/promo' },
    });

    expect(res.test).not.toBeNull();
    expect(res.test.testId).toBe(testId);
    expect(res.test.rootId).toBe(page.rootId);
    expect(res.test.trafficPercentage).toBe(100);
    expect(res.test.variants).toHaveLength(2);
    expect(res.test.variants.filter((v: any) => v.isControl)).toHaveLength(1);
    // Enough for edge bucketing: variantId + branchId + weight.
    for (const v of res.test.variants) {
      expect(typeof v.variantId).toBe('string');
      expect(typeof v.branchId).toBe('string');
      expect(typeof v.weight).toBe('number');
    }
  });

  it('returns { test: null } for a page with no running test', async () => {
    const { cms } = await setupResolveCMS();
    const page = await cms.api.pages.createRoot({
      body: { slug: 'plain', properties: { title: 'Plain' } },
    });
    await publish(cms, 'pages', page.rootId, page.branchId);

    const res = await cms.api.pages.resolveAbVariant({
      query: { path: '/plain' },
    });
    expect(res.test).toBeNull();
  });

  it('returns { test: null } for an unknown path', async () => {
    const { cms } = await setupResolveCMS();
    const res = await cms.api.pages.resolveAbVariant({
      query: { path: '/nope' },
    });
    expect(res.test).toBeNull();
  });

  it('resolves an EMBEDDED-block test through the host page path', async () => {
    const { cms } = await setupResolveCMS();
    const block = await rootWithVariant(cms, 'reusableblocks', {
      label: 'Newsletter',
    });
    const blockTestId = await startTest(cms, 'reusableblocks', block);

    const page = await cms.api.pages.createRoot({
      body: { slug: 'host', properties: { title: 'Host' } },
    });
    await cms.api.pages.createBlock({
      body: {
        rootId: page.rootId,
        branchId: page.branchId,
        parentBlockId: page.rootId,
        type: 'reusableContent',
        properties: { block: block.rootId },
      },
    });
    await publish(cms, 'pages', page.rootId, page.branchId);

    const res = await cms.api.pages.resolveAbVariant({
      query: { path: '/host' },
    });
    expect(res.test).not.toBeNull();
    expect(res.test.testId).toBe(blockTestId);
    expect(res.test.rootId).toBe(block.rootId); // the embedded block, not the page
    expect(res.test.variants).toHaveLength(2);
  });

  it('degrades to { test: null } when a variant branch is unpublished later', async () => {
    const { cms } = await setupResolveCMS();
    const page = await rootWithVariant(
      cms,
      'pages',
      { title: 'Promo' },
      'promo',
    );
    await startTest(cms, 'pages', page);

    // The test is created with both branches published, but a later unpublish
    // (no guard against it today) leaves < 2 published variants → fan-out must
    // degrade to control rather than hand the edge an unrenderable branch.
    await cms.api.pages.unpublishBranch({
      body: { rootId: page.rootId, branchId: page.variantBranchId },
    });

    const res = await cms.api.pages.resolveAbVariant({
      query: { path: '/promo' },
    });
    expect(res.test).toBeNull();
  });
});
