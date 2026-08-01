import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import * as z from 'zod';

import type { CollectionWithName, CMSProcedureContext } from '../types';

import {
  approvalStatusEnum,
  approvals,
  branches,
  mergeRequests,
  roots,
} from '../db/schema.generated';
import { cmsMeta, createCMSEndpoint } from '../endpoint';
import { CMSError } from '../errors';
import { withNotifications } from '../notifications/service';
import { userEnrichment, type EnrichField } from '../user/enrichment';
import { parseTimestampOrNull } from '../utils/parse-timestamp';

const approvalStatusSchema = z.enum(approvalStatusEnum.enumValues);
const approvalTargetTypeSchema = z.enum(['mergeRequest', 'publication']);

/** The three user-id fields enriched on approval reads (getApproval + listApprovals). */
const APPROVAL_USER_FIELDS: EnrichField[] = [
  {
    cmsColumn: 'cms.approvals.requested_by',
    alias: 'req_by_user',
    outputKey: 'requestedByUser',
  },
  {
    cmsColumn: 'cms.approvals.requested_reviewer',
    alias: 'req_rev_user',
    outputKey: 'requestedReviewerUser',
  },
  {
    cmsColumn: 'cms.approvals.reviewed_by',
    alias: 'rev_by_user',
    outputKey: 'reviewedByUser',
    nullGuardCol: 'reviewed_by',
  },
];

const approvalSchema = z.object({
  id: z.string(),
  mergeRequestId: z.string().nullable(),
  branchId: z.string().nullable(),
  commitId: z.string(),
  status: approvalStatusSchema,
  requestedBy: z.string(),
  requestedReviewer: z.string(),
  reviewedBy: z.string().nullable(),
  message: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  reviewedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
  targetType: approvalTargetTypeSchema,
});

type ApprovalOutput = z.infer<typeof approvalSchema>;

function mapApproval(row: {
  id: string;
  mergeRequestId: string | null;
  branchId: string | null;
  commitId: string;
  status: 'pending' | 'approved' | 'rejected';
  requestedBy: string;
  requestedReviewer: string;
  reviewedBy: string | null;
  message: string | null;
  rejectionReason: string | null;
  reviewedAt: Date | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}): ApprovalOutput {
  return {
    ...row,
    reviewedAt: row.reviewedAt ? new Date(row.reviewedAt) : null,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
    targetType: row.mergeRequestId ? 'mergeRequest' : 'publication',
  };
}

