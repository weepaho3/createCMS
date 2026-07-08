import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { setupTestDB } from '../../../../test/utils/db';
import { DUMMY_MEDIA_CONFIG } from '../../../../test/utils/fixtures';
import { createCMS } from '../../../core/factory';
import { i18n } from '../../i18n/index';
import { i18nSchema } from '../../i18n/schema';
import { abTest } from '../index';
import { buildSchema } from '../schema';

/**
 * A/B XOR rule (AB_FANOUT_DESIGN §2): at most one root may vary per rendered
 * page. A page embeds a reusable block via a `reference` property, so a running
 * test on the block and a running test on its host page would vary two axes in
 * one render — `collectCoRenderRoots` + the updateTest→running guard reject the
 * second one with AB_TEST_CROSS_EMBED_CONFLICT.
 */

const XOR_COLLECTIONS = {
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

const schemaCleanups: Array<() => Promise<void>> = [];
afterAll(async () => {
  await Promise.allSettled(schemaCleanups.map((fn) => fn()));
});

async function setupXorCMS() {
  const { db, cleanup } = await setupTestDB({
    plugins: [{ name: 'ab-test', schema: buildSchema() }],
  });
  schemaCleanups.push(cleanup);
  const cms = createCMS({
    db,
    media: DUMMY_MEDIA_CONFIG,
    collections: XOR_COLLECTIONS,
    plugins: [abTest()],
  }) as { api: Record<string, Record<string, (...a: any[]) => Promise<any>>> };
  return { cms };
}

/** Collection-aware approve + publish (the shared helper is pages-only). */
async function publish(
  cms: any,
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

function makeVariants(mainBranchId: string, variantBranchId: string) {
  return [
    { branchId: mainBranchId, name: 'Control', weight: 50, isControl: true },
    { branchId: variantBranchId, name: 'Variant', weight: 50 },
  ];
}

/** Creates a root with a published main branch + a published variant branch. */
async function publishedRootWithVariant(
  cms: any,
  collection: 'pages' | 'reusableblocks',
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

async function runningTest(
  cms: any,
  collection: string,
  root: { rootId: string; mainBranchId: string; variantBranchId: string },
) {
  const { testId } = await cms.api.abTest.createTest({
    body: {
      rootId: root.rootId,
      collection,
      name: `${collection} test`,
      variants: makeVariants(root.mainBranchId, root.variantBranchId),
    },
  });
  await cms.api.abTest.updateTest({ body: { testId, status: 'running' } });
  return testId;
}

/** A published page (main + variant) that embeds `blockRootId` via a reference. */
async function pageEmbedding(cms: any, blockRootId: string, slug: string) {
  const page = await cms.api.pages.createRoot({
    body: { slug, properties: { title: 'Host' } },
  });
  await cms.api.pages.createBlock({
    body: {
      rootId: page.rootId,
      branchId: page.branchId,
      parentBlockId: page.rootId,
      type: 'reusableContent',
      properties: { block: blockRootId },
    },
  });
  await publish(cms, 'pages', page.rootId, page.branchId);
  const variant = await cms.api.pages.createBranch({
    body: {
      rootId: page.rootId,
      name: 'variant',
      sourceBranchId: page.branchId,
    },
  });
  await publish(cms, 'pages', page.rootId, variant.branch.id);
  return {
    rootId: page.rootId,
    mainBranchId: page.branchId,
    variantBranchId: variant.branch.id,
  };
}

describe('A/B XOR cross-embed guard', () => {
  it('rejects a page test when its embedded block has a running test', async () => {
    const { cms } = await setupXorCMS();
    const block = await publishedRootWithVariant(cms, 'reusableblocks', {
      label: 'Newsletter',
    });
    const page = await pageEmbedding(cms, block.rootId, '/host');

    await runningTest(cms, 'reusableblocks', block); // block test runs first → ok

    const { testId: pageTestId } = await cms.api.abTest.createTest({
      body: {
        rootId: page.rootId,
        collection: 'pages',
        name: 'page test',
        variants: makeVariants(page.mainBranchId, page.variantBranchId),
      },
    });
    await expect(
      cms.api.abTest.updateTest({
        body: { testId: pageTestId, status: 'running' },
      }),
    ).rejects.toThrow(/co-rendering|axis/i);
  });

  it('rejects a block test when its host page has a running test (reverse direction)', async () => {
    const { cms } = await setupXorCMS();
    const block = await publishedRootWithVariant(cms, 'reusableblocks', {
      label: 'Newsletter',
    });
    const page = await pageEmbedding(cms, block.rootId, '/host2');

    await runningTest(cms, 'pages', page); // page test runs first → ok

    const { testId: blockTestId } = await cms.api.abTest.createTest({
      body: {
        rootId: block.rootId,
        collection: 'reusableblocks',
        name: 'block test',
        variants: makeVariants(block.mainBranchId, block.variantBranchId),
      },
    });
    await expect(
      cms.api.abTest.updateTest({
        body: { testId: blockTestId, status: 'running' },
      }),
    ).rejects.toThrow(/co-rendering|axis/i);
  });

  it('is group-aware: a tgr_ page→page reference co-renders the target group (i18n)', async () => {
    // i18n + ab-test, with a pages collection that can reference another page.
    const { db, cleanup } = await setupTestDB({
      plugins: [
        { name: 'i18n', schema: i18nSchema },
        { name: 'ab-test', schema: buildSchema() },
      ],
    });
    schemaCleanups.push(cleanup);
    let language = 'en';
    const I18N_COLLECTIONS = {
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
          embed: {
            label: 'Embed',
            properties: {
              ref: {
                type: 'reference' as const,
                collection: 'pages',
                label: 'Ref',
                required: true as const,
              },
            },
          },
        },
      },
    } as const;
    const cms = createCMS({
      db,
      media: DUMMY_MEDIA_CONFIG,
      collections: I18N_COLLECTIONS,
      middleware: async () => ({ language }),
      plugins: [
        i18n({
          languages: ['en', 'de'] as const,
          defaultLanguage: 'en' as const,
        }),
        abTest(),
      ],
    }) as {
      api: Record<string, Record<string, (...a: any[]) => Promise<any>>>;
    };

    language = 'en';
    // target page B (gets a tgr_ translation-group key)
    const b = await publishedRootWithVariant(
      cms,
      'pages',
      { title: 'Target' },
      '/b',
    );
    const [{ translation_key: bTgr }] = (
      (await db.execute(sql`
        SELECT translation_key FROM cms.roots WHERE id = ${b.rootId}
      `)) as { rows: Array<{ translation_key: string }> }
    ).rows;
    expect(bTgr).toMatch(/^tgr_/);

    // host page A embeds B via its tgr_ GROUP key (not its rootId)
    const a = await cms.api.pages.createRoot({
      body: { slug: '/a', properties: { title: 'Host' } },
    });
    await cms.api.pages.createBlock({
      body: {
        rootId: a.rootId,
        branchId: a.branchId,
        parentBlockId: a.rootId,
        type: 'embed',
        properties: { ref: bTgr },
      },
    });
    await publish(cms, 'pages', a.rootId, a.branchId);
    const aVariant = await cms.api.pages.createBranch({
      body: { rootId: a.rootId, name: 'variant', sourceBranchId: a.branchId },
    });
    await publish(cms, 'pages', a.rootId, aVariant.branch.id);

    // B's test runs first → ok
    await runningTest(cms, 'pages', b);

    // A's test → must reject: A's embed resolves the tgr_ to B's group, which runs.
    const { testId: aTestId } = await cms.api.abTest.createTest({
      body: {
        rootId: a.rootId,
        collection: 'pages',
        name: 'host test',
        variants: makeVariants(a.branchId, aVariant.branch.id),
      },
    });
    await expect(
      cms.api.abTest.updateTest({
        body: { testId: aTestId, status: 'running' },
      }),
    ).rejects.toThrow(/co-rendering|axis/i);
  });

  it('allows a running test on a root with no co-rendering embed (happy path)', async () => {
    const { cms } = await setupXorCMS();
    const a = await publishedRootWithVariant(cms, 'reusableblocks', {
      label: 'A',
    });
    const b = await publishedRootWithVariant(cms, 'reusableblocks', {
      label: 'B',
    });
    await runningTest(cms, 'reusableblocks', a);
    await expect(runningTest(cms, 'reusableblocks', b)).resolves.toBeDefined();
  });

  it('publishBranch backstop rejects a publish that makes two running tests co-render (TOCTOU)', async () => {
    const { cms } = await setupXorCMS();
    // two independent blocks, each with a running test — they do NOT co-render
    // yet, so both tests start cleanly (the updateTest guard sees no edge).
    const b = await publishedRootWithVariant(cms, 'reusableblocks', {
      label: 'B',
    });
    const c = await publishedRootWithVariant(cms, 'reusableblocks', {
      label: 'C',
    });
    await runningTest(cms, 'reusableblocks', b);
    await runningTest(cms, 'reusableblocks', c);

    // a page embedding BOTH running blocks, created AFTER both tests started —
    // the start-time guard never saw this co-render edge.
    const page = await cms.api.pages.createRoot({
      body: { slug: '/toctou', properties: { title: 'TOCTOU' } },
    });
    for (const block of [b, c]) {
      await cms.api.pages.createBlock({
        body: {
          rootId: page.rootId,
          branchId: page.branchId,
          parentBlockId: page.rootId,
          type: 'reusableContent',
          properties: { block: block.rootId },
        },
      });
    }
    // publishing the page would render both running blocks in one tree → reject
    await expect(
      publish(cms, 'pages', page.rootId, page.branchId),
    ).rejects.toThrow(/co-rendering|axis/i);
  });

  it('allows publishing a shared block while two independent host pages have running tests', async () => {
    const { cms } = await setupXorCMS();
    // an UNTESTED shared block embedded by two independent pages
    const shared = await publishedRootWithVariant(cms, 'reusableblocks', {
      label: 'Shared',
    });
    const p1 = await pageEmbedding(cms, shared.rootId, '/shared-host-1');
    const p2 = await pageEmbedding(cms, shared.rootId, '/shared-host-2');
    // p1 and p2 never co-render with each other (the shared block is static), so
    // both page tests start cleanly.
    await runningTest(cms, 'pages', p1);
    await runningTest(cms, 'pages', p2);
    // a routine re-publish of the shared block must NOT be rejected — its own
    // render subtree has no varying root (the flat-closure bug rejected this).
    await expect(
      cms.api.reusableblocks.publishBranch({
        body: {
          rootId: shared.rootId,
          branchId: shared.mainBranchId,
          publishedBy: 'admin',
        },
      }),
    ).resolves.toBeDefined();
  });
});
