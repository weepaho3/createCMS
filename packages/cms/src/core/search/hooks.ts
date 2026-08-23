import { sql } from 'drizzle-orm';

import type { DrizzleInstance } from '../types/drizzle';
import type { CMSAfterHook, CMSHookAction } from '../types/plugin';

import { searchIndex as searchIndexRef } from '../db/schema.generated';
import {
  indexAsset,
  indexComment,
  indexMergeRequest,
  indexRoot,
  indexTemplate,
  indexVariable,
  deleteSearchIndex,
} from './index-builder';

type IndexFn = (db: DrizzleInstance, id: string) => Promise<void>;

function fireAndForget(fn: () => Promise<void>): void {
  fn().catch((err) => {
    console.error('[cms:search] index update failed:', err);
  });
}

function createSearchAfterHook(
  action: CMSHookAction,
  extractId: (
    input: Record<string, unknown>,
    result: unknown,
  ) => string | undefined,
  indexFn: IndexFn,
): CMSAfterHook {
  return {
    action,
    handler: async (ctx) => {
      const id = extractId(ctx.input, ctx.result);
      if (!id) return;
      fireAndForget(() => indexFn(ctx.db, id));
    },
  };
}

function createDeleteAfterHook(
  action: CMSHookAction,
  entityType: string,
  extractId: (
    input: Record<string, unknown>,
    result: unknown,
  ) => string | undefined,
): CMSAfterHook {
  return {
    action,
    handler: async (ctx) => {
      const id = extractId(ctx.input, ctx.result);
      if (!id) return;
      fireAndForget(() => deleteSearchIndex(ctx.db, entityType, id));
    },
  };
}

const resultRootId = (_input: Record<string, unknown>, result: unknown) =>
  (result as { rootId?: string })?.rootId;

const inputRootId = (input: Record<string, unknown>) =>
  input.rootId as string | undefined;

/**
 * Creates the set of after-hooks that keep the search index in sync
 * with content mutations. Hooks fire asynchronously (fire-and-forget)
 * to avoid adding latency to the mutation response.
 */
export function createSearchHooks(defaultBranchName: string): CMSAfterHook[] {
  const indexRootFn: IndexFn = (db, id) => indexRoot(db, id, defaultBranchName);
  return [
    createSearchAfterHook('createRoot', resultRootId, indexRootFn),
    createSearchAfterHook('updateRoot', inputRootId, indexRootFn),
    createSearchAfterHook('updateBlock', inputRootId, indexRootFn),
    createSearchAfterHook('updateBlocks', inputRootId, indexRootFn),
    createSearchAfterHook('createBlock', inputRootId, indexRootFn),
    createSearchAfterHook('deleteBlock', inputRootId, indexRootFn),
    createSearchAfterHook('moveBlock', inputRootId, indexRootFn),
    createSearchAfterHook('duplicateBlock', inputRootId, indexRootFn),
    createSearchAfterHook('moveRoot', inputRootId, indexRootFn),
    createSearchAfterHook('executeMerge', inputRootId, indexRootFn),
    // Archiving a root removes it from the working set, so drop its entry.
    createDeleteAfterHook('archiveRoot', 'root', inputRootId),

    createSearchAfterHook(
      'createMergeRequest',
      (_input, result) =>
        (result as { mergeRequest?: { id?: string } })?.mergeRequest?.id,
      indexMergeRequest,
    ),
    createSearchAfterHook(
      'updateMergeRequest',
      (input) => input.mergeRequestId as string | undefined,
      indexMergeRequest,
    ),
    createSearchAfterHook(
      'closeMergeRequest',
      (input) => input.mergeRequestId as string | undefined,
      indexMergeRequest,
    ),
    createSearchAfterHook(
      'reopenMergeRequest',
      (input) => input.mergeRequestId as string | undefined,
      indexMergeRequest,
    ),

    createSearchAfterHook(
      'createCommentMessage',
      (_input, result) =>
        (result as { message?: { id?: string } })?.message?.id,
      indexComment,
    ),
    createSearchAfterHook(
      'updateCommentMessage',
      (input) => input.messageId as string | undefined,
      indexComment,
    ),
    {
      action: 'deleteCommentMessage',
      handler: async (ctx) => {
        const messageId = ctx.input.messageId as string | undefined;
        if (!messageId) return;
        fireAndForget(() => deleteSearchIndex(ctx.db, 'comment', messageId));
      },
    },

    createSearchAfterHook(
      'createVariable',
      (_input, result) => {
        const row = (result as { variable?: { id?: string } })?.variable;
        return row?.id;
      },
      indexVariable,
    ),
    createSearchAfterHook(
      'updateVariable',
      (_input, result) => {
        const row = (result as { variable?: { id?: string } })?.variable;
        return row?.id;
      },
      indexVariable,
    ),
    {
      action: 'deleteVariable',
      handler: async (ctx) => {
        // deleteVariable input carries `key`, not `id`, and the row is already
        // deleted when the after-hook runs, so delete by scanning the index
        // for the entity type + matching key.
        const key = ctx.input.key as string | undefined;
        if (!key) return;
        fireAndForget(async () => {
          await ctx.db.execute(sql`
            DELETE FROM ${searchIndexRef}
            WHERE ${searchIndexRef.entityType} = 'variable'
              AND ${searchIndexRef.meta}->>'key' = ${key}
          `);
        });
      },
    },

    // ---- Templates ----
    createSearchAfterHook(
      'createTemplate',
      (_input, result) => {
        const row = (result as { template?: { id?: string } })?.template;
        return row?.id;
      },
      indexTemplate,
    ),
    createSearchAfterHook(
      'updateTemplate',
      (_input, result) => {
        const row = (result as { template?: { id?: string } })?.template;
        return row?.id;
      },
      indexTemplate,
    ),
    createDeleteAfterHook(
      'deleteTemplate',
      'template',
      (input) => input.templateId as string | undefined,
    ),

    {
      action: 'uploadAssets',
      handler: async (ctx) => {
        const result = ctx.result as
          | { assets?: Array<{ id?: string }> }
          | undefined;
        const uploadedAssets = result?.assets;
        if (!uploadedAssets) return;
        for (const asset of uploadedAssets) {
          if (asset.id) {
            fireAndForget(() => indexAsset(ctx.db, asset.id!));
          }
        }
      },
    },
  ];
}
