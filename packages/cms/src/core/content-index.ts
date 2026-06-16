import type { CollectionWithName } from './types';
import type { DrizzleInstance } from './types/drizzle';

import {
  insertAssetReferencesForVersions,
  type VersionToIndex,
} from './assets';
import { insertReferenceUsagesForVersions } from './references';
import { insertVariableUsagesForVersions } from './variables';

/** A block version as handed to the content indexer at creation time. */
export type IndexableVersion = VersionToIndex & { deleted?: boolean };

/**
 * Single entry point that populates ALL content-derived usage indexes — the one
 * generalist `content_usages` table (asset + variable rows today; reference rows
 * from RB1) — for freshly-created block versions.
 *
 * These indexes are keyed by the immutable blockVersionId and are insert-only:
 * they are written exactly once, here, in the same transaction that creates the
 * versions, and are never re-synced (rows fall away by FK cascade when the
 * version is pruned). Liveness is decided by joining to branch-head snapshots,
 * so superseded versions simply stop counting without any delete.
 *
 * MUST be invoked at EVERY block-version insert site — the only three are
 * commit-writer's writeCommit + createInitialCommit and merges'
 * createMergeBlockVersion. A new insert site that forgets this call would make
 * its content invisible to the GC (asset data-loss) and to the usage UI. The
 * REQUIRED `collectionDef` (no default) is what the reference indexer needs to
 * know which properties are references — keeping it required means the compiler
 * flags any insert site that fails to thread it.
 *
 * Tombstones (deleted=true) carry old properties forward but never appear in a
 * live view, so they are skipped — keeping the index to live-capable versions.
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
