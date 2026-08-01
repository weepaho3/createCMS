import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { CONTROL_CODE, decideEdgeVariant } from '../../../ab-edge';
import { pickVariant } from '../../../react/variant';
import { TEST_COLLECTIONS } from '../../../test-utils/fixtures';
import { publishApprovedBranch } from '../../../test-utils/helpers';
import { postgresAnalytics } from '../analytics/postgres';
import { resolveVariant } from '../assignment';
import { assertTrackingIntegrity } from '../tracking-guard';
import { setupAbTestCMS, setupMultiTenantAbTestCMS } from './utils/cms';

const GUARD_COLLECTIONS = {
  pages: { ...TEST_COLLECTIONS.pages, name: 'pages' },
} as unknown as Parameters<typeof assertTrackingIntegrity>[0]['collections'];

const schemaCleanups: Array<() => Promise<void>> = [];
afterAll(async () => {
  await Promise.allSettled(schemaCleanups.map((fn) => fn()));
});

async function createTestCMS() {
  const { cms, db, cleanupSchema } = await setupAbTestCMS();
  schemaCleanups.push(cleanupSchema);
  return { cms, db };
}

// ============================================================================
// Helpers
// ============================================================================

async function createPageWithBranches(cms: any) {
  const root = await cms.api.pages.createRoot({
    body: { slug: '/landing', properties: { title: 'Landing' } },
  });

  await publishApprovedBranch(cms, {
    rootId: root.rootId,
    branchId: root.branchId,
    publishedBy: 'admin',
  });

  const branch2 = await cms.api.pages.createBranch({
    body: {
      rootId: root.rootId,
      name: 'variant-a',
      sourceBranchId: root.branchId,
    },
  });

  await cms.api.pages.createBlock({
    body: {
      rootId: root.rootId,
      branchId: branch2.branch.id,
      parentBlockId: root.rootId,
      type: 'paragraph',
      properties: { text: 'Variant content' },
    },
  });

  await publishApprovedBranch(cms, {
    rootId: root.rootId,
    branchId: branch2.branch.id,
    publishedBy: 'admin',
  });

  return {
    rootId: root.rootId,
    mainBranchId: root.branchId,
    variantBranchId: branch2.branch.id,
  };
}

function makeVariants(
  mainBranchId: string,
  variantBranchId: string,
  weights = [50, 50],
) {
  return [
    {
      branchId: mainBranchId,
      name: 'Control',
      weight: weights[0],
      isControl: true,
    },
    {
      branchId: variantBranchId,
      name: 'Variant A',
      weight: weights[1],
    },
  ];
}

// ============================================================================
// Assignment Algorithm (pure function)
// ============================================================================

describe('resolveVariant', () => {
  const variants = [
    { id: 'v1', weight: 50, isControl: true },
    { id: 'v2', weight: 50, isControl: false },
  ];

  it('is deterministic: same input always produces same output', () => {
    const r1 = resolveVariant('user-1', 'test-1', 100, variants);
    const r2 = resolveVariant('user-1', 'test-1', 100, variants);
    expect(r1).toEqual(r2);
  });

  it('different users can get different variants', () => {
    const results = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const r = resolveVariant(`user-${i}`, 'test-1', 100, variants);
      results.add(r.variantId);
    }
    expect(results.size).toBe(2);
  });

  it('respects traffic percentage: visitors outside traffic get control', () => {
    let controlCount = 0;
    const total = 1000;
    for (let i = 0; i < total; i++) {
      const r = resolveVariant(`user-${i}`, 'test-1', 10, variants);
      if (!r.inTest) controlCount++;
    }
    expect(controlCount).toBeGreaterThan(800);
    expect(controlCount).toBeLessThan(980);
  });

  it('respects weight distribution', () => {
    const unevenVariants = [
      { id: 'v1', weight: 80, isControl: true },
      { id: 'v2', weight: 20, isControl: false },
    ];

    let v1Count = 0;
    const total = 10000;
    for (let i = 0; i < total; i++) {
      const r = resolveVariant(`user-${i}`, 'test-dist', 100, unevenVariants);
      if (r.variantId === 'v1') v1Count++;
    }

    const ratio = v1Count / total;
    expect(ratio).toBeGreaterThan(0.7);
    expect(ratio).toBeLessThan(0.9);
  });
});

// ============================================================================
// CRUD Endpoints
// ============================================================================

describe('A/B Test CRUD', () => {
  it('creates a test with valid variants', async () => {
    const { cms } = await createTestCMS();
    const page = await createPageWithBranches(cms);

    const result = await cms.api.abTest.createTest({
      body: {
        rootId: page.rootId,
        collection: 'pages',
        name: 'Landing page test',
        variants: makeVariants(page.mainBranchId, page.variantBranchId),
      },
    });

    expect(result.testId).toBeDefined();

    const test = await cms.api.abTest.getTest({
      query: { testId: result.testId },
    });
    expect(test.name).toBe('Landing page test');
    expect(test.status).toBe('draft');
    expect(test.variants).toHaveLength(2);
    expect(test.variants.find((v: any) => v.isControl)?.weight).toBe(50);
  });

  it('rejects variants that do not sum to 100', async () => {
    const { cms } = await createTestCMS();
    const page = await createPageWithBranches(cms);

    await expect(
      cms.api.abTest.createTest({
        body: {
          rootId: page.rootId,
          collection: 'pages',
          name: 'Bad weights',
          variants: makeVariants(
            page.mainBranchId,
            page.variantBranchId,
            [60, 60],
          ),
        },
      }),
    ).rejects.toThrow();
  });

  it('rejects variants without exactly one control', async () => {
    const { cms } = await createTestCMS();
    const page = await createPageWithBranches(cms);

    await expect(
      cms.api.abTest.createTest({
        body: {
          rootId: page.rootId,
          collection: 'pages',
          name: 'No control',
          variants: [
            {
              branchId: page.mainBranchId,
              name: 'A',
              weight: 50,
              isControl: false,
            },
            {
              branchId: page.variantBranchId,
              name: 'B',
              weight: 50,
              isControl: false,
            },
          ],
        },
      }),
    ).rejects.toThrow();
  });

  it('lists tests with filtering', async () => {
    const { cms } = await createTestCMS();
    const page = await createPageWithBranches(cms);

    await cms.api.abTest.createTest({
      body: {
        rootId: page.rootId,
        collection: 'pages',
        name: 'Test 1',
        variants: makeVariants(page.mainBranchId, page.variantBranchId),
      },
    });

    const list = await cms.api.abTest.listTests({
      query: { collection: 'pages' },
    });
    expect(list.tests).toHaveLength(1);
    expect(list.total).toBe(1);
  });

  it('deletes a draft test', async () => {
    const { cms } = await createTestCMS();
    const page = await createPageWithBranches(cms);

    const { testId } = await cms.api.abTest.createTest({
      body: {
        rootId: page.rootId,
        collection: 'pages',
        name: 'To delete',
        variants: makeVariants(page.mainBranchId, page.variantBranchId),
      },
    });

    await cms.api.abTest.deleteTest({ body: { testId } });

    await expect(
      cms.api.abTest.getTest({ query: { testId } }),
    ).rejects.toThrow();
  });
});

