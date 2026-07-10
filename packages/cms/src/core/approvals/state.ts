import { and, eq, isNull } from 'drizzle-orm';

import { approvals } from '../db/schema.generated';
import type { DrizzleInstance } from '../types/drizzle';

type ApprovalState = {
  total: number;
  approved: number;
  pending: number;
  rejected: number;
  hasRequests: boolean;
  allApproved: boolean;
};

function buildApprovalState(
  rows: Array<{ status: 'pending' | 'approved' | 'rejected' }>,
): ApprovalState {
  let approved = 0;
  let pending = 0;
  let rejected = 0;

  for (const row of rows) {
    if (row.status === 'approved') approved++;
    if (row.status === 'pending') pending++;
    if (row.status === 'rejected') rejected++;
  }

  return {
    total: rows.length,
    approved,
    pending,
    rejected,
    hasRequests: rows.length > 0,
    allApproved: rows.length > 0 && approved === rows.length,
  };
}

export async function getApprovalStateForMergeRequest(
  db: DrizzleInstance,
  mergeRequestId: string,
): Promise<ApprovalState> {
  const rows = await db
    .select({ status: approvals.status })
    .from(approvals)
    .where(eq(approvals.mergeRequestId, mergeRequestId));

  return buildApprovalState(rows);
}

export async function getApprovalStateForPublication(
  db: DrizzleInstance,
  branchId: string,
  commitId: string,
): Promise<ApprovalState> {
  const rows = await db
    .select({ status: approvals.status })
    .from(approvals)
    .where(
      and(
        isNull(approvals.mergeRequestId),
        eq(approvals.branchId, branchId),
        eq(approvals.commitId, commitId),
      ),
    );

  return buildApprovalState(rows);
}

export type { ApprovalState };
