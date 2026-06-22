import { eq, sql } from 'drizzle-orm';

import type { CollectionWithName } from '../types';
import type { DrizzleInstance } from '../types/drizzle';

import { DEFAULT_BRANCH_NAME } from '../branch-policy';
import { indexVersionContent } from '../content-index';
import {
  blockVersions,
  branches,
  commits,
  commitSnapshots,
} from '../db/schema.generated';

/**
 * A block version a handler wants to write in a commit. The handler pre-computes
 * the full set of versions that change (new blocks, patched parents, tombstones);
 * the writer owns the commit/snapshot/copy-forward machinery around them.
 *
 * `deleted: true` is a tombstone — it carries the old type/properties/children
 * forward with the deleted flag set and MUST remain present in the snapshot
 * (assembleBlockTree relies on tombstones being there to drop child refs).
 */
export type ChangedVersion = {
  blockId: string;
  type: string;
  properties: Record<string, unknown>;
  children: string[];
  deleted?: boolean;
};

/**
 * Write an incremental commit on an existing branch.
 *
 * Contract: the caller MUST have already locked the branch (`.for('update')`)
 * and read its head into `parentCommitId` in the same transaction — the writer
 * does not re-read the head (no TOCTOU). The writer:
 *  1. inserts the commit (parent = `parentCommitId`),
 *  2. inserts every `changed` version under the new commit,
 *  3. copy-forwards all parent snapshot rows whose block_id is NOT in `changed`
 *     (or ALL rows when `changed` is empty — a pure carry-forward commit),
 *  4. inserts the changed snapshot rows,
 *  5. indexes the new versions' asset/variable references (content-index),
 *  6. advances the branch head.
 *
 * Pre-commit guards (TYPE_MISMATCH, BLOCK_ALREADY_DELETED, …) and other
 * post-commit side effects (slug updates, …) stay in the caller.
 */
export async function writeCommit(
  tx: DrizzleInstance,
  // The collection definition — a constant per-factory dependency the content
  // indexer needs to detect `reference` properties. Positional + required so a
  // caller can never silently skip reference indexing.
  collectionDef: CollectionWithName,
  args: {
    rootId: string;
    branchId: string;
    parentCommitId: string;
    message: string;
    createdBy: string | null | undefined;
    changed: ChangedVersion[];
  },
): Promise<{ commitId: string; versionIdByBlockId: Map<string, string> }> {
  const [newCommit] = await tx
    .insert(commits)
    .values({
      rootId: args.rootId,
      parentCommitId: args.parentCommitId,
      message: args.message,
      createdBy: args.createdBy,
    })
    .returning();

  const versionIdByBlockId = new Map<string, string>();

  if (args.changed.length > 0) {
    const inserted = await tx
      .insert(blockVersions)
      .values(
        args.changed.map((c) => ({
          blockId: c.blockId,
          rootId: args.rootId,
          commitId: newCommit.id,
          type: c.type,
          properties: c.properties,
          children: c.children,
          deleted: c.deleted ?? false,
        })),
      )
      .returning();

    for (const v of inserted) {
      versionIdByBlockId.set(v.blockId, v.id);
    }

    const changedIds = args.changed.map((c) => c.blockId);
    await tx.execute(sql`
      INSERT INTO ${commitSnapshots} (commit_id, block_id, block_version_id)
      SELECT ${newCommit.id}, ${commitSnapshots.blockId}, ${commitSnapshots.blockVersionId}
      FROM ${commitSnapshots}
      WHERE ${commitSnapshots.commitId} = ${args.parentCommitId}
        AND ${commitSnapshots.blockId} NOT IN (${sql.join(
          changedIds.map((id) => sql`${id}`),
          sql`, `,
        )})
    `);

    await tx.insert(commitSnapshots).values(
      inserted.map((v) => ({
        commitId: newCommit.id,
        blockId: v.blockId,
        blockVersionId: v.id,
      })),
    );

    await indexVersionContent(
      tx,
      args.rootId,
      inserted.map((v) => ({
        blockVersionId: v.id,
        blockId: v.blockId,
        type: v.type,
        properties: v.properties,
        deleted: v.deleted,
      })),
      collectionDef,
    );
  } else {
    // No changed versions: carry the entire parent snapshot forward verbatim.
    // (A NOT IN over an empty list would be invalid SQL — copy everything.)
    await tx.execute(sql`
      INSERT INTO ${commitSnapshots} (commit_id, block_id, block_version_id)
      SELECT ${newCommit.id}, ${commitSnapshots.blockId}, ${commitSnapshots.blockVersionId}
      FROM ${commitSnapshots}
      WHERE ${commitSnapshots.commitId} = ${args.parentCommitId}
    `);
  }

  await tx
    .update(branches)
    .set({ headCommitId: newCommit.id, updatedAt: new Date() })
    .where(eq(branches.id, args.branchId));

  return { commitId: newCommit.id, versionIdByBlockId };
}

/**
 * Write the very first commit of a new root: creates the commit (no parent),
 * creates the `main` branch pointing at it, inserts every version, and writes a
 * snapshot row per version (no copy-forward — there is no parent snapshot).
 *
 * Used by createRoot and the root-mode of duplicateBlock. The caller inserts the
 * `roots` row itself (scopedInsert) before calling this.
 */
export async function createInitialCommit(
  tx: DrizzleInstance,
  // See writeCommit — required so reference indexing is never silently skipped.
  collectionDef: CollectionWithName,
  args: {
    rootId: string;
    branchName?: string;
    message: string;
    createdBy: string | null | undefined;
    versions: ChangedVersion[];
  },
): Promise<{
  commitId: string;
  branchId: string;
  versionIdByBlockId: Map<string, string>;
}> {
  const [commit] = await tx
    .insert(commits)
    .values({
      rootId: args.rootId,
      message: args.message,
      createdBy: args.createdBy,
    })
    .returning();

  const [branch] = await tx
    .insert(branches)
    .values({
      rootId: args.rootId,
      name: args.branchName ?? DEFAULT_BRANCH_NAME,
      headCommitId: commit.id,
      createdBy: args.createdBy,
    })
    .returning();

  const versionIdByBlockId = new Map<string, string>();

  if (args.versions.length > 0) {
    const inserted = await tx
      .insert(blockVersions)
      .values(
        args.versions.map((v) => ({
          blockId: v.blockId,
          rootId: args.rootId,
          commitId: commit.id,
          type: v.type,
          properties: v.properties,
          children: v.children,
          deleted: v.deleted ?? false,
        })),
      )
      .returning();

    for (const v of inserted) {
      versionIdByBlockId.set(v.blockId, v.id);
    }

    await tx.insert(commitSnapshots).values(
      inserted.map((v) => ({
        commitId: commit.id,
        blockId: v.blockId,
        blockVersionId: v.id,
      })),
    );

    await indexVersionContent(
      tx,
      args.rootId,
      inserted.map((v) => ({
        blockVersionId: v.id,
        blockId: v.blockId,
        type: v.type,
        properties: v.properties,
        deleted: v.deleted,
      })),
      collectionDef,
    );
  }

  return { commitId: commit.id, branchId: branch.id, versionIdByBlockId };
}
