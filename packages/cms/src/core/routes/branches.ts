import { and, eq, inArray, or, sql } from 'drizzle-orm';
import * as z from 'zod';

import type {
  BranchListItem,
  CollectionWithName,
  CMSProcedureCtx,
  ListBranchesResult,
} from '../types';
import type { DrizzleInstance } from '../types/drizzle';

import { assertBranchWritable, requireRootInScope } from '../blocks/guards';
import { loadBlocksAtCommit } from '../blocks/reconstruct-snapshot';
import { resolveBranchPolicy } from '../branch-policy';
import {
  branches,
  commitSnapshots,
  commits,
  mergeRequests,
  publications,
  roots,
} from '../db/schema.generated';
import { cmsMeta, createCMSEndpoint } from '../endpoint';
import { CMSError } from '../errors';
import { userEnrichment } from '../user/enrichment';
import { parseTimestamp } from '../utils/parse-timestamp';

type Branch = typeof branches.$inferSelect;

async function getBranchState(
  db: DrizzleInstance,
  branchIds: string[],
): Promise<{
  published: Set<string>;
  openMergeRequests: Set<string>;
}> {
  if (branchIds.length === 0) {
    return {
      published: new Set(),
      openMergeRequests: new Set(),
    };
  }

  const [pubs, mrs] = await Promise.all([
    db
      .select({ branchId: publications.branchId })
      .from(publications)
      .where(inArray(publications.branchId, branchIds)),
    db
      .select({
        sourceBranchId: mergeRequests.sourceBranchId,
        targetBranchId: mergeRequests.targetBranchId,
      })
      .from(mergeRequests)
      .where(
        and(
          eq(mergeRequests.status, 'open'),
          or(
            inArray(mergeRequests.sourceBranchId, branchIds),
            inArray(mergeRequests.targetBranchId, branchIds),
          ),
        ),
      ),
  ]);

  const published = new Set<string>();
  for (const pub of pubs) published.add(pub.branchId);

  const openMergeRequests = new Set<string>();
  for (const mr of mrs) {
    if (branchIds.includes(mr.sourceBranchId)) {
      openMergeRequests.add(mr.sourceBranchId);
    }
    if (branchIds.includes(mr.targetBranchId)) {
      openMergeRequests.add(mr.targetBranchId);
    }
  }

  return { published, openMergeRequests };
}

async function checkDeletable(
  db: DrizzleInstance,
  branchIds: string[],
): Promise<Set<string>> {
  const state = await getBranchState(db, branchIds);
  return new Set([...state.published, ...state.openMergeRequests]);
}

function withIsDeletable(
  branch: Branch,
  nonDeletable: Set<string>,
  defaultBranchName: string,
): Branch & { isDeletable: boolean } {
  return {
    ...branch,
    isDeletable:
      branch.name !== defaultBranchName && !nonDeletable.has(branch.id),
  };
}

