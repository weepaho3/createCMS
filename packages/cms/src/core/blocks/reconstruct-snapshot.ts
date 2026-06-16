import { and, eq, inArray, sql } from 'drizzle-orm';

import type { DrizzleInstance } from '../types/drizzle';

import { blockVersions, commitSnapshots } from '../db/schema.generated';

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

export function assembleBlockTree(
  blocks: Map<string, ReconstructedBlock>,
  rootId: string,
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
  db: DrizzleInstance,
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
