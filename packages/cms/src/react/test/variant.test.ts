import { afterAll, describe, expect, it } from 'vitest';

import { allowAnonymous } from '../../core/define';
import { createCMS } from '../../core/factory';
import { abTest } from '../../plugins/ab-test/index';
import { buildSchema } from '../../plugins/ab-test/schema';
import { setupTestDB } from '../../test-utils/db';
import { DUMMY_MEDIA_CONFIG } from '../../test-utils/fixtures';
import { pickVariant } from '../variant';

/**
 * AB_FANOUT FA3 — server-side variant pick. pickVariant(variants, branchId)
 * turns getPublishedContent's page variants + a branch code into the single
 * fully-picked tree (abTest stripped) for the renderer. Verified against real
 * getPublishedContent output.
 */

const COLLECTIONS = {
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

const cleanups: Array<() => Promise<void>> = [];
afterAll(async () => {
  await Promise.allSettled(cleanups.map((fn) => fn()));
});

async function setup() {
  const { db, cleanup } = await setupTestDB({
    plugins: [{ name: 'ab-test', schema: buildSchema() }],
  });
  cleanups.push(cleanup);
  const cms = createCMS({
    db,
    authMiddleware: allowAnonymous(),
    media: DUMMY_MEDIA_CONFIG,
    collections: COLLECTIONS,
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
    body: { branchId, requestedReviewers: ['rev'] },
    context: { userId: 'r' },
  });
  await cms.api[collection].submitApproval({
    body: { approvalId: req.approvals[0].id },
    context: { userId: 'rev' },
  });
  return cms.api[collection].publishBranch({
    body: { rootId, branchId, publishedBy: 'a' },
  });
}

/** A root whose control + variant branches carry DIFFERENT root-prop values. */
async function twoVariantRoot(
  cms: AnyApi,
  collection: string,
  prop: string,
  controlVal: string,
  variantVal: string,
  slug?: string,
) {
  const root = await cms.api[collection].createRoot({
    body: slug
      ? { slug, properties: { [prop]: controlVal } }
      : { properties: { [prop]: controlVal } },
  });
  await publish(cms, collection, root.rootId, root.branchId);
  const variant = await cms.api[collection].createBranch({
    body: {
      rootId: root.rootId,
      name: 'variant',
      sourceBranchId: root.branchId,
    },
  });
  await cms.api[collection].updateRoot({
    body: {
      rootId: root.rootId,
      branchId: variant.branch.id,
      properties: { [prop]: variantVal },
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
  r: { rootId: string; mainBranchId: string; variantBranchId: string },
) {
  const { testId } = await cms.api.abTest.createTest({
    body: {
      rootId: r.rootId,
      collection,
      name: 'test',
      variants: [
        {
          branchId: r.mainBranchId,
          name: 'Control',
          weight: 50,
          isControl: true,
        },
        { branchId: r.variantBranchId, name: 'Variant', weight: 50 },
      ],
    },
  });
  await cms.api.abTest.updateTest({ body: { testId, status: 'running' } });
}

function findByType(node: any, type: string): any {
  if (node?.type === type) return node;
  for (const c of node?.children ?? []) {
    const hit = findByType(c, type);
    if (hit) return hit;
  }
  return undefined;
}

describe('pickVariant (FA3 server-side pick)', () => {
  it('swaps the embedded block to the picked branch (and strips abTest)', async () => {
    const { cms } = await setup();
    const block = await twoVariantRoot(
      cms,
      'reusableblocks',
      'label',
      'Control',
      'Variant',
    );
    await startTest(cms, 'reusableblocks', block);

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

    const res = await cms.api.pages.getPublishedContent({
      query: { rootId: page.rootId },
    });

    // Pick the VARIANT branch → embedded block renders 'Variant', abTest gone.
    const variantTree = pickVariant(res.variants, block.variantBranchId);
    const vHost = findByType(variantTree, 'reusableContent');
    expect(vHost.properties.block.tree.properties.label).toBe('Variant');
    expect(vHost.properties.block.abTest).toBeUndefined();

    // Control (null) → embedded block renders 'Control', abTest gone.
    const controlTree = pickVariant(res.variants, null);
    const cHost = findByType(controlTree, 'reusableContent');
    expect(cHost.properties.block.tree.properties.label).toBe('Control');
    expect(cHost.properties.block.abTest).toBeUndefined();

    // Unknown branch → fail-closed to control.
    const unknown = pickVariant(res.variants, 'nope');
    const uHost = findByType(unknown, 'reusableContent');
    expect(uHost.properties.block.tree.properties.label).toBe('Control');
    expect(uHost.properties.block.abTest).toBeUndefined();
  });

  it('picks a page-level branch by branchId; null → control', async () => {
    const { cms } = await setup();
    const page = await twoVariantRoot(
      cms,
      'pages',
      'title',
      'Control title',
      'Variant title',
      'promo',
    );
    await startTest(cms, 'pages', page);

    const res = await cms.api.pages.getPublishedContent({
      query: { rootId: page.rootId },
    });
    expect(res.variants.length).toBe(2);

    // getPublishedContent exposes the page-level test descriptor.
    expect(res.abTest).toBeDefined();
    expect(res.abTest.trafficPercentage).toBe(100);
    expect(res.abTest.controlBranchId).toBe(page.mainBranchId);

    const variantTree = pickVariant(res.variants, page.variantBranchId)!;
    expect(variantTree.properties.title).toBe('Variant title');

    // Control via the exposed controlBranchId (page-variant order is not
    // guaranteed — pickVariant resolves the control from the descriptor).
    const controlTree = pickVariant(
      res.variants,
      null,
      res.abTest.controlBranchId,
    )!;
    expect(controlTree.properties.title).toBe('Control title');
  });
});
