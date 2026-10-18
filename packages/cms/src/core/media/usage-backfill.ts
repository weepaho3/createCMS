import { and, asc, eq, gt, inArray } from 'drizzle-orm';

import type { CollectionWithName } from '../types';
import type { DrizzleInstance } from '../types/drizzle';

import { insertContentUsagesForVersions } from '../content-index';
import { blockVersions, contentUsages, roots } from '../db/schema.generated';

export type UsageBackfillReport = {
  dryRun: boolean;
  /** Block versions read in this batch. */
  processed: number;
  /** Pass to the next call; `null` once `done`. */
  cursor: string | null;
  done: boolean;
  /** Asset, reference and link rows before and after the re-index of this batch. */
  rowsBefore: number;
  rowsAfter: number;
  /** Versions of roots whose collection is no longer configured; left as they are. */
  skippedVersions: number;
};

/**
 * Re-indexes the asset, reference and link usages of existing block versions
 * with the current extractor, one resumable batch (in id order) per call.
 * Block versions are immutable, so the result is exact; a second run changes
 * nothing. Variable usages are untouched. Tombstones are not indexed.
 */
export async function runUsageBackfill(
  db: DrizzleInstance,
  collections: Record<string, CollectionWithName>,
  options: { cursor?: string | null; limit?: number; dryRun?: boolean } = {},
): Promise<UsageBackfillReport> {
  const limit = options.limit ?? 500;
  const dryRun = options.dryRun ?? false;
  const rows = await db
    .select({
      id: blockVersions.id,
      blockId: blockVersions.blockId,
      rootId: blockVersions.rootId,
      type: blockVersions.type,
      properties: blockVersions.properties,
      deleted: blockVersions.deleted,
      collection: roots.collection,
    })
    .from(blockVersions)
    .innerJoin(roots, eq(roots.id, blockVersions.rootId))
    .where(options.cursor ? gt(blockVersions.id, options.cursor) : undefined)
    .orderBy(asc(blockVersions.id))
    .limit(limit);

  const done = rows.length < limit;
  const report: UsageBackfillReport = {
    dryRun,
    processed: rows.length,
    cursor: done ? null : rows[rows.length - 1].id,
    done,
    rowsBefore: 0,
    rowsAfter: 0,
    skippedVersions: 0,
  };
  const live = rows.filter((row) => {
    if (row.deleted) return false;
    if (collections[row.collection]) return true;
    report.skippedVersions++;
    return false;
  });
  if (live.length === 0) return report;

  const ids = live.map((row) => row.id);
  const indexed = and(
    inArray(contentUsages.blockVersionId, ids),
    inArray(contentUsages.targetKind, ['asset', 'reference', 'link']),
  );
  report.rowsBefore = await db.$count(contentUsages, indexed);

  const reindex = async (tx: DrizzleInstance) => {
    await tx.delete(contentUsages).where(indexed);
    const byRoot = new Map<string, typeof live>();
    for (const row of live) {
      const list = byRoot.get(row.rootId) ?? [];
      list.push(row);
      byRoot.set(row.rootId, list);
    }
    for (const [rootId, versions] of byRoot) {
      await insertContentUsagesForVersions(
        tx,
        rootId,
        versions.map((v) => ({
          blockVersionId: v.id,
          blockId: v.blockId,
          type: v.type,
          properties: (v.properties ?? {}) as Record<string, unknown>,
        })),
        collections[versions[0].collection],
      );
    }
    report.rowsAfter = await tx.$count(contentUsages, indexed);
  };

  if (dryRun) {
    // The re-index runs and is rolled back, so the report shows its effect.
    await db
      .transaction(async (tx) => {
        await reindex(tx);
        throw new DryRunRollback();
      })
      .catch((err: unknown) => {
        if (!(err instanceof DryRunRollback)) throw err;
      });
  } else {
    await db.transaction(reindex);
  }
  return report;
}

class DryRunRollback extends Error {}
