import { and, asc, eq, isNull, lte } from 'drizzle-orm';

import type { CMSProcedureCtx } from '../types';
import type { DrizzleInstance } from '../types/drizzle';

import { resolveBranchPolicy } from '../branch-policy';
import { roots, scheduledPublications } from '../db/schema.generated';
import { CMSError, getCMSErrorCode } from '../errors';
import { syncAssetsOnPublish, syncAssetsOnUnpublish } from '../media/discovery';
import { publishBranchInTx, unpublishBranchInTx } from '../routes/publications';

export type RunScheduledOptions = {
  /** Max due rows processed this pass. Default 100. */
  limit?: number;
  /**
   * Cut-off used to decide which rows are due (scheduledAt <= now). Defaults to
   * the wall clock; accepted mainly so tests can drive time deterministically.
   */
  now?: Date;
};

export type RunScheduledFailure = {
  id: string;
  rootId: string;
  branchId: string;
  action: 'publish' | 'unpublish';
  /** The CMS error code that caused this row to fail (e.g. ROOT_NOT_FOUND). */
  error: string;
};

export type RunScheduledResult = {
  /** Rows attempted this pass (successes + failures). */
  processed: number;
  /** Rows that published successfully. */
  published: number;
  /** Rows that unpublished (expired) successfully. */
  unpublished: number;
  /** Rows that were marked processed but whose publish/unpublish threw. */
  failed: RunScheduledFailure[];
};

const DEFAULT_LIMIT = 100;

/**
 * One pass of the scheduled-publishing queue. Processes every DUE row
 * (`scheduledAt <= now` AND `processedAt IS NULL`), oldest-due first, by running
 * the SAME publish/unpublish machinery the single endpoints use.
 *
 * Each row is handled in its own transaction that FIRST claims the row with a
 * conditional `SET processedAt = now WHERE processedAt IS NULL` (0 rows claimed
 * means a concurrent/overlapping pass already took it, so it is skipped) and then
 * publishes. Claim + publish commit atomically, so a due row publishes AT MOST
 * ONCE even if two cron invocations overlap. If the publish throws, the whole tx
 * rolls back (the claim reverts) and the row stays due: a TRANSIENT failure (e.g.
 * a branch momentarily pending approval) is retried next pass, while a PERMANENT
 * failure (deleted root/branch) is stamped afterwards so it never loops, and
 * surfaced in `failed`. Asset sync runs best-effort after commit.
 *
 * Designed for periodic cron invocation via `admin.runScheduled`, mirroring how
 * `admin.runPruning` drives {@link runPruningPass}.
 */
export async function runScheduledPass(
  db: DrizzleInstance,
  cmsCtx: CMSProcedureCtx,
  opts: RunScheduledOptions = {},
): Promise<RunScheduledResult> {
  const now = opts.now ?? new Date();
  const limit = opts.limit ?? DEFAULT_LIMIT;

  const due = await db
    .select({
      id: scheduledPublications.id,
      rootId: scheduledPublications.rootId,
      branchId: scheduledPublications.branchId,
      action: scheduledPublications.action,
      createdBy: scheduledPublications.createdBy,
    })
    .from(scheduledPublications)
    .where(
      and(
        isNull(scheduledPublications.processedAt),
        lte(scheduledPublications.scheduledAt, now),
      ),
    )
    .orderBy(asc(scheduledPublications.scheduledAt))
    .limit(limit);

  const result: RunScheduledResult = {
    processed: 0,
    published: 0,
    unpublished: 0,
    failed: [],
  };

  for (const row of due) {
    try {
      const outcome = await db.transaction(async (tx) => {
        // Atomic claim: flip processedAt only if still unclaimed. A concurrent
        // pass blocks on this row's lock and then sees 0 rows, so a due row is
        // published at most once. The claim commits WITH the publish below, so a
        // thrown publish rolls back the claim too (retry), unless it is permanent
        // (handled in catch).
        const claimed = await tx
          .update(scheduledPublications)
          .set({ processedAt: now })
          .where(
            and(
              eq(scheduledPublications.id, row.id),
              isNull(scheduledPublications.processedAt),
            ),
          )
          .returning({ id: scheduledPublications.id });
        if (claimed.length === 0) return { status: 'skipped' as const };

        // Resolve the host collection so we apply that collection's branch policy
        // (e.g. requireApprovalBeforePublish) exactly as the single endpoint would.
        const [rootRow] = await tx
          .select({ collection: roots.collection })
          .from(roots)
          .where(eq(roots.id, row.rootId));
        if (!rootRow) throw new CMSError('ROOT_NOT_FOUND');
        const def = cmsCtx.collections[rootRow.collection];
        const branchPolicy = resolveBranchPolicy(cmsCtx, def?.branchProtection);

        if (row.action === 'publish') {
          const res = await publishBranchInTx(tx, {
            collectionName: rootRow.collection,
            rootId: row.rootId,
            branchId: row.branchId,
            actor: row.createdBy ?? 'system',
            branchPolicy,
          });
          return { status: 'published' as const, commitId: res.commitId };
        }
        const res = await unpublishBranchInTx(tx, {
          collectionName: rootRow.collection,
          rootId: row.rootId,
          branchId: row.branchId,
        });
        return { status: 'unpublished' as const, commitId: res.commitId };
      });

      if (outcome.status === 'skipped') continue;
      result.processed++;
      if (outcome.status === 'published') {
        result.published++;
        // Best-effort: the publish is already committed, so an asset-sync hiccup
        // must not flip a live page back to "failed".
        await syncAssetsOnPublish(db, outcome.commitId, row.rootId).catch((err) =>
          console.error('[cms] scheduled publish asset sync failed:', err),
        );
      } else {
        result.unpublished++;
        await syncAssetsOnUnpublish(
          db,
          outcome.commitId,
          row.rootId,
          row.branchId,
        ).catch((err) =>
          console.error('[cms] scheduled unpublish asset sync failed:', err),
        );
      }
    } catch (err) {
      const code = getCMSErrorCode(err) ?? 'UNKNOWN';
      if (!PERMANENT_FAILURE_CODES.has(code)) {
        // Transient (branch momentarily pending approval, a DB hiccup): the tx
        // already rolled back the claim, so the row stays due and a later pass
        // retries it. Do not stamp, do not report as a hard failure.
        continue;
      }
      // Permanent (deleted root/branch, or nothing to unpublish): stamp so it
      // never re-runs, and report it so the caller can alert.
      await db
        .update(scheduledPublications)
        .set({ processedAt: now })
        .where(eq(scheduledPublications.id, row.id));
      result.processed++;
      result.failed.push({
        id: row.id,
        rootId: row.rootId,
        branchId: row.branchId,
        action: row.action,
        error: code,
      });
    }
  }

  return result;
}

/** Error codes for which re-running the scheduled row can never succeed, so it
 *  is stamped processed instead of retried. Everything else is treated as
 *  transient and left due for the next pass. */
const PERMANENT_FAILURE_CODES = new Set([
  'ROOT_NOT_FOUND',
  'BRANCH_NOT_FOUND',
  'PUBLICATION_NOT_FOUND',
]);
