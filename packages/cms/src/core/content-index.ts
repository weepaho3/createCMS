import type { CollectionWithName } from './types';
import type { DrizzleInstance } from './types/drizzle';

import { insertAssetReferencesForVersions } from './media/usage';
import { insertReferenceUsagesForVersions } from './references';
import { insertVariableUsagesForVersions } from './variables';

/**
 * A freshly-inserted block version to index. Block versions are immutable and
 * append-only, so references are inserted exactly ONCE (never re-synced) and
 * removed only when the version itself is pruned (FK cascade). Generic across
 * every content-usage indexer (asset/variable/reference), so it lives here at
 * the indexing entry point rather than behind any one domain path.
 */
export type VersionToIndex = {
  blockVersionId: string;
  blockId: string;
  // The block's type — needed by the reference indexer to look up which
  // properties are `reference`-typed in the collection def (asset/variable
  // extraction is type-agnostic and ignores it).
  type: string;
  properties: Record<string, unknown>;
};

/** A block version as handed to the content indexer at creation time. */
export type IndexableVersion = VersionToIndex & { deleted?: boolean };

/**
 * Single entry point that populates ALL content-derived usage indexes in the
 * one generalist `content_usages` table (asset + variable + reference rows)
 * for freshly-created block versions.
 *
 * These indexes are keyed by the immutable blockVersionId and are insert-only:
 * they are written exactly once, here, in the same transaction that creates
 * the versions, and are never re-synced (rows fall away by FK cascade when the
 * version is pruned). Liveness is decided by joining to branch-head snapshots,
 * so superseded versions simply stop counting without any delete.
 *
 * MUST be invoked at EVERY block-version insert site: the only three are
 * commit-writer's writeCommit + createInitialCommit and merges'
 * createMergeBlockVersion. A new insert site that forgets this call would make
 * its content invisible to the GC (asset data-loss) and to the usage UI. The
 * REQUIRED `collectionDef` (no default) is what the reference indexer needs to
 * know which properties are references; keeping it required means the compiler
 * flags any insert site that fails to thread it.
 *
 * Tombstones (deleted=true) carry old properties forward but never appear in a
 * live view, so they are skipped, keeping the index to live-capable versions.
 */
export async function indexVersionContent(
  tx: DrizzleInstance,
  rootId: string,
  versions: IndexableVersion[],
  collectionDef: CollectionWithName,
): Promise<void> {
  const live = versions.filter((v) => !v.deleted);
  if (live.length === 0) return;

  const payload: VersionToIndex[] = live.map((v) => ({
    blockVersionId: v.blockVersionId,
    blockId: v.blockId,
    type: v.type,
    properties: v.properties,
  }));

  await insertAssetReferencesForVersions(tx, rootId, payload);
  await insertVariableUsagesForVersions(tx, rootId, payload);
  await insertReferenceUsagesForVersions(tx, rootId, payload, collectionDef);
}