// ============================================================================
// Status Transitions (via updateTest)
// ============================================================================

describe('A/B Test Status Transitions', () => {
  it('starts a draft test', async () => {
    const { cms } = await createTestCMS();
    const page = await createPageWithBranches(cms);

    const { testId } = await cms.api.abTest.createTest({
      body: {
        rootId: page.rootId,
        collection: 'pages',
        name: 'Status test',
        variants: makeVariants(page.mainBranchId, page.variantBranchId),
      },
    });

    await cms.api.abTest.updateTest({
      body: { testId, status: 'running' },
    });

    const test = await cms.api.abTest.getTest({ query: { testId } });
    expect(test.status).toBe('running');
    expect(test.startedAt).toBeTruthy();
  });

  it('pauses a running test', async () => {
    const { cms } = await createTestCMS();
    const page = await createPageWithBranches(cms);

    const { testId } = await cms.api.abTest.createTest({
      body: {
        rootId: page.rootId,
        collection: 'pages',
        name: 'Pause test',
        variants: makeVariants(page.mainBranchId, page.variantBranchId),
      },
    });

    await cms.api.abTest.updateTest({
      body: { testId, status: 'running' },
    });
    await cms.api.abTest.updateTest({
      body: { testId, status: 'paused' },
    });

    const test = await cms.api.abTest.getTest({ query: { testId } });
    expect(test.status).toBe('paused');
  });

  it('completes a running test', async () => {
    const { cms } = await createTestCMS();
    const page = await createPageWithBranches(cms);

    const { testId } = await cms.api.abTest.createTest({
      body: {
        rootId: page.rootId,
        collection: 'pages',
        name: 'Complete test',
        variants: makeVariants(page.mainBranchId, page.variantBranchId),
      },
    });

    await cms.api.abTest.updateTest({
      body: { testId, status: 'running' },
    });
    await cms.api.abTest.updateTest({
      body: { testId, status: 'completed' },
    });

    const test = await cms.api.abTest.getTest({ query: { testId } });
    expect(test.status).toBe('completed');
    expect(test.endedAt).toBeTruthy();
  });

  it('rejects invalid status transitions', async () => {
    const { cms } = await createTestCMS();
    const page = await createPageWithBranches(cms);

    const { testId } = await cms.api.abTest.createTest({
      body: {
        rootId: page.rootId,
        collection: 'pages',
        name: 'Invalid transition',
        variants: makeVariants(page.mainBranchId, page.variantBranchId),
      },
    });

    await expect(
      cms.api.abTest.updateTest({
        body: { testId, status: 'completed' },
      }),
    ).rejects.toThrow();
  });

  it('prevents two running tests for the same root', async () => {
    const { cms } = await createTestCMS();
    const page = await createPageWithBranches(cms);

    const variants = makeVariants(page.mainBranchId, page.variantBranchId);

    const { testId: t1 } = await cms.api.abTest.createTest({
      body: {
        rootId: page.rootId,
        collection: 'pages',
        name: 'Test 1',
        variants,
      },
    });

    const { testId: t2 } = await cms.api.abTest.createTest({
      body: {
        rootId: page.rootId,
        collection: 'pages',
        name: 'Test 2',
        variants,
      },
    });

    await cms.api.abTest.updateTest({
      body: { testId: t1, status: 'running' },
    });

    await expect(
      cms.api.abTest.updateTest({ body: { testId: t2, status: 'running' } }),
    ).rejects.toThrow();
  });

  it('prevents deleting a running test', async () => {
    const { cms } = await createTestCMS();
    const page = await createPageWithBranches(cms);

    const { testId } = await cms.api.abTest.createTest({
      body: {
        rootId: page.rootId,
        collection: 'pages',
        name: 'Running test',
        variants: makeVariants(page.mainBranchId, page.variantBranchId),
      },
    });

    await cms.api.abTest.updateTest({
      body: { testId, status: 'running' },
    });

    await expect(
      cms.api.abTest.deleteTest({ body: { testId } }),
    ).rejects.toThrow();
  });
});

// ============================================================================
// Variant Assignment (via endpoint)
// ============================================================================

describe('A/B Test Variant Assignment', () => {
  it('assigns a variant for a running test', async () => {
    const { cms } = await createTestCMS();
    const page = await createPageWithBranches(cms);

    const { testId } = await cms.api.abTest.createTest({
      body: {
        rootId: page.rootId,
        collection: 'pages',
        name: 'Assignment test',
        variants: makeVariants(page.mainBranchId, page.variantBranchId),
      },
    });

    await cms.api.abTest.updateTest({
      body: { testId, status: 'running' },
    });

    const assignment = await cms.api.abTest.assignVariant({
      body: { testId, context: { key: 'user-42' } },
    });

    expect(assignment.variantId).toBeDefined();
    expect(assignment.branchId).toBeDefined();
    expect(typeof assignment.inTest).toBe('boolean');
  });

  it('returns consistent assignments for the same user', async () => {
    const { cms } = await createTestCMS();
    const page = await createPageWithBranches(cms);

    const { testId } = await cms.api.abTest.createTest({
      body: {
        rootId: page.rootId,
        collection: 'pages',
        name: 'Consistency test',
        variants: makeVariants(page.mainBranchId, page.variantBranchId),
      },
    });

    await cms.api.abTest.updateTest({
      body: { testId, status: 'running' },
    });

    const a1 = await cms.api.abTest.assignVariant({
      body: { testId, context: { key: 'user-99' } },
    });
    const a2 = await cms.api.abTest.assignVariant({
      body: { testId, context: { key: 'user-99' } },
    });

    expect(a1.variantId).toBe(a2.variantId);
    expect(a1.branchId).toBe(a2.branchId);
  });

  it('rejects assignment for non-running tests', async () => {
    const { cms } = await createTestCMS();
    const page = await createPageWithBranches(cms);

    const { testId } = await cms.api.abTest.createTest({
      body: {
        rootId: page.rootId,
        collection: 'pages',
        name: 'Draft test',
        variants: makeVariants(page.mainBranchId, page.variantBranchId),
      },
    });

    await expect(
      cms.api.abTest.assignVariant({
        body: { testId, context: { key: 'user-1' } },
      }),
    ).rejects.toThrow();
  });
});

// ============================================================================
// Analytics (Postgres adapter)
// ============================================================================

