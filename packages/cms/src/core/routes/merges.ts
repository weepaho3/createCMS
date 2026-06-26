import { and, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import * as z from 'zod';

import type { NotificationInput } from '../notifications/types';
import type {
  CollectionWithName,
  CMSProcedureCtx,
  InferMergeBlockVersionInput,
  ListMergeRequestsResult,
} from '../types';
import type { DrizzleInstance } from '../types/drizzle';

import {
  loadBlocksAtCommit,
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
  roots,
} from '../db/schema.generated';
import { cmsMeta, createCMSEndpoint } from '../endpoint';
import { CMSError } from '../errors';
import { flushNotifications } from '../notifications/service';
import { batchFetchRoots } from '../root/batch-fetch';
import { buildMergeBlockVersionInputSchema } from '../schema-builders';
import { userEnrichment } from '../user/enrichment';
import { getApprovalStateForMergeRequest } from './approvals';
import {
  findCommonAncestor,
  loadBranchPair,
  loadMergeSnapshots,
  loadOpenMergeRequest,
} from './merge-context';

const changeTypeEnum = z.enum([
  'added',
  'deleted',
  'modified',
  'moved',
  'childrenReordered',
]);

type ChangeType = z.infer<typeof changeTypeEnum>;

const conflictResolutionSchema = z.enum(['source', 'target', 'manual']);

type ParentInfo = { parentId: string; index: number };

function buildParentMap(
  blocks: Map<string, ReconstructedBlock>,
): Map<string, ParentInfo> {
  const parentOf = new Map<string, ParentInfo>();
  for (const block of blocks.values()) {
    if (block.deleted) continue;
    for (let i = 0; i < block.children.length; i++) {
      parentOf.set(block.children[i], { parentId: block.blockId, index: i });
    }
  }
  return parentOf;
}

function childrenEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function propertiesEqual(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    const valA = a[key];
    const valB = b[key];
    if (
      typeof valA === 'object' &&
      valA !== null &&
      typeof valB === 'object' &&
      valB !== null
    ) {
      if (
        !propertiesEqual(
          valA as Record<string, unknown>,
          valB as Record<string, unknown>,
        )
      ) {
        return false;
      }
    } else if (valA !== valB) {
      return false;
    }
  }
  return true;
}

function blockToOutput(block: ReconstructedBlock | undefined) {
  return block ?? null;
}

