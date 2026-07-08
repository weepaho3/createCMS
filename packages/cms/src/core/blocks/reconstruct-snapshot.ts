import { and, eq, inArray, sql } from 'drizzle-orm';

import type { DbOrTx, DrizzleInstance } from '../types/drizzle';

import { blockVersions, commitSnapshots } from '../db/schema.generated';
import { CMSError } from '../errors';
import type { BlockVersionRow } from './copy-subtree';

export type ReconstructedBlock = {
  blockId: string;
  blockVersionId: string;
  type: string;
  properties: Record<string, unknown>;
  children: string[];
  deleted: boolean;
};

export type ReconstructionResult = {
  blocks: Map<string, ReconstructedBlock>;
  reconstructed: boolean;
};

export type BlockTreeNode = {
  blockId: string;
  type: string;
  properties: Record<string, unknown>;
  children: BlockTreeNode[];
};

/**
 * cms-05: reserved property key that stores a root's per-branch DRAFT slug on the
 * ROOT block version's `properties`. Namespaced with a `__` prefix so it can never
 * collide with a user-defined root property. Because it rides `properties`, the
 * draft slug survives revertBranch / merge / history for free, and it is promoted
 * to the global `roots.slug` only at publish time. It MUST be stripped from any
 * public/rendered output (see `assembleBlockTree`'s `stripReservedProps`).
 */
export const ROOT_SLUG_PROP = '__slug';

/**
 * Typed accessor for the draft slug stored on a root block version's properties.
 * Returns `null` when the key is absent or not a string (e.g. an allowIndex home
 * page carries no draft slug).
 */
export function readRootSlug(
  properties: Record<string, unknown>,
): string | null {
  const value = properties[ROOT_SLUG_PROP];
  return typeof value === 'string' ? value : null;
}

/**
 * Fold a draft slug into a root version's properties. A non-empty string is
 * stored under {@link ROOT_SLUG_PROP}; an empty string / null / undefined strips
 * the key (an empty draft slug means "no slug", e.g. an allowIndex home page).
 * Non-mutating — returns a new object.
 */
export function withRootSlug(
  properties: Record<string, unknown>,
  slug: string | null | undefined,
): Record<string, unknown> {
  if (typeof slug === 'string' && slug.length > 0) {
    return { ...properties, [ROOT_SLUG_PROP]: slug };
  }
  const { [ROOT_SLUG_PROP]: _omit, ...rest } = properties;
  return rest;
}

export function assembleBlockTree(
  blocks: Map<string, ReconstructedBlock>,
  rootId: string,
  options?: { stripReservedProps?: boolean },
): BlockTreeNode | null {
  const deletedBlockIds = new Set<string>();
  const nodeMap = new Map<string, BlockTreeNode>();

  for (const [id, block] of blocks) {
    if (block.deleted) {
      deletedBlockIds.add(id);
      continue;
    }
    nodeMap.set(id, {
      blockId: block.blockId,
      type: block.type,
      properties: block.properties,
      children: [],
    });
  }

  for (const [, block] of blocks) {
    if (block.deleted) continue;
    const node = nodeMap.get(block.blockId)!;
    // Drop child references that point at a deleted block or at a block absent
    // from this snapshot. This is intentional: a parent legitimately keeps a
    // reference to a child that a merge excluded (e.g. deleted on one branch).
    // See buildMergedSnapshot in routes/merges.ts for the merge-side reasoning.
    node.children = block.children
      .filter((childId) => !deletedBlockIds.has(childId))
      .map((childId) => nodeMap.get(childId))
      .filter(
        (candidate): candidate is BlockTreeNode => candidate !== undefined,
      );
  }

  const rootNode = nodeMap.get(rootId);
  if (rootNode) {
    // The root block is STORED with type = collection name (see the inverse
    // `type === 'root' ? collectionName : type` in routes/merges.ts), but the
    // consumable tree contract uses the logical `'root'` marker — the renderer
    // skips it to render the page as a fragment, and `getReferencePropertyNames`
    // keys off it. Translate stored → logical HERE, at the single tree-builder,
    // so every consumer (editor read, published render, reference resolution)
    // sees a consistent `type: 'root'` top node.
    rootNode.type = 'root';
    // cms-05 public boundary: the reserved `__slug` draft-slug key must never
    // leak into rendered/published output. Callers on the PUBLIC path
    // (getPublishedContent + embedded-reference loads) pass `stripReservedProps`;
    // the editor read (getBlockTree) omits it so the slug field round-trips.
    if (
      options?.stripReservedProps &&
      ROOT_SLUG_PROP in rootNode.properties
    ) {
      const { [ROOT_SLUG_PROP]: _omit, ...rest } = rootNode.properties;
      rootNode.properties = rest;
    }
  }
  return rootNode ?? null;
}

/**
 * Load the (commit_snapshots ⋈ block_versions) rows for a single commit/root.
 * The rootId clause is the scope guard — it keeps reconstruction from reading
 * another root's block versions. Returns [] when the commit has no snapshot.
 */
async function loadSnapshotRows(
  db: DrizzleInstance,
  commitId: string,
  rootId: string,
) {
  return db
    .select({
      blockId: commitSnapshots.blockId,
      blockVersionId: blockVersions.id,
      type: blockVersions.type,
      properties: blockVersions.properties,
      children: blockVersions.children,
      deleted: blockVersions.deleted,
    })
    .from(commitSnapshots)
    .innerJoin(
      blockVersions,
      eq(blockVersions.id, commitSnapshots.blockVersionId),
    )
    .where(
      and(
        eq(commitSnapshots.commitId, commitId),
        eq(blockVersions.rootId, rootId),
      ),
    );
}

