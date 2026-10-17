import { and, eq, inArray, type SQL, sql } from 'drizzle-orm';

import type { ResolvedScope } from '../types/definitions';
import type { DrizzleInstance } from '../types/drizzle';
import type { MediaConfig } from '../types/s3';

import { loadBlocksAtCommit } from '../blocks/reconstruct-snapshot';
import { assets, branches, publications, roots } from '../db/schema.generated';
import { setAssetsVisibility } from './placement';
import { collectAssetIdsFromProperties } from './usage';

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
 * Asset ids referenced by the root's blocks at `commitId` that exist inside
 * `scope.assets`. Ids outside the scope are ignored (and counted in a
 * development log).
 */
export async function findAssetsInCommit(
  db: DrizzleInstance,
  commitId: string,
  rootId: string,
  scope?: DiscoveryScope,
): Promise<string[]> {
  const { blocks } = await loadBlocksAtCommit(db, commitId, rootId);

  const candidates = new Set<string>();
  for (const block of blocks.values()) {
    if (block.deleted) continue;
    for (const id of collectAssetIdsFromProperties(block.properties)) {
      candidates.add(id);
    }
  }

  if (candidates.size === 0) return [];

  const candidateArray = [...candidates];
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

export async function findAssetsInAllPublications(
  db: DrizzleInstance,
  excludeRootId?: string,
  excludeBranchId?: string,
  scope?: DiscoveryScope,
): Promise<Set<string>> {
  const conditions: SQL[] = [];
  if (excludeRootId && excludeBranchId) {
    conditions.push(
      sql`NOT (${publications.rootId} = ${excludeRootId} AND ${publications.branchId} = ${excludeBranchId})`,
    );
  }

  const rootWhere = scope?.roots?.where;
  if (rootWhere) conditions.push(rootWhere);

  const base = db
    .select({
      rootId: publications.rootId,
      headCommitId: branches.headCommitId,
    })
    .from(publications)
    .innerJoin(branches, eq(branches.id, publications.branchId));
  // `scope.roots.where` references `cms.roots`, so join it only when needed.
  const pubs = await (
    rootWhere ? base.innerJoin(roots, eq(roots.id, publications.rootId)) : base
  ).where(conditions.length > 0 ? and(...conditions) : undefined);

  const results = await Promise.all(
    pubs.map((pub) =>
      findAssetsInCommit(db, pub.headCommitId, pub.rootId, scope),
    ),
  );

  const allAssetIds = new Set<string>();
  for (const assetIds of results) {
    for (const id of assetIds) {
      allAssetIds.add(id);
    }
  }

  return allAssetIds;
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

  const stillPublished = await findAssetsInAllPublications(
    db,
    rootId,
    branchId,
    scope,
  );

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