describe('A/B Test Analytics', () => {
  it('tracks events and queries results', async () => {
    const { cms } = await createTestCMS();
    const page = await createPageWithBranches(cms);

    const { testId } = await cms.api.abTest.createTest({
      body: {
        rootId: page.rootId,
        collection: 'pages',
        name: 'Analytics test',
        variants: makeVariants(page.mainBranchId, page.variantBranchId),
      },
    });

    await cms.api.abTest.updateTest({
      body: { testId, status: 'running' },
    });

    const test = await cms.api.abTest.getTest({ query: { testId } });
    const controlVariant = test.variants.find((v: any) => v.isControl)!;
    const treatmentVariant = test.variants.find((v: any) => !v.isControl)!;

    for (let i = 0; i < 5; i++) {
      await cms.api.abTest.trackEvent({
        body: {
          testId,
          variantId: controlVariant.id,
          visitorId: `visitor-${i}`,
          eventType: 'impression',
        },
      });
    }

    for (let i = 0; i < 3; i++) {
      await cms.api.abTest.trackEvent({
        body: {
          testId,
          variantId: treatmentVariant.id,
          visitorId: `visitor-${i + 10}`,
          eventType: 'impression',
        },
      });
    }

    await cms.api.abTest.trackEvent({
      body: {
        testId,
        variantId: controlVariant.id,
        visitorId: 'visitor-0',
        eventType: 'conversion',
      },
    });

    const results = await cms.api.abTest.getResults({
      query: { testId },
    });

    expect(results.testId).toBe(testId);
    expect(results.totalImpressions).toBe(8);
    expect(results.totalConversions).toBe(1);

    const controlResult = results.variants.find(
      (v: any) => v.variantId === controlVariant.id,
    )!;
    expect(controlResult.impressions).toBe(5);
    expect(controlResult.conversions).toBe(1);
    expect(controlResult.conversionRate).toBeGreaterThan(0);
  });

  it('records a branch-keyed impression, resolving the variant id server-side (FA4)', async () => {
    const { cms } = await createTestCMS();
    const page = await createPageWithBranches(cms);

    const { testId } = await cms.api.abTest.createTest({
      body: {
        rootId: page.rootId,
        collection: 'pages',
        name: 'Branch-keyed test',
        variants: makeVariants(page.mainBranchId, page.variantBranchId),
      },
    });
    await cms.api.abTest.updateTest({ body: { testId, status: 'running' } });

    const test = await cms.api.abTest.getTest({ query: { testId } });
    const treatment = test.variants.find((v: any) => !v.isControl)!;

    // Pattern A: the beacon knows the served BRANCH, not the variant id.
    await cms.api.abTest.trackEvent({
      body: {
        testId,
        branchId: page.variantBranchId,
        visitorId: 'visitor-x',
        eventType: 'impression',
      },
    });

    const results = await cms.api.abTest.getResults({ query: { testId } });
    const treatmentResult = results.variants.find(
      (v: any) => v.variantId === treatment.id,
    )!;
    expect(treatmentResult.impressions).toBe(1); // branchId resolved to the right variant

    // A branchId that belongs to no variant of the test is rejected.
    await expect(
      cms.api.abTest.trackEvent({
        body: {
          testId,
          branchId: 'branch_does_not_exist',
          visitorId: 'visitor-y',
          eventType: 'impression',
        },
      }),
    ).rejects.toThrow();
  });

  it('resolves → buckets → picks → records across the full Pattern A chain (FA1–FA5)', async () => {
    const { cms } = await createTestCMS();
    const page = await createPageWithBranches(cms); // slug '/landing', 2 published branches

    const { testId } = await cms.api.abTest.createTest({
      body: {
        rootId: page.rootId,
        collection: 'pages',
        name: 'Pattern A end-to-end',
        // 100% traffic → every visitor buckets into a variant, so the edge always
        // rewrites (deterministic assertion, no flaky out-of-traffic control path).
        trafficPercentage: 100,
        variants: makeVariants(page.mainBranchId, page.variantBranchId),
      },
    });
    await cms.api.abTest.updateTest({ body: { testId, status: 'running' } });

    // FA1 — the edge resolve seam maps the public path to the running test.
    const resolved = await cms.api.pages.resolveAbVariant({
      query: { path: '/landing' },
    });
    expect(resolved.test?.testId).toBe(testId);
    expect(resolved.test?.variants).toHaveLength(2);
    const branchIds = resolved.test!.variants.map((v) => v.branchId).sort();
    expect(branchIds).toEqual([page.mainBranchId, page.variantBranchId].sort());

    // FA2/FA2.5 — CONSENT-FREE first assignment: no variant cookie yet → bucket
    // (100% traffic → a real branch) and return the code to persist. Rewrites to
    // `/ab/<branchId>/landing` (the code is the segment after the `/ab` prefix).
    const decided = decideEdgeVariant({
      pathname: '/landing',
      resolve: resolved,
      assignedCode: null,
    });
    expect(decided.rewritePath).toMatch(/^\/ab\/[^/]+\/landing$/);
    const servedBranchId = decodeURIComponent(
      decided.rewritePath.split('/')[2]!,
    );
    expect(branchIds).toContain(servedBranchId); // a real branch, not the sentinel
    expect(decided.assignCode).toBe(servedBranchId); // persisted in the variant cookie

    // Consistency: a returning visitor whose variant cookie holds the assignment
    // gets the SAME branch, with no re-roll + no new cookie.
    const again = decideEdgeVariant({
      pathname: '/landing',
      resolve: resolved,
      assignedCode: servedBranchId,
    });
    expect(again.rewritePath).toBe(decided.rewritePath);
    expect(again.assignCode).toBeNull();

    // Always-rewrite invariant: a path with no running test → control sentinel,
    // nothing to persist (no passthrough).
    const noTest = decideEdgeVariant({
      pathname: '/landing',
      resolve: { test: null },
      assignedCode: null,
    });
    expect(noTest.rewritePath).toBe(`/ab/${CONTROL_CODE}/landing`);
    expect(noTest.assignCode).toBeNull();

    // FA3b — the render route loads every published variant + the page-level
    // A/B descriptor (control branch + test id).
    const content = await cms.api.pages.getPublishedContent({
      query: { slug: '/landing' },
    });
    expect(content.abTest?.testId).toBe(testId);
    expect(content.abTest?.controlBranchId).toBe(page.mainBranchId);
    expect(content.variants).toHaveLength(2);

    // FA3a — pickVariant resolves a concrete tree for the served branch AND for
    // the control (branchId = null); both fail closed to a real tree.
    const variantTree = pickVariant(
      content.variants,
      servedBranchId,
      content.abTest?.controlBranchId,
    );
    const controlTree = pickVariant(
      content.variants,
      null,
      content.abTest?.controlBranchId,
    );
    expect(variantTree).not.toBeNull();
    expect(controlTree).not.toBeNull();

    // The anonymous beacon reports the served BRANCH (no visitor id); trackEvent
    // resolves it to the right variant id and getResults attributes it to that arm.
    const servedVariantId = resolved.test!.variants.find(
      (v) => v.branchId === servedBranchId,
    )!.variantId;
    await cms.api.abTest.trackEvent({
      body: {
        testId,
        branchId: servedBranchId,
        anonymous: true,
        eventType: 'impression',
      },
    });

    const results = await cms.api.abTest.getResults({ query: { testId } });
    expect(results.totalImpressions).toBe(1);
    const arm = results.variants.find(
      (v: { variantId: string; impressions: number }) =>
        v.variantId === servedVariantId,
    )!;
    expect(arm.impressions).toBe(1);
  });

  it('fires a root revalidation when a test toggles in/out of running (FA5 render-cache bust)', async () => {
    const events: Array<{ rootId: string; storedSlug: string | null }> = [];
    const { cms, cleanupSchema } = await setupAbTestCMS({
      onRevalidate: { handler: (event) => void events.push(event) },
    });
    schemaCleanups.push(cleanupSchema);
    const page = await createPageWithBranches(cms);
    // The slug a CONTENT publish revalidates with — test start/stop must use the
    // SAME slug so the app busts the same render-cache tag.
    const publishSlug = events.find(
      (e) => e.rootId === page.rootId,
    )?.storedSlug;
    expect(publishSlug).toBeTruthy();
    events.length = 0; // ignore the publish events from branch setup

    const { testId } = await cms.api.abTest.createTest({
      body: {
        rootId: page.rootId,
        collection: 'pages',
        name: 'Revalidation test',
        variants: makeVariants(page.mainBranchId, page.variantBranchId),
      },
    });
    // Creating a draft test changes no render → no revalidation.
    expect(events).toHaveLength(0);

    // Starting it makes getPublishedContent expose the abTest descriptor for
    // this root → the page's render caches must be busted, with the same slug.
    await cms.api.abTest.updateTest({ body: { testId, status: 'running' } });
    const startEvent = events.find((e) => e.rootId === page.rootId);
    expect(startEvent).toBeTruthy();
    expect(startEvent?.storedSlug).toBe(publishSlug);

    // Pausing reverts the render to control → bust again.
    events.length = 0;
    await cms.api.abTest.updateTest({ body: { testId, status: 'paused' } });
    expect(events.some((e) => e.rootId === page.rootId)).toBe(true);

    // paused → completed does not change the render (already control) → no fire.
    events.length = 0;
    await cms.api.abTest.updateTest({ body: { testId, status: 'completed' } });
    expect(events).toHaveLength(0);
  });

  it('stores a non-A/B analytics event (no testId/variantId) and never lets it pollute a test result', async () => {
    const { cms, db } = await createTestCMS();
    const page = await createPageWithBranches(cms);

    const { testId } = await cms.api.abTest.createTest({
      body: {
        rootId: page.rootId,
        collection: 'pages',
        name: 'Decoupled-event test',
        variants: makeVariants(page.mainBranchId, page.variantBranchId),
      },
    });
    await cms.api.abTest.updateTest({ body: { testId, status: 'running' } });

    const test = await cms.api.abTest.getTest({ query: { testId } });
    const control = test.variants.find((v: any) => v.isControl)!;

    // One A/B-attributed impression for the test.
    await cms.api.abTest.trackEvent({
      body: {
        testId,
        variantId: control.id,
        visitorId: 'visitor-1',
        eventType: 'impression',
      },
    });

    // A non-A/B analytics event: no testId/variantId, carries a source handle.
    await cms.api.abTest.trackEvent({
      body: {
        visitorId: 'visitor-1',
        eventType: 'form_submit',
        source: { handle: 'newsletter', type: 'signupForm' },
      },
    });

    // The non-A/B event is persisted with NULL test/variant + its source.
    const stored = (await db.execute(sql`
      SELECT test_id, variant_id, source_handle, source_type
      FROM cms.ab_test_events
      WHERE event_type = 'form_submit'
    `)) as {
      rows: Array<{
        test_id: string | null;
        variant_id: string | null;
        source_handle: string | null;
        source_type: string | null;
      }>;
    };
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0]!.test_id).toBeNull();
    expect(stored.rows[0]!.variant_id).toBeNull();
    expect(stored.rows[0]!.source_handle).toBe('newsletter');
    expect(stored.rows[0]!.source_type).toBe('signupForm');

    // The test's aggregation is unaffected by the non-A/B event.
    const results = await cms.api.abTest.getResults({ query: { testId } });
    expect(results.totalImpressions).toBe(1);
    expect(results.totalConversions).toBe(0);
  });

  it('postgres adapter dedupes by row id (idempotent ingestion)', async () => {
    const { db } = await createTestCMS();
    const adapter = postgresAnalytics();
    adapter.init?.(db);

    const event = {
      id: 'abe_fixed_idempotency_key',
      name: 'page_view',
      visitorId: 'visitor-1',
      anonymous: false,
      timestamp: new Date(),
    };
    await adapter.track(event);
    await adapter.track(event);

    const counted = (await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM cms.ab_test_events
      WHERE id = 'abe_fixed_idempotency_key'
    `)) as { rows: Array<{ n: number }> };
    expect(counted.rows[0]!.n).toBe(1);
  });

  it('postgres adapter mints a fresh id for a blank id (no silent drop)', async () => {
    const { db } = await createTestCMS();
    const adapter = postgresAnalytics();
    adapter.init?.(db);

    // Two DISTINCT events that both arrive with id "" must both persist — a
    // naive `event.id ?? mint` would write one row then swallow the rest.
    const base = {
      id: '',
      name: 'page_view',
      visitorId: 'v',
      anonymous: false,
    };
    await adapter.track({ ...base, timestamp: new Date() });
    await adapter.track({ ...base, timestamp: new Date() });

    const counted = (await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM cms.ab_test_events
      WHERE event_type = 'page_view'
    `)) as { rows: Array<{ n: number }> };
    expect(counted.rows[0]!.n).toBe(2);
  });
});

