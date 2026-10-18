import { and, asc, eq, isNull, like, sql } from 'drizzle-orm';

import type { AssetMetadata } from '../types/asset-metadata';
import type { DrizzleInstance } from '../types/drizzle';
import type { MediaConfig } from '../types/s3';

import { assets } from '../db/schema.generated';
import { buildPublicObjectUrl } from '../storage/s3/utils';

export type VideoStream = NonNullable<AssetMetadata['stream']>;

/** A provider's view of one ingested video. */
export type VideoProviderStatus = {
  state: 'processing' | 'ready' | 'errored';
  playbackId: string | null;
  durationMs?: number;
};

/**
 * A video service (adaptive streaming, posters) that long videos are handed
 * to. The CMS keeps only the provider's ids and URLs in
 * `metadata.stream`; the original stays in the bucket.
 */
export type VideoProviderAdapter = {
  id: string;
  /** Starts copying the video at `sourceUrl` (public). */
  ingest(source: {
    assetId: string;
    sourceUrl: string;
    mimeType: string;
  }): Promise<{ providerAssetId: string; playbackId: string | null }>;
  status(providerAssetId: string): Promise<VideoProviderStatus>;
  /** HLS URL of a playback id. */
  playbackUrl(playbackId: string): string;
  posterUrl(playbackId: string): string | null;
  /** Deletes the provider's copy; an unknown id is not an error. */
  delete(providerAssetId: string): Promise<void>;
};

export type VideoConfig = {
  provider: VideoProviderAdapter;
  /** Videos at least this long (from `metadata.media.durationMs`) go to the provider. @default 60000 */
  minDurationMs?: number;
  /** Videos at least this large go to the provider when their duration is unknown. @default 52428800 (50 MiB) */
  minBytes?: number;
};

export const VIDEO_MIN_DURATION_MS = 60_000;
export const VIDEO_MIN_BYTES = 50 * 1024 * 1024;

/** Whether a video asset should be streamed by the provider. */
export function needsVideoProvider(
  video: VideoConfig,
  asset: { size: number; metadata: AssetMetadata },
): boolean {
  const duration = asset.metadata.media?.durationMs;
  if (duration !== undefined) {
    return duration >= (video.minDurationMs ?? VIDEO_MIN_DURATION_MS);
  }
  return asset.size >= (video.minBytes ?? VIDEO_MIN_BYTES);
}

export type MuxVideoOptions = {
  /** Mux access token id and secret (Video permission). */
  tokenId: string;
  tokenSecret: string;
  /** @default 'https://api.mux.com' */
  apiUrl?: string;
  fetch?: typeof fetch;
};

/**
 * A `VideoProviderAdapter` for Mux Video with public playback ids:
 * playback at `https://stream.mux.com/<id>.m3u8`, posters from
 * `image.mux.com`.
 */
export function muxVideo(options: MuxVideoOptions): VideoProviderAdapter {
  const apiUrl = (options.apiUrl ?? 'https://api.mux.com').replace(/\/+$/, '');
  const doFetch = options.fetch ?? ((input, init) => fetch(input, init));
  const auth = `Basic ${Buffer.from(`${options.tokenId}:${options.tokenSecret}`).toString('base64')}`;
  const call = (path: string, init: { method?: string; body?: string } = {}) =>
    doFetch(`${apiUrl}${path}`, {
      ...init,
      headers: { authorization: auth, 'content-type': 'application/json' },
    });
  type MuxAsset = {
    id: string;
    status: 'preparing' | 'ready' | 'errored';
    duration?: number;
    playback_ids?: { id: string; policy: string }[];
  };
  const playbackOf = (asset: MuxAsset) =>
    asset.playback_ids?.find((p) => p.policy === 'public')?.id ?? null;
  return {
    id: 'mux',
    async ingest({ sourceUrl }) {
      const res = await call('/video/v1/assets', {
        method: 'POST',
        body: JSON.stringify({
          input: [{ url: sourceUrl }],
          playback_policy: ['public'],
        }),
      });
      if (!res.ok) throw new Error(`Mux ingest answered ${res.status}`);
      const { data } = (await res.json()) as { data: MuxAsset };
      return { providerAssetId: data.id, playbackId: playbackOf(data) };
    },
    async status(providerAssetId) {
      const res = await call(
        `/video/v1/assets/${encodeURIComponent(providerAssetId)}`,
      );
      if (res.status === 404) return { state: 'errored', playbackId: null };
      if (!res.ok) throw new Error(`Mux status answered ${res.status}`);
      const { data } = (await res.json()) as { data: MuxAsset };
      const status: VideoProviderStatus = {
        state: data.status === 'preparing' ? 'processing' : data.status,
        playbackId: playbackOf(data),
      };
      if (data.duration !== undefined) {
        status.durationMs = Math.round(data.duration * 1000);
      }
      return status;
    },
    playbackUrl: (playbackId) => `https://stream.mux.com/${playbackId}.m3u8`,
    posterUrl: (playbackId) =>
      `https://image.mux.com/${playbackId}/thumbnail.jpg`,
    async delete(providerAssetId) {
      const res = await call(
        `/video/v1/assets/${encodeURIComponent(providerAssetId)}`,
        { method: 'DELETE' },
      );
      if (!res.ok && res.status !== 404) {
        throw new Error(`Mux delete answered ${res.status}`);
      }
    },
  };
}