export async function loadBlocksAtCommit(
  db: DbOrTx,
  commitId: string,
  rootId: string,
): Promise<ReconstructionResult> {
  const snapshotRows = await loadSnapshotRows(db, commitId, rootId);

  if (snapshotRows.length > 0) {
    const blocks = new Map<string, ReconstructedBlock>();
    for (const row of snapshotRows) {
      blocks.set(row.blockId, {
        blockId: row.blockId,
        blockVersionId: row.blockVersionId,
        type: row.type,
        properties: row.properties,
        children: (row.children ?? []) as string[],
        deleted: row.deleted,
      });
    }
    return { blocks, reconstructed: false };
  }

  type ChainRow = {
    id: string;
    parent_commit_id: string | null;
    depth: number;
    has_snapshot: boolean;
  };

  const chainResult = await db.execute(sql`
    WITH RECURSIVE chain AS (
      SELECT id, parent_commit_id, 0 AS depth
      FROM cms.commits
      WHERE id = ${commitId} AND root_id = ${rootId}
      UNION ALL
      SELECT c.id, c.parent_commit_id, chain.depth + 1
      FROM cms.commits c
      JOIN chain ON c.id = chain.parent_commit_id
      WHERE chain.depth < 10000
    )
    SELECT chain.id, chain.parent_commit_id, chain.depth,
           EXISTS (SELECT 1 FROM cms.commit_snapshots cs WHERE cs.commit_id = chain.id) AS has_snapshot
    FROM chain
    ORDER BY depth DESC
  `);

  const chainRows = chainResult.rows as ChainRow[];

  if (chainRows.length === 0) {
    return { blocks: new Map(), reconstructed: true };
  }

  const commitChain = chainRows.map((row) => row.id);
  const commitsWithSnapshots = new Set(
    chainRows.filter((row) => row.has_snapshot).map((row) => row.id),
  );

  let baseCommitId: string | null = null;
  let baseIndex = -1;
  for (let i = commitChain.length - 1; i >= 0; i--) {
    if (
      commitChain[i] !== commitId &&
      commitsWithSnapshots.has(commitChain[i])
    ) {
      baseCommitId = commitChain[i];
      baseIndex = i;
      break;
    }
  }

  const state = new Map<string, ReconstructedBlock>();

  if (baseCommitId) {
    const baseRows = await loadSnapshotRows(db, baseCommitId, rootId);

    for (const row of baseRows) {
      state.set(row.blockId, {
        blockId: row.blockId,
        blockVersionId: row.blockVersionId,
        type: row.type,
        properties: row.properties,
        children: (row.children ?? []) as string[],
        deleted: row.deleted,
      });
    }
  }

  const replayCommitIds = baseCommitId
    ? commitChain.slice(baseIndex + 1)
    : commitChain;

  if (replayCommitIds.length > 0) {
    const replayVersions = await db
      .select()
      .from(blockVersions)
      .where(
        and(
          inArray(blockVersions.commitId, replayCommitIds),
          eq(blockVersions.rootId, rootId),
        ),
      );

    const versionsByCommit = new Map<string, typeof replayVersions>();
    for (const version of replayVersions) {
      const list = versionsByCommit.get(version.commitId) ?? [];
      list.push(version);
      versionsByCommit.set(version.commitId, list);
    }

    for (const commitIdInChain of replayCommitIds) {
      const versionsForCommit = versionsByCommit.get(commitIdInChain);
      if (!versionsForCommit) continue;

      for (const version of versionsForCommit) {
        state.set(version.blockId, {
          blockId: version.blockId,
          blockVersionId: version.id,
          type: version.type,
          properties: version.properties,
          children: (version.children ?? []) as string[],
          deleted: version.deleted,
        });
      }
    }
  }

  return { blocks: state, reconstructed: true };
}

/**
 * Loads a single commit's head snapshot into a `blockId → version` map,
 * normalized to {@link BlockVersionRow}. This is the shared preamble behind the
 * subtree mutations (move / delete / duplicate): read the commit's snapshot
 * rows, hydrate their block versions, and key them by block id. Throws
 * `EMPTY_SNAPSHOT` when the commit carries no snapshot. Pass the active tx so
 * the read participates in the transaction's row locks.
 */
export async function loadVersionMapAtCommit(
  exec: DrizzleInstance,
  commitId: string,
): Promise<Map<string, BlockVersionRow>> {
  const snapshotRows = await exec
    .select({ blockVersionId: commitSnapshots.blockVersionId })
    .from(commitSnapshots)
    .where(eq(commitSnapshots.commitId, commitId));

  const versionIds = snapshotRows.map((row) => row.blockVersionId);
  if (versionIds.length === 0) throw new CMSError('EMPTY_SNAPSHOT');

  const versions = await exec
    .select()
    .from(blockVersions)
    .where(inArray(blockVersions.id, versionIds));

  return new Map(
    versions.map((version) => [
      version.blockId,
      {
        blockId: version.blockId,
        type: version.type,
        properties: version.properties,
        children: version.children ?? [],
        deleted: version.deleted,
      },
    ]),
  );
}
