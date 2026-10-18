import { and, inArray, isNull, or, type SQL } from 'drizzle-orm';

import type { ResolvedScope } from '../types/definitions';
import type { DrizzleInstance } from '../types/drizzle';
import type { MediaConfig } from '../types/s3';

import { assets } from '../db/schema.generated';
import { crossScopeColumns } from '../scope';
import {
  assetUsageCounts,
  assetsSuspectedInRichText,
  assetsUsedIn,
} from './usage';

/**
 * Why an asset was not archived: `in_use` by live content, used by an
 * `external` usage source, or `richtext_suspect` (its id appears inside rich
 * text, which the index cannot type).
 */
export type ArchiveSkipReason = 'in_use' | 'external' | 'richtext_suspect';

/** The ids among `assetIds` that a configured usage source reports. */
export async function assetsUsedExternally(
  media: MediaConfig | undefined,
  assetIds: string[],
): Promise<Set<string>> {
  const used = new Set<string>();
  if (!media?.usageSources?.length || assetIds.length === 0) return used;
  for (const source of media.usageSources) {
    for (const id of await source.assetsInUse(assetIds)) used.add(id);
  }
  return used;
}

/**
 * Archives the live assets among `assetIds` (in scope) together with their
 * variants. Without `force`, assets used by live content (`in_use`), by a
 * usage source (`external`), or whose id appears inside rich text
 * (`richtext_suspect`, unless `media.guardRichTextReferences` is off) are
 * skipped; `usage` gives the root counts of the `in_use` ones. With `force`,
 * they are archived too: pruning still reclaims an asset only once no
 * commit (history included) and no usage source uses it. Assets archived
 * while archived roots use them are listed in `usedByArchivedRoots`. Ids
 * that match no live asset in scope are neither archived nor skipped.
 */
export async function archiveAssetsInScope(
  db: DrizzleInstance,
  assetIds: string[],
  scope: ResolvedScope,
  options: { media?: MediaConfig; force?: boolean } = {},
): Promise<{
  found: string[];
  archivedIds: string[];
  skippedReasons: Record<string, ArchiveSkipReason>;
  usage: Record<string, { roots: number; published: number }>;
  usedByArchivedRoots: string[];
}> {
  const selectConditions: SQL[] = [
    inArray(assets.id, assetIds),
    isNull(assets.archivedAt),
  ];
  if (scope.assets?.where) selectConditions.push(scope.assets.where);
  const found = (
    await db
      .select({ id: assets.id })
      .from(assets)
      .where(and(...selectConditions))
  ).map((a) => a.id);

  const scopeColumns = crossScopeColumns(scope.roots);
  const skippedReasons: Record<string, ArchiveSkipReason> = {};
  let usage: Record<string, { roots: number; published: number }> = {};
  if (!options.force) {
    const live = await assetsUsedIn(db, {
      assetIds: found,
      scope: 'live',
      scopeColumns,
    });
    const external = await assetsUsedExternally(
      options.media,
      found.filter((id) => !live.has(id)),
    );
    const suspected =
      options.media?.guardRichTextReferences === false
        ? new Set<string>()
        : await assetsSuspectedInRichText(
            db,
            found.filter((id) => !live.has(id) && !external.has(id)),
            scopeColumns,
          );
    for (const id of found) {
      if (live.has(id)) skippedReasons[id] = 'in_use';
      else if (external.has(id)) skippedReasons[id] = 'external';
      else if (suspected.has(id)) skippedReasons[id] = 'richtext_suspect';
    }
    usage = await assetUsageCounts(db, [...live], 'live', scopeColumns);
  }
  const toArchive = found.filter((id) => !skippedReasons[id]);
  if (toArchive.length === 0) {
    return {
      found,
      archivedIds: [],
      skippedReasons,
      usage,
      usedByArchivedRoots: [],
    };
  }

  // Variants are archived with their original, so a variant object is never
  // left without it. Objects stay until pruning reclaims them.
  const now = new Date();
  const archiveConditions: SQL[] = [
    or(inArray(assets.id, toArchive), inArray(assets.variantOf, toArchive))!,
    isNull(assets.archivedAt),
  ];
  if (scope.assets?.where) archiveConditions.push(scope.assets.where);
  const archived = await db
    .update(assets)
    .set({ archivedAt: now, updatedAt: now })
    .where(and(...archiveConditions))
    .returning({ id: assets.id });

  const inTrash = await assetsUsedIn(db, {
    assetIds: toArchive,
    scope: 'live',
    scopeColumns,
    includeArchivedRoots: true,
  });
  return {
    found,
    archivedIds: archived.map((a) => a.id),
    skippedReasons,
    usage,
    usedByArchivedRoots: toArchive.filter((id) => inTrash.has(id)),
  };
}