// ============================================================================
// Update Test (variant replacement)
// ============================================================================

describe('A/B Test Update', () => {
  it('replaces variants on update', async () => {
    const { cms } = await createTestCMS();
    const page = await createPageWithBranches(cms);

    const { testId } = await cms.api.abTest.createTest({
      body: {
        rootId: page.rootId,
        collection: 'pages',
        name: 'Update test',
        variants: makeVariants(page.mainBranchId, page.variantBranchId),
      },
    });

    await cms.api.abTest.updateTest({
      body: {
        testId,
        variants: makeVariants(
          page.mainBranchId,
          page.variantBranchId,
          [70, 30],
        ),
      },
    });

    const test = await cms.api.abTest.getTest({ query: { testId } });
    const control = test.variants.find((v: any) => v.isControl)!;
    expect(control.weight).toBe(70);
  });

  it('prevents variant updates on running tests', async () => {
    const { cms } = await createTestCMS();
    const page = await createPageWithBranches(cms);

    const { testId } = await cms.api.abTest.createTest({
      body: {
        rootId: page.rootId,
        collection: 'pages',
        name: 'Running update test',
        variants: makeVariants(page.mainBranchId, page.variantBranchId),
      },
    });

    await cms.api.abTest.updateTest({
      body: { testId, status: 'running' },
    });

    await expect(
      cms.api.abTest.updateTest({
        body: {
          testId,
          variants: makeVariants(
            page.mainBranchId,
            page.variantBranchId,
            [80, 20],
          ),
        },
      }),
    ).rejects.toThrow();
  });
});

