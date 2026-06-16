import { and, eq, inArray, sql } from 'drizzle-orm';

import type { DrizzleInstance } from '../types/drizzle';

import { collectAssetIdsFromProperties } from '../assets';
import { loadBlocksAtCommit } from '../blocks/reconstruct-snapshot';
import { assets, branches, publications } from '../db/schema.generated';

export async function findAssetsInCommit(
  db: DrizzleInstance,
  commitId: string,
  rootId: string,
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
  const found = await db
    .select({ id: assets.id })
    .from(assets)
    .where(inArray(assets.id, candidateArray));

  return found.map((row) => row.id);
}

export async function findAssetsInAllPublications(
  db: DrizzleInstance,
  excludeRootId?: string,
  excludeBranchId?: string,
): Promise<Set<string>> {
  const conditions = [];
  if (excludeRootId && excludeBranchId) {
    conditions.push(
      sql`NOT (${publications.rootId} = ${excludeRootId} AND ${publications.branchId} = ${excludeBranchId})`,
    );
  }

  const pubs = await db
    .select({
      rootId: publications.rootId,
      headCommitId: branches.headCommitId,
    })
    .from(publications)
    .innerJoin(branches, eq(branches.id, publications.branchId))
    .where(conditions.length > 0 ? and(...conditions) : undefined);

  const results = await Promise.all(
    pubs.map((pub) => findAssetsInCommit(db, pub.headCommitId, pub.rootId)),
  );

  const allAssetIds = new Set<string>();
  for (const assetIds of results) {
    for (const id of assetIds) {
      allAssetIds.add(id);
    }
  }

  return allAssetIds;
}

export async function syncAssetsOnPublish(
  db: DrizzleInstance,
  commitId: string,
  rootId: string,
): Promise<string[]> {
  const assetIds = await findAssetsInCommit(db, commitId, rootId);

  if (assetIds.length > 0) {
    await db
      .update(assets)
      .set({ status: 'public', updatedAt: new Date() })
      .where(inArray(assets.id, assetIds));
  }

  return assetIds;
}

export async function syncAssetsOnUnpublish(
  db: DrizzleInstance,
  commitId: string,
  rootId: string,
  branchId: string,
): Promise<string[]> {
  const assetIds = await findAssetsInCommit(db, commitId, rootId);
  if (assetIds.length === 0) return [];

  const stillPublished = await findAssetsInAllPublications(
    db,
    rootId,
    branchId,
  );

  const toPrivatize = assetIds.filter((id) => !stillPublished.has(id));

  if (toPrivatize.length > 0) {
    await db
      .update(assets)
      .set({ status: 'private', updatedAt: new Date() })
      .where(inArray(assets.id, toPrivatize));
  }

  return toPrivatize;
}
