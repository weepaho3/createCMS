import {
  and,
  asc,
  eq,
  ilike,
  inArray,
  isNull,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import * as z from 'zod';

import type {
  CollectionWithName,
  CMSProcedureContext,
  InferMergeBlockVersionInput,
  ListMergeRequestsResult,
  MergeRequestListItem,
  RootSummary,
} from '../types';
import type { DrizzleInstance } from '../types/drizzle';

import type { BlockChange, ChangeAttribution } from '../diff/types';

import { fetchCommitSummary } from '../blocks/commit-writer';
import {
  loadBlocksAtCommit,
  ROOT_SLUG_PROP,
  type ReconstructedBlock,
} from '../blocks/reconstruct-snapshot';
import { approvalGatePasses, resolveBranchPolicy } from '../branch-policy';
import { indexVersionContent } from '../content-index';
import {
  blockVersions,
  branches,
  commitSnapshots,
  commits,
  mergeConflicts,
  mergeRequests,
  publications,
  roots,
} from '../db/schema.generated';
import { buildAnnotatedTree } from '../diff/annotated-tree';
import { classifyChanges } from '../diff/classify';
import { cmsMeta, createCMSEndpoint } from '../endpoint';
import { CMSError } from '../errors';
import { withNotifications } from '../notifications/service';
import { batchFetchRoots } from '../root/batch-fetch';
import { buildMergeBlockVersionInputSchema } from '../schema-builders';
import { userEnrichment, type UserEnrichment } from '../user/enrichment';
import { parseTimestamp } from '../utils/parse-timestamp';
import {
  wireBooleanIsTrue,
  wireBooleanSchema,
} from '../utils/wire-boolean';
import { getApprovalStateForMergeRequest } from './approvals';
import {
  findCommonAncestor,
  loadBranchPair,
  loadMergeSnapshots,
  loadOpenMergeRequest,
} from './merge-context';

const conflictResolutionSchema = z.enum(['source', 'target', 'manual']);

function isUniqueViolation(err: unknown, constraint: string): boolean {
  const pgErr = err as { code?: string; constraint?: string };
  return pgErr.code === '23505' && !!pgErr.constraint?.includes(constraint);
}

/**
 * Clones a change entry with the reserved draft-slug key stripped from every
 * version payload's properties. Applied to the ROOT entry of the flat diff
 * list so `__slug` never leaks to consumers — the clones keep the underlying
 * snapshot maps unmutated.
 */
function withoutRootSlug(change: BlockChange): BlockChange {
  const strip = (
    version: ReconstructedBlock | null,
  ): ReconstructedBlock | null => {
    if (!version || !(ROOT_SLUG_PROP in version.properties)) return version;
    const { [ROOT_SLUG_PROP]: _omit, ...properties } = version.properties;
    return { ...version, properties };
  };
  return {
    ...change,
    sourceVersion: strip(change.sourceVersion),
    targetVersion: strip(change.targetVersion),
    baseVersion: strip(change.baseVersion),
  };
}

/** One side of a diff query resolved to a concrete commit within its root. */
type DiffRef = { commitId: string; rootId: string };

/**
 * Resolves one side of a diff query to a commit + root. A branch ref resolves
 * to the branch's head commit; a commit ref is used as-is. Both lookups join
 * the owning root scoped to the collection AND the caller's root scope
 * (`scopeWhere`) — the same IDOR boundary `loadBranchPair` applies for branch
 * pairs — so an out-of-scope branch or commit reads as not found.
 */
async function resolveDiffRef(
  exec: DrizzleInstance,
  opts: {
    branchId: string | undefined;
    commitId: string | undefined;
    collectionName: string;
    scopeWhere: SQL | undefined;
  },
): Promise<DiffRef> {
  if (opts.branchId) {
    const [branch] = await exec
      .select({ rootId: branches.rootId, headCommitId: branches.headCommitId })
      .from(branches)
      .innerJoin(roots, eq(roots.id, branches.rootId))
      .where(
        and(
          eq(branches.id, opts.branchId),
          eq(roots.collection, opts.collectionName),
          opts.scopeWhere,
        ),
      );
    if (!branch) throw new CMSError('BRANCH_NOT_FOUND');
    return { commitId: branch.headCommitId, rootId: branch.rootId };
  }

  const [commit] = await exec
    .select({ id: commits.id, rootId: commits.rootId })
    .from(commits)
    .innerJoin(roots, eq(roots.id, commits.rootId))
    .where(
      and(
        eq(commits.id, opts.commitId!),
        eq(roots.collection, opts.collectionName),
        opts.scopeWhere,
      ),
    );
  if (!commit) throw new CMSError('COMMIT_NOT_FOUND');
  return { commitId: commit.id, rootId: commit.rootId };
}

/**
 * Resolves a root's CURRENT publication to the published branch's LIVE head
 * commit — what the published-render path actually serves:
 * `getPublishedContent` reads `branches.headCommitId`, NOT the
 * `publications.commitId` pinned at publish time. The pin goes stale the
 * moment the published branch advances (e.g. a merge-to-live, the sanctioned
 * way to update a protected published branch), and diffing against it would
 * re-report already-live changes as pending. The publication pick stays
 * getPublishedContent's deterministic one: oldest publish first, branchId as
 * the stable tiebreak. The caller passes a rootId taken from an already
 * scope-checked ref, so no separate scope guard is needed here.
 */
async function resolvePublishedRef(
  exec: DrizzleInstance,
  rootId: string,
): Promise<DiffRef> {
  const [publication] = await exec
    .select({ headCommitId: branches.headCommitId })
    .from(publications)
    .innerJoin(branches, eq(branches.id, publications.branchId))
    .where(eq(publications.rootId, rootId))
    .orderBy(asc(publications.publishedAt), asc(publications.branchId))
    .limit(1);
  if (!publication) throw new CMSError('PUBLICATION_NOT_FOUND');
  return { commitId: publication.headCommitId, rootId };
}

/**
 * Attaches {@link ChangeAttribution} to each change entry whose authoring
 * commit is derivable (mutates the entries in place, BEFORE the annotated
 * tree is built so its annotations carry the attribution too):
 *
 * - Own version changed (`sourceVersion.blockVersionId` differs from the
 *   base's — added / deleted / modified / childrenReordered / slug change):
 *   the commit that created `sourceVersion`.
 * - Pure position move (own version unchanged): the commit that actually
 *   repositioned the block under its new parent. The new parent's CURRENT
 *   `sourceVersion` is NOT trusted (it names whatever touched the parent
 *   last, e.g. a later property edit); instead the new parent's versions on
 *   the source side's first-parent commit chain (common ancestor → source
 *   head) are walked oldest-to-newest, and the entry is attributed to the
 *   LAST version where the moved child's presence/index in `children`
 *   changed relative to the previous version — the actual move commit
 *   (multiple moves → the latest one). When no such version exists on that
 *   chain (e.g. the move landed via a merge's source side), attribution is
 *   OMITTED rather than guessed.
 *
 * Batched: one `blockVersions` id → commitId query, one recursive-CTE chain
 * walk covering ALL affected new parents, and one `commits` query (the latter
 * carrying the optional `withUser` enrichment onto `changedByUser`). Every
 * entry receives its OWN attribution object — never shared across entries of
 * the same commit — so per-entry consumers (and the aliased tree annotations)
 * can be mutated independently.
 */
async function attachAttribution(
  exec: DrizzleInstance,
  enrich: UserEnrichment,
  changes: BlockChange[],
  opts: {
    baseBlocks: Map<string, ReconstructedBlock>;
    sourceCommitId: string;
    ancestorCommitId: string;
    rootId: string;
  },
): Promise<void> {
  // Rule 1: own version changed → the commit that created `sourceVersion`.
  const versionIdByBlockId = new Map<string, string>();
  // Rule 2: pure position moves, grouped by the NEW parent whose version
  // history carries the move.
  const pureMovesByParentId = new Map<string, BlockChange[]>();
  for (const change of changes) {
    const { sourceVersion, baseVersion } = change;
    if (
      sourceVersion &&
      sourceVersion.blockVersionId !== baseVersion?.blockVersionId
    ) {
      versionIdByBlockId.set(change.blockId, sourceVersion.blockVersionId);
      continue;
    }
    const toParentId = change.moved?.toParentId;
    if (toParentId) {
      const group = pureMovesByParentId.get(toParentId) ?? [];
      group.push(change);
      pureMovesByParentId.set(toParentId, group);
    }
  }

  const commitIdByBlockId = new Map<string, string>();

  if (versionIdByBlockId.size > 0) {
    const versionRows = await exec
      .select({ id: blockVersions.id, commitId: blockVersions.commitId })
      .from(blockVersions)
      .where(
        inArray(blockVersions.id, [...new Set(versionIdByBlockId.values())]),
      );
    const commitIdByVersionId = new Map(
      versionRows.map((row) => [row.id, row.commitId]),
    );
    for (const [blockId, versionId] of versionIdByBlockId) {
      const commitId = commitIdByVersionId.get(versionId);
      if (commitId) commitIdByBlockId.set(blockId, commitId);
    }
  }

  if (pureMovesByParentId.size > 0) {
    // All versions the affected new parents committed on the source side's
    // first-parent chain (ancestor excluded — its state is the baseline),
    // oldest first. The chain mirrors reconstruct-snapshot's recursive CTE:
    // follow `parent_commit_id` only, never a merge's source side.
    const walkResult = await exec.execute(sql`
      WITH RECURSIVE chain AS (
        SELECT id, parent_commit_id, 0 AS depth
        FROM cms.commits
        WHERE id = ${opts.sourceCommitId} AND root_id = ${opts.rootId}
        UNION ALL
        SELECT c.id, c.parent_commit_id, chain.depth + 1
        FROM cms.commits c
        JOIN chain ON c.id = chain.parent_commit_id
        WHERE chain.id <> ${opts.ancestorCommitId} AND chain.depth < 10000
      )
      SELECT
        cms.block_versions.block_id,
        cms.block_versions.commit_id,
        cms.block_versions.children,
        chain.depth
      FROM cms.block_versions
      JOIN chain ON chain.id = cms.block_versions.commit_id
      WHERE ${inArray(blockVersions.blockId, [...pureMovesByParentId.keys()])}
        AND cms.block_versions.root_id = ${opts.rootId}
        AND chain.id <> ${opts.ancestorCommitId}
      ORDER BY chain.depth DESC
    `);

    const versionsByParentId = new Map<
      string,
      Array<{ commitId: string; children: string[] }>
    >();
    for (const row of walkResult.rows as Array<Record<string, unknown>>) {
      const parentId = row.block_id as string;
      const versions = versionsByParentId.get(parentId) ?? [];
      versions.push({
        commitId: row.commit_id as string,
        children: (row.children ?? []) as string[],
      });
      versionsByParentId.set(parentId, versions);
    }

    for (const [parentId, moves] of pureMovesByParentId) {
      const versions = versionsByParentId.get(parentId);
      if (!versions) continue; // Not derivable on this chain → omit.
      const baseChildren = opts.baseBlocks.get(parentId)?.children ?? [];
      for (const change of moves) {
        let previousIndex = baseChildren.indexOf(change.blockId);
        let moveCommitId: string | undefined;
        for (const version of versions) {
          const index = version.children.indexOf(change.blockId);
          if (index !== previousIndex) moveCommitId = version.commitId;
          previousIndex = index;
        }
        if (moveCommitId) commitIdByBlockId.set(change.blockId, moveCommitId);
      }
    }
  }

  if (commitIdByBlockId.size === 0) return;

  const commitIds = [...new Set(commitIdByBlockId.values())];
  const result = await exec.execute(sql`
    SELECT
      cms.commits.id,
      cms.commits.created_by,
      cms.commits.created_at
      ${enrich.select}
    FROM cms.commits
    ${enrich.join}
    WHERE ${inArray(commits.id, commitIds)}
  `);

  const attributionByCommitId = new Map<string, ChangeAttribution>();
  for (const row of result.rows as Array<Record<string, unknown>>) {
    const attribution: ChangeAttribution = {
      commitId: row.id as string,
      changedAt: parseTimestamp(row.created_at),
      changedBy: (row.created_by as string | null) ?? null,
    };
    enrich.apply(attribution, row);
    attributionByCommitId.set(attribution.commitId, attribution);
  }

  for (const change of changes) {
    const commitId = commitIdByBlockId.get(change.blockId);
    const attribution = commitId
      ? attributionByCommitId.get(commitId)
      : undefined;
    // Clone per entry: two entries authored by the same commit must not share
    // one attribution object.
    if (attribution) change.attribution = { ...attribution };
  }
}

type ConflictEntry = {
  blockId: string;
  sourceVersionId: string | null;
  targetVersionId: string | null;
  baseVersionId: string | null;
};

function detectConflicts(
  baseBlocks: Map<string, ReconstructedBlock>,
  sourceBlocks: Map<string, ReconstructedBlock>,
  targetBlocks: Map<string, ReconstructedBlock>,
): ConflictEntry[] {
  const conflicts: ConflictEntry[] = [];

  const allBlockIds = new Set<string>();
  for (const id of baseBlocks.keys()) allBlockIds.add(id);
  for (const id of sourceBlocks.keys()) allBlockIds.add(id);
  for (const id of targetBlocks.keys()) allBlockIds.add(id);

  for (const blockId of allBlockIds) {
    const base = baseBlocks.get(blockId);
    const source = sourceBlocks.get(blockId);
    const target = targetBlocks.get(blockId);

    const sourceVid = source?.blockVersionId;
    const targetVid = target?.blockVersionId;
    const baseVid = base?.blockVersionId;

    if (sourceVid === baseVid && targetVid === baseVid) continue;
    if (sourceVid !== baseVid && targetVid === baseVid) continue;
    if (sourceVid === baseVid && targetVid !== baseVid) continue;
    if (sourceVid === targetVid) continue;

    conflicts.push({
      blockId,
      sourceVersionId: sourceVid ?? null,
      targetVersionId: targetVid ?? null,
      baseVersionId: baseVid ?? null,
    });
  }

  return conflicts;
}

type MergeResolution = {
  blockId: string;
  resolvedVersionId: string;
};

/**
 * Builds the merged snapshot as a per-block `blockId -> blockVersionId` map
 * using a 3-way (base/source/target) decision per block.
 *
 * Reachability is intentionally NOT enforced here, and that is safe:
 *
 * - Blocks that one side deleted while the other left untouched are excluded.
 *   This is correct — the block really is gone — and `assembleBlockTree` simply
 *   drops the now-dangling child reference on its (surviving) parent. The
 *   delete-vs-edit exclusion only applies to blocks that were LIVE at the
 *   common ancestor: a block with no live base version is NEW on whichever
 *   side carries it and is kept (absence on the other side is not a deletion).
 * - Any block that BOTH sides changed differently (including delete/modify, as
 *   deleted blocks carry a `deleted: true` version) is a conflict. `executeMerge`
 *   refuses to merge until every such conflict has a resolution (throws
 *   UNRESOLVED_CONFLICTS), so this function only runs on a fully-resolved set.
 *
 * The one remaining edge is an *orphan*: a block kept in the merged set but
 * unreachable from the root — e.g. source adds child C under parent P, P is a
 * conflict resolved to target's version (which doesn't list C). C then exists
 * as a committed version but won't appear in the assembled tree. This is a
 * deliberate consequence of the chosen conflict resolution (not data loss — the
 * version persists in the commit), and is documented rather than auto-reconciled
 * to avoid changing well-tested merge semantics or raising spurious conflicts.
 */
function buildMergedSnapshot(
  baseBlocks: Map<string, ReconstructedBlock>,
  sourceBlocks: Map<string, ReconstructedBlock>,
  targetBlocks: Map<string, ReconstructedBlock>,
  resolutions: MergeResolution[],
): Map<string, string> {
  const resolutionMap = new Map<string, string>();
  for (const r of resolutions) {
    resolutionMap.set(r.blockId, r.resolvedVersionId);
  }

  const merged = new Map<string, string>();

  const allBlockIds = new Set<string>();
  for (const id of baseBlocks.keys()) allBlockIds.add(id);
  for (const id of sourceBlocks.keys()) allBlockIds.add(id);
  for (const id of targetBlocks.keys()) allBlockIds.add(id);

  for (const blockId of allBlockIds) {
    const base = baseBlocks.get(blockId);
    const source = sourceBlocks.get(blockId);
    const target = targetBlocks.get(blockId);

    const baseVid = base?.blockVersionId;
    const sourceVid = source?.blockVersionId;
    const targetVid = target?.blockVersionId;

    const sourceDeleted = !source || source.deleted;
    const targetDeleted = !target || target.deleted;
    // A block ABSENT from a side is only a deletion when it actually existed
    // (live) at the common ancestor. A block with no live base version is NEW
    // on whichever side carries it — "absent on the other side" must not read
    // as "the other side deleted it", or one-side additions get dropped.
    const baseAlive = !!base && !base.deleted;

    if (resolutionMap.has(blockId)) {
      merged.set(blockId, resolutionMap.get(blockId)!);
      continue;
    }

    if (sourceDeleted && targetDeleted) continue;
    if (sourceDeleted && !targetDeleted && targetVid === baseVid) continue;
    if (targetDeleted && !sourceDeleted && sourceVid === baseVid) continue;

    if (
      baseAlive &&
      ((sourceDeleted && !targetDeleted && targetVid !== baseVid) ||
        (targetDeleted && !sourceDeleted && sourceVid !== baseVid))
    ) {
      continue;
    }

    if (sourceVid !== baseVid && targetVid === baseVid) {
      if (sourceVid && !sourceDeleted) merged.set(blockId, sourceVid);
      continue;
    }

    if (targetVid !== baseVid && sourceVid === baseVid) {
      if (targetVid && !targetDeleted) merged.set(blockId, targetVid);
      continue;
    }

    if (sourceVid === targetVid && sourceVid) {
      merged.set(blockId, sourceVid);
      continue;
    }

    if (sourceVid === baseVid && targetVid === baseVid && baseVid) {
      merged.set(blockId, baseVid);
      continue;
    }

    if (sourceVid && !sourceDeleted) {
      merged.set(blockId, sourceVid);
    } else if (targetVid && !targetDeleted) {
      merged.set(blockId, targetVid);
    }
  }

  return merged;
}

export function createMergeEndpoints<TDef extends CollectionWithName>(
  def: TDef,
  cmsCtx: CMSProcedureContext,
) {
  const { db } = cmsCtx;
  const collectionName = def.name;
  const branchPolicy = resolveBranchPolicy(cmsCtx, def.branchProtection);

  return {
    /**
     * Compares two refs of one root and returns the base-to-source changeset
     * in up to two representations: a flat change list (`diff`) and an
     * annotated render tree (`tree`), selected via `view`.
     *
     * Each side is a ref: a branch (resolved to its head commit), a commit
     * (used as-is), or — target only — the root's current publication
     * (resolved to the published branch's LIVE head commit — exactly what the
     * published render serves, so a stale publish-time pin never re-reports
     * already-live changes). The base is the common ancestor of the two
     * resolved commits; when one commit is an ancestor of the other, the
     * common ancestor IS that commit and the 3-way diff degenerates to an
     * exact 2-way comparison (e.g. commit vs. its parent yields exactly that
     * commit's changes, and a publish preview yields exactly the edits not
     * yet live).
     *
     * Movement is identity-based: a block is `moved` (kind `reparented` or
     * `reordered`, with its old/new parent and index) only when it actually
     * moved, and a parent is `childrenReordered` only when the RELATIVE order
     * of its surviving children changed — insertions and deletions around
     * untouched siblings produce no cascade. Modified entries carry granular
     * `propertyChanges` (with word-level `textDiff` segments for richText
     * properties), and the root entry carries `slugChange` when the versioned
     * draft slug differs (a slug-only change is not `modified`).
     *
     * With `withAttribution: true`, each entry (and its tree annotation)
     * carries an `attribution` — the commit id, timestamp, and author of the
     * change, plus `changedByUser` under the `withUser` flag. Attribution
     * rule: an entry whose own version changed (added / deleted / modified /
     * childrenReordered / slug change) is attributed to the commit that
     * created its `sourceVersion`; a pure position move (own version
     * unchanged) is attributed to the commit that actually repositioned the
     * block under its new parent (derived by walking the new parent's version
     * history on the source side's first-parent chain), and is OMITTED when
     * that commit is not derivable — e.g. the move landed via a merge's
     * source side.
     *
     * Both boolean flags travel strictly on the wire: only `true` / `'true'`
     * enable them — the HTTP string `'false'` decodes to false (it does NOT
     * count as a target ref, and does not enable attribution).
     *
     * @param sourceBranchId - Source branch ref; exactly one of sourceBranchId or sourceCommitId.
     * @param sourceCommitId - Source commit ref; exactly one of sourceBranchId or sourceCommitId.
     * @param targetBranchId - Target branch ref; exactly one of targetBranchId, targetCommitId, or targetPublished.
     * @param targetCommitId - Target commit ref; exactly one of targetBranchId, targetCommitId, or targetPublished.
     * @param targetPublished - Target the source root's current publication (the published branch's
     *   live head); exactly one of targetBranchId, targetCommitId, or targetPublished.
     * @param view - Which representations to return: 'list', 'tree', or 'both' (default 'both').
     * @param withAttribution - Attach per-entry commit attribution (default false).
     * @returns `diff` (flat change list, null when view is 'tree'), `tree` (the source tree
     *   annotated per node, with deleted blocks re-inserted as ghost nodes at their old
     *   position; null when view is 'list', and also null — for any view — when the source
     *   ref deleted the root block itself), a per-changeType `summary`, plus the resolved
     *   commit ids.
     * @throws BRANCH_NOT_FOUND if a branch ref does not exist in this collection.
     * @throws COMMIT_NOT_FOUND if a commit ref does not exist in this collection.
     * @throws PUBLICATION_NOT_FOUND if targetPublished is set and the source root has no publication.
     * @throws BRANCHES_NOT_SAME_ROOT if the two refs resolve to different roots.
     * @example await cmsClient.pages.getDiff({ sourceBranchId: 'src-id', targetBranchId: 'tgt-id', view: 'tree' })
     * @example
     * // Publish preview: exactly the edits on the branch that are not yet live.
     * await cmsClient.pages.getDiff({ sourceBranchId: 'branch-id', targetPublished: true })
     */
    getDiff: createCMSEndpoint(
      `/${collectionName}/getDiff`,
      {
        method: 'GET',
        query: z
          .object({
            sourceBranchId: z.string().optional(),
            sourceCommitId: z.string().optional(),
            targetBranchId: z.string().optional(),
            targetCommitId: z.string().optional(),
            targetPublished: wireBooleanSchema.optional(),
            view: z.enum(['list', 'tree', 'both']).optional(),
            withAttribution: wireBooleanSchema.optional(),
          })
          .refine((q) => !!q.sourceBranchId !== !!q.sourceCommitId, {
            message: 'Provide exactly one of sourceBranchId or sourceCommitId',
          })
          .refine(
            // A decoded-false/absent targetPublished is NOT a ref — so
            // `targetPublished: false` (or the wire string 'false') alongside
            // targetBranchId/targetCommitId stays a valid single-ref query.
            (q) =>
              [
                q.targetBranchId,
                q.targetCommitId,
                wireBooleanIsTrue(q.targetPublished) || undefined,
              ].filter((ref) => ref !== undefined).length === 1,
            {
              message:
                'Provide exactly one of targetBranchId, targetCommitId, or targetPublished',
            },
          ),
        metadata: cmsMeta(
          {
            $Infer: {
              query: {} as {
                sourceBranchId?: string;
                sourceCommitId?: string;
                targetBranchId?: string;
                targetCommitId?: string;
                targetPublished?: boolean;
                view?: 'list' | 'tree' | 'both';
                withAttribution?: boolean;
              },
            },
          },
          {
            permissionResource: 'mergeRequest',
            operation: 'read',
            scope: 'collection',
            collection: collectionName,
          },
        ),
      },
      async (ctx) => {
        const view = ctx.query.view ?? 'both';
        const scopeWhere = ctx.context.scope.roots?.where;

        const source = await resolveDiffRef(db, {
          branchId: ctx.query.sourceBranchId,
          commitId: ctx.query.sourceCommitId,
          collectionName,
          scopeWhere,
        });
        const target = wireBooleanIsTrue(ctx.query.targetPublished)
          ? await resolvePublishedRef(db, source.rootId)
          : await resolveDiffRef(db, {
              branchId: ctx.query.targetBranchId,
              commitId: ctx.query.targetCommitId,
              collectionName,
              scopeWhere,
            });

        if (source.rootId !== target.rootId) {
          throw new CMSError('BRANCHES_NOT_SAME_ROOT', {
            message: 'Source and target refs must belong to the same root',
          });
        }

        const { ancestor, baseSnapshot, sourceSnapshot, targetSnapshot } =
          await loadMergeSnapshots(
            db,
            { rootId: source.rootId, headCommitId: source.commitId },
            { rootId: target.rootId, headCommitId: target.commitId },
          );

        const rootId = source.rootId;
        const { changes, summary } = classifyChanges({
          baseBlocks: baseSnapshot.blocks,
          sourceBlocks: sourceSnapshot.blocks,
          targetBlocks: targetSnapshot.blocks,
          rootId,
          blockDefs: def.blocks,
          rootProperties: def.root.properties,
        });

        if (wireBooleanIsTrue(ctx.query.withAttribution)) {
          const enrich = userEnrichment(ctx, {
            cmsColumn: 'cms.commits.created_by',
            alias: 'commit_user',
            outputKey: 'changedByUser',
          });
          await attachAttribution(db, enrich, changes, {
            baseBlocks: baseSnapshot.blocks,
            sourceCommitId: source.commitId,
            ancestorCommitId: ancestor.commonAncestorCommitId,
            rootId,
          });
        }

        return {
          diff:
            view !== 'tree'
              ? changes.map((change) =>
                  change.blockId === rootId ? withoutRootSlug(change) : change,
                )
              : null,
          tree:
            view !== 'list'
              ? buildAnnotatedTree({
                  sourceBlocks: sourceSnapshot.blocks,
                  baseBlocks: baseSnapshot.blocks,
                  changes,
                  rootId,
                })
              : null,
          summary,
          sourceCommitId: source.commitId,
          targetCommitId: target.commitId,
          commonAncestorCommitId: ancestor.commonAncestorCommitId,
        };
      },
    ),

    /**
     * Detects merge conflicts between two branches using three-way merge (base/source/target).
     *
     * @param sourceBranchId - The source branch id.
     * @param targetBranchId - The target branch id.
     * @returns A conflicts array and a hasConflicts flag, plus commit ids.
     * @throws BRANCH_NOT_FOUND if either branch does not exist in this collection.
     * @throws BRANCHES_NOT_SAME_ROOT if the branches are from different roots.
     * @example await cmsClient.pages.checkConflicts({ sourceBranchId: 'src-id', targetBranchId: 'tgt-id' })
     */
    checkConflicts: createCMSEndpoint(
      `/${collectionName}/checkConflicts`,
      {
        method: 'GET',
        query: z.object({
          sourceBranchId: z.string(),
          targetBranchId: z.string(),
        }),
        metadata: cmsMeta(
          {
            $Infer: {
              query: {} as { sourceBranchId: string; targetBranchId: string },
            },
          },
          {
            permissionResource: 'mergeRequest',
            operation: 'read',
            scope: 'collection',
            collection: collectionName,
          },
        ),
      },
      async (ctx) => {
        const { sourceBranchId, targetBranchId } = ctx.query;

        const { sourceBranch, targetBranch } = await loadBranchPair(db, {
          sourceBranchId,
          targetBranchId,
          collectionName,
          scopeWhere: ctx.context.scope.roots?.where,
        });

        const { ancestor, baseSnapshot, sourceSnapshot, targetSnapshot } =
          await loadMergeSnapshots(db, sourceBranch, targetBranch);

        const conflicts = detectConflicts(
          baseSnapshot.blocks,
          sourceSnapshot.blocks,
          targetSnapshot.blocks,
        );

        return {
          hasConflicts: conflicts.length > 0,
          conflicts,
          commonAncestorCommitId: ancestor.commonAncestorCommitId,
          sourceCommitId: sourceBranch.headCommitId,
          targetCommitId: targetBranch.headCommitId,
        };
      },
    ),

    /**
     * Opens a new merge request to merge source branch into target branch.
     * Fails if an open merge request already exists for this source-target pair.
     *
     * @param sourceBranchId - The source branch id to merge from.
     * @param targetBranchId - The target branch id to merge into.
     * @param title - A brief title for the merge request.
     * @param description - Optional longer description.
     * @param createdBy - Optional explicit actor id; used only when ctx.context.userId is absent (context takes precedence).
     * @returns The created merge request row, conflicts array, and hasConflicts flag.
     * @throws MERGE_REQUEST_ALREADY_EXISTS if an open MR for this pair exists.
     * @throws BRANCH_NOT_FOUND if either branch does not exist.
     * @throws BRANCHES_NOT_SAME_ROOT if branches have different root ids.
     * @throws USER_ID_REQUIRED if no actor (userId or createdBy) is provided.
     * @example await cmsClient.pages.createMergeRequest({ sourceBranchId: 'src', targetBranchId: 'tgt', title: 'Merge feature' })
     */
    createMergeRequest: createCMSEndpoint(
      `/${collectionName}/createMergeRequest`,
      {
        method: 'POST',
        body: z.object({
          sourceBranchId: z.string(),
          targetBranchId: z.string(),
          title: z.string().min(1),
          description: z.string().optional(),
          createdBy: z.string().optional(),
        }),
        metadata: cmsMeta(
          {
            $Infer: {
              body: {} as {
                sourceBranchId: string;
                targetBranchId: string;
                title: string;
                description?: string;
                createdBy?: string;
              },
            },
          },
          {
            permissionResource: 'mergeRequest',
            operation: 'create',
            scope: 'collection',
            collection: collectionName,
          },
        ),
      },
      async (ctx) => {
        const {
          sourceBranchId,
          targetBranchId,
          title,
          description,
          createdBy,
        } = ctx.body;
        const actor = ctx.context.userId ?? createdBy;
        if (!actor) throw new CMSError('USER_ID_REQUIRED');

        return withNotifications(
          db,
          cmsCtx.notificationService,
          async (tx, pending) => {
            const { sourceBranch, targetBranch } = await loadBranchPair(tx, {
              sourceBranchId,
              targetBranchId,
              collectionName,
              scopeWhere: ctx.context.scope.roots?.where,
            });

            const [existingMR] = await tx
              .select({ id: mergeRequests.id })
              .from(mergeRequests)
              .where(
                and(
                  eq(mergeRequests.sourceBranchId, sourceBranchId),
                  eq(mergeRequests.targetBranchId, targetBranchId),
                  eq(mergeRequests.status, 'open'),
                ),
              );
            if (existingMR) throw new CMSError('MERGE_REQUEST_ALREADY_EXISTS');

            const { ancestor, baseSnapshot, sourceSnapshot, targetSnapshot } =
              await loadMergeSnapshots(tx, sourceBranch, targetBranch);

            const conflicts = detectConflicts(
              baseSnapshot.blocks,
              sourceSnapshot.blocks,
              targetSnapshot.blocks,
            );

            let mr: typeof mergeRequests.$inferSelect;
            try {
              [mr] = await tx
                .insert(mergeRequests)
                .values({
                  rootId: sourceBranch.rootId,
                  sourceBranchId,
                  targetBranchId,
                  sourceCommitId: sourceBranch.headCommitId,
                  baseCommitId: ancestor.commonAncestorCommitId,
                  title,
                  description,
                  createdBy: actor,
                  status: 'open',
                })
                .returning();
            } catch (err: unknown) {
              if (isUniqueViolation(err, 'mr_open_source_target')) {
                throw new CMSError('MERGE_REQUEST_ALREADY_EXISTS');
              }
              throw err;
            }

            if (conflicts.length > 0) {
              await tx.insert(mergeConflicts).values(
                conflicts.map((c) => ({
                  mergeRequestId: mr.id,
                  blockId: c.blockId,
                  sourceVersionId: c.sourceVersionId,
                  targetVersionId: c.targetVersionId,
                  baseVersionId: c.baseVersionId,
                })),
              );
            }

            if (targetBranch.createdBy && targetBranch.createdBy !== actor) {
              pending.push({
                recipientId: targetBranch.createdBy,
                actorId: actor,
                type: 'mergeRequestOpened',
                title: 'New merge request for your branch',
                body: title ?? null,
                resourceType: 'mergeRequest',
                resourceId: mr.id,
                collection: collectionName,
                meta: {
                  mergeRequestId: mr.id,
                  rootId: sourceBranch.rootId,
                  sourceBranchId,
                  targetBranchId,
                },
              });
            }

            return {
              mergeRequest: mr,
              hasConflicts: conflicts.length > 0,
              conflicts,
            };
          },
        );
      },
    ),

    /**
     * Lists merge requests for the collection with optional filtering and sorting.
     *
     * @param limit - Max results per page (1–100, default 20).
     * @param offset - Pagination offset (default 0).
     * @param rootId - Filter by root id.
     * @param sourceBranchId - Filter by source branch.
     * @param targetBranchId - Filter by target branch.
     * @param status - Filter by status: 'open', 'merged', or 'closed'.
     * @param createdBy - Filter by merge request creator.
     * @param search - Search title and description by pattern.
     * @param sortBy - Sort field: createdAt (default), updatedAt, status, or title.
     * @param sortDirection - 'asc' or 'desc' (default 'desc').
     * @returns Array of merge request objects plus total count and hasMore flag.
     * @example await cmsClient.pages.listMergeRequests({ status: 'open', limit: 50 })
     */
    listMergeRequests: createCMSEndpoint(
      `/${collectionName}/listMergeRequests`,
      {
        method: 'GET',
        query: z
          .object({
            limit: z.coerce.number().min(1).max(100).optional(),
            offset: z.coerce.number().min(0).optional(),
            rootId: z.string().optional(),
            sourceBranchId: z.string().optional(),
            targetBranchId: z.string().optional(),
            status: z.enum(['open', 'merged', 'closed']).optional(),
            createdBy: z.string().optional(),
            search: z.string().optional(),
            sortBy: z
              .enum(['createdAt', 'updatedAt', 'status', 'title'])
              .optional(),
            sortDirection: z.enum(['asc', 'desc']).optional(),
          })
          .optional(),
        metadata: cmsMeta(
          {
            $Infer: {
              query: {} as {
                limit?: number;
                offset?: number;
                rootId?: string;
                sourceBranchId?: string;
                targetBranchId?: string;
                status?: 'open' | 'merged' | 'closed';
                createdBy?: string;
                search?: string;
                sortBy?: 'createdAt' | 'updatedAt' | 'status' | 'title';
                sortDirection?: 'asc' | 'desc';
                withRoot?: boolean;
              },
            },
          },
          {
            permissionResource: 'mergeRequest',
            operation: 'read',
            scope: 'collection',
            collection: collectionName,
          },
        ),
      },
      async (ctx) => {
        const input = ctx.query ?? {};
        const limit = input.limit ?? 20;
        const offset = input.offset ?? 0;
        const sortDirection = input.sortDirection ?? 'desc';

        const MR_SORT_FIELDS: Record<string, string> = {
          createdAt: 'cms.merge_requests.created_at',
          updatedAt: 'cms.merge_requests.updated_at',
          status: 'cms.merge_requests.status',
          title: 'cms.merge_requests.title',
        };

        const orderColumn = MR_SORT_FIELDS[input.sortBy ?? 'createdAt']!;
        const orderExpr = sql.raw(orderColumn);
        const dirExpr = sortDirection === 'asc' ? sql`ASC` : sql`DESC`;

        // Exclude merge requests whose root was soft-deleted (archiveRoot sets
        // roots.archived_at) — they must not surface in the MR list, mirroring
        // listRoots' own archived filter.
        const conditions = [
          eq(roots.collection, collectionName),
          isNull(roots.archivedAt),
        ];

        if (input.rootId) {
          conditions.push(eq(mergeRequests.rootId, input.rootId));
        }
        if (input.sourceBranchId) {
          conditions.push(
            eq(mergeRequests.sourceBranchId, input.sourceBranchId),
          );
        }
        if (input.targetBranchId) {
          conditions.push(
            eq(mergeRequests.targetBranchId, input.targetBranchId),
          );
        }
        if (input.status) {
          conditions.push(eq(mergeRequests.status, input.status));
        }
        if (input.createdBy) {
          conditions.push(eq(mergeRequests.createdBy, input.createdBy));
        }
        if (input.search) {
          const needle = `%${input.search}%`;
          conditions.push(
            or(
              ilike(mergeRequests.title, needle),
              ilike(mergeRequests.description, needle),
            )!,
          );
        }

        if (ctx.context.scope.roots?.where) {
          conditions.push(ctx.context.scope.roots.where);
        }

        const whereCondition =
          conditions.length > 0 ? and(...conditions) : undefined;
        const whereClause = whereCondition
          ? sql`WHERE ${whereCondition}`
          : sql``;

        const countResult = await db.execute(sql`
          SELECT COUNT(*)::int AS count
          FROM cms.merge_requests
          INNER JOIN cms.roots ON cms.roots.id = cms.merge_requests.root_id
          ${whereClause}
        `);
        const total = parseInt(
          (countResult.rows[0] as { count: string }).count,
          10,
        );

        const enrich = userEnrichment(ctx, {
          cmsColumn: 'cms.merge_requests.created_by',
          alias: 'created_by_user',
          outputKey: 'createdByUser',
        });

        const result = await db.execute(sql`
          SELECT
            cms.merge_requests.id,
            cms.merge_requests.root_id,
            cms.merge_requests.source_branch_id,
            source_branches.name AS source_branch_name,
            cms.merge_requests.target_branch_id,
            target_branches.name AS target_branch_name,
            cms.merge_requests.source_commit_id,
            cms.merge_requests.base_commit_id,
            cms.merge_requests.merge_commit_id,
            cms.merge_requests.status,
            cms.merge_requests.title,
            cms.merge_requests.description,
            cms.merge_requests.created_by,
            cms.merge_requests.created_at,
            cms.merge_requests.updated_at,
            (
              SELECT COUNT(*)::int FROM cms.merge_conflicts mc
              WHERE mc.merge_request_id = cms.merge_requests.id
            ) AS conflict_count,
            (
              SELECT COUNT(*)::int FROM cms.comment_threads ct
              WHERE ct.merge_request_id = cms.merge_requests.id
                AND ct.deleted_at IS NULL
            ) AS comment_count
            ${enrich.select}
          FROM cms.merge_requests
          INNER JOIN cms.roots ON cms.roots.id = cms.merge_requests.root_id
          INNER JOIN cms.branches AS source_branches
            ON source_branches.id = cms.merge_requests.source_branch_id
          INNER JOIN cms.branches AS target_branches
            ON target_branches.id = cms.merge_requests.target_branch_id
          ${enrich.join}
          ${whereClause}
          ORDER BY ${orderExpr} ${dirExpr}
          LIMIT ${limit}
          OFFSET ${offset}
        `);

        // Raw-SQL row: the hand-selected column shape. Typing it lets the mapper
        // below be structurally checked against MergeRequestListItem rather than
        // blindly asserted. Timestamp/count columns stay `unknown` (coerced via
        // `new Date` / `parseInt(String(...))`).
        const rows = result.rows as Array<{
          id: string;
          root_id: string;
          source_branch_id: string;
          source_branch_name: string;
          target_branch_id: string;
          target_branch_name: string;
          source_commit_id: string;
          base_commit_id: string | null;
          merge_commit_id: string | null;
          status: 'open' | 'merged' | 'closed';
          title: string | null;
          description: string | null;
          created_by: string;
          created_at: unknown;
          updated_at: unknown;
          conflict_count: unknown;
          comment_count: unknown;
        }>;

        const items = rows.map((row) => {
          const conflictCount = parseInt(String(row.conflict_count), 10);
          const commentCount = parseInt(String(row.comment_count), 10);
          const item: MergeRequestListItem<TDef['root']['properties']> = {
            id: row.id,
            rootId: row.root_id,
            sourceBranchId: row.source_branch_id,
            sourceBranchName: row.source_branch_name,
            targetBranchId: row.target_branch_id,
            targetBranchName: row.target_branch_name,
            sourceCommitId: row.source_commit_id,
            baseCommitId: row.base_commit_id,
            mergeCommitId: row.merge_commit_id,
            status: row.status,
            title: row.title,
            description: row.description,
            createdBy: row.created_by,
            createdAt: parseTimestamp(row.created_at),
            updatedAt: parseTimestamp(row.updated_at),
            conflictCount,
            hasConflicts: conflictCount > 0,
            commentCount,
          };

          enrich.apply(item, row);

          return item;
        });

        if (ctx.context.withRoot) {
          const rootIds = [...new Set(items.map((i) => i.rootId))];
          const rootMap = await batchFetchRoots(
            db,
            rootIds,
            branchPolicy.defaultBranchName,
          );
          for (const item of items) {
            // batchFetchRoots types `properties` as the schema-less
            // `Record<string, unknown>`; the API surface narrows it to the
            // collection's typed root properties. This one leaf is the dynamic
            // JSON boundary — cast it, not the whole item.
            item.root =
              (rootMap.get(item.rootId) as
                | RootSummary<TDef['root']['properties']>
                | undefined) ?? null;
          }
        }

        const response: ListMergeRequestsResult<TDef['root']['properties']> = {
          mergeRequests: items,
          total,
          hasMore: offset + items.length < total,
        };
        return response;
      },
    ),

    /**
     * Updates title and/or description of a merge request.
     * Requires at least one field (title or description) to be provided.
     *
     * @param mergeRequestId - The merge request id.
     * @param title - New title (optional).
     * @param description - New description (optional).
     * @returns The updated merge request row, wrapped as { mergeRequest }.
     * @throws MERGE_REQUEST_NOT_FOUND if the merge request does not exist.
     * @throws MERGE_REQUEST_NOT_OPEN if the merge request is already merged or closed.
     * @example await cmsClient.pages.updateMergeRequest({ mergeRequestId: 'mr-id', title: 'Updated title' })
     */
    updateMergeRequest: createCMSEndpoint(
      `/${collectionName}/updateMergeRequest`,
      {
        method: 'POST',
        body: z.object({
          mergeRequestId: z.string(),
          title: z.string().optional(),
          description: z.string().optional(),
        }),
        metadata: cmsMeta(
          {
            $Infer: {
              body: {} as {
                mergeRequestId: string;
                title?: string;
                description?: string;
              },
            },
          },
          {
            permissionResource: 'mergeRequest',
            operation: 'update',
            scope: 'collection',
            collection: collectionName,
          },
        ),
      },
      async (ctx) => {
        const { mergeRequestId, title, description } = ctx.body;

        const mr = await loadOpenMergeRequest(db, {
          mergeRequestId,
          collectionName,
          scopeWhere: ctx.context.scope.roots?.where,
        });

        if (title === undefined && description === undefined) {
          return { mergeRequest: mr };
        }

        const updates: Record<string, unknown> = { updatedAt: new Date() };
        if (title !== undefined) updates.title = title;
        if (description !== undefined) updates.description = description;

        const [updated] = await db
          .update(mergeRequests)
          .set(updates)
          .where(eq(mergeRequests.id, mergeRequestId))
          .returning();

        return { mergeRequest: updated };
      },
    ),

    /**
     * Closes an open merge request without merging it.
     * Sends a notification to the merge request creator if closed by another user.
     *
     * @param mergeRequestId - The merge request id.
     * @param reason - Optional reason for closing.
     * @returns The updated merge request row, wrapped as { mergeRequest }.
     * @throws MERGE_REQUEST_NOT_FOUND if the merge request does not exist.
     * @throws MERGE_REQUEST_NOT_OPEN if the merge request is not in open status.
     * @example await cmsClient.pages.closeMergeRequest({ mergeRequestId: 'mr-id', reason: 'No longer needed' })
     */
    closeMergeRequest: createCMSEndpoint(
      `/${collectionName}/closeMergeRequest`,
      {
        method: 'POST',
        body: z.object({
          mergeRequestId: z.string(),
          reason: z.string().optional(),
        }),
        metadata: cmsMeta(
          {
            $Infer: {
              body: {} as { mergeRequestId: string; reason?: string },
            },
          },
          {
            permissionResource: 'mergeRequest',
            operation: 'update',
            scope: 'collection',
            collection: collectionName,
          },
        ),
      },
      async (ctx) => {
        const { mergeRequestId, reason } = ctx.body;
        const actor = ctx.context.userId;
        return withNotifications(
          db,
          cmsCtx.notificationService,
          async (tx, pending) => {
            const mr = await loadOpenMergeRequest(tx, {
              mergeRequestId,
              collectionName,
              scopeWhere: ctx.context.scope.roots?.where,
            });

            const [updated] = await tx
              .update(mergeRequests)
              .set({ status: 'closed', updatedAt: new Date() })
              .where(eq(mergeRequests.id, mergeRequestId))
              .returning();

            if (mr.createdBy !== actor) {
              pending.push({
                recipientId: mr.createdBy,
                actorId: actor ?? null,
                type: 'mergeRequestClosed',
                title: 'Your merge request was closed',
                body: mr.title ?? null,
                resourceType: 'mergeRequest',
                resourceId: mr.id,
                collection: collectionName,
                meta: {
                  mergeRequestId: mr.id,
                  rootId: mr.rootId,
                  reason: reason ?? null,
                },
              });
            }

            return { mergeRequest: updated };
          },
        );
      },
    ),

    /**
     * Reopens a closed merge request back to open status.
     * Fails if the merge request is already merged or if an open MR for the same branch pair already exists.
     *
     * @param mergeRequestId - The merge request id.
     * @returns The updated merge request row, wrapped as { mergeRequest }.
     * @throws MERGE_REQUEST_NOT_FOUND if the merge request does not exist.
     * @throws MERGE_REQUEST_ALREADY_MERGED if the merge request was already merged.
     * @throws MERGE_REQUEST_NOT_CLOSED if the merge request is still open.
     * @throws MERGE_REQUEST_ALREADY_EXISTS if another open MR exists for the same source-target pair.
     * @example await cmsClient.pages.reopenMergeRequest({ mergeRequestId: 'mr-id' })
     */
    reopenMergeRequest: createCMSEndpoint(
      `/${collectionName}/reopenMergeRequest`,
      {
        method: 'POST',
        body: z.object({ mergeRequestId: z.string() }),
        metadata: cmsMeta(
          {
            $Infer: {
              body: {} as { mergeRequestId: string },
            },
          },
          {
            permissionResource: 'mergeRequest',
            operation: 'update',
            scope: 'collection',
            collection: collectionName,
          },
        ),
      },
      async (ctx) => {
        const { mergeRequestId } = ctx.body;
        const actor = ctx.context.userId;
        return withNotifications(
          db,
          cmsCtx.notificationService,
          async (tx, pending) => {
            const mr = await loadOpenMergeRequest(tx, {
              mergeRequestId,
              collectionName,
              scopeWhere: ctx.context.scope.roots?.where,
              requireOpen: false,
            });

            if (mr.status === 'merged') {
              throw new CMSError('MERGE_REQUEST_ALREADY_MERGED');
            }
            if (mr.status === 'open') {
              throw new CMSError('MERGE_REQUEST_NOT_CLOSED');
            }

            // Preserve the "at most one open MR per source/target" invariant.
            const [conflicting] = await tx
              .select({ id: mergeRequests.id })
              .from(mergeRequests)
              .where(
                and(
                  eq(mergeRequests.sourceBranchId, mr.sourceBranchId),
                  eq(mergeRequests.targetBranchId, mr.targetBranchId),
                  eq(mergeRequests.status, 'open'),
                ),
              );
            if (conflicting) {
              throw new CMSError('MERGE_REQUEST_ALREADY_EXISTS');
            }

            let updated: typeof mergeRequests.$inferSelect;
            try {
              [updated] = await tx
                .update(mergeRequests)
                .set({ status: 'open', updatedAt: new Date() })
                .where(eq(mergeRequests.id, mergeRequestId))
                .returning();
            } catch (err: unknown) {
              if (isUniqueViolation(err, 'mr_open_source_target')) {
                throw new CMSError('MERGE_REQUEST_ALREADY_EXISTS');
              }
              throw err;
            }

            if (mr.createdBy !== actor) {
              pending.push({
                recipientId: mr.createdBy,
                actorId: actor ?? null,
                type: 'mergeRequestReopened',
                title: 'Your merge request was reopened',
                body: mr.title ?? null,
                resourceType: 'mergeRequest',
                resourceId: mr.id,
                collection: collectionName,
                meta: {
                  mergeRequestId: mr.id,
                  rootId: mr.rootId,
                },
              });
            }

            return { mergeRequest: updated };
          },
        );
      },
    ),

    /**
     * Executes a merge request, integrating all resolved conflicts into the target branch.
     * Creates a merge commit if the target has diverged since the MR was created. If the target
     * has NOT diverged, the integration depends on the merge strategy: by default it fast-forwards
     * (no merge commit), but `mergeStrategy: 'merge-commit'` (config) or `noFastForward: true`
     * (per call) force an explicit merge commit (git's `--no-ff`). A merge with nothing to integrate
     * (heads already equal) is always a no-op fast-forward. Requires all conflicts resolved. A pending
     * approval request blocks the merge by default (regardless of the governance flags); the
     * `requireApprovalToMerge` flag additionally makes an approval mandatory even when none was requested.
     *
     * @param mergeRequestId - The merge request id.
     * @param mergedBy - Optional explicit actor id; used only when ctx.context.userId is absent (context takes precedence).
     * @param message - Optional custom commit message (auto-generated if omitted).
     * @param noFastForward - Force a merge commit even when a fast-forward is possible; overrides the
     *   configured `mergeStrategy`. `false` forces a fast-forward.
     * @returns The commit envelope ({ id, message, createdAt, createdBy }) — the merge commit on a
     *   non-fast-forward, or the source head that became the new target head on a fast-forward —
     *   plus the fastForward flag, target branch id, and root id.
     * @throws MERGE_REQUEST_NOT_FOUND if the merge request does not exist.
     * @throws MERGE_REQUEST_NOT_OPEN if the merge request is not open.
     * @throws BRANCH_NOT_FOUND if either branch no longer exists.
     * @throws NO_COMMON_ANCESTOR if branches have no common commit history.
     * @throws MERGE_APPROVAL_REQUIRED if `requireApprovalToMerge` is on and no approval requests exist.
     * @throws APPROVALS_NOT_FULLY_APPROVED if an approval request exists but is not fully approved. A
     *   pending (or rejected) request blocks the merge by default, regardless of the governance flags.
     * @throws UNRESOLVED_CONFLICTS if any conflict lacks a resolution.
     * @example await cmsClient.pages.executeMerge({ mergeRequestId: 'mr-id' })
     */
    executeMerge: createCMSEndpoint(
      `/${collectionName}/executeMerge`,
      {
        method: 'POST',
        body: z.object({
          mergeRequestId: z.string(),
          mergedBy: z.string().optional(),
          message: z.string().optional(),
          noFastForward: z.boolean().optional(),
        }),
        metadata: cmsMeta(
          {
            $Infer: {
              body: {} as {
                mergeRequestId: string;
                mergedBy?: string;
                message?: string;
                // Force a merge commit even when a fast-forward is possible
                // (git's `--no-ff`). Overrides the configured `mergeStrategy`.
                noFastForward?: boolean;
              },
            },
          },
          {
            permissionResource: 'mergeRequest',
            operation: 'update',
            scope: 'collection',
            collection: collectionName,
          },
        ),
      },
      async (ctx) => {
        const { mergeRequestId, mergedBy, message, noFastForward } = ctx.body;
        const actor = ctx.context.userId ?? mergedBy;

        return withNotifications(
          db,
          cmsCtx.notificationService,
          async (tx, pending) => {
            const mr = await loadOpenMergeRequest(tx, {
              mergeRequestId,
              collectionName,
              scopeWhere: ctx.context.scope.roots?.where,
            });

            // Compute the common ancestor OFF the branch-row locks' critical
            // path. `findCommonAncestor` walks the append-only, immutable
            // `commits` DAG (it never reads the `branches` rows), and its result
            // is a pure function of the two head commit ids — so it does not
            // need the FOR UPDATE locks for correctness. Materializing both
            // heads' ancestry can be O(history); running it while holding the
            // two branch locks would block concurrent edits for that whole walk.
            //
            // Instead we read the current heads WITHOUT locking, run the walk
            // (and the approval query) while other writers can still proceed,
            // then take the locks and re-verify the heads. Under READ COMMITTED
            // (the transaction default here) the FOR UPDATE reads below observe
            // the latest committed head; if a concurrent merge/commit moved
            // either head between the unlocked read and the lock, we recompute
            // the ancestor under the lock — rare, and always correct.
            const [preSource] = await tx
              .select({ headCommitId: branches.headCommitId })
              .from(branches)
              .where(eq(branches.id, mr.sourceBranchId));
            if (!preSource) throw new CMSError('BRANCH_NOT_FOUND');

            const [preTarget] = await tx
              .select({ headCommitId: branches.headCommitId })
              .from(branches)
              .where(eq(branches.id, mr.targetBranchId));
            if (!preTarget) throw new CMSError('BRANCH_NOT_FOUND');

            const [preAncestor, approvalState] = await Promise.all([
              findCommonAncestor(
                tx,
                preSource.headCommitId,
                preTarget.headCommitId,
              ),
              getApprovalStateForMergeRequest(tx, mr.id),
            ]);

            const [sourceBranch] = await tx
              .select({
                id: branches.id,
                rootId: branches.rootId,
                name: branches.name,
                headCommitId: branches.headCommitId,
              })
              .from(branches)
              .where(eq(branches.id, mr.sourceBranchId))
              .for('update');
            if (!sourceBranch) throw new CMSError('BRANCH_NOT_FOUND');

            const [targetBranch] = await tx
              .select({
                id: branches.id,
                rootId: branches.rootId,
                name: branches.name,
                headCommitId: branches.headCommitId,
              })
              .from(branches)
              .where(eq(branches.id, mr.targetBranchId))
              .for('update');
            if (!targetBranch) throw new CMSError('BRANCH_NOT_FOUND');

            // Note: a merge is deliberately NOT gated by `protectPublishedBranches`
            // even when the target branch is published — merging is the sanctioned
            // path for updating live content (branch → edit → merge → re-publish).
            // Only DIRECT edits to a published branch are blocked (see
            // `assertBranchWritable`).

            const liveSourceCommitId = sourceBranch.headCommitId;

            // Reuse the pre-lock walk unless a concurrent writer moved a head
            // out from under us between the unlocked read and the lock.
            const ancestor =
              liveSourceCommitId === preSource.headCommitId &&
              targetBranch.headCommitId === preTarget.headCommitId
                ? preAncestor
                : await findCommonAncestor(
                    tx,
                    liveSourceCommitId,
                    targetBranch.headCommitId,
                  );

            if (!ancestor) throw new CMSError('NO_COMMON_ANCESTOR');
            const baseCommitId = ancestor.commonAncestorCommitId;

            // A fast-forward is *possible* only when the target has not diverged
            // from the common ancestor. `noFastForward` (per call) overrides the
            // configured `mergeStrategy`; either forces an explicit merge commit
            // (git's `--no-ff`). When there is nothing to merge (heads already
            // equal) we never fabricate an empty merge commit — that path stays a
            // no-op fast-forward regardless ("already up to date").
            const canFastForward = targetBranch.headCommitId === baseCommitId;
            const nothingToMerge =
              liveSourceCommitId === targetBranch.headCommitId;
            const forceMergeCommit =
              noFastForward ?? branchPolicy.mergeStrategy === 'merge-commit';
            const doFastForward =
              canFastForward && (!forceMergeCommit || nothingToMerge);

            if (branchPolicy.requireApprovalToMerge) {
              // Strict governance: an approval is mandatory before merging, even
              // when none was ever requested.
              if (!approvalState.hasRequests) {
                throw new CMSError('MERGE_APPROVAL_REQUIRED');
              }
              if (
                !approvalGatePasses(
                  approvalState,
                  branchPolicy.requiredReviewers,
                )
              ) {
                throw new CMSError('APPROVALS_NOT_FULLY_APPROVED');
              }
            } else if (
              approvalState.hasRequests &&
              !approvalGatePasses(approvalState, branchPolicy.requiredReviewers)
            ) {
              // Default (flag-independent) behavior, mirroring publishBranch: even
              // with the governance flags off, an approval request that exists but
              // is not fully approved — e.g. still PENDING — blocks the merge. If
              // someone opened an approval request, a merge must not silently
              // bypass it; only once every request is APPROVED may the merge
              // proceed.
              throw new CMSError('APPROVALS_NOT_FULLY_APPROVED');
            }

            if (doFastForward) {
              await Promise.all([
                tx
                  .update(branches)
                  .set({
                    headCommitId: liveSourceCommitId,
                    updatedAt: new Date(),
                  })
                  .where(eq(branches.id, mr.targetBranchId)),
                tx
                  .update(mergeRequests)
                  .set({
                    status: 'merged',
                    mergeCommitId: liveSourceCommitId,
                    updatedAt: new Date(),
                  })
                  .where(eq(mergeRequests.id, mergeRequestId)),
              ]);

              if (mr.createdBy !== actor) {
                pending.push({
                  recipientId: mr.createdBy,
                  actorId: actor ?? null,
                  type: 'mergeRequestMerged',
                  title: 'Your merge request was merged',
                  body: mr.title ?? null,
                  resourceType: 'mergeRequest',
                  resourceId: mr.id,
                  collection: collectionName,
                  meta: {
                    mergeRequestId: mr.id,
                    rootId: mr.rootId,
                    fastForward: true,
                  },
                });
              }

              // No new commit is written on a fast-forward — the source head
              // simply becomes the new target head. Report that commit.
              const commit = (await fetchCommitSummary(
                tx,
                liveSourceCommitId,
              ))!;

              return {
                commit,
                fastForward: true,
                rootId: mr.rootId,
                targetBranchId: mr.targetBranchId,
              };
            }

            // Build the merge commit's snapshot. When the target has NOT diverged
            // (we only reach here because a merge commit was forced), the result
            // is exactly the source tree — take it directly as a shortcut.
            // (`buildMergedSnapshot` would produce the same answer now that its
            // delete-vs-edit exclusion is gated on a live base version, but the
            // wholesale copy skips loading two extra snapshots.)
            let mergedVersionMap: Map<string, string>;
            if (canFastForward) {
              const sourceSnapshot = await loadBlocksAtCommit(
                tx,
                liveSourceCommitId,
                sourceBranch.rootId,
              );
              mergedVersionMap = new Map(
                Array.from(sourceSnapshot.blocks.entries())
                  .filter(([, block]) => !block.deleted)
                  .map(([blockId, block]) => [blockId, block.blockVersionId]),
              );
            } else {
              const [baseSnapshot, sourceSnapshot, targetSnapshot] =
                await Promise.all([
                  loadBlocksAtCommit(tx, baseCommitId, sourceBranch.rootId),
                  loadBlocksAtCommit(
                    tx,
                    liveSourceCommitId,
                    sourceBranch.rootId,
                  ),
                  loadBlocksAtCommit(
                    tx,
                    targetBranch.headCommitId,
                    targetBranch.rootId,
                  ),
                ]);

              const freshConflicts = detectConflicts(
                baseSnapshot.blocks,
                sourceSnapshot.blocks,
                targetSnapshot.blocks,
              );

              const existingResolutions = await tx
                .select({
                  blockId: mergeConflicts.blockId,
                  resolution: mergeConflicts.resolution,
                  resolvedVersionId: mergeConflicts.resolvedVersionId,
                })
                .from(mergeConflicts)
                .where(eq(mergeConflicts.mergeRequestId, mergeRequestId));

              const resolutionMap = new Map<
                string,
                (typeof existingResolutions)[0]
              >();
              for (const r of existingResolutions) {
                resolutionMap.set(r.blockId, r);
              }

              for (const conflict of freshConflicts) {
                const resolution = resolutionMap.get(conflict.blockId);
                if (!resolution || !resolution.resolution) {
                  throw new CMSError('UNRESOLVED_CONFLICTS');
                }
              }

              const resolutions: MergeResolution[] = [];
              for (const conflict of freshConflicts) {
                const resolution = resolutionMap.get(conflict.blockId)!;
                let resolvedVersionId: string | null;

                if (resolution.resolution === 'source') {
                  resolvedVersionId = conflict.sourceVersionId;
                } else if (resolution.resolution === 'target') {
                  resolvedVersionId = conflict.targetVersionId;
                } else {
                  resolvedVersionId = resolution.resolvedVersionId!;
                }

                if (resolvedVersionId) {
                  resolutions.push({
                    blockId: conflict.blockId,
                    resolvedVersionId,
                  });
                }
              }

              mergedVersionMap = buildMergedSnapshot(
                baseSnapshot.blocks,
                sourceSnapshot.blocks,
                targetSnapshot.blocks,
                resolutions,
              );
            }

            const [mergeCommit] = await tx
              .insert(commits)
              .values({
                rootId: sourceBranch.rootId,
                parentCommitId: targetBranch.headCommitId,
                mergeSourceCommitId: liveSourceCommitId,
                message:
                  message ??
                  `Merge ${sourceBranch.name} into ${targetBranch.name}`,
                createdBy: actor,
                // The merge commit is created on the target branch.
                branchId: mr.targetBranchId,
                originBranchName: targetBranch.name,
              })
              .returning();

            const snapshotRows = Array.from(mergedVersionMap.entries()).map(
              ([blockId, bvId]) => ({
                commitId: mergeCommit.id,
                blockId,
                blockVersionId: bvId,
              }),
            );

            if (snapshotRows.length > 0) {
              await tx.insert(commitSnapshots).values(snapshotRows);
            }

            await Promise.all([
              tx
                .update(branches)
                .set({
                  headCommitId: mergeCommit.id,
                  updatedAt: new Date(),
                })
                .where(eq(branches.id, mr.targetBranchId)),
              tx
                .update(mergeRequests)
                .set({
                  status: 'merged',
                  mergeCommitId: mergeCommit.id,
                  updatedAt: new Date(),
                })
                .where(eq(mergeRequests.id, mergeRequestId)),
            ]);

            if (mr.createdBy !== actor) {
              pending.push({
                recipientId: mr.createdBy,
                actorId: actor ?? null,
                type: 'mergeRequestMerged',
                title: 'Your merge request was merged',
                body: mr.title ?? null,
                resourceType: 'mergeRequest',
                resourceId: mr.id,
                collection: collectionName,
                meta: {
                  mergeRequestId: mr.id,
                  mergeCommitId: mergeCommit.id,
                  rootId: mr.rootId,
                  fastForward: false,
                },
              });
            }

            return {
              commit: {
                id: mergeCommit.id,
                message: mergeCommit.message,
                createdAt: mergeCommit.createdAt,
                createdBy: mergeCommit.createdBy,
              },
              fastForward: false,
              rootId: mr.rootId,
              targetBranchId: mr.targetBranchId,
            };
          },
        );
      },
    ),

    /**
     * Creates a new block version to resolve a merge conflict manually (third-way resolution).
     * The version is persisted and available for the conflict resolution; becomes live once the merge is executed.
     *
     * @param mergeRequestId - The merge request id.
     * @param blockId - The block id with a conflict.
     * @param type - The block type (inferred from collection schema).
     * @param properties - Block properties object.
     * @param children - Optional array of child block ids.
     * @returns The created block version id.
     * @throws MERGE_REQUEST_NOT_FOUND if the merge request does not exist.
     * @throws CONFLICT_NOT_FOUND if no conflict exists for the given block in this MR.
     * @throws BRANCH_NOT_FOUND if the source branch is not found.
     * @example await cmsClient.pages.createMergeBlockVersion({ mergeRequestId: 'mr-id', blockId: 'b-id', type: 'card', properties: { ... } })
     */
    createMergeBlockVersion: createCMSEndpoint(
      `/${collectionName}/createMergeBlockVersion`,
      {
        method: 'POST',
        body: buildMergeBlockVersionInputSchema(
          def.blocks,
          def.root.properties,
        ),
        metadata: cmsMeta(
          {
            $Infer: {
              body: {} as InferMergeBlockVersionInput<
                TDef['blocks'],
                TDef['root']['properties']
              >,
            },
          },
          {
            permissionResource: 'mergeRequest',
            operation: 'create',
            scope: 'collection',
            collection: collectionName,
          },
        ),
      },
      async (ctx) => {
        const { mergeRequestId, blockId, type, children } = ctx.body;
        const properties = ctx.body.properties as Record<string, unknown>;
        const actor = ctx.context.userId;

        return db.transaction(async (tx) => {
          const mr = await loadOpenMergeRequest(tx, {
            mergeRequestId,
            collectionName,
            scopeWhere: ctx.context.scope.roots?.where,
          });

          const [conflict] = await tx
            .select({ id: mergeConflicts.id })
            .from(mergeConflicts)
            .where(
              and(
                eq(mergeConflicts.mergeRequestId, mergeRequestId),
                eq(mergeConflicts.blockId, blockId),
              ),
            );
          if (!conflict) throw new CMSError('CONFLICT_NOT_FOUND');

          const [sourceBranch] = await tx
            .select({
              headCommitId: branches.headCommitId,
              name: branches.name,
            })
            .from(branches)
            .where(eq(branches.id, mr.sourceBranchId));
          if (!sourceBranch) throw new CMSError('BRANCH_NOT_FOUND');

          const [resolutionCommit] = await tx
            .insert(commits)
            .values({
              rootId: mr.rootId,
              parentCommitId: sourceBranch.headCommitId,
              message: `Manual merge resolution for block ${blockId}`,
              createdBy: actor,
              // The resolution commit is created on the source branch.
              branchId: mr.sourceBranchId,
              originBranchName: sourceBranch.name,
            })
            .returning();

          const storedType = type === 'root' ? collectionName : type;

          const [version] = await tx
            .insert(blockVersions)
            .values({
              blockId,
              rootId: mr.rootId,
              commitId: resolutionCommit.id,
              type: storedType,
              properties,
              children: children ?? [],
            })
            .returning();

          // Index the resolved version's asset/variable references — this is the
          // THIRD block-version insert site (besides commit-writer's two). It
          // becomes the live head version once the merge is executed, so it must
          // populate the same indexes or the GC would not see its references.
          await indexVersionContent(
            tx,
            mr.rootId,
            [
              {
                blockVersionId: version.id,
                blockId,
                type: storedType,
                properties,
              },
            ],
            def,
          );

          return { blockVersionId: version.id };
        });
      },
    ),

    /**
     * Marks one or more merge conflicts as resolved, specifying which version to keep (source, target, or manual).
     * Manual resolutions must reference an existing block version (created by createMergeBlockVersion or preexisting).
     *
     * @param mergeRequestId - The merge request id.
     * @param resolutions - Non-empty array of conflict resolutions.
     * @returns Array of resolved conflicts (with resolved timestamp) and remaining unresolved count.
     * @throws MERGE_REQUEST_NOT_FOUND if the merge request does not exist.
     * @throws MERGE_REQUEST_NOT_OPEN if the merge request is not open.
     * @throws CONFLICT_NOT_FOUND if any conflict id does not belong to this MR.
     * @throws RESOLVED_VERSION_NOT_FOUND if a manual resolution references a non-existent version.
     * @example await cmsClient.pages.applyConflictResolutions({ mergeRequestId: 'mr-id', resolutions: [{ conflictId: 'c-id', resolution: 'source', resolvedBy: 'user-id' }] })
     */
    applyConflictResolutions: createCMSEndpoint(
      `/${collectionName}/applyConflictResolutions`,
      {
        method: 'POST',
        body: z.object({
          mergeRequestId: z.string(),
          resolutions: z
            .array(
              z.object({
                conflictId: z.string(),
                resolution: conflictResolutionSchema,
                resolvedVersionId: z.string().optional(),
                resolvedBy: z.string(),
              }),
            )
            .min(1),
        }),
        metadata: cmsMeta(
          {
            $Infer: {
              body: {} as {
                mergeRequestId: string;
                resolutions: Array<{
                  conflictId: string;
                  resolution: z.infer<typeof conflictResolutionSchema>;
                  resolvedVersionId?: string;
                  resolvedBy: string;
                }>;
              },
            },
          },
          {
            permissionResource: 'mergeRequest',
            operation: 'update',
            scope: 'collection',
            collection: collectionName,
          },
        ),
      },
      async (ctx) => {
        const { mergeRequestId, resolutions } = ctx.body;

        return db.transaction(async (tx) => {
          await loadOpenMergeRequest(tx, {
            mergeRequestId,
            collectionName,
            scopeWhere: ctx.context.scope.roots?.where,
          });

          const conflictIds = resolutions.map((r) => r.conflictId);
          const conflicts = await tx
            .select({
              id: mergeConflicts.id,
              blockId: mergeConflicts.blockId,
              sourceVersionId: mergeConflicts.sourceVersionId,
              targetVersionId: mergeConflicts.targetVersionId,
            })
            .from(mergeConflicts)
            .where(
              and(
                eq(mergeConflicts.mergeRequestId, mergeRequestId),
                inArray(mergeConflicts.id, conflictIds),
              ),
            )
            .for('update');

          const conflictMap = new Map(conflicts.map((c) => [c.id, c]));
          for (const r of resolutions) {
            if (!conflictMap.has(r.conflictId)) {
              throw new CMSError('CONFLICT_NOT_FOUND');
            }
          }

          const manualVersionIds = resolutions
            .filter((r) => r.resolution === 'manual' && r.resolvedVersionId)
            .map((r) => r.resolvedVersionId!);

          if (manualVersionIds.length > 0) {
            const existingVersions = await tx
              .select({ id: blockVersions.id })
              .from(blockVersions)
              .where(inArray(blockVersions.id, manualVersionIds));

            const existingSet = new Set(existingVersions.map((v) => v.id));
            for (const vid of manualVersionIds) {
              if (!existingSet.has(vid)) {
                throw new CMSError('RESOLVED_VERSION_NOT_FOUND');
              }
            }
          }

          const now = new Date();

          const updatePromises = resolutions.map((r) => {
            const conflict = conflictMap.get(r.conflictId)!;

            let resolvedVersionId: string | null = null;
            if (r.resolution === 'source') {
              resolvedVersionId = conflict.sourceVersionId;
            } else if (r.resolution === 'target') {
              resolvedVersionId = conflict.targetVersionId;
            } else {
              if (!r.resolvedVersionId) {
                throw new CMSError('RESOLVED_VERSION_NOT_FOUND');
              }
              resolvedVersionId = r.resolvedVersionId;
            }

            return tx
              .update(mergeConflicts)
              .set({
                resolution: r.resolution,
                resolvedVersionId,
                resolvedBy: r.resolvedBy,
                resolvedAt: now,
              })
              .where(eq(mergeConflicts.id, r.conflictId))
              .returning()
              .then(([updated]) => updated);
          });

          const resolved = await Promise.all(updatePromises);

          const [{ count }] = await tx
            .select({
              count: sql<number>`count(*)`.mapWith(Number),
            })
            .from(mergeConflicts)
            .where(
              and(
                eq(mergeConflicts.mergeRequestId, mergeRequestId),
                sql`${mergeConflicts.resolution} IS NULL`,
              ),
            );

          await tx
            .update(mergeRequests)
            .set({ updatedAt: now })
            .where(eq(mergeRequests.id, mergeRequestId));

          return {
            resolved: resolved.map((c) => ({
              ...c,
              resolvedAt: c.resolvedAt ? new Date(c.resolvedAt) : null,
              createdAt: new Date(c.createdAt),
            })),
            remainingUnresolved: count,
          };
        });
      },
    ),
  };
}
