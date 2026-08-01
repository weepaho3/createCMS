import { and, eq, isNull } from 'drizzle-orm';

import type { DrizzleInstance } from '../types/drizzle';

import { approvals } from '../db/schema.generated';

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

/**
 * Approval state for a merge request. When `commitId` is omitted, every
 * approval ever recorded against the merge request counts — an approval
 * survives a subsequent push to the source branch, matching GitHub's default
 * pull-request behaviour. Pass the source branch's current head commit id to
 * opt into `dismissStaleApprovals`: only approvals recorded against that exact
 * commit count, and `staleRequests` reports whether approvals exist but were
 * all recorded against an earlier (now-superseded) commit.
 */
export async function getApprovalStateForMergeRequest(
  db: DrizzleInstance,
  mergeRequestId: string,
  commitId?: string,
): Promise<ApprovalState & { staleRequests: boolean }> {
  const rows = await db
    .select({ status: approvals.status, commitId: approvals.commitId })
    .from(approvals)
    .where(eq(approvals.mergeRequestId, mergeRequestId));

  if (commitId === undefined) {
    // Today's behavior, unchanged: all rows count regardless of commit.
    return { ...buildApprovalState(rows), staleRequests: false };
  }

  const currentRows = rows.filter((row) => row.commitId === commitId);
  const staleRequests = rows.length > 0 && currentRows.length === 0;
  const state = buildApprovalState(currentRows);
  return {
    ...state,
    // `hasRequests` must stay true when a request exists but only against a
    // superseded commit: the flag-independent "an open request blocks the
    // merge" rule (and `requireApprovalToMerge`'s "an approval is mandatory")
    // both key off `hasRequests`, and a stale request is still an open
    // request — it just fails the (now separate) staleness check instead of
    // silently falling through as "never reviewed".
    hasRequests: state.hasRequests || rows.length > 0,
    staleRequests,
  };
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