export function createApprovalEndpoints<TDef extends CollectionWithName>(
  def: TDef,
  cmsCtx: CMSProcedureContext,
) {
  const { db } = cmsCtx;
  const collectionName = def.name;

  return {
    /**
     * Request approval from one or more reviewers for a merge request or branch commit.
     * @param mergeRequestId Merge request to request approval for; exactly one of mergeRequestId or branchId must be provided.
     * @param branchId Branch to request approval for; exactly one of mergeRequestId or branchId must be provided.
     * @param requestedReviewers Array of user ids to request approval from; must be unique and non-empty.
     * @param message Optional approval request message to send to reviewers.
     * @returns Object containing array of created approvals.
     * @throws MERGE_REQUEST_NOT_FOUND If the merge request does not exist or is not accessible.
     * @throws MERGE_REQUEST_NOT_OPEN If the merge request is not in open status.
     * @throws BRANCH_NOT_FOUND If the branch does not exist.
     * @throws APPROVAL_ALREADY_REQUESTED If an approval from any requested reviewer for this commit already exists.
     * @example await cmsClient.pages.requestApproval({ branchId: 'br_123', requestedReviewers: ['user2', 'user3'], message: 'Please review' })
     */
    requestApproval: createCMSEndpoint(
      `/${collectionName}/requestApproval`,
      {
        method: 'POST',
        body: z
          .object({
            mergeRequestId: z.string().optional(),
            branchId: z.string().optional(),
            requestedReviewers: z.array(z.string().min(1)).min(1),
            message: z.string().optional(),
          })
          .refine((input) => !!input.mergeRequestId !== !!input.branchId, {
            message: 'Provide exactly one of mergeRequestId or branchId',
          })
          .refine(
            (input) =>
              new Set(input.requestedReviewers).size ===
              input.requestedReviewers.length,
            {
              message: 'requestedReviewers must be unique',
            },
          ),
        metadata: cmsMeta(
          {
            $Infer: {
              body: {} as {
                mergeRequestId?: string;
                branchId?: string;
                requestedReviewers: string[];
                message?: string;
              },
            },
          },
          {
            permissionResource: 'approval',
            operation: 'create',
            scope: 'collection',
            collection: collectionName,
          },
        ),
      },
      async (ctx) => {
        const input = ctx.body;
        const actor = ctx.context.userId;
        if (!actor) throw new CMSError('USER_ID_REQUIRED');

        return withNotifications(
          db,
          cmsCtx.notificationService,
          async (tx, pending) => {
            let mergeRequestId: string | null = null;
            let branchId: string;
            let commitId: string;
            let rootId: string;
            let branchName: string;

            if (input.mergeRequestId) {
              const [mr] = await tx
                .select({
                  id: mergeRequests.id,
                  rootId: mergeRequests.rootId,
                  sourceBranchId: mergeRequests.sourceBranchId,
                  status: mergeRequests.status,
                })
                .from(mergeRequests)
                .innerJoin(roots, eq(roots.id, mergeRequests.rootId))
                .where(
                  and(
                    eq(mergeRequests.id, input.mergeRequestId),
                    eq(roots.collection, collectionName),
                    ctx.context.scope.roots?.where,
                  ),
                );

              if (!mr) throw new CMSError('MERGE_REQUEST_NOT_FOUND');
              if (mr.status !== 'open')
                throw new CMSError('MERGE_REQUEST_NOT_OPEN');
              // sourceBranchId is only null once a branch has been deleted (ON
              // DELETE SET NULL); an open merge request can never reference an
              // already-deleted branch, but narrow explicitly rather than assert.
              if (!mr.sourceBranchId) throw new CMSError('BRANCH_NOT_FOUND');

              const [sourceBranch] = await tx
                .select({
                  headCommitId: branches.headCommitId,
                  name: branches.name,
                })
                .from(branches)
                .where(eq(branches.id, mr.sourceBranchId))
                .for('update');

              if (!sourceBranch) throw new CMSError('BRANCH_NOT_FOUND');

              mergeRequestId = mr.id;
              branchId = mr.sourceBranchId;
              commitId = sourceBranch.headCommitId;
              rootId = mr.rootId;
              branchName = sourceBranch.name;
            } else {
              const [branch] = await tx
                .select({
                  id: branches.id,
                  rootId: branches.rootId,
                  name: branches.name,
                  headCommitId: branches.headCommitId,
                })
                .from(branches)
                .innerJoin(roots, eq(roots.id, branches.rootId))
                .where(
                  and(
                    eq(branches.id, input.branchId!),
                    eq(roots.collection, collectionName),
                    ctx.context.scope.roots?.where,
                  ),
                )
                .for('update');

              if (!branch) throw new CMSError('BRANCH_NOT_FOUND');

              branchId = branch.id;
              commitId = branch.headCommitId;
              rootId = branch.rootId;
              branchName = branch.name;
            }

            const existing = await tx
              .select({
                requestedReviewer: approvals.requestedReviewer,
              })
              .from(approvals)
              .where(
                and(
                  mergeRequestId
                    ? eq(approvals.mergeRequestId, mergeRequestId)
                    : isNull(approvals.mergeRequestId),
                  eq(approvals.branchId, branchId),
                  eq(approvals.commitId, commitId),
                  inArray(
                    approvals.requestedReviewer,
                    input.requestedReviewers,
                  ),
                ),
              );

            if (existing.length > 0) {
              throw new CMSError('APPROVAL_ALREADY_REQUESTED');
            }

            const inserted = await tx
              .insert(approvals)
              .values(
                input.requestedReviewers.map((requestedReviewer) => ({
                  mergeRequestId,
                  branchId,
                  commitId,
                  requestedBy: actor,
                  requestedReviewer,
                  message: input.message,
                })),
              )
              .returning();

            pending.push(
              ...inserted.map((a) => ({
                recipientId: a.requestedReviewer,
                actorId: actor,
                type: 'approvalRequested' as const,
                title: 'Approval requested',
                body: input.message ?? null,
                resourceType: mergeRequestId ? 'mergeRequest' : 'branch',
                resourceId: mergeRequestId ?? branchId,
                collection: collectionName,
                meta: {
                  approvalId: a.id,
                  rootId,
                  branchId,
                  branchName,
                  commitId,
                  mergeRequestId,
                },
              })),
            );

            return {
              approvals: inserted.map(mapApproval),
            };
          },
        );
      },
    ),

    /**
     * Approve a pending approval request.
     * @param approvalId The approval to approve.
     * @returns Object containing the approved approval record under the `approval` key.
     * @throws APPROVAL_NOT_FOUND If the approval does not exist or is not accessible.
     * @throws APPROVAL_NOT_PENDING If the approval is not in pending status.
     * @throws APPROVAL_REVIEWER_MISMATCH If the reviewer is not the requested reviewer for this approval.
     * @throws APPROVAL_STALE If the approval is for a direct publication and the branch has since moved to a different commit.
     * @example await cmsClient.pages.submitApproval({ approvalId: 'apr_123' })
     */
    submitApproval: createCMSEndpoint(
      `/${collectionName}/submitApproval`,
      {
        method: 'POST',
        body: z.object({
          approvalId: z.string(),
        }),
        metadata: cmsMeta(
          {
            $Infer: {
              body: {} as {
                approvalId: string;
              },
            },
          },
          {
            permissionResource: 'approval',
            operation: 'update',
            scope: 'collection',
            collection: collectionName,
          },
        ),
      },
      async (ctx) => {
        const input = ctx.body;
        const actor = ctx.context.userId;
        if (!actor) throw new CMSError('USER_ID_REQUIRED');

        return withNotifications(
          db,
          cmsCtx.notificationService,
          async (tx, pending) => {
            const [approval] = await tx
              .select({
                id: approvals.id,
                mergeRequestId: approvals.mergeRequestId,
                branchId: approvals.branchId,
                rootId: branches.rootId,
                branchName: branches.name,
                commitId: approvals.commitId,
                status: approvals.status,
                requestedBy: approvals.requestedBy,
                requestedReviewer: approvals.requestedReviewer,
                reviewedBy: approvals.reviewedBy,
                message: approvals.message,
                rejectionReason: approvals.rejectionReason,
                reviewedAt: approvals.reviewedAt,
                createdAt: approvals.createdAt,
                updatedAt: approvals.updatedAt,
              })
              .from(approvals)
              .innerJoin(branches, eq(branches.id, approvals.branchId))
              .innerJoin(roots, eq(roots.id, branches.rootId))
              .where(
                and(
                  eq(approvals.id, input.approvalId),
                  eq(roots.collection, collectionName),
                  ctx.context.scope.roots?.where,
                ),
              )
              .for('update');

            if (!approval) throw new CMSError('APPROVAL_NOT_FOUND');
            if (approval.status !== 'pending') {
              throw new CMSError('APPROVAL_NOT_PENDING');
            }
            if (approval.requestedReviewer !== actor) {
              throw new CMSError('APPROVAL_REVIEWER_MISMATCH');
            }

            // branchId is only null once the branch has been deleted (ON
            // DELETE SET NULL); mirror the existing "branch not found" == "not
            // stale" tolerance below rather than querying with a null id.
            if (!approval.mergeRequestId && approval.branchId) {
              const [branch] = await tx
                .select({ headCommitId: branches.headCommitId })
                .from(branches)
                .where(eq(branches.id, approval.branchId));
              if (branch && branch.headCommitId !== approval.commitId) {
                throw new CMSError('APPROVAL_STALE');
              }
            }

            const [updated] = await tx
              .update(approvals)
              .set({
                status: 'approved',
                reviewedBy: actor,
                reviewedAt: new Date(),
                updatedAt: new Date(),
                rejectionReason: null,
              })
              .where(
                and(
                  eq(approvals.id, input.approvalId),
                  eq(approvals.status, 'pending'),
                ),
              )
              .returning();

            if (!updated) throw new CMSError('APPROVAL_NOT_PENDING');

            if (updated.requestedBy !== actor) {
              pending.push({
                recipientId: updated.requestedBy,
                actorId: actor,
                type: 'approvalApproved',
                title: 'Your approval request was approved',
                body: null,
                resourceType: updated.mergeRequestId
                  ? 'mergeRequest'
                  : 'branch',
                resourceId: updated.mergeRequestId ?? updated.branchId,
                collection: collectionName,
                meta: {
                  approvalId: updated.id,
                  rootId: approval.rootId,
                  branchId: updated.branchId,
                  branchName: approval.branchName,
                  mergeRequestId: updated.mergeRequestId,
                },
              });
            }

            return { approval: mapApproval(updated) };
          },
        );
      },
    ),

    /**
     * Reject a pending approval request.
     * @param approvalId The approval to reject.
     * @param rejectionReason Optional reason for the rejection.
     * @returns Object containing the rejected approval record under the `approval` key.
     * @throws APPROVAL_NOT_FOUND If the approval does not exist or is not accessible.
     * @throws APPROVAL_NOT_PENDING If the approval is not in pending status.
     * @throws APPROVAL_REVIEWER_MISMATCH If the reviewer is not the requested reviewer for this approval.
     * @throws APPROVAL_STALE If the approval is for a direct publication and the branch has since moved to a different commit.
     * @example await cmsClient.pages.submitRejection({ approvalId: 'apr_123', rejectionReason: 'Needs revision' })
     */
    submitRejection: createCMSEndpoint(
      `/${collectionName}/submitRejection`,
      {
        method: 'POST',
        body: z.object({
          approvalId: z.string(),
          rejectionReason: z.string().optional(),
        }),
        metadata: cmsMeta(
          {
            $Infer: {
              body: {} as {
                approvalId: string;
                rejectionReason?: string;
              },
            },
          },
          {
            permissionResource: 'approval',
            operation: 'update',
            scope: 'collection',
            collection: collectionName,
          },
        ),
      },
      async (ctx) => {
        const input = ctx.body;
        const actor = ctx.context.userId;
        if (!actor) throw new CMSError('USER_ID_REQUIRED');

        return withNotifications(
          db,
          cmsCtx.notificationService,
          async (tx, pending) => {
            const [approval] = await tx
              .select({
                id: approvals.id,
                mergeRequestId: approvals.mergeRequestId,
                branchId: approvals.branchId,
                rootId: branches.rootId,
                branchName: branches.name,
                commitId: approvals.commitId,
                status: approvals.status,
                requestedBy: approvals.requestedBy,
                requestedReviewer: approvals.requestedReviewer,
                reviewedBy: approvals.reviewedBy,
                message: approvals.message,
                rejectionReason: approvals.rejectionReason,
                reviewedAt: approvals.reviewedAt,
                createdAt: approvals.createdAt,
                updatedAt: approvals.updatedAt,
              })
              .from(approvals)
              .innerJoin(branches, eq(branches.id, approvals.branchId))
              .innerJoin(roots, eq(roots.id, branches.rootId))
              .where(
                and(
                  eq(approvals.id, input.approvalId),
                  eq(roots.collection, collectionName),
                  ctx.context.scope.roots?.where,
                ),
              )
              .for('update');

            if (!approval) throw new CMSError('APPROVAL_NOT_FOUND');
            if (approval.status !== 'pending') {
              throw new CMSError('APPROVAL_NOT_PENDING');
            }
            if (approval.requestedReviewer !== actor) {
              throw new CMSError('APPROVAL_REVIEWER_MISMATCH');
            }

            // branchId is only null once the branch has been deleted (ON
            // DELETE SET NULL); mirror the existing "branch not found" == "not
            // stale" tolerance below rather than querying with a null id.
            if (!approval.mergeRequestId && approval.branchId) {
              const [branch] = await tx
                .select({ headCommitId: branches.headCommitId })
                .from(branches)
                .where(eq(branches.id, approval.branchId));
              if (branch && branch.headCommitId !== approval.commitId) {
                throw new CMSError('APPROVAL_STALE');
              }
            }

            const [updated] = await tx
              .update(approvals)
              .set({
                status: 'rejected',
                reviewedBy: actor,
                rejectionReason: input.rejectionReason ?? null,
                reviewedAt: new Date(),
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(approvals.id, input.approvalId),
                  eq(approvals.status, 'pending'),
                ),
              )
              .returning();

            if (!updated) throw new CMSError('APPROVAL_NOT_PENDING');

            if (updated.requestedBy !== actor) {
              pending.push({
                recipientId: updated.requestedBy,
                actorId: actor,
                type: 'approvalRejected',
                title: 'Your approval request was rejected',
                body: input.rejectionReason ?? null,
                resourceType: updated.mergeRequestId
                  ? 'mergeRequest'
                  : 'branch',
                resourceId: updated.mergeRequestId ?? updated.branchId,
                collection: collectionName,
                meta: {
                  approvalId: updated.id,
                  rootId: approval.rootId,
                  branchId: updated.branchId,
                  branchName: approval.branchName,
                  mergeRequestId: updated.mergeRequestId,
                  rejectionReason: input.rejectionReason,
                },
              });
            }

            return { approval: mapApproval(updated) };
          },
        );
      },
    ),

    /**
     * Cancel a pending approval request.
     * @param approvalId The approval to cancel.
     * @returns Object containing the canceled approval id.
     * @throws APPROVAL_NOT_FOUND If the approval does not exist or is not accessible.
     * @throws APPROVAL_NOT_PENDING If the approval is not in pending status.
     * @example await cmsClient.pages.cancelApproval({ approvalId: 'apr_123' })
     */
    cancelApproval: createCMSEndpoint(
      `/${collectionName}/cancelApproval`,
      {
        method: 'POST',
        body: z.object({
          approvalId: z.string(),
        }),
        metadata: cmsMeta(
          {
            $Infer: {
              body: {} as {
                approvalId: string;
              },
            },
          },
          {
            permissionResource: 'approval',
            operation: 'delete',
            scope: 'collection',
            collection: collectionName,
          },
        ),
      },
      async (ctx) => {
        const input = ctx.body;

        return db.transaction(async (tx) => {
          const [approval] = await tx
            .select({
              id: approvals.id,
              status: approvals.status,
            })
            .from(approvals)
            .innerJoin(branches, eq(branches.id, approvals.branchId))
            .innerJoin(roots, eq(roots.id, branches.rootId))
            .where(
              and(
                eq(approvals.id, input.approvalId),
                eq(roots.collection, collectionName),
                ctx.context.scope.roots?.where,
              ),
            )
            .for('update');

          if (!approval) throw new CMSError('APPROVAL_NOT_FOUND');
          if (approval.status !== 'pending') {
            throw new CMSError('APPROVAL_NOT_PENDING');
          }

          const deleted = await tx
            .delete(approvals)
            .where(
              and(
                eq(approvals.id, input.approvalId),
                eq(approvals.status, 'pending'),
              ),
            )
            .returning();

          if (deleted.length === 0) throw new CMSError('APPROVAL_NOT_PENDING');

          return {
            approvalId: input.approvalId,
          };
        });
      },
    ),

    /**
     * Retrieve a single approval with enriched user profile data.
     * @param approvalId The approval id to retrieve.
     * @returns The approval record with requestedByUser, requestedReviewerUser, and reviewedByUser populated.
     * @throws APPROVAL_NOT_FOUND If the approval does not exist or is not accessible.
     * @example await cmsClient.pages.getApproval({ approvalId: 'apr_123' })
     */
    getApproval: createCMSEndpoint(
      `/${collectionName}/getApproval`,
      {
        method: 'GET',
        query: z.object({
          approvalId: z.string(),
        }),
        metadata: cmsMeta(
          {
            $Infer: {
              query: {} as {
                approvalId: string;
              },
            },
          },
          {
            permissionResource: 'approval',
            operation: 'read',
            scope: 'collection',
            collection: collectionName,
          },
        ),
      },
      async (ctx) => {
        const enrich = userEnrichment(ctx, APPROVAL_USER_FIELDS);

        const result = await db.execute(sql`
          SELECT
            ${approvals.id},
            ${approvals.mergeRequestId} AS merge_request_id,
            ${approvals.branchId} AS branch_id,
            ${approvals.commitId} AS commit_id,
            ${approvals.status},
            ${approvals.requestedBy} AS requested_by,
            ${approvals.requestedReviewer} AS requested_reviewer,
            ${approvals.reviewedBy} AS reviewed_by,
            ${approvals.message},
            ${approvals.rejectionReason} AS rejection_reason,
            ${approvals.reviewedAt} AS reviewed_at,
            ${approvals.createdAt} AS created_at,
            ${approvals.updatedAt} AS updated_at
            ${enrich.select}
          FROM ${approvals}
          INNER JOIN ${branches} ON ${branches.id} = ${approvals.branchId}
          INNER JOIN ${roots} ON ${roots.id} = ${branches.rootId}
          ${enrich.join}
          WHERE ${approvals.id} = ${ctx.query.approvalId}
            AND ${roots.collection} = ${collectionName}
            ${ctx.context.scope.roots?.where ? sql`AND ${ctx.context.scope.roots.where}` : sql``}
        `);

        const row = result.rows[0] as Record<string, unknown> | undefined;
        if (!row) throw new CMSError('APPROVAL_NOT_FOUND');

        const item: Record<string, unknown> = mapApproval({
          id: row.id as string,
          mergeRequestId: row.merge_request_id as string | null,
          branchId: row.branch_id as string,
          commitId: row.commit_id as string,
          status: row.status as 'pending' | 'approved' | 'rejected',
          requestedBy: row.requested_by as string,
          requestedReviewer: row.requested_reviewer as string,
          reviewedBy: row.reviewed_by as string | null,
          message: row.message as string | null,
          rejectionReason: row.rejection_reason as string | null,
          reviewedAt: parseTimestampOrNull(row.reviewed_at),
          createdAt: row.created_at as string,
          updatedAt: row.updated_at as string,
        });

        enrich.apply(item, row);

        return item;
      },
    ),

    /**
     * List approvals with optional filtering and pagination.
     * @param limit Maximum number of results to return; clamped to 1–100, defaults to 20.
     * @param offset Number of results to skip for pagination; defaults to 0.
     * @param status Filter by approval status (pending, approved, or rejected).
     * @param mergeRequestId Filter by merge request id.
     * @param branchId Filter by branch id.
     * @param commitId Filter by commit id.
     * @param requestedBy Filter by the user who requested the approval.
     * @param requestedReviewer Filter by the requested reviewer.
     * @param reviewedBy Filter by the user who reviewed the approval.
     * @param targetType Filter by target type: 'mergeRequest' (has mergeRequestId) or 'publication' (no mergeRequestId); silent if combined with incompatible filters.
     * @returns Object containing approvals array, total count, and hasMore flag.
     * @example await cmsClient.pages.listApprovals({ status: 'pending', limit: 10, offset: 0 })
     */
    listApprovals: createCMSEndpoint(
      `/${collectionName}/listApprovals`,
      {
        method: 'GET',
        query: z
          .object({
            limit: z.coerce.number().min(1).max(100).optional(),
            offset: z.coerce.number().min(0).optional(),
            status: approvalStatusSchema.optional(),
            mergeRequestId: z.string().optional(),
            branchId: z.string().optional(),
            commitId: z.string().optional(),
            requestedBy: z.string().optional(),
            requestedReviewer: z.string().optional(),
            reviewedBy: z.string().optional(),
            targetType: approvalTargetTypeSchema.optional(),
          })
          .optional(),
        metadata: cmsMeta(
          {
            $Infer: {
              query: {} as {
                limit?: number;
                offset?: number;
                status?: z.infer<typeof approvalStatusSchema>;
                mergeRequestId?: string;
                branchId?: string;
                commitId?: string;
                requestedBy?: string;
                requestedReviewer?: string;
                reviewedBy?: string;
                targetType?: z.infer<typeof approvalTargetTypeSchema>;
              },
            },
          },
          {
            permissionResource: 'approval',
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

        if (input.targetType === 'publication' && input.mergeRequestId) {
          return { approvals: [], total: 0, hasMore: false };
        }

        // Exclude approvals whose root was soft-deleted (roots.archived_at).
        const conditions = [
          eq(roots.collection, collectionName),
          isNull(roots.archivedAt),
        ];

        if (input.status) {
          conditions.push(eq(approvals.status, input.status));
        }
        if (input.mergeRequestId) {
          conditions.push(eq(approvals.mergeRequestId, input.mergeRequestId));
        }
        if (input.branchId) {
          conditions.push(eq(approvals.branchId, input.branchId));
        }
        if (input.commitId) {
          conditions.push(eq(approvals.commitId, input.commitId));
        }
        if (input.requestedBy) {
          conditions.push(eq(approvals.requestedBy, input.requestedBy));
        }
        if (input.requestedReviewer) {
          conditions.push(
            eq(approvals.requestedReviewer, input.requestedReviewer),
          );
        }
        if (input.reviewedBy) {
          conditions.push(eq(approvals.reviewedBy, input.reviewedBy));
        }
        if (input.targetType === 'mergeRequest') {
          conditions.push(isNotNull(approvals.mergeRequestId));
        } else if (input.targetType === 'publication') {
          conditions.push(isNull(approvals.mergeRequestId));
        }

        if (ctx.context.scope.roots?.where) {
          conditions.push(ctx.context.scope.roots.where);
        }

        const whereCondition = and(...conditions)!;

        const enrich = userEnrichment(ctx, APPROVAL_USER_FIELDS);

        const [{ count }] = await db
          .select({ count: sql<number>`count(*)`.mapWith(Number) })
          .from(approvals)
          .innerJoin(branches, eq(branches.id, approvals.branchId))
          .innerJoin(roots, eq(roots.id, branches.rootId))
          .where(whereCondition);

        const dataResult = await db.execute(sql`
          SELECT
            ${approvals.id},
            ${approvals.mergeRequestId} AS merge_request_id,
            ${approvals.branchId} AS branch_id,
            ${approvals.commitId} AS commit_id,
            ${approvals.status},
            ${approvals.requestedBy} AS requested_by,
            ${approvals.requestedReviewer} AS requested_reviewer,
            ${approvals.reviewedBy} AS reviewed_by,
            ${approvals.message},
            ${approvals.rejectionReason} AS rejection_reason,
            ${approvals.reviewedAt} AS reviewed_at,
            ${approvals.createdAt} AS created_at,
            ${approvals.updatedAt} AS updated_at
            ${enrich.select}
          FROM ${approvals}
          INNER JOIN ${branches} ON ${branches.id} = ${approvals.branchId}
          INNER JOIN ${roots} ON ${roots.id} = ${branches.rootId}
          ${enrich.join}
          WHERE ${whereCondition}
          ORDER BY ${approvals.createdAt} DESC
          LIMIT ${limit} OFFSET ${offset}
        `);

        const rows = dataResult.rows as Array<Record<string, unknown>>;

        const items = rows.map((row) => {
          const item: Record<string, unknown> = mapApproval({
            id: row.id as string,
            mergeRequestId: row.merge_request_id as string | null,
            branchId: row.branch_id as string,
            commitId: row.commit_id as string,
            status: row.status as 'pending' | 'approved' | 'rejected',
            requestedBy: row.requested_by as string,
            requestedReviewer: row.requested_reviewer as string,
            reviewedBy: row.reviewed_by as string | null,
            message: row.message as string | null,
            rejectionReason: row.rejection_reason as string | null,
            reviewedAt: parseTimestampOrNull(row.reviewed_at),
            createdAt: row.created_at as string,
            updatedAt: row.updated_at as string,
          });
          enrich.apply(item, row);
          return item;
        });

        return {
          approvals: items,
          total: count,
          hasMore: offset + items.length < count,
        };
      },
    ),
  };
}