// ============================================================================
// Multi-Tenant Isolation
// ============================================================================

describe('multi-tenant isolation', () => {
  async function createMultiTenantTestCMS() {
    const result = await setupMultiTenantAbTestCMS();
    schemaCleanups.push(result.cleanupSchema);
    return result;
  }

  async function createPageWithBranchesMT(cms: any) {
    const root = await cms.api.pages.createRoot({
      body: {
        slug: `/landing-${Date.now()}`,
        properties: { title: 'Landing' },
      },
    });

    await publishApprovedBranch(cms, {
      rootId: root.rootId,
      branchId: root.branchId,
      publishedBy: 'admin',
    });

    const branch2 = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'variant-a',
        sourceBranchId: root.branchId,
      },
    });

    await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: branch2.branch.id,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Variant content' },
      },
    });

    await publishApprovedBranch(cms, {
      rootId: root.rootId,
      branchId: branch2.branch.id,
      publishedBy: 'admin',
    });

    return {
      rootId: root.rootId,
      mainBranchId: root.branchId,
      variantBranchId: branch2.branch.id,
    };
  }

  it('tenant A cannot see tests created by tenant B', async () => {
    const { cms, setTenant } = await createMultiTenantTestCMS();

    setTenant('tenant-a');
    const pageA = await createPageWithBranchesMT(cms);

    await cms.api.abTest.createTest({
      body: {
        rootId: pageA.rootId,
        collection: 'pages',
        name: 'Tenant A test',
        variants: makeVariants(pageA.mainBranchId, pageA.variantBranchId),
      },
    });

    setTenant('tenant-b');
    const pageB = await createPageWithBranchesMT(cms);

    await cms.api.abTest.createTest({
      body: {
        rootId: pageB.rootId,
        collection: 'pages',
        name: 'Tenant B test',
        variants: makeVariants(pageB.mainBranchId, pageB.variantBranchId),
      },
    });

    const listB = await cms.api.abTest.listTests({ query: {} });
    expect(listB.tests).toHaveLength(1);
    expect(listB.tests[0].name).toBe('Tenant B test');

    setTenant('tenant-a');
    const listA = await cms.api.abTest.listTests({ query: {} });
    expect(listA.tests).toHaveLength(1);
    expect(listA.tests[0].name).toBe('Tenant A test');
  });

  it('tenant B cannot access tenant A test by ID', async () => {
    const { cms, setTenant } = await createMultiTenantTestCMS();

    setTenant('tenant-a');
    const pageA = await createPageWithBranchesMT(cms);

    const { testId } = await cms.api.abTest.createTest({
      body: {
        rootId: pageA.rootId,
        collection: 'pages',
        name: 'Secret A test',
        variants: makeVariants(pageA.mainBranchId, pageA.variantBranchId),
      },
    });

    setTenant('tenant-b');

    await expect(
      cms.api.abTest.getTest({ query: { testId } }),
    ).rejects.toThrow();
  });

  it('tenant B cannot list goal events for tenant A root', async () => {
    const { cms, setTenant } = await createMultiTenantTestCMS();

    setTenant('tenant-a');
    const root = await cms.api.pages.createRoot({
      body: { slug: '/mt-goals', properties: { title: 'Goals' } },
    });
    await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'signupForm',
        properties: { cta: 'Join', trackingId: 'nl' },
      },
    });
    await publishApprovedBranch(cms, {
      rootId: root.rootId,
      branchId: root.branchId,
      publishedBy: 'admin',
    });

    // tenant-a sees its own goals
    const own = await cms.api.abTest.listGoalEvents({
      query: { rootId: root.rootId },
    });
    expect(own.goals.length).toBeGreaterThan(0);

    // tenant-b must NOT see tenant-a's goals (the root is out of its scope) —
    // exercises the tenantSlug branch of loadRootPublishedTree.
    setTenant('tenant-b');
    const cross = await cms.api.abTest.listGoalEvents({
      query: { rootId: root.rootId },
    });
    expect(cross.goals).toEqual([]);
  });

  it('tenant B cannot update or delete tenant A test', async () => {
    const { cms, setTenant } = await createMultiTenantTestCMS();

    setTenant('tenant-a');
    const pageA = await createPageWithBranchesMT(cms);

    const { testId } = await cms.api.abTest.createTest({
      body: {
        rootId: pageA.rootId,
        collection: 'pages',
        name: 'Protected test',
        variants: makeVariants(pageA.mainBranchId, pageA.variantBranchId),
      },
    });

    setTenant('tenant-b');

    await expect(
      cms.api.abTest.updateTest({
        body: { testId, name: 'Hijacked' },
      }),
    ).rejects.toThrow();

    await expect(
      cms.api.abTest.deleteTest({ body: { testId } }),
    ).rejects.toThrow();
  });

  it('tenant B cannot create a test on tenant A root', async () => {
    const { cms, setTenant } = await createMultiTenantTestCMS();

    setTenant('tenant-a');
    const pageA = await createPageWithBranchesMT(cms);

    setTenant('tenant-b');

    await expect(
      cms.api.abTest.createTest({
        body: {
          rootId: pageA.rootId,
          collection: 'pages',
          name: 'Cross-tenant test',
          variants: makeVariants(pageA.mainBranchId, pageA.variantBranchId),
        },
      }),
    ).rejects.toThrow();
  });

  it('tenant B cannot assign variant on tenant A test', async () => {
    const { cms, setTenant } = await createMultiTenantTestCMS();

    setTenant('tenant-a');
    const pageA = await createPageWithBranchesMT(cms);

    const { testId } = await cms.api.abTest.createTest({
      body: {
        rootId: pageA.rootId,
        collection: 'pages',
        name: 'Running test A',
        variants: makeVariants(pageA.mainBranchId, pageA.variantBranchId),
      },
    });

    await cms.api.abTest.updateTest({
      body: { testId, status: 'running' },
    });

    setTenant('tenant-b');

    await expect(
      cms.api.abTest.assignVariant({
        body: { testId, context: { key: 'visitor-1' } },
      }),
    ).rejects.toThrow();
  });
});

// ============================================================================
// trackingId publish-guard (M2b)
// ============================================================================

