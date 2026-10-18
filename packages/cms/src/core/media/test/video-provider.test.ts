import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AssetMetadata } from '../../types/asset-metadata';
import type {
  VideoProviderAdapter,
  VideoProviderStatus,
} from '../video-provider';

import { setupTestCMS } from '../../../test-utils/cms';
import { assets } from '../../db/schema.generated';
import { muxVideo, syncVideoStreams } from '../video-provider';

describe('muxVideo', () => {
  it('ingests with a public playback policy and maps the status', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      if (init.method === 'POST') {
        return Response.json({
          data: {
            id: 'mux_asset',
            status: 'preparing',
            playback_ids: [{ id: 'play1', policy: 'public' }],
          },
        });
      }
      if (init.method === 'DELETE') return new Response(null, { status: 404 });
      return Response.json({
        data: {
          id: 'mux_asset',
          status: 'ready',
          duration: 95.5,
          playback_ids: [{ id: 'play1', policy: 'public' }],
        },
      });
    });
    const mux = muxVideo({
      tokenId: 'id',
      tokenSecret: 'secret',
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(
      await mux.ingest({
        assetId: 'ast_1',
        sourceUrl: 'https://cdn.example.com/pub/ast_1/talk.mp4',
        mimeType: 'video/mp4',
      }),
    ).toEqual({ providerAssetId: 'mux_asset', playbackId: 'play1' });
    expect(calls[0].url).toBe('https://api.mux.com/video/v1/assets');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      input: [{ url: 'https://cdn.example.com/pub/ast_1/talk.mp4' }],
      playback_policy: ['public'],
    });
    expect(
      (calls[0].init.headers as Record<string, string>).authorization,
    ).toBe(`Basic ${Buffer.from('id:secret').toString('base64')}`);

    expect(await mux.status('mux_asset')).toEqual({
      state: 'ready',
      playbackId: 'play1',
      durationMs: 95_500,
    });
    expect(mux.playbackUrl('play1')).toBe('https://stream.mux.com/play1.m3u8');
    await expect(mux.delete('gone')).resolves.toBeUndefined();
  });
});

