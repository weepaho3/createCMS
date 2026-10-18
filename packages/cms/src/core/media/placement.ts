import { and, eq, inArray, or, type SQL } from 'drizzle-orm';

import type { StorageAdapter, StorageObjectAcl } from '../storage/adapter';
import type { ResolvedScope } from '../types/definitions';
import type { DrizzleInstance } from '../types/drizzle';
import type { MediaConfig } from '../types/s3';

import { assets } from '../db/schema.generated';
import { getStorage } from '../storage/get-storage';
import { buildUploadObjectKey } from '../storage/s3/utils';

export type AssetVisibility = 'public' | 'private';

const IMMUTABLE = 'max-age=31536000, immutable';

const SEGMENT: Record<AssetVisibility, string> = {
  public: 'pub/',
  private: 'prv/',
};

// `t/<tenant>/` (optional), then `pub/` or `prv/` (optional), then the rest.
const KEY_LAYOUT = /^(t\/[^/]+\/)?(pub\/|prv\/)?(.*)$/s;

export function visibilityMode(config: MediaConfig): 'prefix' | 'legacy' {
  return config.visibility ?? 'prefix';
}

/**
 * Fails at construction when `visibility: 'prefix'` is configured on a
 * storage that cannot copy objects, since every status change moves bytes.
 */
export function assertVisibilitySupported(config: MediaConfig): void {
  if (visibilityMode(config) !== 'prefix') return;
  const storage = getStorage(config);
  if (!storage.capabilities.copy || !storage.copy) {
    throw new Error(
      `[cms] media.visibility 'prefix' moves objects between pub/ and prv/ and needs a storage adapter with the copy capability; "${storage.name}" has none. Set media.visibility to 'legacy' or use an adapter that implements copy.`,
    );
  }
}

const warnedAclIgnored = new WeakSet<MediaConfig>();

/**
 * The `x-amz-acl` for uploads: `public-read` only with `acl: 'public-read'`,
 * `visibility: 'legacy'` and an adapter that reports `objectAcl`. With
 * `visibility: 'prefix'` the bucket policy on `pub/*` grants public reads,
 * so no ACL is ever sent.
 */
export function uploadAcl(
  config: MediaConfig,
  storage: StorageAdapter,
): StorageObjectAcl | undefined {
  if (config.acl !== 'public-read') return undefined;
  if (visibilityMode(config) === 'prefix') return undefined;
  if (!storage.capabilities.objectAcl) {
    if (!warnedAclIgnored.has(config)) {
      warnedAclIgnored.add(config);
      console.warn(
        `[cms] media.acl 'public-read' is ignored: storage "${storage.name}" does not report the objectAcl capability.`,
      );
    }
    return undefined;
  }
  return 'public-read';
}

/**
 * `Cache-Control` for an object. Keys are unique per upload, replace and
 * move, so every object is immutable; private objects under
 * `visibility: 'prefix'` must not be stored by shared caches.
 */
export function cacheControlFor(
  config: MediaConfig,
  visibility: AssetVisibility,
): string {
  return visibilityMode(config) === 'prefix' && visibility === 'private'
    ? `private, ${IMMUTABLE}`
    : `public, ${IMMUTABLE}`;
}

/**
 * The object key for a new object of asset `id`:
 * `{storageKeyPrefix}{pub|prv}/<id>/<slug of fileName>` under
 * `visibility: 'prefix'`, `<id>/<slug of fileName>` under `'legacy'`.
 */
export function assetObjectKey(
  config: MediaConfig,
  params: {
    id: string;
    fileName: string;
    visibility: AssetVisibility;
    scope?: Pick<ResolvedScope, 'storageKeyPrefix'>;
  },
): string {
  const base = buildUploadObjectKey(params.id, params.fileName);
  if (visibilityMode(config) === 'legacy') return base;
  return `${params.scope?.storageKeyPrefix ?? ''}${SEGMENT[params.visibility]}${base}`;
}

/**
 * `key` with its visibility segment set to `visibility`. A tenant segment
 * already in the key is kept; a key without one gets `storageKeyPrefix`.
 */
export function keyWithVisibility(
  key: string,
  visibility: AssetVisibility,
  storageKeyPrefix?: string,
): string {
  const [, tenant, , rest] = KEY_LAYOUT.exec(key)!;
  return `${tenant ?? storageKeyPrefix ?? ''}${SEGMENT[visibility]}${rest}`;
}

type Move = { rowId: string; from: string; to: string; mimeType: string };

async function deleteKeys(storage: StorageAdapter, keys: string[]) {
  if (keys.length === 0) return;
  if (storage.capabilities.deleteMany && storage.deleteMany) {
    await storage.deleteMany(keys);
    return;
  }
  for (const key of keys) await storage.delete(key);
}