export function createBranchEndpoints<TDef extends CollectionWithName>(
  def: TDef,
  cmsCtx: CMSProcedureCtx,
) {
  const { db } = cmsCtx;
  const collectionName = def.name;
  const branchPolicy = resolveBranchPolicy(cmsCtx, def.branchProtection);

  return {
    /**
     * Retrieves a single branch with its metadata and deletability state.
     * @param branchId The branch ID to fetch.
     * @returns Branch data with id, rootId, name, headCommitId, createdBy, createdAt, updatedAt, isDeletable flag, and optionally createdByUser.
     * @throws BRANCH_NOT_FOUND if the branch does not exist or is outside the current scope.
     * @example await cmsClient.pages.getBranch({ branchId: 'br_abc123' })
     */
    getBranch: createCMSEndpoint(
      `/${collectionName}/getBranch`,
      {
        method: 'GET',
        query: z.object({ branchId: z.string() }),
        metadata: cmsMeta(
          {
            $Infer: {
              query: {} as { branchId: string },
            },
          },
          {
            permissionResource: 'branch',
            operation: 'read',
            scope: 'collection',
            collection: collectionName,
          },
        ),
      },
      async (ctx) => {
        const enrich = userEnrichment(ctx, {
          cmsColumn: 'cms.branches.created_by',
          alias: 'branch_user',
          outputKey: 'createdByUser',
        });

        const rows = await db.execute(sql`
          SELECT
            ${branches.id},
            ${branches.rootId} AS root_id,
            ${branches.name},
            ${branches.headCommitId} AS head_commit_id,
            ${branches.createdBy} AS created_by,
            ${branches.createdAt} AS created_at,
            ${branches.updatedAt} AS updated_at
            ${enrich.select}
          FROM ${branches}
          INNER JOIN ${roots} ON ${roots.id} = ${branches.rootId}
          ${enrich.join}
          WHERE ${branches.id} = ${ctx.query.branchId}
            AND ${roots.collection} = ${collectionName}
            ${ctx.context.scope.roots?.where ? sql`AND ${ctx.context.scope.roots.where}` : sql``}
        `);

        const row = rows.rows[0] as Record<string, unknown> | undefined;
        if (!row) throw new CMSError('BRANCH_NOT_FOUND');

        const branch: Branch = {
          id: row.id as string,
          rootId: row.root_id as string,
          name: row.name as string,
          headCommitId: row.head_commit_id as string,
          createdBy: (row.created_by as string | null) ?? null,
          createdAt: parseTimestamp(row.created_at),
          updatedAt: parseTimestamp(row.updated_at),
        };

        const result: Record<string, unknown> = {
          ...withIsDeletable(
            branch,
            await checkDeletable(db, [branch.id]),
            branchPolicy.defaultBranchName,
          ),
        };

        enrich.apply(result, row);

        return result;
      },
    ),

    /**
     * Lists all branches for a given root with pagination, search, and filtering by publication/merge-request state.
     * @param rootId The root ID whose branches to list (required).
     * @param limit Maximum branches per page (1–100, default 20).
     * @param offset Result offset for pagination (default 0).
     * @param search Optional substring filter on branch name (case-insensitive).
     * @param isDeletable Filter: true = only deletable branches (not main, no publications/open MRs), false = only protected branches.
     * @param hasPublications Filter by branches with (true) or without (false) any publications.
     * @param hasOpenMergeRequests Filter by branches with (true) or without (false) open merge requests.
     * @returns Paginated array of branch items, total count, and hasMore flag.
     * @example await cmsClient.pages.listBranches({ rootId: 'root_123', limit: 50 })
     */
    listBranches: createCMSEndpoint(
      `/${collectionName}/listBranches`,
      {
        method: 'GET',
        query: z.object({
          rootId: z.string(),
          limit: z.coerce.number().min(1).max(100).optional(),
          offset: z.coerce.number().min(0).optional(),
          search: z.string().optional(),
          isDeletable: z.coerce.boolean().optional(),
          hasPublications: z.coerce.boolean().optional(),
          hasOpenMergeRequests: z.coerce.boolean().optional(),
        }),
        metadata: cmsMeta(
          {
            $Infer: {
              query: {} as {
                rootId: string;
                limit?: number;
                offset?: number;
                search?: string;
                isDeletable?: boolean;
                hasPublications?: boolean;
                hasOpenMergeRequests?: boolean;
              },
            },
          },
          {
            permissionResource: 'branch',
            operation: 'read',
            scope: 'collection',
            collection: collectionName,
          },
        ),
      },
      async (ctx) => {
        const input = ctx.query;
        const limit = input.limit ?? 20;
        const offset = input.offset ?? 0;

        await requireRootInScope(
          db,
          input.rootId,
          collectionName,
          ctx.context.scope.roots,
        );

        const conditions: ReturnType<typeof sql>[] = [
          sql`${branches.rootId} = ${input.rootId}`,
        ];

        if (input.search) {
          conditions.push(
            sql`LOWER(${branches.name}) LIKE ${`%${input.search.toLowerCase()}%`}`,
          );
        }

        const hasPubSubquery = sql`EXISTS (SELECT 1 FROM ${publications} WHERE ${publications.branchId} = ${branches.id})`;
        const hasOpenMrSubquery = sql`EXISTS (
          SELECT 1 FROM ${mergeRequests}
          WHERE ${mergeRequests.status} = 'open'
            AND (${mergeRequests.sourceBranchId} = ${branches.id} OR ${mergeRequests.targetBranchId} = ${branches.id})
        )`;

        if (input.hasPublications === true) {
          conditions.push(hasPubSubquery);
        } else if (input.hasPublications === false) {
          conditions.push(sql`NOT ${hasPubSubquery}`);
        }

        if (input.hasOpenMergeRequests === true) {
          conditions.push(hasOpenMrSubquery);
        } else if (input.hasOpenMergeRequests === false) {
          conditions.push(sql`NOT ${hasOpenMrSubquery}`);
        }

        if (input.isDeletable === true) {
          conditions.push(
            sql`${branches.name} != ${branchPolicy.defaultBranchName}`,
          );
          conditions.push(sql`NOT ${hasPubSubquery}`);
          conditions.push(sql`NOT ${hasOpenMrSubquery}`);
        } else if (input.isDeletable === false) {
          conditions.push(sql`(
            ${branches.name} = ${branchPolicy.defaultBranchName}
            OR ${hasPubSubquery}
            OR ${hasOpenMrSubquery}
          )`);
        }

        const whereClause = sql.join(conditions, sql` AND `);

        const enrich = userEnrichment(ctx, {
          cmsColumn: 'cms.branches.created_by',
          alias: 'branch_user',
          outputKey: 'createdByUser',
        });

        const [countResult, rows] = await Promise.all([
          db.execute(
            sql`SELECT COUNT(*)::int AS count FROM ${branches} WHERE ${whereClause}`,
          ),
          db.execute(sql`
            SELECT ${branches.id}, ${branches.rootId}, ${branches.name},
                   ${branches.headCommitId}, ${branches.createdBy},
                   ${branches.createdAt}, ${branches.updatedAt}
                   ${enrich.select}
            FROM ${branches}
            ${enrich.join}
            WHERE ${whereClause}
            ORDER BY ${branches.createdAt}
            LIMIT ${limit} OFFSET ${offset}
          `),
        ]);

        const total = parseInt(
          (countResult.rows[0] as { count: string }).count,
          10,
        );

        // Raw-SQL row: the hand-selected column shape. Typing it lets the mapper
        // below be structurally checked against BranchListItem rather than blindly
        // asserted. Timestamp columns stay `unknown` (coerced via `new Date`).
        const branchRows = rows.rows as Array<{
          id: string;
          root_id: string;
          name: string;
          head_commit_id: string;
          created_by: string | null;
          created_at: unknown;
          updated_at: unknown;
        }>;
        const branchIds = branchRows.map((b) => b.id);
        const state = await getBranchState(db, branchIds);
        const nonDeletable = new Set([
          ...state.published,
          ...state.openMergeRequests,
        ]);

        const paginated = branchRows.map((b) => {
          const item: BranchListItem = {
            id: b.id,
            rootId: b.root_id,
            name: b.name,
            headCommitId: b.head_commit_id,
            createdBy: b.created_by,
            createdAt: new Date(b.created_at as string),
            updatedAt: new Date(b.updated_at as string),
            hasPublications: state.published.has(b.id),
            isDeletable:
              b.name !== branchPolicy.defaultBranchName &&
              !nonDeletable.has(b.id),
          };

          enrich.apply(item, b);

          return item;
        });

        const result: ListBranchesResult = {
          branches: paginated,
          total,
          hasMore: offset + paginated.length < total,
        };
        return result;
      },
    ),

    /**
     * Creates a new branch by copying the head commit from a source branch.
     * @param rootId The root ID for which to create the branch.
     * @param name Unique branch name within the root.
     * @param sourceBranchId The branch whose head commit will initialize the new branch's head.
     * @param createdBy Optional explicit actor id, used only as a fallback when ctx.context.userId is absent; context identity takes precedence.
     * @returns Object with the created branch row and its isDeletable flag (always true for a fresh branch).
     * @throws BRANCH_NOT_FOUND if sourceBranchId does not exist.
     * @throws BRANCH_NAME_ALREADY_EXISTS if name is already taken in this root.
     * @example await cmsClient.pages.createBranch({ rootId: 'root_123', name: 'feature-x', sourceBranchId: 'br_main' })
     */
    createBranch: createCMSEndpoint(
      `/${collectionName}/createBranch`,
      {
        method: 'POST',
        body: z.object({
          rootId: z.string(),
          name: z.string(),
          sourceBranchId: z.string(),
          createdBy: z.string().optional(),
        }),
        metadata: cmsMeta(
          {
            $Infer: {
              body: {} as {
                rootId: string;
                name: string;
                sourceBranchId: string;
                createdBy?: string;
              },
            },
          },
          {
            permissionResource: 'branch',
            operation: 'create',
            scope: 'collection',
            collection: collectionName,
          },
        ),
      },
      async (ctx) => {
        const { rootId, name, sourceBranchId, createdBy } = ctx.body;
        const actor = ctx.context.userId ?? createdBy;

        return db.transaction(async (tx) => {
          await requireRootInScope(
            tx,
            rootId,
            collectionName,
            ctx.context.scope.roots,
          );

          const [sourceBranch] = await tx
            .select()
            .from(branches)
            .where(
              and(eq(branches.id, sourceBranchId), eq(branches.rootId, rootId)),
            )
            .for('update');
          if (!sourceBranch) throw new CMSError('BRANCH_NOT_FOUND');

          const [existing] = await tx
            .select({ id: branches.id })
            .from(branches)
            .where(and(eq(branches.rootId, rootId), eq(branches.name, name)));
          if (existing) throw new CMSError('BRANCH_NAME_ALREADY_EXISTS');

          const [newBranch] = await tx
            .insert(branches)
            .values({
              rootId,
              name,
              headCommitId: sourceBranch.headCommitId,
              createdBy: actor,
            })
            .returning();

          // A freshly created branch can never be the default branch and has no
          // publications or open merge requests yet, so isDeletable is
          // statically true.
          return {
            branch: newBranch,
            isDeletable: true,
          };
        });
      },
    ),

    /**
     * Renames an existing branch.
     * @param branchId The branch ID to rename.
     * @param newName The new branch name.
     * @returns Object with the updated branch row (new name, refreshed updatedAt) and its isDeletable flag.
     * @throws BRANCH_NOT_FOUND if the branch does not exist.
     * @throws CANNOT_RENAME_MAIN_BRANCH if the branch is 'main'.
     * @throws BRANCH_NAME_ALREADY_EXISTS if newName is already taken in this root.
     */
    renameBranch: createCMSEndpoint(
      `/${collectionName}/renameBranch`,
      {
        method: 'POST',
        body: z.object({
          branchId: z.string(),
          newName: z.string(),
        }),
        metadata: cmsMeta(
          {
            $Infer: {
              body: {} as { branchId: string; newName: string },
            },
          },
          {
            permissionResource: 'branch',
            operation: 'update',
            scope: 'collection',
            collection: collectionName,
          },
        ),
      },
      async (ctx) => {
        const { branchId, newName } = ctx.body;

        return db.transaction(async (tx) => {
          const [branch] = await tx
            .select({
              id: branches.id,
              rootId: branches.rootId,
              name: branches.name,
              headCommitId: branches.headCommitId,
              createdBy: branches.createdBy,
              createdAt: branches.createdAt,
              updatedAt: branches.updatedAt,
            })
            .from(branches)
            .innerJoin(roots, eq(roots.id, branches.rootId))
            .where(
              and(
                eq(branches.id, branchId),
                eq(roots.collection, collectionName),
                ctx.context.scope.roots?.where,
              ),
            )
            .for('update');

          if (!branch) throw new CMSError('BRANCH_NOT_FOUND');
          if (branch.name === branchPolicy.defaultBranchName) {
            throw new CMSError('CANNOT_RENAME_MAIN_BRANCH');
          }

          const [existing] = await tx
            .select({ id: branches.id })
            .from(branches)
            .where(
              and(
                eq(branches.rootId, branch.rootId),
                eq(branches.name, newName),
              ),
            );
          if (existing) throw new CMSError('BRANCH_NAME_ALREADY_EXISTS');

          const [updated] = await tx
            .update(branches)
            .set({ name: newName, updatedAt: new Date() })
            .where(eq(branches.id, branchId))
            .returning();

          const nonDeletable = await checkDeletable(tx, [updated.id]);
          const isDeletable =
            updated.name !== branchPolicy.defaultBranchName &&
            !nonDeletable.has(updated.id);
          return { branch: updated, isDeletable };
        });
      },
    ),

    /**
     * Deletes a branch.
     * @param branchId The branch ID to delete.
     * @returns Object with the deleted branchId.
     * @throws BRANCH_NOT_FOUND if the branch does not exist.
     * @throws CANNOT_DELETE_MAIN_BRANCH if the branch is 'main'.
     * @throws BRANCH_HAS_PUBLICATIONS if the branch has any active publications.
     * @throws BRANCH_HAS_OPEN_MERGE_REQUESTS if the branch is involved in any open merge requests.
     */
    deleteBranch: createCMSEndpoint(
      `/${collectionName}/deleteBranch`,
      {
        method: 'POST',
        body: z.object({ branchId: z.string() }),
        metadata: cmsMeta(
          {
            $Infer: {
              body: {} as { branchId: string },
            },
          },
          {
            permissionResource: 'branch',
            operation: 'delete',
            scope: 'collection',
            collection: collectionName,
          },
        ),
      },
      async (ctx) => {
        const { branchId } = ctx.body;

        return db.transaction(async (tx) => {
          const [branch] = await tx
            .select({
              id: branches.id,
              rootId: branches.rootId,
              name: branches.name,
              headCommitId: branches.headCommitId,
              createdBy: branches.createdBy,
              createdAt: branches.createdAt,
              updatedAt: branches.updatedAt,
            })
            .from(branches)
            .innerJoin(roots, eq(roots.id, branches.rootId))
            .where(
              and(
                eq(branches.id, branchId),
                eq(roots.collection, collectionName),
                ctx.context.scope.roots?.where,
              ),
            )
            .for('update');

          if (!branch) throw new CMSError('BRANCH_NOT_FOUND');
          if (branch.name === branchPolicy.defaultBranchName) {
            throw new CMSError('CANNOT_DELETE_MAIN_BRANCH');
          }

          const [pub] = await tx
            .select({ branchId: publications.branchId })
            .from(publications)
            .where(eq(publications.branchId, branchId));
          if (pub) throw new CMSError('BRANCH_HAS_PUBLICATIONS');

          const [mr] = await tx
            .select({ id: mergeRequests.id })
            .from(mergeRequests)
            .where(
              and(
                eq(mergeRequests.status, 'open'),
                or(
                  eq(mergeRequests.sourceBranchId, branchId),
                  eq(mergeRequests.targetBranchId, branchId),
                ),
              ),
            );
          if (mr) throw new CMSError('BRANCH_HAS_OPEN_MERGE_REQUESTS');

          await tx.delete(branches).where(eq(branches.id, branchId));

          return { branchId };
        });
      },
    ),

    /**
     * Reverts a branch to the snapshot at a target commit by creating a new commit with the target snapshot state.
     * @param branchId The branch ID to revert.
     * @param targetCommitId The commit whose snapshot to restore.
     * @param message Optional custom commit message (default: auto-generated).
     * @param createdBy Optional explicit actor id, used only as a fallback when ctx.context.userId is absent; context identity takes precedence.
     * @returns Object with the commit envelope (id, message, createdAt, createdBy) of the revert commit.
     * @throws BRANCH_NOT_FOUND if the branch does not exist.
     * @throws COMMIT_NOT_FOUND if targetCommitId does not belong to this root.
     * @throws EMPTY_SNAPSHOT if the target commit snapshot is empty.
     */
    revertBranch: createCMSEndpoint(
      `/${collectionName}/revertBranch`,
      {
        method: 'POST',
        body: z.object({
          branchId: z.string(),
          targetCommitId: z.string(),
          message: z.string().optional(),
          createdBy: z.string().optional(),
        }),
        metadata: cmsMeta(
          {
            $Infer: {
              body: {} as {
                branchId: string;
                targetCommitId: string;
                message?: string;
                createdBy?: string;
              },
            },
          },
          {
            permissionResource: 'branch',
            operation: 'update',
            scope: 'collection',
            collection: collectionName,
          },
        ),
      },
      async (ctx) => {
        const { branchId, targetCommitId, message, createdBy } = ctx.body;
        const actor = ctx.context.userId ?? createdBy;

        return db.transaction(async (tx) => {
          const [branch] = await tx
            .select({
              id: branches.id,
              rootId: branches.rootId,
              name: branches.name,
              headCommitId: branches.headCommitId,
              createdBy: branches.createdBy,
              createdAt: branches.createdAt,
              updatedAt: branches.updatedAt,
            })
            .from(branches)
            .innerJoin(roots, eq(roots.id, branches.rootId))
            .where(
              and(
                eq(branches.id, branchId),
                eq(roots.collection, collectionName),
                ctx.context.scope.roots?.where,
              ),
            )
            .for('update');
          if (!branch) throw new CMSError('BRANCH_NOT_FOUND');
          // A revert rewrites the branch head in place — a direct content
          // mutation, so it is blocked while the branch is published.
          await assertBranchWritable(
            tx,
            branchPolicy,
            branch.rootId,
            branch.id,
          );

          const [targetCommit] = await tx
            .select({ id: commits.id })
            .from(commits)
            .where(
              and(
                eq(commits.id, targetCommitId),
                eq(commits.rootId, branch.rootId),
              ),
            );
          if (!targetCommit) throw new CMSError('COMMIT_NOT_FOUND');

          const targetState = await loadBlocksAtCommit(
            tx,
            targetCommitId,
            branch.rootId,
          );
          if (targetState.blocks.size === 0 && !targetState.reconstructed) {
            throw new CMSError('EMPTY_SNAPSHOT');
          }

          const [newCommit] = await tx
            .insert(commits)
            .values({
              rootId: branch.rootId,
              parentCommitId: branch.headCommitId,
              message:
                message ?? `Revert ${branch.name} to commit ${targetCommitId}`,
              createdBy: actor,
              // The revert commit is created on the branch being reverted.
              branchId: branch.id,
              originBranchName: branch.name,
            })
            .returning();

          await tx.insert(commitSnapshots).values(
            Array.from(targetState.blocks.values()).map((block) => ({
              commitId: newCommit.id,
              blockId: block.blockId,
              blockVersionId: block.blockVersionId,
            })),
          );

          await tx
            .update(branches)
            .set({ headCommitId: newCommit.id, updatedAt: new Date() })
            .where(eq(branches.id, branchId));

          return {
            commit: {
              id: newCommit.id,
              message: newCommit.message,
              createdAt: newCommit.createdAt,
              createdBy: newCommit.createdBy,
            },
          };
        });
      },
    ),

    /**
     * Checks divergence between two branches by computing their common ancestor and commit distance.
     * @param sourceBranchId The source branch to check.
     * @param targetBranchId The target branch to check.
     * @returns Object with: hasCommonAncestor (boolean), commonAncestorCommitId (string | null), sourceAhead (commit count), targetAhead (commit count), canFastForward (boolean).
     * @throws BRANCH_NOT_FOUND if either branch does not exist.
     * @throws BRANCHES_NOT_SAME_ROOT if the branches belong to different roots.
     */
    checkDivergence: createCMSEndpoint(
      `/${collectionName}/checkDivergence`,
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
            permissionResource: 'branch',
            operation: 'read',
            scope: 'collection',
            collection: collectionName,
          },
        ),
      },
      async (ctx) => {
        const { sourceBranchId, targetBranchId } = ctx.query;

        const [[sourceBranch], [targetBranch]] = await Promise.all([
          db
            .select({
              headCommitId: branches.headCommitId,
              rootId: branches.rootId,
            })
            .from(branches)
            .innerJoin(roots, eq(roots.id, branches.rootId))
            .where(
              and(
                eq(branches.id, sourceBranchId),
                eq(roots.collection, collectionName),
                ctx.context.scope.roots?.where,
              ),
            ),
          db
            .select({
              headCommitId: branches.headCommitId,
              rootId: branches.rootId,
            })
            .from(branches)
            .innerJoin(roots, eq(roots.id, branches.rootId))
            .where(
              and(
                eq(branches.id, targetBranchId),
                eq(roots.collection, collectionName),
                ctx.context.scope.roots?.where,
              ),
            ),
        ]);

        if (!sourceBranch) throw new CMSError('BRANCH_NOT_FOUND');
        if (!targetBranch) throw new CMSError('BRANCH_NOT_FOUND');

        if (sourceBranch.rootId !== targetBranch.rootId) {
          throw new CMSError('BRANCHES_NOT_SAME_ROOT');
        }

        if (sourceBranch.headCommitId === targetBranch.headCommitId) {
          return {
            hasCommonAncestor: true,
            commonAncestorCommitId: sourceBranch.headCommitId,
            sourceAhead: 0,
            targetAhead: 0,
            canFastForward: true,
          };
        }

        type AncestorRow = { id: string; depth: number };

        const [sourceResult, targetResult] = await Promise.all([
          db.execute(sql`
            WITH RECURSIVE chain AS (
              SELECT id, parent_commit_id, merge_source_commit_id, 0 AS depth
              FROM cms.commits WHERE id = ${sourceBranch.headCommitId}
              UNION ALL
              SELECT c.id, c.parent_commit_id, c.merge_source_commit_id, chain.depth + 1
              FROM cms.commits c JOIN chain ON c.id = chain.parent_commit_id
                 OR c.id = chain.merge_source_commit_id
              WHERE chain.depth < 10000
            )
            SELECT DISTINCT id, MIN(depth) AS depth FROM chain GROUP BY id ORDER BY depth
          `),
          db.execute(sql`
            WITH RECURSIVE chain AS (
              SELECT id, parent_commit_id, merge_source_commit_id, 0 AS depth
              FROM cms.commits WHERE id = ${targetBranch.headCommitId}
              UNION ALL
              SELECT c.id, c.parent_commit_id, c.merge_source_commit_id, chain.depth + 1
              FROM cms.commits c JOIN chain ON c.id = chain.parent_commit_id
                 OR c.id = chain.merge_source_commit_id
              WHERE chain.depth < 10000
            )
            SELECT DISTINCT id, MIN(depth) AS depth FROM chain GROUP BY id ORDER BY depth
          `),
        ]);

        const sourceChain = sourceResult.rows as AncestorRow[];
        const targetChain = targetResult.rows as AncestorRow[];

        const targetSet = new Map<string, number>();
        for (const row of targetChain) {
          targetSet.set(row.id, row.depth);
        }

        for (const row of sourceChain) {
          if (targetSet.has(row.id)) {
            return {
              hasCommonAncestor: true,
              commonAncestorCommitId: row.id,
              sourceAhead: row.depth,
              targetAhead: targetSet.get(row.id)!,
              canFastForward: targetSet.get(row.id)! === 0,
            };
          }
        }

        return {
          hasCommonAncestor: false,
          commonAncestorCommitId: null,
          sourceAhead: sourceChain.length,
          targetAhead: targetChain.length,
          canFastForward: false,
        };
      },
    ),
  };
}