describe('A/B Test trackingId guard', () => {
  async function addSignupForm(
    cms: any,
    rootId: string,
    branchId: string,
    props: { cta: string; trackingId?: string },
  ) {
    return cms.api.pages.createBlock({
      body: {
        rootId,
        branchId,
        parentBlockId: rootId,
        type: 'signupForm',
        properties: props,
      },
    });
  }

  it('publishBranch passes when functional blocks have unique trackingIds', async () => {
    const { cms } = await createTestCMS();
    const root = await cms.api.pages.createRoot({
      body: { slug: '/guard-pass', properties: { title: 'Pass' } },
    });
    await addSignupForm(cms, root.rootId, root.branchId, {
      cta: 'Go',
      trackingId: 'newsletter',
    });
    await expect(
      publishApprovedBranch(cms, {
        rootId: root.rootId,
        branchId: root.branchId,
        publishedBy: 'admin',
      }),
    ).resolves.toBeDefined();
  });

  it('publishBranch rejects a functional block missing its trackingId', async () => {
    const { cms } = await createTestCMS();
    const root = await cms.api.pages.createRoot({
      body: { slug: '/guard-missing', properties: { title: 'Missing' } },
    });
    await addSignupForm(cms, root.rootId, root.branchId, { cta: 'Go' });
    await expect(
      publishApprovedBranch(cms, {
        rootId: root.rootId,
        branchId: root.branchId,
        publishedBy: 'admin',
      }),
    ).rejects.toThrow(/trackingId/i);
  });

  it('publishBranch rejects duplicate trackingId within a branch', async () => {
    const { cms } = await createTestCMS();
    const root = await cms.api.pages.createRoot({
      body: { slug: '/guard-dup', properties: { title: 'Dup' } },
    });
    await addSignupForm(cms, root.rootId, root.branchId, {
      cta: 'A',
      trackingId: 'dup',
    });
    await addSignupForm(cms, root.rootId, root.branchId, {
      cta: 'B',
      trackingId: 'dup',
    });
    await expect(
      publishApprovedBranch(cms, {
        rootId: root.rootId,
        branchId: root.branchId,
        publishedBy: 'admin',
      }),
    ).rejects.toThrow(/trackingId/i);
  });

  it('publishBranch rejects trackingId drift across A/B variant branches', async () => {
    const { cms } = await createTestCMS();
    const root = await cms.api.pages.createRoot({
      body: { slug: '/guard-drift', properties: { title: 'Drift' } },
    });
    // main: one functional block with trackingId 'a'
    await addSignupForm(cms, root.rootId, root.branchId, {
      cta: 'A',
      trackingId: 'a',
    });
    await publishApprovedBranch(cms, {
      rootId: root.rootId,
      branchId: root.branchId,
      publishedBy: 'admin',
    });
    // variant branches off main (inherits 'a') and is published (set {a})
    const variant = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'variant-a',
        sourceBranchId: root.branchId,
      },
    });
    await publishApprovedBranch(cms, {
      rootId: root.rootId,
      branchId: variant.branch.id,
      publishedBy: 'admin',
    });
    // link both (now-published, consistent {a}) branches as test variants and
    // run it — drift is only enforced for RUNNING tests.
    const { testId } = await cms.api.abTest.createTest({
      body: {
        rootId: root.rootId,
        collection: 'pages',
        name: 'Drift test',
        variants: makeVariants(root.branchId, variant.branch.id),
      },
    });
    await cms.api.abTest.updateTest({ body: { testId, status: 'running' } });
    // introduce drift: the variant now also has trackingId 'b' → set {a,b}
    await addSignupForm(cms, root.rootId, variant.branch.id, {
      cta: 'B',
      trackingId: 'b',
    });
    // re-publishing the variant (the guard runs as a before-hook): {a,b} != {a}
    await expect(
      cms.api.pages.publishBranch({
        body: {
          rootId: root.rootId,
          branchId: variant.branch.id,
          publishedBy: 'admin',
        },
      }),
    ).rejects.toThrow(/differs across/i);
  });

  it('does NOT enforce drift for a non-running (draft) test', async () => {
    const { cms } = await createTestCMS();
    const root = await cms.api.pages.createRoot({
      body: { slug: '/guard-draft', properties: { title: 'Draft' } },
    });
    await addSignupForm(cms, root.rootId, root.branchId, {
      cta: 'A',
      trackingId: 'a',
    });
    await publishApprovedBranch(cms, {
      rootId: root.rootId,
      branchId: root.branchId,
      publishedBy: 'admin',
    });
    const variant = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'variant-a',
        sourceBranchId: root.branchId,
      },
    });
    await publishApprovedBranch(cms, {
      rootId: root.rootId,
      branchId: variant.branch.id,
      publishedBy: 'admin',
    });
    // a DRAFT test (never started) — drift must not be enforced
    await cms.api.abTest.createTest({
      body: {
        rootId: root.rootId,
        collection: 'pages',
        name: 'Draft test',
        variants: makeVariants(root.branchId, variant.branch.id),
      },
    });
    await addSignupForm(cms, root.rootId, variant.branch.id, {
      cta: 'B',
      trackingId: 'b',
    });
    // {a,b} vs {a} but the test is draft → no drift enforcement
    await expect(
      cms.api.pages.publishBranch({
        body: {
          rootId: root.rootId,
          branchId: variant.branch.id,
          publishedBy: 'admin',
        },
      }),
    ).resolves.toBeDefined();
  });

  it('publishBranch allows variant branches with identical trackingId sets', async () => {
    const { cms } = await createTestCMS();
    const root = await cms.api.pages.createRoot({
      body: { slug: '/guard-nodrift', properties: { title: 'NoDrift' } },
    });
    await addSignupForm(cms, root.rootId, root.branchId, {
      cta: 'A',
      trackingId: 'a',
    });
    await publishApprovedBranch(cms, {
      rootId: root.rootId,
      branchId: root.branchId,
      publishedBy: 'admin',
    });
    const variant = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'variant-a',
        sourceBranchId: root.branchId,
      },
    });
    // variant inherits the 'a' form unchanged → set {a}; publish it
    await publishApprovedBranch(cms, {
      rootId: root.rootId,
      branchId: variant.branch.id,
      publishedBy: 'admin',
    });
    const { testId } = await cms.api.abTest.createTest({
      body: {
        rootId: root.rootId,
        collection: 'pages',
        name: 'No-drift test',
        variants: makeVariants(root.branchId, variant.branch.id),
      },
    });
    await cms.api.abTest.updateTest({ body: { testId, status: 'running' } });
    // re-publish the (unchanged) variant of the RUNNING test → {a} == {a}
    await expect(
      cms.api.pages.publishBranch({
        body: {
          rootId: root.rootId,
          branchId: variant.branch.id,
          publishedBy: 'admin',
        },
      }),
    ).resolves.toBeDefined();
  });

  it('does not leak / fire across tenants (ownership check skips the guard)', async () => {
    const { cms, setTenant, cleanupSchema } = await setupMultiTenantAbTestCMS();
    schemaCleanups.push(cleanupSchema);

    // tenant-a: a root whose branch has a functional block MISSING its trackingId
    setTenant('tenant-a');
    const root = await cms.api.pages.createRoot({
      body: { slug: '/guard-tenant', properties: { title: 'T' } },
    });
    await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'signupForm',
        properties: { cta: 'Go' }, // no trackingId — would trip the guard
      },
    });

    // tenant-b tries to publish tenant-a's branch: the guard's ownership check
    // returns early (foreign root), so it never reads tenant-a's blocks and the
    // failure is a generic not-found, NOT a trackingId leak.
    setTenant('tenant-b');
    let message = '';
    try {
      await cms.api.pages.publishBranch({
        body: {
          rootId: root.rootId,
          branchId: root.branchId,
          publishedBy: 'admin',
        },
      });
      throw new Error('expected publishBranch to reject');
    } catch (err) {
      message = (err as Error).message ?? '';
    }
    expect(message).not.toMatch(/trackingId/i);
  });

  it('scope.where gate skips the guard for an out-of-scope root (any dimension)', async () => {
    // Directly exercises the ownership gate with an arbitrary scope.where — a
    // stand-in for a foreign tenant OR i18n-language predicate. An out-of-scope
    // root must NOT be read by the guard (no trackingId leak); an in-scope one is.
    const { cms, db } = await createTestCMS();
    const root = await cms.api.pages.createRoot({
      body: { slug: '/guard-scope', properties: { title: 'Scope' } },
    });
    await addSignupForm(cms, root.rootId, root.branchId, { cta: 'Go' }); // no trackingId

    // out-of-scope predicate → requireRootInScope finds nothing → guard no-ops
    await expect(
      assertTrackingIntegrity({
        db,
        collections: GUARD_COLLECTIONS,
        collectionName: 'pages',
        rootId: root.rootId,
        branchId: root.branchId,
        scope: { roots: { where: sql`1 = 0` } },
      }),
    ).resolves.toBeUndefined();

    // in-scope (no predicate) → the missing trackingId IS caught
    await expect(
      assertTrackingIntegrity({
        db,
        collections: GUARD_COLLECTIONS,
        collectionName: 'pages',
        rootId: root.rootId,
        branchId: root.branchId,
        scope: { roots: { where: undefined } },
      }),
    ).rejects.toThrow(/trackingId/i);
  });
});