describe('syncVideoStreams', () => {
  let cleanup: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await cleanup?.();
    cleanup = undefined;
  });

  function mockProvider() {
    const states = new Map<string, VideoProviderStatus>();
    let next = 0;
    const provider: VideoProviderAdapter & { deleted: string[] } = {
      id: 'mock',
      deleted: [],
      ingest: vi.fn(async () => {
        const id = `pv_${++next}`;
        states.set(id, { state: 'processing', playbackId: `play_${next}` });
        return { providerAssetId: id, playbackId: `play_${next}` };
      }),
      status: async (id) => states.get(id)!,
      playbackUrl: (playbackId) =>
        `https://stream.example.com/${playbackId}.m3u8`,
      posterUrl: (playbackId) => `https://image.example.com/${playbackId}.jpg`,
      async delete(id) {
        provider.deleted.push(id);
      },
    };
    return { provider, states };
  }

  async function setup() {
    const { provider, states } = mockProvider();
    const ctx = await setupTestCMS({
      withS3: true,
      media: { video: { provider, minDurationMs: 60_000, minBytes: 1000 } },
    });
    cleanup = ctx.s3.cleanup;
    const mp4 = (size: number) => {
      const bytes = new Uint8Array(size);
      bytes.set([
        0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
      ]);
      return bytes;
    };
    const upload = async (name: string, size: number) => {
      const body = mp4(size);
      const { assets: created } = await ctx.cms.api.media.uploadAssets({
        body: {
          files: [
            {
              name,
              size: body.length,
              type: 'video/mp4',
              buffer: new Blob([body as BlobPart]),
            },
          ],
        },
      });
      const id = created[0].id;
      await ctx.cms.api.media.updateAssetsStatus({
        body: { assetIds: [id], status: 'public' },
      });
      return id;
    };
    const metadataOf = async (id: string) =>
      (
        await ctx.db
          .select({ metadata: assets.metadata })
          .from(assets)
          .where(eq(assets.id, id))
      )[0].metadata as AssetMetadata;
    const setDuration = (id: string, durationMs: number) =>
      ctx.db
        .update(assets)
        .set({ metadata: { media: { durationMs } } })
        .where(eq(assets.id, id));
    const sync = () =>
      syncVideoStreams(ctx.db, ctx.s3.config, {
        limit: 10,
        deadline: Date.now() + 60_000,
      });
    return { ...ctx, provider, states, upload, metadataOf, setDuration, sync };
  }

  it('hands long public videos to the provider and stores the stream once ready', async () => {
    const { provider, states, upload, metadataOf, setDuration, sync } =
      await setup();
    const long = await upload('talk.mp4', 64);
    await setDuration(long, 95_000);
    const short = await upload('clip.mp4', 64);
    await setDuration(short, 8_000);
    const unknownLarge = await upload('raw.mp4', 2000);

    const first = await sync();
    expect(first.ingested.sort()).toEqual([long, unknownLarge].sort());
    expect(provider.ingest).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: long,
        sourceUrl: expect.stringContaining('talk.mp4'),
      }),
    );
    expect((await metadataOf(long)).stream).toMatchObject({
      provider: 'mock',
      state: 'processing',
      playbackUrl: null,
    });
    expect((await metadataOf(short)).stream).toBeUndefined();

    const { providerAssetId } = (await metadataOf(long)).stream!;
    states.set(providerAssetId, {
      state: 'ready',
      playbackId: 'play_1',
      durationMs: 95_250,
    });
    const second = await sync();
    expect(second.ready).toEqual([long]);
    const ready = await metadataOf(long);
    expect(ready.stream).toMatchObject({
      state: 'ready',
      playbackUrl: 'https://stream.example.com/play_1.m3u8',
      posterUrl: 'https://image.example.com/play_1.jpg',
    });
    expect(ready.media?.durationMs).toBe(95_250);

    const third = await sync();
    expect(third.ingested).toEqual([]);
    expect(third.ready).toEqual([]);
  });

  it('skips private videos, re-ingests replaced bytes and deletes on purge', async () => {
    const { cms, db, provider, upload, metadataOf, setDuration, sync } =
      await setup();
    const hidden = await upload('internal.mp4', 64);
    await setDuration(hidden, 120_000);
    await cms.api.media.updateAssetsStatus({
      body: { assetIds: [hidden], status: 'private' },
    });
    expect((await sync()).ingested).toEqual([]);

    const video = await upload('keynote.mp4', 64);
    await setDuration(video, 120_000);
    await sync();
    const before = (await metadataOf(video)).stream!;
    await db
      .update(assets)
      .set({ objectKey: `${before.sourceKey}-new` })
      .where(eq(assets.id, video));
    expect((await sync()).ingested).toEqual([video]);
    expect(provider.deleted).toEqual([before.providerAssetId]);
    const after = (await metadataOf(video)).stream!;

    await db
      .update(assets)
      .set({ objectKey: before.sourceKey })
      .where(eq(assets.id, video));
    await cms.api.media.purgeAssets({
      body: { assetIds: [video], reason: 'test' },
    });
    expect(provider.deleted).toContain(after.providerAssetId);
  });

  it('keeps clients from writing metadata.stream', async () => {
    const { cms, db, upload } = await setup();
    const id = await upload('clip.mp4', 64);
    const [asset] = await db
      .select({ updatedAt: assets.updatedAt })
      .from(assets)
      .where(eq(assets.id, id));
    await expect(
      cms.api.media.updateAsset({
        body: {
          assetId: id,
          expectedUpdatedAt: asset.updatedAt.toISOString(),
          patch: {
            metadata: {
              stream: {
                provider: 'mock',
                providerAssetId: 'x',
                playbackId: 'x',
                state: 'ready',
                playbackUrl: 'https://evil.example/x.m3u8',
                posterUrl: null,
                sourceKey: 'x',
              },
            },
          },
        },
      }),
    ).rejects.toMatchObject({ body: { code: 'VALIDATION_ERROR' } });
  });
});
