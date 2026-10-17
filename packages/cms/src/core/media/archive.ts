import { and, inArray, isNull, or, type SQL } from 'drizzle-orm';

import type { ResolvedScope } from '../types/definitions';
import type { DrizzleInstance } from '../types/drizzle';
import type { MediaConfig } from '../types/s3';

import { assets } from '../db/schema.generated';
import { crossScopeColumns } from '../scope';
import {
  assetsReferencedByLiveContent,
  assetsSuspectedInRichText,
} from './usage';

export type ArchiveSkipReason = 'in_use' | 'richtext_suspect';

/**
 * Archives the live assets among `assetIds` (in scope) together with their
 * variants. Assets referenced by live content are skipped (`in_use`), and so
 * are assets whose id appears inside rich text (`richtext_suspect`) unless
 * `force` is set or `media.guardRichTextReferences` is off. Ids that match
 * no live asset in scope are neither archived nor skipped.
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
  const referenced = await assetsReferencedByLiveContent(
    db,
    found,
    scopeColumns,
  );
  const suspected =
    options.force || options.media?.guardRichTextReferences === false
      ? new Set<string>()
      : await assetsSuspectedInRichText(
          db,
          found.filter((id) => !referenced.has(id)),
          scopeColumns,
        );

  const toArchive: string[] = [];
  const skippedReasons: Record<string, ArchiveSkipReason> = {};
  for (const id of found) {
    if (referenced.has(id)) skippedReasons[id] = 'in_use';
    else if (suspected.has(id)) skippedReasons[id] = 'richtext_suspect';
    else toArchive.push(id);
  }
  if (toArchive.length === 0) {
    return { found, archivedIds: [], skippedReasons };
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

  return {
    found,
    archivedIds: archived.map((a) => a.id),
    skippedReasons,
  };
}