// ============================================================================
// listGoalEvents — the M4 goal-picker
// ============================================================================

describe('A/B Test listGoalEvents (M4 goal-picker)', () => {
  it('returns one candidate per declared event on functional block instances', async () => {
    const { cms } = await createTestCMS();
    const root = await cms.api.pages.createRoot({
      body: { slug: '/goals', properties: { title: 'Goals' } },
    });
    await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'signupForm',
        properties: { cta: 'Join', trackingId: 'newsletter' },
      },
    });
    await publishApprovedBranch(cms, {
      rootId: root.rootId,
      branchId: root.branchId,
      publishedBy: 'admin',
    });

    const { goals } = await cms.api.abTest.listGoalEvents({
      query: { rootId: root.rootId },
    });

    // signupForm declares: submit (no override) + submitSuccess (name override).
    expect(goals).toHaveLength(2);
    const byEvent = Object.fromEntries(
      goals.map((g: { event: string }) => [g.event, g]),
    );
    expect(byEvent.submit).toMatchObject({
      handle: 'newsletter',
      blockType: 'signupForm',
      event: 'submit',
      name: 'cms_signupForm_submit', // default wire name cms_<type>_<key>
      inVaryingRoot: true,
      hostRootId: root.rootId,
    });
    expect(byEvent.submitSuccess).toMatchObject({
      handle: 'newsletter',
      event: 'submitSuccess',
      name: 'generate_lead', // declared EventDeclaration.name override
      inVaryingRoot: true,
    });
  });

  it('returns no goals for a page with only presentational blocks', async () => {
    const { cms } = await createTestCMS();
    const root = await cms.api.pages.createRoot({
      body: { slug: '/no-goals', properties: { title: 'No goals' } },
    });
    await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Just text' },
      },
    });
    await publishApprovedBranch(cms, {
      rootId: root.rootId,
      branchId: root.branchId,
      publishedBy: 'admin',
    });

    const { goals } = await cms.api.abTest.listGoalEvents({
      query: { rootId: root.rootId },
    });
    expect(goals).toEqual([]);
  });

  it('returns no goals for an unpublished root', async () => {
    const { cms } = await createTestCMS();
    const root = await cms.api.pages.createRoot({
      body: { slug: '/draft-goals', properties: { title: 'Draft' } },
    });
    await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'signupForm',
        properties: { cta: 'Join', trackingId: 'nl' },
      },
    });
    // intentionally NOT published
    const { goals } = await cms.api.abTest.listGoalEvents({
      query: { rootId: root.rootId },
    });
    expect(goals).toEqual([]);
  });
});

// ============================================================================
// goal storage + goal-aware getResults (M4b)
// ============================================================================

describe('A/B Test goal storage + getResults (M4b)', () => {
  it('stores the goal on createTest and returns it via getTest', async () => {
    const { cms } = await createTestCMS();
    const page = await createPageWithBranches(cms);
    const { testId } = await cms.api.abTest.createTest({
      body: {
        rootId: page.rootId,
        collection: 'pages',
        name: 'Goal test',
        goalHandle: 'cta-main',
        goalEvent: 'cms_cta_click',
        variants: makeVariants(page.mainBranchId, page.variantBranchId),
      },
    });
    const test = await cms.api.abTest.getTest({ query: { testId } });
    expect(test.goalHandle).toBe('cta-main');
    expect(test.goalEvent).toBe('cms_cta_click');
  });

  it('counts the chosen goal event as the conversion (not other events)', async () => {
    const { cms } = await createTestCMS();
    const page = await createPageWithBranches(cms);
    const { testId } = await cms.api.abTest.createTest({
      body: {
        rootId: page.rootId,
        collection: 'pages',
        name: 'Goal results',
        goalEvent: 'cms_cta_click',
        trafficPercentage: 100,
        variants: makeVariants(page.mainBranchId, page.variantBranchId),
      },
    });
    await cms.api.abTest.updateTest({ body: { testId, status: 'running' } });

    const branchId = page.mainBranchId;
    for (const eventType of [
      'impression',
      'cms_cta_click', // the goal
      'some_other_event', // an unrelated event — must NOT count
    ]) {
      await cms.api.abTest.trackEvent({
        body: { testId, branchId, anonymous: true, eventType },
      });
    }

    const results = await cms.api.abTest.getResults({ query: { testId } });
    expect(results.totalConversions).toBe(1); // only the goal event
    const arm = results.variants.find(
      (v: { impressions: number }) => v.impressions === 1,
    )!;
    expect(arm.conversions).toBe(1); // cms_cta_click, not some_other_event
    expect(arm.conversionRate).toBe(100); // 1 / 1
  });

  it('updates and clears the goal', async () => {
    const { cms } = await createTestCMS();
    const page = await createPageWithBranches(cms);
    const { testId } = await cms.api.abTest.createTest({
      body: {
        rootId: page.rootId,
        collection: 'pages',
        name: 'Goal update',
        goalEvent: 'old_goal',
        variants: makeVariants(page.mainBranchId, page.variantBranchId),
      },
    });

    await cms.api.abTest.updateTest({
      body: { testId, goalEvent: 'new_goal' },
    });
    let test = await cms.api.abTest.getTest({ query: { testId } });
    expect(test.goalEvent).toBe('new_goal');

    await cms.api.abTest.updateTest({ body: { testId, goalEvent: null } });
    test = await cms.api.abTest.getTest({ query: { testId } });
    expect(test.goalEvent).toBeNull();
  });
});

