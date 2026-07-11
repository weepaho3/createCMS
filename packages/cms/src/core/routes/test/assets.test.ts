import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { assets, contentUsages } from '../../../schema';
import { setupTestCMS } from '../../../test-utils/cms';

async function insertAsset(
  db: Awaited<ReturnType<typeof setupTestCMS>>['db'],
  slug: string,
) {
  const [asset] = await db
    .insert(assets)
    .values({
      slug,
      mimeType: 'image/png',
      size: 100,
      objectKey: slug,
    })
    .returning();
  return asset;
}

describe('asset reference tracking', () => {
  it('records a reference when a block embeds an asset id and exposes it via getAssetUsages', async () => {
    const { cms, db } = await setupTestCMS();

    const asset = await insertAsset(db, 'img.png');

    const root = await cms.api.pages.createRoot({
      body: { slug: '/p', properties: { title: 'Page' } },
    });
    await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: asset.id },
      },
    });

    const refs = await db
      .select()
      .from(contentUsages)
      .where(
        and(
          eq(contentUsages.targetKind, 'asset'),
          eq(contentUsages.targetKey, asset.id),
        ),
      );
    expect(refs.length).toBeGreaterThan(0);
    expect(refs[0].rootId).toBe(root.rootId);

    const usages = await cms.api.media.getAssetUsages({
      query: { assetId: asset.id },
    });
    expect(usages.pageCount).toBeGreaterThan(0);
    expect(usages.pages[0].rootId).toBe(root.rootId);
  });

  it('stops reporting live usage once the block stops referencing the asset', async () => {
    const { cms, db } = await setupTestCMS();

    const asset = await insertAsset(db, 'drop.png');

    const root = await cms.api.pages.createRoot({
      body: { slug: '/p', properties: { title: 'Page' } },
    });
    const block = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: asset.id },
      },
    });

    await cms.api.pages.updateBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        blockId: block.blockId,
        type: 'paragraph',
        properties: { text: 'no asset here' },
      },
    });

    // The edit creates a NEW block version without the asset; the head no longer
    // references it, so live usage is empty. The superseded version's row stays
    // in the append-only index (it is pruned with its version), so a raw count
    // is non-zero — liveness is what the UI/GC consume.
    const usages = await cms.api.media.getAssetUsages({
      query: { assetId: asset.id },
    });
    expect(usages.pageCount).toBe(0);

    const refs = await db
      .select()
      .from(contentUsages)
      .where(
        and(
          eq(contentUsages.targetKind, 'asset'),
          eq(contentUsages.targetKey, asset.id),
        ),
      );
    expect(refs.length).toBeGreaterThan(0);
  });

  it('does not insert references for id-shaped strings that are not real assets', async () => {
    const { cms, db } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/p', properties: { title: 'Page' } },
    });
    await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        // matches the id shape but is not an asset row -> FK-validated out.
        properties: { text: 'ast_zzzzzzzzzzzzzzzzzzzz' },
      },
    });

    const refs = await db
      .select()
      .from(contentUsages)
      .where(eq(contentUsages.targetKind, 'asset'));
    expect(refs).toHaveLength(0);
  });

  it('excludes archived roots from getAssetUsages', async () => {
    const { cms, db } = await setupTestCMS();

    const asset = await insertAsset(db, 'arch.png');

    const root = await cms.api.pages.createRoot({
      body: { slug: '/p', properties: { title: 'Page' } },
    });
    await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: asset.id },
      },
    });

    await cms.api.pages.archiveRoot({ body: { rootId: root.rootId } });

    const usages = await cms.api.media.getAssetUsages({
      query: { assetId: asset.id },
    });
    expect(usages.pageCount).toBe(0);
  });
});
