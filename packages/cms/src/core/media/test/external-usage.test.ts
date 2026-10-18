import { afterEach, describe, expect, it } from 'vitest';

import type { ExternalUsage, ExternalUsageRegistry } from '../../types/s3';

import { setupTestCMS } from '../../../test-utils/cms';

/** A registry kept in memory, as a host would keep it in its own table. */
function memoryRegistry(): ExternalUsageRegistry & {
  entries: ExternalUsage[];
} {
  const entries: ExternalUsage[] = [];
  return {
    entries,
    async register(usage) {
      const exists = entries.some(
        (e) =>
          e.assetId === usage.assetId &&
          e.consumer === usage.consumer &&
          e.url === usage.url,
      );
      if (!exists) entries.push({ ...usage, registeredAt: new Date() });
    },
    async remove(usage) {
      const before = entries.length;
      const kept = entries.filter(
        (e) =>
          !(
            e.assetId === usage.assetId &&
            e.consumer === usage.consumer &&
            (usage.url === undefined || e.url === usage.url)
          ),
      );
      entries.splice(0, entries.length, ...kept);
      return before - kept.length;
    },
    async list(assetIds) {
      return entries.filter((e) => assetIds.includes(e.assetId));
    },
  };
}

describe('external usages', () => {
  let cleanup: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await cleanup?.();
    cleanup = undefined;
  });

  async function setup(withRegistry = true) {
    const registry = memoryRegistry();
    const ctx = await setupTestCMS({
      withS3: true,
      media: {
        externalUsage: withRegistry ? registry : undefined,
        usageSources: [
          {
            kind: 'seo-settings',
            assetsInUse: async (ids) => ids.filter((id) => id === seoAsset),
          },
        ],
      },
    });
    cleanup = ctx.s3.cleanup;
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    const upload = async (name: string) =>
      (
        await ctx.cms.api.media.uploadAssets({
          body: {
            files: [
              {
                name,
                size: png.length,
                type: 'image/png',
                buffer: new Blob([png]),
              },
            ],
          },
        })
      ).assets[0].id;
    const asset = await upload('hero.png');
    seoAsset = await upload('og.png');
    return { ...ctx, registry, asset, seoAsset };
  }
  let seoAsset = '';

  it('registers, lists in the external group and removes usages', async () => {
    const { cms, registry, asset } = await setup();
    for (const url of [
      'https://news.example.com/october',
      'https://news.example.com/october',
      'https://news.example.com/november',
    ]) {
      await cms.api.media.registerExternalUsage({
        body: { assetId: asset, consumer: 'newsletter', url },
      });
    }
    expect(registry.entries).toHaveLength(2);

    const page = await cms.api.media.getAssetUsages({
      query: { assetId: asset },
    });
    expect(page.total.roots).toBe(0);
    expect(page.external).toEqual([
      {
        consumer: 'newsletter',
        url: 'https://news.example.com/october',
        registeredAt: expect.any(String),
        blocking: false,
      },
      expect.objectContaining({ url: 'https://news.example.com/november' }),
    ]);

    const one = await cms.api.media.removeExternalUsage({
      body: {
        assetId: asset,
        consumer: 'newsletter',
        url: 'https://news.example.com/october',
      },
    });
    expect(one.removed).toBe(1);
    const all = await cms.api.media.removeExternalUsage({
      body: { assetId: asset, consumer: 'newsletter' },
    });
    expect(all.removed).toBe(1);
    expect(registry.entries).toEqual([]);
  });

  it('lists usage sources as blocking entries without a url', async () => {
    const { cms, seoAsset: og } = await setup();
    const page = await cms.api.media.getAssetUsages({ query: { assetId: og } });
    expect(page.external).toEqual([
      {
        consumer: 'seo-settings',
        url: null,
        registeredAt: null,
        blocking: true,
      },
    ]);
  });

  it('archives an externally used asset and only warns', async () => {
    const { cms, asset, seoAsset: og } = await setup();
    await cms.api.media.registerExternalUsage({
      body: {
        assetId: asset,
        consumer: 'partner-site',
        url: 'https://partner.example.org/press',
      },
    });
    const result = await cms.api.media.archiveAssets({
      body: { assetIds: [asset, og] },
    });
    expect(result.archivedIds).toEqual([asset]);
    expect(result.externalUsages).toEqual({ [asset]: 1 });
    expect(result.skippedReasons).toEqual({ [og]: 'external' });
  });

  it('refuses unsafe urls, foreign assets and a missing registry', async () => {
    const { cms, asset } = await setup();
    for (const url of ['javascript:alert(1)', 'https://user:pw@example.com/']) {
      await expect(
        cms.api.media.registerExternalUsage({
          body: { assetId: asset, consumer: 'x', url },
        }),
      ).rejects.toMatchObject({ body: { code: 'VALIDATION_ERROR' } });
    }
    await expect(
      cms.api.media.registerExternalUsage({
        body: {
          assetId: 'ast_00000000000000000000',
          consumer: 'x',
          url: 'https://example.com/',
        },
      }),
    ).rejects.toMatchObject({ body: { code: 'ASSET_NOT_FOUND' } });

    await cleanup?.();
    const bare = await setup(false);
    await expect(
      bare.cms.api.media.registerExternalUsage({
        body: {
          assetId: bare.asset,
          consumer: 'x',
          url: 'https://example.com/',
        },
      }),
    ).rejects.toMatchObject({
      body: { code: 'EXTERNAL_USAGE_NOT_CONFIGURED' },
    });
  });
});
