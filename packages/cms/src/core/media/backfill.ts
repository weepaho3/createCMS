import { and, asc, eq, gt, inArray, isNull } from 'drizzle-orm';

import type { DrizzleInstance } from '../types/drizzle';
import type { MediaConfig } from '../types/s3';

import { assets } from '../db/schema.generated';
import { getStorage } from '../storage/get-storage';
import { readImageDimensions } from './dimensions';
import { backfillFolderPaths } from './folder-paths';
import { formatVariantKey, parseLegacyVariantSlug } from './variant-key';

/** Bytes read per image to find its dimensions. */
const HEADER_BYTES = 64 * 1024;

export type MediaBackfillReport = {
  /** Rows examined in this batch. */
  processed: number;
  /** Pass to the next call; `null` once every row was examined. */
  cursor: string | null;
  done: boolean;
  dryRun: boolean;
  updated: {
    originalName: number;
    variantKey: number;
    dimensions: number;
    folderPaths: number;
  };
  /**
   * Variants whose slug follows no known scheme, or whose key a live sibling
   * already holds; they become standalone assets (`variantOf` cleared).
   */
  detachedVariants: string[];
  /** Images whose header could not be read. */
  dimensionsUnreadable: string[];
};

/**
 * Fills columns added to `assets` and `asset_folders` for rows written
 * before them, one batch of `limit` assets (by id, after `cursor`) per call:
 * `originalName` from the slug, `variantKey` parsed from the former variant
 * slug scheme, `width`/`height` from the first 64 KB of each image, and the
 * folder `path`/`depth` (on the first batch). Idempotent; `dryRun` reports
 * without writing. Revision links of replaced bytes stay empty: the key of a
 * superseded object carries a fresh id, not the asset's.
 */
export async function runMediaBackfill(
  db: DrizzleInstance,
  media: MediaConfig,
  options: { cursor?: string | null; limit?: number; dryRun?: boolean } = {},
): Promise<MediaBackfillReport> {
  const limit = Math.min(Math.max(options.limit ?? 500, 1), 500);
  const dryRun = options.dryRun === true;
  const report: MediaBackfillReport = {
    processed: 0,
    cursor: null,
    done: false,
    dryRun,
    updated: { originalName: 0, variantKey: 0, dimensions: 0, folderPaths: 0 },
    detachedVariants: [],
    dimensionsUnreadable: [],
  };

  if (!options.cursor && !dryRun) {
    report.updated.folderPaths = await backfillFolderPaths(db);
  }

  const rows = await db
    .select()
    .from(assets)
    .where(options.cursor ? gt(assets.id, options.cursor) : undefined)
    .orderBy(asc(assets.id))
    .limit(limit);
  report.processed = rows.length;
  report.done = rows.length < limit;
  report.cursor = report.done ? null : rows[rows.length - 1].id;

  const parentIds = [
    ...new Set(
      rows.flatMap((r) => (r.variantOf && !r.variantKey ? [r.variantOf] : [])),
    ),
  ];
  const parents = parentIds.length
    ? await db
        .select({ id: assets.id, slug: assets.slug })
        .from(assets)
        .where(inArray(assets.id, parentIds))
    : [];
  const parentSlug = new Map(parents.map((p) => [p.id, p.slug]));
  const storage = getStorage(media);

  for (const row of rows) {
    const set: Partial<typeof assets.$inferInsert> = {};

    if (!row.originalName) {
      set.originalName = row.slug;
      report.updated.originalName++;
    }

    if (row.variantOf && !row.variantKey) {
      const spec = parseLegacyVariantSlug(
        row.slug,
        parentSlug.get(row.variantOf) ?? '',
      );
      const key = spec ? formatVariantKey(spec) : null;
      const [taken] =
        key && !row.archivedAt
          ? await db
              .select({ id: assets.id })
              .from(assets)
              .where(
                and(
                  eq(assets.variantOf, row.variantOf),
                  eq(assets.variantKey, key),
                  isNull(assets.archivedAt),
                ),
              )
              .limit(1)
          : [];
      if (key && !taken) {
        set.variantKey = key;
        report.updated.variantKey++;
      } else {
        set.variantOf = null;
        report.detachedVariants.push(row.id);
      }
    }

    if (
      row.width === null &&
      row.mimeType.startsWith('image/') &&
      storage.capabilities.rangeRead
    ) {
      const head = await storage
        .getRange(row.objectKey, 0, HEADER_BYTES - 1)
        .catch(() => null);
      const size = head ? readImageDimensions(head) : null;
      if (size) {
        set.width = size.width;
        set.height = size.height;
        report.updated.dimensions++;
      } else {
        report.dimensionsUnreadable.push(row.id);
      }
    }

    if (!dryRun && Object.keys(set).length > 0) {
      await db.update(assets).set(set).where(eq(assets.id, row.id));
    }
  }

  if (report.detachedVariants.length > 0) {
    console.warn(
      `[cms] media backfill: ${report.detachedVariants.length} variant(s) without a parseable key become standalone assets: ${report.detachedVariants.join(', ')}`,
    );
  }
  return report;
}
