import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { assets } from '../../../schema';
import { setupTestCMS } from '../../../test-utils/cms';

type Ctx = Awaited<ReturnType<typeof setupTestCMS>>;

async function setup() {
  const ctx = await setupTestCMS();
  const [asset, other] = await ctx.db
    .insert(assets)
    .values([
      { slug: 'a.png', mimeType: 'image/png', size: 1, objectKey: 'a-key' },
      { slug: 'b.png', mimeType: 'image/png', size: 1, objectKey: 'b-key' },
    ])
    .returning();
  const api = ctx.cms.api.pages;

  const page = async (slug: string) =>
    api.createRoot({ body: { slug, properties: { title: slug.slice(1) } } });
  const image = (
    root: { rootId: string },
    branchId: string,
    src: string | { assetId: string; alt?: string },
  ) =>
    api.createBlock({
      body: {
        rootId: root.rootId,
        branchId,
        parentBlockId: root.rootId,
        type: 'image',
        properties: { src },
      },
    });

  // Published page, image without alt text.
  const published = await page('/published');
  await image(published, published.branchId, asset.id);
  await api.publishBranch({
    body: { rootId: published.rootId, branchId: published.branchId },
  });

  // Draft page: the asset only on a second branch, with alt text.
  const drafted = await page('/drafted');
  const draft = await api.createBranch({
    body: {
      rootId: drafted.rootId,
      name: 'draft',
      sourceBranchId: drafted.branchId,
    },
  });
  await image(drafted, draft.branch.id, { assetId: asset.id, alt: 'Team' });

  // A page that used the asset once: history only.
  const former = await page('/former');
  const block = await image(former, former.branchId, asset.id);
  await api.updateBlock({
    body: {
      rootId: former.rootId,
      branchId: former.branchId,
      blockId: block.blockId,
      type: 'image',
      properties: { src: other.id },
    },
  });

  return { ...ctx, asset, published, drafted, draft, former };
}

async function usages(ctx: Ctx, query: Record<string, unknown>) {
  return ctx.cms.api.media.getAssetUsages({ query: query as never });
}

describe('getAssetUsages', () => {
  it('derives the live, published, history and branch scopes', async () => {
    const ctx = await setup();
    const roots = async (query: Record<string, unknown>) =>
      (await usages(ctx, { assetId: ctx.asset.id, ...query })).items
        .map((item) => item.rootId)
        .sort();

    expect(await roots({})).toEqual(
      [ctx.drafted.rootId, ctx.published.rootId].sort(),
    );
    expect(await roots({ scope: 'published' })).toEqual([ctx.published.rootId]);
    expect(await roots({ scope: 'history' })).toEqual(
      [ctx.drafted.rootId, ctx.published.rootId, ctx.former.rootId].sort(),
    );
    expect(await roots({ branchId: ctx.draft.branch.id })).toEqual([
      ctx.drafted.rootId,
    ]);
  });

  it('describes roots and occurrences', async () => {
    const ctx = await setup();
    const page = await usages(ctx, { assetId: ctx.asset.id });
    expect(page.total).toEqual({ roots: 2, occurrences: 2, hiddenRoots: 0 });
    const byRoot = new Map(page.items.map((item) => [item.rootId, item]));
    expect(byRoot.get(ctx.published.rootId)).toMatchObject({
      collection: 'pages',
      status: 'published',
      via: null,
      occurrences: [
        {
          branchName: 'main',
          propertyKey: 'src',
          path: '/src',
          matchedBy: 'schema',
          altState: 'missing',
        },
      ],
    });
    expect(byRoot.get(ctx.drafted.rootId)).toMatchObject({
      status: 'draft',
      occurrences: [{ branchName: 'draft', altState: 'present' }],
    });
  });

  it('filters usages without alt text', async () => {
    const ctx = await setup();
    const page = await usages(ctx, {
      assetId: ctx.asset.id,
      missingAlt: 'true',
    });
    expect(page.items.map((item) => item.rootId)).toEqual([
      ctx.published.rootId,
    ]);
  });

  it('paginates roots with a cursor', async () => {
    const ctx = await setup();
    const first = await usages(ctx, {
      assetId: ctx.asset.id,
      scope: 'history',
      limit: 2,
    });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = await usages(ctx, {
      assetId: ctx.asset.id,
      scope: 'history',
      limit: 2,
      cursor: first.nextCursor,
    });
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    const all = [...first.items, ...second.items].map((item) => item.rootId);
    expect(new Set(all).size).toBe(3);
  });

  it('counts usages for many assets', async () => {
    const ctx = await setup();
    const { counts } = await ctx.cms.api.media.getAssetUsageCounts({
      body: { assetIds: [ctx.asset.id] },
    });
    expect(counts).toEqual({ [ctx.asset.id]: { roots: 2, published: 1 } });
  });

  it('makes an asset private again when its last publication goes, from the index', async () => {
    const ctx = await setup();
    const status = async () =>
      (await ctx.db.select().from(assets).where(eq(assets.id, ctx.asset.id)))[0]
        .status;
    expect(await status()).toBe('public');
    await ctx.cms.api.pages.unpublishBranch({
      body: { rootId: ctx.published.rootId, branchId: ctx.published.branchId },
    });
    expect(await status()).toBe('private');
  });
});