// ============================================================================
// funnel: completion_rate from interaction ids (M4d)
// ============================================================================

describe('A/B Test funnel completion_rate (M4d)', () => {
  it('computes attempts + completion_rate from interaction ids', async () => {
    const { cms } = await createTestCMS();
    const page = await createPageWithBranches(cms);
    const { testId } = await cms.api.abTest.createTest({
      body: {
        rootId: page.rootId,
        collection: 'pages',
        name: 'Funnel',
        goalEvent: 'form_success',
        trafficPercentage: 100,
        variants: makeVariants(page.mainBranchId, page.variantBranchId),
      },
    });
    await cms.api.abTest.updateTest({ body: { testId, status: 'running' } });

    const branchId = page.mainBranchId;
    // 3 interactions start (attempt); 2 reach the goal (success) → 2/3.
    for (const interactionId of ['ix1', 'ix2', 'ix3']) {
      await cms.api.abTest.trackEvent({
        body: {
          testId,
          branchId,
          anonymous: true,
          eventType: 'form_attempt',
          interactionId,
        },
      });
    }
    for (const interactionId of ['ix1', 'ix2']) {
      await cms.api.abTest.trackEvent({
        body: {
          testId,
          branchId,
          anonymous: true,
          eventType: 'form_success',
          interactionId,
        },
      });
    }

    const results = await cms.api.abTest.getResults({ query: { testId } });
    const arm = results.variants.find(
      (v: { attempts: number }) => v.attempts === 3,
    )!;
    expect(arm.attempts).toBe(3); // 3 distinct interaction ids
    expect(arm.eventBreakdown['form_success']!.distinctInteractions).toBe(2);
    expect(arm.completionRate).toBe(66.67); // 2 of 3 reached the goal
  });

  it('completion_rate is 0 for a non-funnel goal (no interaction ids)', async () => {
    const { cms } = await createTestCMS();
    const page = await createPageWithBranches(cms);
    const { testId } = await cms.api.abTest.createTest({
      body: {
        rootId: page.rootId,
        collection: 'pages',
        name: 'Click goal',
        goalEvent: 'cms_cta_click',
        trafficPercentage: 100,
        variants: makeVariants(page.mainBranchId, page.variantBranchId),
      },
    });
    await cms.api.abTest.updateTest({ body: { testId, status: 'running' } });

    await cms.api.abTest.trackEvent({
      body: {
        testId,
        branchId: page.mainBranchId,
        anonymous: true,
        eventType: 'cms_cta_click', // no interactionId → not a funnel
      },
    });

    const results = await cms.api.abTest.getResults({ query: { testId } });
    const arm = results.variants.find(
      (v: { conversions: number }) => v.conversions === 1,
    )!;
    expect(arm.attempts).toBe(0);
    expect(arm.completionRate).toBe(0);
  });
});

// ============================================================================
// server-MP forward (M5)
// ============================================================================

describe('A/B Test server-MP forward (M5)', () => {
  async function runningTest(ga4: { type: 'sgtm'; endpointUrl: string }) {
    const { cms, cleanupSchema } = await setupAbTestCMS({ ga4 });
    schemaCleanups.push(cleanupSchema);
    const page = await createPageWithBranches(cms);
    const { testId } = await cms.api.abTest.createTest({
      body: {
        rootId: page.rootId,
        collection: 'pages',
        name: 'MP',
        trafficPercentage: 100,
        variants: makeVariants(page.mainBranchId, page.variantBranchId),
      },
    });
    await cms.api.abTest.updateTest({ body: { testId, status: 'running' } });
    return { cms, testId, branchId: page.mainBranchId };
  }

  const GRANTED = {
    analytics_storage: 'granted',
    ad_storage: 'granted',
    ad_user_data: 'granted',
    ad_personalization: 'granted',
  } as const;

  it('forwards a consenting, client_id-bearing event to the GA4 endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('fetch', fetchMock);
    try {
      const { cms, testId, branchId } = await runningTest({
        type: 'sgtm',
        endpointUrl: 'https://sgtm.example/collect',
      });

      await cms.api.abTest.trackEvent({
        body: {
          testId,
          branchId,
          anonymous: false,
          eventType: 'cms_cta_click',
          transport: { clientId: 'GA-CID', engagementTimeMsec: 5 },
          consent: GRANTED,
        },
      });

      expect(fetchMock).toHaveBeenCalledOnce();
      expect(fetchMock.mock.calls[0]![0]).toBe('https://sgtm.example/collect');
      const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
      expect(body.client_id).toBe('GA-CID');
      expect(body.events[0].name).toBe('cms_cta_click');
      expect(body.events[0].params.experiment_id).toBe(testId);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('stores but does NOT forward when no client_id (consent-free path)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('fetch', fetchMock);
    try {
      const { cms, testId, branchId } = await runningTest({
        type: 'sgtm',
        endpointUrl: 'https://sgtm.example/collect',
      });

      // consent granted but NO transport.clientId → stored, not forwarded.
      await cms.api.abTest.trackEvent({
        body: {
          testId,
          branchId,
          anonymous: true,
          eventType: 'cms_cta_click',
          consent: GRANTED,
        },
      });

      expect(fetchMock).not.toHaveBeenCalled();
      // the anonymous aggregate count was still recorded
      const results = await cms.api.abTest.getResults({ query: { testId } });
      expect(
        results.variants.some((v) => v.eventBreakdown['cms_cta_click']),
      ).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('a self-reported denial skips BOTH the store write and the forward', async () => {
    const fetchMock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('fetch', fetchMock);
    try {
      const { cms, testId, branchId } = await runningTest({
        type: 'sgtm',
        endpointUrl: 'https://sgtm.example/collect',
      });

      await cms.api.abTest.trackEvent({
        body: {
          testId,
          branchId,
          anonymous: false,
          eventType: 'cms_cta_click',
          transport: { clientId: 'GA-CID', engagementTimeMsec: 5 },
          consent: { ...GRANTED, analytics_storage: 'denied' },
        },
      });

      // No GA4 forward …
      expect(fetchMock).not.toHaveBeenCalled();
      // … and nothing stored either (the courtesy no-op short-circuits first).
      const results = await cms.api.abTest.getResults({ query: { testId } });
      expect(
        results.variants.some((v) => v.eventBreakdown['cms_cta_click']),
      ).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
