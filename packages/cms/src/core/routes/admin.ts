import * as z from 'zod';

import type { RevalidationRunner } from '../revalidation';
import type { CMSProcedureContext, MediaConfig } from '../types';
import type { CMSPlugin } from '../types/plugin';

import { runPruningPass } from '../admin/pruning';
import { runScheduledPass } from '../admin/scheduling';
import { DEFAULT_BRANCH_NAME } from '../branch-policy';
import { cmsMeta, createCMSEndpoint } from '../endpoint';
import { CMSError } from '../errors';
import { runMediaBackfill } from '../media/backfill';
import { reindexAll } from '../search/index-builder';

// ============================================================================
// Endpoint factory
// ============================================================================

const ADMIN_META = {
  scope: 'system' as const,
  permissionResource: 'admin' as const,
};

export function createAdminEndpoints(
  cmsCtx: CMSProcedureContext,
  plugins: CMSPlugin[] = [],
  mediaConfig: MediaConfig,
  revalidationRunner: RevalidationRunner | null = null,
) {
  const { db, dataRetention } = cmsCtx;

  return {
    /**
     * Executes one bounded, resumable pruning pass to reclaim storage by deleting old commits, hard-deleting archived roots, and reclaiming unreferenced assets.
     * Designed for periodic cron invocation; each pass does capped work within time and root count budgets and persists progress, enabling multi-pass draining. Supports dry-run inspection and custom limits.
     * @param dryRun Optional; if true, plan what would be deleted without persisting changes (defaults to false).
     * @param maxRoots Optional; maximum roots to process per pass (archived and live combined); defaults to 50.
     * @param maxDurationMs Optional; soft wall-clock budget in milliseconds; the pass returns before exceeding it (defaults to 8000).
     * @param liveRescanMs Optional; interval in milliseconds after which a live root becomes due for re-scanning (defaults to 24 hours); enables draining.
     * @param maxAssets Optional; maximum archived unreferenced assets to reclaim this pass (defaults to 100).
     * @param sweepCursor Optional; the `sweepCursor` of the previous pass, where the orphan sweep resumes. Omit or pass null to start at the first key.
     * @param maxSweepObjects Optional; storage keys the orphan sweep inspects this pass, 1 to 1000 (defaults to 1000). Objects without an asset row, older than the signed URL lifetime plus one hour, are deleted.
     * @returns An object with deletion counts (commits, block versions, snapshots, merge requests, approvals), lists of deleted root IDs, asset IDs and swept storage keys, the next `sweepCursor`, the number of live roots processed, and a `done` flag (true when all due work is drained within budget).
     * @throws DATA_RETENTION_NOT_CONFIGURED if dataRetention is not configured.
     * @example
     * const result = await cmsClient.admin.runPruning({ dryRun: false, maxRoots: 10, maxDurationMs: 5000 });
     */
    runPruning: createCMSEndpoint(
      '/admin/runPruning',
      {
        method: 'POST',
        body: z.object({
          dryRun: z.boolean().optional().default(false),
          maxRoots: z.number().int().min(1).max(1000).optional(),
          maxDurationMs: z.number().int().min(100).optional(),
          liveRescanMs: z.number().int().min(0).optional(),
          maxAssets: z.number().int().min(1).max(1000).optional(),
          sweepCursor: z.string().max(2048).nullable().optional(),
          maxSweepObjects: z.number().int().min(1).max(1000).optional(),
        }),
        metadata: cmsMeta(
          {
            $Infer: {
              body: {} as {
                dryRun?: boolean;
                maxRoots?: number;
                maxDurationMs?: number;
                liveRescanMs?: number;
                maxAssets?: number;
                sweepCursor?: string | null;
                maxSweepObjects?: number;
              },
            },
          },
          { operation: 'delete', ...ADMIN_META },
        ),
      },
      async (ctx) => {
        if (!dataRetention) {
          throw new CMSError('DATA_RETENTION_NOT_CONFIGURED');
        }

        // One bounded, resumable pass (per-root transactions). Cron: ping
        // periodically and ignore `done`. Queue (Vercel/Upstash): re-enqueue
        // another pass while `done` is false to drain fast. The pass persists
        // its own progress (archived-root deletes self-drain; live roots rotate
        // via roots.lastPrunedAt), so no caller-side loop is required either way.
        return runPruningPass(db, cmsCtx, dataRetention, plugins, mediaConfig, {
          dryRun: ctx.body.dryRun,
          maxRoots: ctx.body.maxRoots,
          maxDurationMs: ctx.body.maxDurationMs,
          liveRescanMs: ctx.body.liveRescanMs,
          maxAssets: ctx.body.maxAssets,
          sweepCursor: ctx.body.sweepCursor,
          maxSweepObjects: ctx.body.maxSweepObjects,
        });
      },
    ),

    /**
     * Fills the asset and folder columns added for the media data model on rows written before them, one resumable batch per call: `originalName`, `variantKey` (parsed from the former variant slugs; unparseable variants become standalone assets), `width`/`height` from image headers, and folder paths. Idempotent.
     * @param cursor Optional; the `cursor` of the previous report. Omit to start.
     * @param limit Optional; assets per batch, 1 to 500 (defaults to 500).
     * @param dryRun Optional; report without writing.
     * @returns A report with `processed`, the next `cursor` (null when `done`), per-column update counts, `detachedVariants` and `dimensionsUnreadable`.
     * @example
     * let cursor = null;
     * do { ({ cursor } = await cms.api.admin.runMediaBackfill({ body: { cursor } })); } while (cursor);
     */
    runMediaBackfill: createCMSEndpoint(
      '/admin/runMediaBackfill',
      {
        method: 'POST',
        body: z.object({
          cursor: z.string().nullable().optional(),
          limit: z.number().int().min(1).max(500).optional(),
          dryRun: z.boolean().optional(),
        }),
        metadata: cmsMeta(
          {
            $Infer: {
              body: {} as {
                cursor?: string | null;
                limit?: number;
                dryRun?: boolean;
              },
            },
          },
          { operation: 'update', ...ADMIN_META },
        ),
      },
      async (ctx) => runMediaBackfill(db, mediaConfig, ctx.body ?? {}),
    ),

    /**
     * Processes the scheduled-publishing queue: every DUE row (scheduledAt <= now and not yet processed) is published or unpublished using the same machinery as the single endpoints, then stamped processed.
     * Designed for periodic cron invocation (mirrors runPruning). Publishing and expiry (scheduled unpublish) both drain through here. A row whose publish/unpublish fails is still marked processed and reported in `failed` so a permanently-broken intent never re-runs forever.
     * @param limit Optional; maximum number of due rows to process this pass (defaults to 100).
     * @returns An object with `processed` (rows attempted), `published`, `unpublished`, and a `failed` array of { id, rootId, branchId, action, error } for rows whose publish/unpublish threw.
     * @example
     * const result = await cmsClient.admin.runScheduled({ limit: 50 });
     */
    runScheduled: createCMSEndpoint(
      '/admin/runScheduled',
      {
        method: 'POST',
        body: z
          .object({
            limit: z.number().int().min(1).max(1000).optional(),
          })
          .optional(),
        metadata: cmsMeta(
          {
            $Infer: {
              body: {} as {
                limit?: number;
              },
            },
          },
          { operation: 'create', ...ADMIN_META },
        ),
      },
      async (ctx) => {
        // Thread the caller's request scope so a SCOPED runScheduled (e.g. a
        // per-tenant cron) only processes ITS scope's due rows and materializes
        // each slug within that scope. An unscoped/single-tenant cron passes an
        // empty scope → unchanged (all due rows).
        return runScheduledPass(
          db,
          cmsCtx,
          {
            limit: ctx.body?.limit,
            revalidationRunner,
          },
          ctx.context.scope,
        );
      },
    ),

    /**
     * Rebuilds the entire full-text search index from scratch, re-indexing all roots, comments, merge requests, variables, templates, assets, and notifications.
     * @returns An object with an `indexed` property containing counts of each entity type that was re-indexed.
     * @example
     * const result = await cmsClient.admin.reindexSearch();
     */
    reindexSearch: createCMSEndpoint(
      '/admin/reindexSearch',
      {
        method: 'POST',
        body: z.object({}).optional(),
        metadata: cmsMeta(
          {
            $Infer: { body: {} as Record<string, never> },
          },
          { operation: 'create', ...ADMIN_META },
        ),
      },
      async () => {
        const result = await reindexAll(
          db,
          cmsCtx.defaultBranchName ?? DEFAULT_BRANCH_NAME,
        );
        return result;
      },
    ),
  };
}