describe('listAssets usage filters', () => {
  it('lists used, unused and missing-alt assets in a scope', async () => {
    const ctx = await setup();
    const ids = async (query: Record<string, unknown>) =>
      (await ctx.cms.api.media.listAssets({ query: query as never })).assets
        .map((a) => a.id)
        .sort();
    const other = (await ctx.db.select().from(assets)).find(
      (a) => a.id !== ctx.asset.id,
    )!;

    expect(await ids({ usage: 'used' })).toEqual(
      [ctx.asset.id, other.id].sort(),
    );
    expect(await ids({ usage: 'used', usageScope: 'published' })).toEqual([
      ctx.asset.id,
    ]);
    expect(await ids({ usage: 'unused', usageScope: 'published' })).toEqual([
      other.id,
    ]);
    expect(await ids({ missingAlt: true })).toEqual(
      [ctx.asset.id, other.id].sort(),
    );
    expect(await ids({ usage: 'unused' })).toEqual([]);
    expect(await ids({ unusedSinceDays: 1, usageScope: 'published' })).toEqual(
      [],
    );

    // Pages through the filtered set with a cursor.
    const first = await ctx.cms.api.media.listAssets({
      query: { usage: 'used', limit: 1 } as never,
    });
    const second = await ctx.cms.api.media.listAssets({
      query: { usage: 'used', limit: 1, cursor: first.nextCursor } as never,
    });
    expect(first.total).toBe(2);
    expect(second.assets[0].id).not.toBe(first.assets[0].id);
  });
});

describe('protection matrix', () => {
  it('skips used assets with counts, archives them with force', async () => {
    const ctx = await setup();
    const res = await ctx.cms.api.media.archiveAssets({
      body: { assetIds: [ctx.asset.id] },
    });
    expect(res.skippedReasons).toEqual({ [ctx.asset.id]: 'in_use' });
    expect(res.usage).toEqual({ [ctx.asset.id]: { roots: 2, published: 1 } });

    const forced = await ctx.cms.api.media.archiveAssets({
      body: { assetIds: [ctx.asset.id], force: true },
    });
    expect(forced.archivedIds).toContain(ctx.asset.id);
  });

  it('never reclaims an asset that history or an archived root uses', async () => {
    const ctx = await setupTestCMS({
      dataRetention: { keepDays: 7, keepMinCommits: 1, archiveKeepDays: 7 },
    });
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [historyOnly, inTrash, free, unused] = await ctx.db
      .insert(assets)
      .values(
        ['h', 't', 'f', 'u'].map((slug) => ({
          slug: `${slug}.png`,
          mimeType: 'image/png',
          size: 1,
          objectKey: `${slug}-key`,
        })),
      )
      .returning();
    const api = ctx.cms.api.pages;
    const page = await api.createRoot({
      body: { slug: '/history', properties: { title: 'History' } },
    });
    const block = await api.createBlock({
      body: {
        rootId: page.rootId,
        branchId: page.branchId,
        parentBlockId: page.rootId,
        type: 'image',
        properties: { src: historyOnly.id },
      },
    });
    await api.updateBlock({
      body: {
        rootId: page.rootId,
        branchId: page.branchId,
        blockId: block.blockId,
        type: 'image',
        properties: { src: free.id },
      },
    });
    const trashed = await api.createRoot({
      body: { slug: '/trashed', properties: { title: 'Trashed' } },
    });
    await api.createBlock({
      body: {
        rootId: trashed.rootId,
        branchId: trashed.branchId,
        parentBlockId: trashed.rootId,
        type: 'image',
        properties: { src: inTrash.id },
      },
    });
    await api.archiveRoot({ body: { rootId: trashed.rootId } });
    // `free` is used live, so it is the control that stays; archive the rest.
    await ctx.db
      .update(assets)
      .set({ archivedAt: old })
      .where(eq(assets.id, historyOnly.id));
    await ctx.db
      .update(assets)
      .set({ archivedAt: old })
      .where(eq(assets.id, inTrash.id));
    await ctx.db
      .update(assets)
      .set({ archivedAt: old })
      .where(eq(assets.id, unused.id));

    const result = await ctx.cms.api.admin.runPruning({
      body: { dryRun: true },
    });
    expect(result.deletedAssets).not.toContain(historyOnly.id);
    expect(result.deletedAssets).not.toContain(inTrash.id);
    expect(result.deletedAssets).toContain(unused.id);
  });

  it('respects usage sources', async () => {
    const ctx = await setupTestCMS({
      media: {
        usageSources: [
          {
            kind: 'seo',
            assetsInUse: async (ids) => ids.filter((id) => id.endsWith('1')),
          },
        ],
      },
    });
    const [asset] = await ctx.db
      .insert(assets)
      .values({
        id: 'ast_0000000000000000000a1',
        slug: 'seo.png',
        mimeType: 'image/png',
        size: 1,
        objectKey: 'seo-key',
      })
      .returning();
    const res = await ctx.cms.api.media.archiveAssets({
      body: { assetIds: [asset.id] },
    });
    expect(res.skippedReasons).toEqual({ [asset.id]: 'external' });
  });
});

