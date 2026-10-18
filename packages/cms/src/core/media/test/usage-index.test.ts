import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { assets, contentUsages } from '../../../schema';
import { setupTestCMS } from '../../../test-utils/cms';

type Ctx = Awaited<ReturnType<typeof setupTestCMS>>;

async function insertAsset(db: Ctx['db'], slug: string) {
  const [row] = await db
    .insert(assets)
    .values({ slug, mimeType: 'image/png', size: 1, objectKey: `${slug}-key` })
    .returning();
  return row;
}

async function assetRows(db: Ctx['db'], assetId: string) {
  return db
    .select({
      propertyKey: contentUsages.propertyKey,
      path: contentUsages.path,
      matchedBy: contentUsages.matchedBy,
      altState: contentUsages.altState,
    })
    .from(contentUsages)
    .where(
      and(
        eq(contentUsages.targetKind, 'asset'),
        eq(contentUsages.targetKey, assetId),
      ),
    );
}

async function pageWith(ctx: Ctx, assetId: string) {
  const root = await ctx.cms.api.pages.createRoot({
    body: { slug: `/p-${assetId.slice(-6)}`, properties: { title: 'Page' } },
  });
  await ctx.cms.api.pages.createBlock({
    body: {
      rootId: root.rootId,
      branchId: root.branchId,
      parentBlockId: root.rootId,
      type: 'image',
      properties: { src: { assetId, alt: 'Team' } },
    },
  });
  await ctx.cms.api.pages.createBlock({
    body: {
      rootId: root.rootId,
      branchId: root.branchId,
      parentBlockId: root.rootId,
      type: 'hero',
      properties: { title: 'Hero', backgroundImage: assetId },
    },
  });
  await ctx.cms.api.pages.createBlock({
    body: {
      rootId: root.rootId,
      branchId: root.branchId,
      parentBlockId: root.rootId,
      type: 'paragraph',
      properties: { text: `<img src="/api/cms/media/asset/${assetId}?w=320">` },
    },
  });
  return root;
}

describe('usage index', () => {
  it('indexes every usage with its path, match and alt state', async () => {
    const ctx = await setupTestCMS();
    const asset = await insertAsset(ctx.db, 'team.png');
    await pageWith(ctx, asset.id);

    const rows = await assetRows(ctx.db, asset.id);
    expect(rows).toEqual(
      expect.arrayContaining([
        {
          propertyKey: 'src',
          path: '/src',
          matchedBy: 'schema',
          altState: 'present',
        },
        {
          propertyKey: 'backgroundImage',
          path: '/backgroundImage',
          matchedBy: 'schema',
          altState: 'missing',
        },
        {
          propertyKey: 'text',
          path: '/text',
          matchedBy: 'url',
          altState: null,
        },
      ]),
    );
  });

  it('re-indexes existing versions with the backfill, idempotently', async () => {
    const ctx = await setupTestCMS();
    const asset = await insertAsset(ctx.db, 'old.png');
    await pageWith(ctx, asset.id);
    const indexed = await assetRows(ctx.db, asset.id);

    // Rows as the former indexer wrote them: no path, no alt state.
    await ctx.db
      .delete(contentUsages)
      .where(eq(contentUsages.targetKey, asset.id));
    const dry = await ctx.cms.api.admin.runUsageBackfill({
      body: { dryRun: true },
    });
    expect(dry).toMatchObject({ dryRun: true, done: true, rowsBefore: 0 });
    expect(dry.rowsAfter).toBe(indexed.length);
    expect(await assetRows(ctx.db, asset.id)).toEqual([]);

    const report = await ctx.cms.api.admin.runUsageBackfill({
      body: { limit: 2 },
    });
    expect(report.done).toBe(false);
    let cursor = report.cursor;
    while (cursor) {
      ({ cursor } = await ctx.cms.api.admin.runUsageBackfill({
        body: { cursor, limit: 2 },
      }));
    }
    expect(await assetRows(ctx.db, asset.id)).toEqual(
      expect.arrayContaining(indexed),
    );

    const again = await ctx.cms.api.admin.runUsageBackfill({ body: {} });
    expect(again.rowsAfter).toBe(again.rowsBefore);
  });
});