function classifyChanges(
  baseBlocks: Map<string, ReconstructedBlock>,
  sourceBlocks: Map<string, ReconstructedBlock>,
  targetBlocks: Map<string, ReconstructedBlock>,
) {
  const baseParentOf = buildParentMap(baseBlocks);
  const sourceParentOf = buildParentMap(sourceBlocks);

  const allBlockIds = new Set<string>();
  for (const id of baseBlocks.keys()) allBlockIds.add(id);
  for (const id of sourceBlocks.keys()) allBlockIds.add(id);

  const diff: Array<{
    blockId: string;
    changeTypes: ChangeType[];
    sourceVersion: ReconstructedBlock | null;
    targetVersion: ReconstructedBlock | null;
    baseVersion: ReconstructedBlock | null;
  }> = [];

  for (const blockId of allBlockIds) {
    const base = baseBlocks.get(blockId);
    const source = sourceBlocks.get(blockId);
    const changeTypes: ChangeType[] = [];

    const baseAlive = base && !base.deleted;
    const sourceAlive = source && !source.deleted;

    if (sourceAlive && !baseAlive) changeTypes.push('added');
    if (baseAlive && !sourceAlive) changeTypes.push('deleted');

    if (baseAlive && sourceAlive) {
      if (
        source.type !== base.type ||
        !propertiesEqual(source.properties, base.properties)
      ) {
        changeTypes.push('modified');
      }
    }

    if (baseAlive && sourceAlive) {
      const baseParent = baseParentOf.get(blockId);
      const sourceParent = sourceParentOf.get(blockId);

      if (baseParent && sourceParent) {
        if (
          baseParent.parentId !== sourceParent.parentId ||
          baseParent.index !== sourceParent.index
        ) {
          changeTypes.push('moved');
        }
      } else if (baseParent && !sourceParent) {
        changeTypes.push('moved');
      } else if (!baseParent && sourceParent) {
        changeTypes.push('moved');
      }
    }

    if (baseAlive && sourceAlive) {
      if (!childrenEqual(base.children, source.children)) {
        changeTypes.push('childrenReordered');
      }
    }

    if (changeTypes.length > 0) {
      diff.push({
        blockId,
        changeTypes,
        sourceVersion: blockToOutput(source),
        targetVersion: blockToOutput(targetBlocks.get(blockId)),
        baseVersion: blockToOutput(base),
      });
    }
  }

  return diff;
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
 *   drops the now-dangling child reference on its (surviving) parent.
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

    if (resolutionMap.has(blockId)) {
      merged.set(blockId, resolutionMap.get(blockId)!);
      continue;
    }

    if (sourceDeleted && targetDeleted) continue;
    if (sourceDeleted && !targetDeleted && targetVid === baseVid) continue;
    if (targetDeleted && !sourceDeleted && sourceVid === baseVid) continue;

    if (
      (sourceDeleted && !targetDeleted && targetVid !== baseVid) ||
      (targetDeleted && !sourceDeleted && sourceVid !== baseVid)
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

    if (!base && !target && source && !sourceDeleted && sourceVid) {
      merged.set(blockId, sourceVid);
      continue;
    }

    if (!base && !source && target && !targetDeleted && targetVid) {
      merged.set(blockId, targetVid);
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
  cmsCtx: CMSProcedureCtx,
) {
  const { db } = cmsCtx;
  const collectionName = def.name;
  const branchPolicy = resolveBranchPolicy(cmsCtx, def.branchProtection);

  return {
    /**
     * Compares two branches and returns a changeset of blocks that differ between source and target.
     *
     * @param sourceBranchId - The source branch id.
     * @param targetBranchId - The target branch id.
     * @returns A diff array (each entry lists changeTypes: added, deleted, modified, moved, childrenReordered) plus commit ids.
     * @throws BRANCH_NOT_FOUND if either branch does not exist in this collection.
     * @throws BRANCHES_NOT_SAME_ROOT if the branches are from different roots.
     * @example await cmsClient.pages.getDiff({ sourceBranchId: 'src-id', targetBranchId: 'tgt-id' })
     */
    getDiff: createCMSEndpoint(
      `/${collectionName}/getDiff`,
      {
        method: 'POST',
        body: z.object({
          sourceBranchId: z.string(),
          targetBranchId: z.string(),
        }),
        metadata: cmsMeta(
          {
            $Infer: {
              body: {} as { sourceBranchId: string; targetBranchId: string },
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
        const { sourceBranchId, targetBranchId } = ctx.body;

        const { sourceBranch, targetBranch } = await loadBranchPair(db, {
          sourceBranchId,
          targetBranchId,
          collectionName,
          scopeWhere: ctx.context.scope.roots?.where,
        });

        const { ancestor, baseSnapshot, sourceSnapshot, targetSnapshot } =
          await loadMergeSnapshots(db, sourceBranch, targetBranch);

        const diff = classifyChanges(
          baseSnapshot.blocks,
          sourceSnapshot.blocks,
          targetSnapshot.blocks,
        );

        return {
          diff,
          sourceCommitId: sourceBranch.headCommitId,
          targetCommitId: targetBranch.headCommitId,
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
        method: 'POST',
        body: z.object({
          sourceBranchId: z.string(),
          targetBranchId: z.string(),
        }),
        metadata: cmsMeta(
          {
            $Infer: {
              body: {} as { sourceBranchId: string; targetBranchId: string },
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
        const { sourceBranchId, targetBranchId } = ctx.body;

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
     * @param createdBy - Optional user id; defaults to ctx.context.userId.
     * @returns Merge request id, conflicts array, and hasConflicts flag.
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

        const pending: NotificationInput[] = [];

        return db
          .transaction(async (tx) => {
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
              const pgErr = err as { code?: string; constraint?: string };
              if (
                pgErr.code === '23505' &&
                pgErr.constraint?.includes('mr_open_source_target')
              ) {
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
              mergeRequestId: mr.id,
              hasConflicts: conflicts.length > 0,
              conflicts,
            };
          })
          .then((result) => {
            flushNotifications(cmsCtx.notificationService, pending);
            return result;
          });
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

        // Exclude merge requests whose root was soft-deleted (deleteRoot sets
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

        const items = (result.rows as Array<Record<string, unknown>>).map(
          (row) => {
            const conflictCount = parseInt(String(row.conflict_count), 10);
            const commentCount = parseInt(String(row.comment_count), 10);
            const item: Record<string, unknown> = {
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
              createdAt: new Date(row.created_at as string),
              updatedAt: new Date(row.updated_at as string),
              conflictCount,
              hasConflicts: conflictCount > 0,
              commentCount,
            };

            enrich.apply(item, row);

            return item;
          },
        );

        if (ctx.context.withRoot) {
          const rootIds = [...new Set(items.map((i) => i.rootId as string))];
          const rootMap = await batchFetchRoots(
            db,
            rootIds,
            branchPolicy.defaultBranchName,
          );
          for (const item of items) {
            item.root = rootMap.get(item.rootId as string) ?? null;
          }
        }

        return {
          mergeRequests: items,
          total,
          hasMore: offset + items.length < total,
        } as unknown as ListMergeRequestsResult<TDef['root']['properties']>;
      },
    ),

    /**
     * Updates title and/or description of a merge request.
     * Requires at least one field (title or description) to be provided.
     *
     * @param mergeRequestId - The merge request id.
     * @param title - New title (optional).
     * @param description - New description (optional).
     * @returns The updated merge request row.
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
          return mr;
        }

        const updates: Record<string, unknown> = { updatedAt: new Date() };
        if (title !== undefined) updates.title = title;
        if (description !== undefined) updates.description = description;

        const [updated] = await db
          .update(mergeRequests)
          .set(updates)
          .where(eq(mergeRequests.id, mergeRequestId))
          .returning();

        return updated;
      },
    ),

    /**
     * Closes an open merge request without merging it.
     * Sends a notification to the merge request creator if closed by another user.
     *
     * @param mergeRequestId - The merge request id.
     * @param reason - Optional reason for closing.
     * @returns The updated merge request row.
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
        const pending: NotificationInput[] = [];

        return db
          .transaction(async (tx) => {
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

            return updated;
          })
          .then((result) => {
            flushNotifications(cmsCtx.notificationService, pending);
            return result;
          });
      },
    ),

    /**
     * Reopens a closed merge request back to open status.
     * Fails if the merge request is already merged or if an open MR for the same branch pair already exists.
     *
     * @param mergeRequestId - The merge request id.
     * @returns The updated merge request row.
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
        const pending: NotificationInput[] = [];

        return db
          .transaction(async (tx) => {
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
              const pgErr = err as { code?: string; constraint?: string };
              if (
                pgErr.code === '23505' &&
                pgErr.constraint?.includes('mr_open_source_target')
              ) {
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

            return updated;
          })
          .then((result) => {
            flushNotifications(cmsCtx.notificationService, pending);
            return result;
          });
      },
    ),

    /**
     * Executes a merge request, integrating all resolved conflicts into the target branch.
     * Creates a merge commit if the target has diverged since the MR was created. If the target
     * has NOT diverged, the integration depends on the merge strategy: by default it fast-forwards
     * (no merge commit), but `mergeStrategy: 'merge-commit'` (config) or `noFastForward: true`
     * (per call) force an explicit merge commit (git's `--no-ff`). A merge with nothing to integrate
     * (heads already equal) is always a no-op fast-forward. Requires all approvals granted and all
     * conflicts resolved.
     *
     * @param mergeRequestId - The merge request id.
     * @param mergedBy - Optional user id; defaults to ctx.context.userId.
     * @param message - Optional custom commit message (auto-generated if omitted).
     * @param noFastForward - Force a merge commit even when a fast-forward is possible; overrides the
     *   configured `mergeStrategy`. `false` forces a fast-forward.
     * @returns The merge commit id, fastForward flag, target branch id, and root id.
     * @throws MERGE_REQUEST_NOT_FOUND if the merge request does not exist.
     * @throws MERGE_REQUEST_NOT_OPEN if the merge request is not open.
     * @throws BRANCH_NOT_FOUND if either branch no longer exists.
     * @throws NO_COMMON_ANCESTOR if branches have no common commit history.
     * @throws MERGE_APPROVAL_REQUIRED if no approval requests exist.
     * @throws APPROVALS_NOT_FULLY_APPROVED if not all approval requests are approved.
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

        const pending: NotificationInput[] = [];

        return db
          .transaction(async (tx) => {
            const mr = await loadOpenMergeRequest(tx, {
              mergeRequestId,
              collectionName,
              scopeWhere: ctx.context.scope.roots?.where,
            });

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

            const [ancestor, approvalState] = await Promise.all([
              findCommonAncestor(
                tx,
                liveSourceCommitId,
                targetBranch.headCommitId,
              ),
              getApprovalStateForMergeRequest(tx, mr.id),
            ]);

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

              return {
                mergeCommitId: null,
                fastForward: true,
                rootId: mr.rootId,
                targetBranchId: mr.targetBranchId,
              };
            }

            // Build the merge commit's snapshot. When the target has NOT diverged
            // (we only reach here because a merge commit was forced), the result
            // is exactly the source tree — take it directly. The three-way
            // `buildMergedSnapshot` must NOT run here: its "block absent on the
            // target means deleted" heuristic would drop blocks the source added,
            // since an un-diverged target legitimately lacks them.
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
              mergeCommitId: mergeCommit.id,
              fastForward: false,
              rootId: mr.rootId,
              targetBranchId: mr.targetBranchId,
            };
          })
          .then((result) => {
            flushNotifications(cmsCtx.notificationService, pending);
            return result;
          });
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
     * @example await cmsClient.pages.resolveConflicts({ mergeRequestId: 'mr-id', resolutions: [{ conflictId: 'c-id', resolution: 'source', resolvedBy: 'user-id' }] })
     */
    resolveConflicts: createCMSEndpoint(
      `/${collectionName}/resolveConflicts`,
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
          const mr = await loadOpenMergeRequest(tx, {
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