describe('replaceAssetUsages', () => {
  it('lists, then commits the replacement on every branch head using the asset', async () => {
    const ctx = await setup();
    const other = (await ctx.db.select().from(assets)).find(
      (a) => a.id !== ctx.asset.id,
    )!;
    const dry = await ctx.cms.api.media.replaceAssetUsages({
      body: { fromAssetId: ctx.asset.id, toAssetId: other.id, dryRun: true },
    });
    expect(
      dry.results.map((r) => [r.rootId, r.branchId, r.commitId]).sort(),
    ).toEqual(
      [
        [ctx.drafted.rootId, ctx.draft.branch.id, null],
        [ctx.published.rootId, ctx.published.branchId, null],
      ].sort(),
    );

    const done = await ctx.cms.api.media.replaceAssetUsages({
      body: { fromAssetId: ctx.asset.id, toAssetId: other.id },
    });
    expect(done.results.every((r) => r.ok && r.commitId)).toBe(true);

    const before = await ctx.cms.api.media.getAssetUsages({
      query: { assetId: ctx.asset.id },
    });
    expect(before.items).toEqual([]);
    const after = await ctx.cms.api.media.getAssetUsages({
      query: { assetId: other.id },
    });
    const drafted = after.items.find((i) => i.rootId === ctx.drafted.rootId)!;
    // The alt text of the usage survives the swap.
    expect(drafted.occurrences[0].altState).toBe('present');
  });

  it('only touches the given branches', async () => {
    const ctx = await setup();
    const other = (await ctx.db.select().from(assets)).find(
      (a) => a.id !== ctx.asset.id,
    )!;
    const res = await ctx.cms.api.media.replaceAssetUsages({
      body: {
        fromAssetId: ctx.asset.id,
        toAssetId: other.id,
        branchIds: [ctx.draft.branch.id],
      },
    });
    expect(res.results.map((r) => r.branchId)).toEqual([ctx.draft.branch.id]);
  });
});

describe('rich text usages', () => {
  it('lists an asset that only a rich text image node uses and keeps it from archiving', async () => {
    const ctx = await setupTestCMS({ withS3: true });
    const [asset] = await ctx.db
      .insert(assets)
      .values([
        { slug: 'r.png', mimeType: 'image/png', size: 1, objectKey: 'r-key' },
      ])
      .returning();
    const api = ctx.cms.api.pages;
    const root = await api.createRoot({
      body: { slug: '/story', properties: { title: 'Story' } },
    });
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'image', attrs: { assetId: asset.id, alt: null } }],
        },
      ],
    };
    await api.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: JSON.stringify(doc) },
      },
    });

    const page = await ctx.cms.api.media.getAssetUsages({
      query: { assetId: asset.id },
    });
    expect(page.items.map((item) => item.rootId)).toEqual([root.rootId]);
    expect(page.items[0].occurrences[0]).toMatchObject({
      propertyKey: 'text',
      path: '/text/content/0/content/0',
      matchedBy: 'schema',
      altState: 'missing',
    });

    const archived = await ctx.cms.api.media.archiveAssets({
      body: { assetIds: [asset.id] },
    });
    expect(archived.skippedReasons).toEqual({ [asset.id]: 'in_use' });
    await ctx.s3.cleanup();
  });
});
