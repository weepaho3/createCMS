import { and, inArray, type SQL } from 'drizzle-orm';

import type { ResolvedScope } from '../types/definitions';
import type { DrizzleInstance } from '../types/drizzle';
import type { MediaConfig } from '../types/s3';

import { assets } from '../db/schema.generated';
import { setAssetsVisibility } from './placement';
import { assetsAtCommit, assetsUsedIn } from './usage';

/**
 * The scope publish discovery runs in: the publishing request's scope. Asset
 * ids found in content are matched only against assets inside
 * `scope.assets`, and only publications of roots inside `scope.roots` keep an
 * asset public, so content in one tenant can never change the status of
 * another tenant's asset.
 */
export type DiscoveryScope = Pick<
  ResolvedScope,
  'assets' | 'roots' | 'storageKeyPrefix'
>;

/**
 * Asset ids the usage index holds for the root's blocks at `commitId` that
 * exist inside `scope.assets`. Ids outside the scope are ignored (and
 * counted in a development log).
 */
export async function findAssetsInCommit(
  db: DrizzleInstance,
  commitId: string,
  rootId: string,
  scope?: DiscoveryScope,
): Promise<string[]> {
  const candidateArray = await assetsAtCommit(db, commitId, rootId);
  if (candidateArray.length === 0) return [];

  const conditions: SQL[] = [inArray(assets.id, candidateArray)];
  if (scope?.assets?.where) conditions.push(scope.assets.where);
  const found = await db
    .select({ id: assets.id })
    .from(assets)
    .where(and(...conditions));

  if (scope?.assets?.where && process.env.NODE_ENV !== 'production') {
    const known = await db
      .select({ id: assets.id })
      .from(assets)
      .where(inArray(assets.id, candidateArray));
    const ignored = known.length - found.length;
    if (ignored > 0) {
      console.debug(
        `[cms] asset discovery ignored ${ignored} asset id(s) outside the scope of root ${rootId}`,
      );
    }
  }

  return found.map((row) => row.id);
}

/**
 * Makes the assets referenced at `commitId` public. With `media`, objects
 * move to `pub/` (see `setAssetsVisibility`); returns the ids that changed.
 */
export async function syncAssetsOnPublish(
  db: DrizzleInstance,
  commitId: string,
  rootId: string,
  scope?: DiscoveryScope,
  media?: MediaConfig,
): Promise<string[]> {
  const assetIds = await findAssetsInCommit(db, commitId, rootId, scope);
  const { changed } = await setAssetsVisibility(
    db,
    media,
    assetIds,
    'public',
    scope,
  );
  return changed;
}

export async function syncAssetsOnUnpublish(
  db: DrizzleInstance,
  commitId: string,
  rootId: string,
  branchId: string,
  scope?: DiscoveryScope,
  media?: MediaConfig,
): Promise<string[]> {
  const assetIds = await findAssetsInCommit(db, commitId, rootId, scope);
  if (assetIds.length === 0) return [];

  // Published content elsewhere (any other published branch in scope)
  // keeps an asset public; read from the usage index.
  const stillPublished = await assetsUsedIn(db, {
    assetIds,
    scope: 'published',
    rootsWhere: scope?.roots?.where,
    excludePublication: { rootId, branchId },
  });

  const toPrivatize = assetIds.filter((id) => !stillPublished.has(id));
  const { changed } = await setAssetsVisibility(
    db,
    media,
    toPrivatize,
    'private',
    scope,
  );
  return changed;
}
