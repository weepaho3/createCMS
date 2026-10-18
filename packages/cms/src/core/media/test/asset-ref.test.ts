import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { assets } from '../../../schema';
import { setupTestCMS } from '../../../test-utils/cms';
import { buildPropertiesSchema } from '../../schema-builders';
import { assetIdOf, imageAlt, normalizeAssetRef } from '../asset-ref';

async function setup() {
  const ctx = await setupTestCMS();
  const [asset] = await ctx.db
    .insert(assets)
    .values({
      slug: 'team.png',
      mimeType: 'image/png',
      size: 1,
      objectKey: 'team.png',
    })
    .returning();
  const root = await ctx.cms.api.pages.createRoot({
    body: { slug: '/team', properties: { title: 'Team' } },
  });
  const createImage = (src: unknown) =>
    ctx.cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'image',
        properties: { src: src as string, alt: 'block alt' },
      },
    });
  return { ...ctx, asset, root, createImage };
}

describe('image values', () => {
  it('stores an AssetRef and indexes its asset', async () => {
    const { cms, asset, createImage } = await setup();
    const ref = { assetId: asset.id, alt: 'Team beim Workshop' };
    await createImage(ref);
    const usage = await cms.api.media.getAssetUsages({
      query: { assetId: asset.id },
    });
    expect(usage.total.roots).toBe(1);
  });

  it('keeps accepting a bare id', async () => {
    const { asset, createImage } = await setup();
    await expect(createImage(asset.id)).resolves.toBeDefined();
  });

  it('rejects fractions outside 0..1 and crops beyond the image', async () => {
    const { asset, createImage } = await setup();
    await expect(
      createImage({ assetId: asset.id, focal: { x: 1.5, y: 0 } }),
    ).rejects.toThrow();
    await expect(
      createImage({
        assetId: asset.id,
        crop: { x: 0.5, y: 0, width: 0.6, height: 1 },
      }),
    ).rejects.toThrow(/inside the image/);
  });

  it('rejects an unknown asset id inside an AssetRef', async () => {
    const { createImage } = await setup();
    await expect(
      createImage({ assetId: 'ast_00000000000000000000' }),
    ).rejects.toThrow(/does not exist/);
  });

  it('rejects a revisionId that belongs to another asset', async () => {
    const { db, asset, createImage } = await setup();
    const [other] = await db
      .insert(assets)
      .values({
        slug: 'o.png',
        mimeType: 'image/png',
        size: 1,
        objectKey: 'o.png',
      })
      .returning();
    const [revision] = await db
      .insert(assets)
      .values({
        slug: 'o-old.png',
        mimeType: 'image/png',
        size: 1,
        objectKey: 'o-old.png',
        revisionOf: other.id,
        archivedAt: new Date(),
      })
      .returning();
    await expect(
      createImage({ assetId: asset.id, revisionId: revision.id }),
    ).rejects.toThrow(/is not a revision of asset/);
    await expect(
      createImage({ assetId: other.id, revisionId: revision.id }),
    ).resolves.toBeDefined();
    const [row] = await db
      .select()
      .from(assets)
      .where(eq(assets.id, revision.id));
    expect(row.revisionOf).toBe(other.id);
  });
});

describe('requireAlt', () => {
  const schema = buildPropertiesSchema({
    img: { type: 'image', label: 'Image', required: true, requireAlt: true },
  });

  it('accepts alt text or decorative', () => {
    expect(
      schema.safeParse({ img: { assetId: 'ast_1', alt: 'x' } }).success,
    ).toBe(true);
    expect(
      schema.safeParse({ img: { assetId: 'ast_1', decorative: true } }).success,
    ).toBe(true);
  });

  it('rejects a bare id, an empty alt and a missing alt', () => {
    expect(schema.safeParse({ img: 'ast_1' }).success).toBe(false);
    expect(
      schema.safeParse({ img: { assetId: 'ast_1', alt: ' ' } }).success,
    ).toBe(false);
    expect(schema.safeParse({ img: { assetId: 'ast_1' } }).success).toBe(false);
  });
});

describe('helpers', () => {
  it('normalizes and reads ids', () => {
    expect(normalizeAssetRef('ast_1')).toEqual({ assetId: 'ast_1' });
    expect(assetIdOf({ assetId: 'ast_2', alt: 'a' })).toBe('ast_2');
  });

  it('renders alt="" for decorative images and never a file name', () => {
    expect(imageAlt({ decorative: true, alt: 'ignored' })).toBe('');
    expect(imageAlt({ alt: 'Team' })).toBe('Team');
    expect(imageAlt({})).toBeUndefined();
    expect(imageAlt({ alt: '' })).toBeUndefined();
  });
});

describe('rich text attrs', () => {
  it('requires an asset id and rejects a src', async () => {
    const { richTextImageAttrsSchema } = await import('../asset-ref');
    expect(
      richTextImageAttrsSchema.safeParse({
        assetId: 'ast_abcdefghij0123456789',
        alt: 'x',
      }).success,
    ).toBe(true);
    expect(richTextImageAttrsSchema.safeParse({ alt: 'x' }).success).toBe(
      false,
    );
    expect(
      richTextImageAttrsSchema.safeParse({
        assetId: 'ast_abcdefghij0123456789',
        src: 'https://cdn/x.png',
      }).success,
    ).toBe(false);
  });

  it('accepts internal and external links only', async () => {
    const { richTextLinkAttrsSchema } = await import('../asset-ref');
    expect(richTextLinkAttrsSchema.safeParse({ rootId: 'rot_1' }).success).toBe(
      true,
    );
    expect(
      richTextLinkAttrsSchema.safeParse({ href: 'https://x.test' }).success,
    ).toBe(true);
    expect(
      richTextLinkAttrsSchema.safeParse({ target: '_blank' }).success,
    ).toBe(false);
  });
});
