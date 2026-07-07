import * as z from 'zod';

import type { CMSProcedureCtx, MediaConfig } from '../types';
import type { CMSPlugin } from '../types/plugin';

import { runPruningPass } from '../admin/pruning';
import { DEFAULT_BRANCH_NAME } from '../branch-policy';
import { cmsMeta, createCMSEndpoint } from '../endpoint';
import { CMSError } from '../errors';
import { reindexAll } from '../search/index-builder';

// ============================================================================
// Endpoint factory
// ============================================================================

const ADMIN_META = { scope: 'system' as const, permissionResource: 'admin' };

export function createAdminEndpoints(
  cmsCtx: CMSProcedureCtx,
  plugins: CMSPlugin[] = [],
  mediaConfig: MediaConfig,
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
     * @returns An object with deletion counts (commits, block versions, snapshots, merge requests, approvals), lists of deleted root IDs and asset IDs, the number of live roots processed, and a `done` flag (true when all due work is drained within budget).
     * @throws DATA_RETENTION_NOT_CONFIGURED if dataRetention is not configured.
     * @example
     * const result = await cmsClient.admin.runPruning({ body: { dryRun: false, maxRoots: 10, maxDurationMs: 5000 } });
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
        });
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