/**
 * Calls `onPurge` with the asset endpoint paths of `assetIds`, whose cached
 * redirects point at objects that changed. Errors are logged, never thrown.
 */
export async function purgeAssetPaths(
  config: MediaConfig,
  assetIds: string[],
): Promise<void> {
  if (!config.onPurge || assetIds.length === 0) return;
  try {
    await config.onPurge(assetIds.map((id) => `/media/asset/${id}`));
  } catch (err) {
    console.error('[cms] media onPurge failed:', err);
  }
}

/**
 * Sets the status of `assetIds` inside `scope`. Under
 * `visibility: 'prefix'` the objects of each asset and its variants move to
 * the matching `pub/` or `prv/` key first: copy, then the rows' status and
 * keys in one transaction, then the old objects are deleted. An asset whose
 * copy fails keeps its status and keys (its partial copies are removed) and
 * is reported in `failed`. Source deletion and `onPurge` are best effort.
 */
export async function setAssetsVisibility(
  db: DrizzleInstance,
  config: MediaConfig | undefined,
  assetIds: string[],
  visibility: AssetVisibility,
  scope?: Pick<ResolvedScope, 'assets' | 'storageKeyPrefix'>,
): Promise<{ changed: string[]; failed: string[] }> {
  if (assetIds.length === 0) return { changed: [], failed: [] };

  const updateStatus = async (tx: DrizzleInstance, ids: string[]) => {
    if (ids.length === 0) return;
    const conditions: SQL[] = [inArray(assets.id, ids)];
    if (scope?.assets?.where) conditions.push(scope.assets.where);
    await tx
      .update(assets)
      .set({ status: visibility, updatedAt: new Date() })
      .where(and(...conditions));
  };

  const rowConditions: SQL[] = [
    or(inArray(assets.id, assetIds), inArray(assets.variantOf, assetIds))!,
  ];
  if (scope?.assets?.where) rowConditions.push(scope.assets.where);
  const rows = await db
    .select({
      id: assets.id,
      variantOf: assets.variantOf,
      objectKey: assets.objectKey,
      mimeType: assets.mimeType,
      processingState: assets.processingState,
    })
    .from(assets)
    .where(and(...rowConditions));

  // Unscanned or infected bytes are never published: such an asset keeps
  // its status (reported as failed), such a variant stays private.
  const unready = new Set(
    visibility === 'public'
      ? rows.filter((row) => row.processingState !== 'ready').map((r) => r.id)
      : [],
  );
  const blocked = assetIds.filter((id) => unready.has(id));
  const allowed = assetIds.filter((id) => !unready.has(id));

  if (!config || visibilityMode(config) === 'legacy') {
    await updateStatus(db, allowed);
    return { changed: allowed, failed: blocked };
  }

  const requested = new Set(allowed);
  const movesByAsset = new Map<string, Move[]>();
  for (const row of rows) {
    if (unready.has(row.id)) continue;
    const owner =
      row.variantOf && requested.has(row.variantOf) ? row.variantOf : row.id;
    if (!requested.has(owner)) continue;
    const to = keyWithVisibility(
      row.objectKey,
      visibility,
      scope?.storageKeyPrefix,
    );
    if (to === row.objectKey) continue;
    const list = movesByAsset.get(owner) ?? [];
    list.push({
      rowId: row.id,
      from: row.objectKey,
      to,
      mimeType: row.mimeType,
    });
    movesByAsset.set(owner, list);
  }

  const storage = getStorage(config);
  const cacheControl = cacheControlFor(config, visibility);
  const failed: string[] = [];
  const copied: Move[] = [];
  for (const [assetId, moves] of movesByAsset) {
    const done: Move[] = [];
    try {
      for (const move of moves) {
        await storage.copy!(move.from, move.to, {
          contentType: move.mimeType,
          cacheControl,
        });
        done.push(move);
      }
      copied.push(...done);
    } catch (err) {
      console.error(
        `[cms] moving asset ${assetId} to ${SEGMENT[visibility]} failed; its status is unchanged:`,
        err,
      );
      failed.push(assetId);
      await deleteKeys(
        storage,
        done.map((m) => m.to),
      ).catch(() => {});
    }
  }

  failed.push(...blocked);
  const failedSet = new Set(failed);
  const changed = assetIds.filter((id) => !failedSet.has(id));
  await db.transaction(async (tx) => {
    await updateStatus(tx, changed);
    for (const move of copied) {
      await tx
        .update(assets)
        .set({ objectKey: move.to, updatedAt: new Date() })
        .where(eq(assets.id, move.rowId));
    }
  });

  try {
    await deleteKeys(
      storage,
      copied.map((m) => m.from),
    );
  } catch (err) {
    console.error('[cms] deleting moved media objects failed:', err);
  }
  await purgeAssetPaths(
    config,
    changed.filter((id) => movesByAsset.has(id)),
  );

  return { changed, failed };
}
