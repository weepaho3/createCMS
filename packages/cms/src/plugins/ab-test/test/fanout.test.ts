import { afterAll, describe, expect, it } from 'vitest';

import { setupTestDB } from '../../../test-utils/db';
import { DUMMY_MEDIA_CONFIG } from '../../../test-utils/fixtures';
import { allowAnonymous } from '../../../core/define';
import { createCMS } from '../../../core/factory';
import { abTest } from '../index';
import { buildSchema } from '../schema';

/**
 * AB_FANOUT F2 — server fan-out. When an embedded reusable block has a RUNNING
 * A/B test, getPublishedContent must stop collapsing it to one branch and
 * instead expose ALL its published variant branches on the ResolvedReference's
 * optional `abTest` field, with the CONTROL branch filling top-level
 * tree/properties (the no-JS / AB-off fallback the client pre-render pass swaps).
 */

const FANOUT_COLLECTIONS = {
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
    blocks: {
      nested: {
        label: 'Nested',
        properties: {
          inner: {
            type: 'reference' as const,
            collection: 'reusableblocks',
            label: 'Inner',
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

async function setupFanoutCMS() {
  const { db, cleanup } = await setupTestDB({
    plugins: [{ name: 'ab-test', schema: buildSchema() }],
  });
  schemaCleanups.push(cleanup);
  const cms = createCMS({
    db,
    authMiddleware: allowAnonymous(),
    media: DUMMY_MEDIA_CONFIG,
    collections: FANOUT_COLLECTIONS,
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
    body: {
      branchId,
      requestedReviewers: ['reviewer-1'],
    },
    context: { userId: 'requester-1' },
  });
  await cms.api[collection].approve({
    body: { approvalId: req.approvals[0].id },
    context: { userId: 'reviewer-1' },
  });
  return cms.api[collection].publishBranch({
    body: { rootId, branchId, publishedBy: 'admin' },
  });
}

/** Start a running 50/50 test (control = main branch, variant = the other). */
async function startTest(
  cms: AnyApi,
  collection: string,
  rootId: string,
  controlBranchId: string,
  variantBranchId: string,
) {
  const { testId } = await cms.api.abTest.createTest({
    body: {
      rootId,
      collection,
      name: `${collection} test`,
      variants: [
        {
          branchId: controlBranchId,
          name: 'Control',
          weight: 50,
          isControl: true,
        },
        { branchId: variantBranchId, name: 'Variant', weight: 50 },
      ],
    },
  });
  await cms.api.abTest.updateTest({ body: { testId, status: 'running' } });
  return testId as string;
}

/** Recursively find the first block of a given type in a resolved tree. */
function findByType(node: any, type: string): any | undefined {
  if (node?.type === type) return node;
  for (const child of node?.children ?? []) {
    const hit = findByType(child, type);
    if (hit) return hit;
  }
  return undefined;
}

function isResolvedRef(value: unknown): boolean {
  return (
    value != null &&
    typeof value === 'object' &&
    'tree' in (value as object) &&
    'properties' in (value as object)
  );
}

describe('A/B server fan-out (F2)', () => {
  it('exposes all variants on the embedded reference (control fills top-level)', async () => {
    const { cms } = await setupFanoutCMS();

    // Reusable block with a published control + a published variant branch.
    const block = await cms.api.reusableblocks.createRoot({
      body: { properties: { label: 'Control' } },
    });
    await publish(cms, 'reusableblocks', block.rootId, block.branchId);
    const variant = await cms.api.reusableblocks.createBranch({
      body: {
        rootId: block.rootId,
        name: 'variant',
        sourceBranchId: block.branchId,
      },
    });
    await cms.api.reusableblocks.updateRoot({
      body: {
        rootId: block.rootId,
        branchId: variant.branch.id,
        properties: { label: 'Variant' },
      },
    });
    await publish(cms, 'reusableblocks', block.rootId, variant.branch.id);

    const testId = await startTest(
      cms,
      'reusableblocks',
      block.rootId,
      block.branchId,
      variant.branch.id,
    );

    // A page that embeds the block.
    const page = await cms.api.pages.createRoot({
      body: { slug: '/host', properties: { title: 'Host' } },
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

    const host = findByType(res.variants[0].tree, 'reusableContent');
    const ref = host.properties.block;

    expect(isResolvedRef(ref)).toBe(true);
    expect(ref.rootId).toBe(block.rootId);
    // Control fills top-level (no-JS fallback).
    expect(ref.properties.label).toBe('Control');

    // The full A/B descriptor for the client pre-render pass.
    expect(ref.abTest).toBeDefined();
    expect(ref.abTest.testId).toBe(testId);
    expect(ref.abTest.trafficPercentage).toBe(100);
    expect(ref.abTest.variants).toHaveLength(2);
    const control = ref.abTest.variants.find((v: any) => v.isControl);
    const other = ref.abTest.variants.find((v: any) => !v.isControl);
    expect(control.branchId).toBe(block.branchId);
    expect(control.properties.label).toBe('Control');
    expect(other.branchId).toBe(variant.branch.id);
    expect(other.properties.label).toBe('Variant');
  });

  it('embeds a non-running block as a single reference (no abTest)', async () => {
    const { cms } = await setupFanoutCMS();

    const block = await cms.api.reusableblocks.createRoot({
      body: { properties: { label: 'Solo' } },
    });
    await publish(cms, 'reusableblocks', block.rootId, block.branchId);

    const page = await cms.api.pages.createRoot({
      body: { slug: '/host2', properties: { title: 'Host2' } },
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

    const host = findByType(res.variants[0].tree, 'reusableContent');
    const ref = host.properties.block;

    expect(isResolvedRef(ref)).toBe(true);
    expect(ref.rootId).toBe(block.rootId);
    expect(ref.properties.label).toBe('Solo');
    expect(ref.abTest).toBeUndefined();
  });

  it('resolves nested references inside EVERY variant subtree (cloned cycle guard)', async () => {
    const { cms } = await setupFanoutCMS();

    // A leaf block embedded by both branches of the tested block.
    const leaf = await cms.api.reusableblocks.createRoot({
      body: { properties: { label: 'Leaf' } },
    });
    await publish(cms, 'reusableblocks', leaf.rootId, leaf.branchId);

    // Tested block: control embeds the leaf; the variant branch inherits it.
    const block = await cms.api.reusableblocks.createRoot({
      body: { properties: { label: 'B-control' } },
    });
    await cms.api.reusableblocks.createBlock({
      body: {
        rootId: block.rootId,
        branchId: block.branchId,
        parentBlockId: block.rootId,
        type: 'nested',
        properties: { inner: leaf.rootId },
      },
    });
    await publish(cms, 'reusableblocks', block.rootId, block.branchId);
    const variant = await cms.api.reusableblocks.createBranch({
      body: {
        rootId: block.rootId,
        name: 'variant',
        sourceBranchId: block.branchId,
      },
    });
    await cms.api.reusableblocks.updateRoot({
      body: {
        rootId: block.rootId,
        branchId: variant.branch.id,
        properties: { label: 'B-variant' },
      },
    });
    await publish(cms, 'reusableblocks', block.rootId, variant.branch.id);

    await startTest(
      cms,
      'reusableblocks',
      block.rootId,
      block.branchId,
      variant.branch.id,
    );

    const page = await cms.api.pages.createRoot({
      body: { slug: '/host3', properties: { title: 'Host3' } },
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

    const host = findByType(res.variants[0].tree, 'reusableContent');
    const ref = host.properties.block;
    expect(ref.abTest).toBeDefined();

    // The control's nested leaf reference is resolved (existing behaviour).
    const controlNested = findByType(ref.tree, 'nested');
    expect(isResolvedRef(controlNested.properties.inner)).toBe(true);
    expect(controlNested.properties.inner.rootId).toBe(leaf.rootId);

    // The VARIANT's nested leaf reference must ALSO be resolved — not left as a
    // raw rootId string by the shared cycle guard (the F2 cloned-visited fix).
    const other = ref.abTest.variants.find((v: any) => !v.isControl);
    const variantNested = findByType(other.tree, 'nested');
    expect(isResolvedRef(variantNested.properties.inner)).toBe(true);
    expect(variantNested.properties.inner.rootId).toBe(leaf.rootId);
  });

  it('substitutes variables in the embedded block AND in every A/B variant', async () => {
    const { cms } = await setupFanoutCMS();
    await cms.api.variables.createVariable({
      body: { key: 'promo', value: 'BlackFriday' },
    });

    const block = await cms.api.reusableblocks.createRoot({
      body: { properties: { label: '{{promo}} control' } },
    });
    await publish(cms, 'reusableblocks', block.rootId, block.branchId);
    const variant = await cms.api.reusableblocks.createBranch({
      body: {
        rootId: block.rootId,
        name: 'variant',
        sourceBranchId: block.branchId,
      },
    });
    await cms.api.reusableblocks.updateRoot({
      body: {
        rootId: block.rootId,
        branchId: variant.branch.id,
        properties: { label: '{{promo}} variant' },
      },
    });
    await publish(cms, 'reusableblocks', block.rootId, variant.branch.id);
    await startTest(
      cms,
      'reusableblocks',
      block.rootId,
      block.branchId,
      variant.branch.id,
    );

    const page = await cms.api.pages.createRoot({
      body: { slug: '/host-vars', properties: { title: 'Host' } },
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
    const host = findByType(res.variants[0].tree, 'reusableContent');
    const ref = host.properties.block;

    // Control (top-level): both the typed copy and the tree props substituted + consistent.
    expect(ref.properties.label).toBe('BlackFriday control');
    expect(ref.tree.properties.label).toBe('BlackFriday control');

    // Every A/B variant subtree is substituted too.
    const other = ref.abTest.variants.find((v: any) => !v.isControl);
    expect(other.properties.label).toBe('BlackFriday variant');
    expect(other.tree.properties.label).toBe('BlackFriday variant');
  });

  it('substitutes variables in a non-A/B embedded block', async () => {
    const { cms } = await setupFanoutCMS();
    await cms.api.variables.createVariable({
      body: { key: 'site', value: 'Acme' },
    });

    const block = await cms.api.reusableblocks.createRoot({
      body: { properties: { label: '{{site}} footer' } },
    });
    await publish(cms, 'reusableblocks', block.rootId, block.branchId);

    const page = await cms.api.pages.createRoot({
      body: { slug: '/host-vars2', properties: { title: 'Host' } },
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
    const host = findByType(res.variants[0].tree, 'reusableContent');
    const ref = host.properties.block;

    expect(ref.properties.label).toBe('Acme footer');
    expect(ref.tree.properties.label).toBe('Acme footer');
  });
});