/** Deletes the provider copies of these assets; errors are logged. */
export async function deleteVideoStreams(
  config: MediaConfig,
  metadata: readonly (AssetMetadata | Record<string, unknown> | null)[],
): Promise<void> {
  const provider = config.video?.provider;
  if (!provider) return;
  for (const entry of metadata) {
    const stream = (entry as AssetMetadata | null)?.stream;
    if (!stream || stream.provider !== provider.id) continue;
    try {
      await provider.delete(stream.providerAssetId);
    } catch (err) {
      console.error(
        `[cms] deleting video ${stream.providerAssetId} failed:`,
        err,
      );
    }
  }
}

/**
 * The video step of the pruning pass: hands public, ready videos above the
 * thresholds (`needsVideoProvider`) to the provider, re-ingests a video
 * whose bytes were replaced, and polls videos the provider is still
 * processing. Only public originals are ingested, since the provider plays
 * them back without the CMS's access checks.
 */
export async function syncVideoStreams(
  db: DrizzleInstance,
  config: MediaConfig,
  opts: { limit: number; deadline: number; dryRun?: boolean },
): Promise<{ ingested: string[]; ready: string[]; more: boolean }> {
  const result = {
    ingested: [] as string[],
    ready: [] as string[],
    more: false,
  };
  const video = config.video;
  if (!video || opts.dryRun) return result;
  const provider = video.provider;
  const minDuration = video.minDurationMs ?? VIDEO_MIN_DURATION_MS;
  const minBytes = video.minBytes ?? VIDEO_MIN_BYTES;

  const rows = await db
    .select({
      id: assets.id,
      objectKey: assets.objectKey,
      mimeType: assets.mimeType,
      size: assets.size,
      metadata: assets.metadata,
    })
    .from(assets)
    .where(
      and(
        like(assets.mimeType, 'video/%'),
        eq(assets.status, 'public'),
        eq(assets.processingState, 'ready'),
        isNull(assets.archivedAt),
        isNull(assets.variantOf),
        isNull(assets.revisionOf),
        // Above the thresholds and not ingested, still processing, or
        // ingested from bytes that were replaced since.
        sql`(${assets.metadata}->'stream'->>'state' = 'processing'
          or ((${assets.metadata}->'stream' is null
              or ${assets.metadata}->'stream'->>'sourceKey' <> ${assets.objectKey})
            and (((${assets.metadata}->'media'->>'durationMs')::bigint >= ${minDuration})
              or (${assets.metadata}->'media'->'durationMs' is null
                and ${assets.size} >= ${minBytes}))))`,
      ),
    )
    .orderBy(asc(assets.updatedAt))
    .limit(opts.limit + 1);
  result.more = rows.length > opts.limit;

  const save = (id: string, metadata: AssetMetadata) =>
    db
      .update(assets)
      .set({ metadata: metadata as Record<string, unknown> })
      .where(eq(assets.id, id));

  for (const row of rows.slice(0, opts.limit)) {
    if (Date.now() >= opts.deadline) return { ...result, more: true };
    const metadata = row.metadata as AssetMetadata;
    const stream = metadata.stream;
    try {
      if (stream && stream.sourceKey === row.objectKey) {
        if (stream.state !== 'processing') continue;
        const status = await provider.status(stream.providerAssetId);
        if (status.state === 'processing') continue;
        const playbackId = status.playbackId ?? stream.playbackId;
        const next: AssetMetadata = {
          ...metadata,
          stream: {
            ...stream,
            state: playbackId ? status.state : 'errored',
            playbackId,
            playbackUrl:
              status.state === 'ready' && playbackId
                ? provider.playbackUrl(playbackId)
                : null,
            posterUrl:
              status.state === 'ready' && playbackId
                ? provider.posterUrl(playbackId)
                : null,
          },
        };
        if (status.durationMs !== undefined) {
          next.media = { ...metadata.media, durationMs: status.durationMs };
        }
        await save(row.id, next);
        if (next.stream!.state === 'ready') result.ready.push(row.id);
        continue;
      }
      if (!needsVideoProvider(video, { size: row.size, metadata })) continue;
      if (stream) await deleteVideoStreams(config, [metadata]);
      const ingested = await provider.ingest({
        assetId: row.id,
        sourceUrl: buildPublicObjectUrl(config.publicUrl, row.objectKey),
        mimeType: row.mimeType,
      });
      await save(row.id, {
        ...metadata,
        stream: {
          provider: provider.id,
          providerAssetId: ingested.providerAssetId,
          playbackId: ingested.playbackId,
          state: 'processing',
          playbackUrl: null,
          posterUrl: null,
          sourceKey: row.objectKey,
        },
      });
      result.ingested.push(row.id);
    } catch (err) {
      // The next pass tries again.
      console.error(`[cms] video provider sync of ${row.id} failed:`, err);
    }
  }
  return result;
}
