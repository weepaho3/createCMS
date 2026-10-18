import { asc, eq } from 'drizzle-orm';

import type { DrizzleInstance } from '../types/drizzle';
import type { MediaConfig } from '../types/s3';

import { assets } from '../db/schema.generated';
import { getStorage } from '../storage/get-storage';
import { purgeAssetPaths, setAssetsVisibility } from './placement';

export type ProcessingState = 'pending' | 'ready' | 'failed';

/** The state new bytes start in: `pending` while a scanner is configured. */
export function initialProcessingState(
  config: MediaConfig | undefined,
): ProcessingState {
  return config?.scan ? 'pending' : 'ready';
}

/**
 * The visibility new bytes are stored under: always private while a scanner
 * is configured, so unscanned bytes are never public in the bucket.
 */
export function uploadVisibility(
  config: MediaConfig | undefined,
  status: 'public' | 'private',
): 'public' | 'private' {
  return config?.scan ? 'private' : status;
}

export type ScanPassResult = {
  /** Assets the scanner cleared (now `ready`). */
  ready: string[];
  /** Assets with malware: object deleted, state `failed`. */
  failed: string[];
  /** Assets whose scan threw; they stay `pending`. */
  errored: string[];
};

/**
 * Scans up to `limit` pending assets, oldest first. Idempotent per asset: a
 * row leaves `pending` only after its verdict is stored. A cleared asset
 * whose status is public (or whose original is) is moved to the public
 * prefix and its gate path purged. Without a scanner nothing happens.
 */
export async function scanPendingAssets(
  db: DrizzleInstance,
  config: MediaConfig,
  opts: { limit: number; deadline: number; dryRun?: boolean },
): Promise<ScanPassResult & { more: boolean }> {
  const result: ScanPassResult & { more: boolean } = {
    ready: [],
    failed: [],
    errored: [],
    more: false,
  };
  const scanner = config.scan;
  if (!scanner) return result;

  const pending = await db
    .select({
      id: assets.id,
      objectKey: assets.objectKey,
      mimeType: assets.mimeType,
      size: assets.size,
      status: assets.status,
      variantOf: assets.variantOf,
    })
    .from(assets)
    .where(eq(assets.processingState, 'pending'))
    .orderBy(asc(assets.createdAt))
    .limit(opts.limit);
  result.more = pending.length === opts.limit;

  const storage = getStorage(config);
  for (const row of pending) {
    if (Date.now() >= opts.deadline) {
      result.more = true;
      break;
    }
    let verdict;
    try {
      verdict = await scanner.scan({
        assetId: row.id,
        objectKey: row.objectKey,
        mimeType: row.mimeType,
        size: row.size,
        storage,
      });
    } catch (err) {
      console.error(`[cms:media] scan of ${row.id} failed`, err);
      result.errored.push(row.id);
      continue;
    }
    if (opts.dryRun) {
      (verdict === 'infected' ? result.failed : result.ready).push(row.id);
      continue;
    }
    if (verdict === 'infected') {
      try {
        await storage.delete(row.objectKey);
      } catch (err) {
        console.error(`[cms:media] could not delete infected ${row.id}`, err);
      }
      await db
        .update(assets)
        .set({ processingState: 'failed', updatedAt: new Date() })
        .where(eq(assets.id, row.id));
      result.failed.push(row.id);
      continue;
    }
    await db
      .update(assets)
      .set({ processingState: 'ready', updatedAt: new Date() })
      .where(eq(assets.id, row.id));
    result.ready.push(row.id);

    const owner = row.variantOf ?? row.id;
    const [ownerRow] = row.variantOf
      ? await db
          .select({ status: assets.status })
          .from(assets)
          .where(eq(assets.id, owner))
      : [{ status: row.status }];
    if (ownerRow?.status === 'public') {
      await setAssetsVisibility(db, config, [owner], 'public');
    }
    await purgeAssetPaths(config, [owner]);
  }
  return result;
}
