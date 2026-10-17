import { APIError } from 'better-call';
import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  type SQL,
  sql,
} from 'drizzle-orm';
import * as z from 'zod';

import type { CMSProcedureContext, MediaConfig } from '../types';
import type { AssetMetadata } from '../types/asset-metadata';
import type { ResolvedScope } from '../types/definitions';
import type { DrizzleInstance } from '../types/drizzle';

import { assetFolders, assets } from '../db/schema.generated';
import { cmsMeta, createCMSEndpoint } from '../endpoint';
import { CMSError, errorMessages } from '../errors';
import { archiveAssetsInScope } from '../media/archive';
import { emitMediaEvents } from '../media/events';
import { purgeAssetPaths, setAssetsVisibility } from '../media/placement';
import { assertFolderExists } from '../media/uploads';
import {
  ASSET_PROVENANCES,
  assetMetadataSchema,
  mergeMetadata,
} from '../types/asset-metadata';

const MEDIA_META = {
  scope: 'system' as const,
  permissionResource: 'media' as const,
};

/** Upper bound of ids per `batchAssets` call. */
export const MEDIA_BATCH_LIMIT = 500;

type AssetRow = typeof assets.$inferSelect;

function liveAssetConditions(scope: ResolvedScope, ...extra: SQL[]): SQL[] {
  const conditions: SQL[] = [
    isNull(assets.archivedAt),
    isNull(assets.revisionOf),
    ...extra,
  ];
  if (scope.assets?.where) conditions.push(scope.assets.where);
  return conditions;
}

/** `metadata` unchanged once it passed the `AssetMetadata` schema. */
function validateMetadata(
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  const parsed = assetMetadataSchema.safeParse(metadata);
  if (!parsed.success) {
    throw new APIError(400, {
      code: 'VALIDATION_ERROR',
      message: `Invalid asset metadata: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'} ${issue.message}`)
        .join('; ')}`,
    });
  }
  return metadata;
}

export type BatchOperation =
  | { op: 'move'; folderId: string | null }
  | { op: 'archive'; force?: boolean }
  | { op: 'restore' }
  | { op: 'setStatus'; status: 'public' | 'private' }
  | {
      op: 'setProvenance';
      provenance: (typeof ASSET_PROVENANCES)[number];
    };

/**
 * Endpoints that edit an asset's descriptive data, restore it from the
 * trash, apply one operation to many assets, and manage its revisions.
 * `toItem` renders an asset row the way `listAssets` does.
 */
export function createMediaAssetEndpoints<TItem>(
  cmsCtx: CMSProcedureContext,
  mediaConfig: MediaConfig,
  toItem: (row: AssetRow) => TItem,
) {
  const { db } = cmsCtx;

  async function loadLive(
    tx: DrizzleInstance,
    assetId: string,
    scope: ResolvedScope,
  ): Promise<AssetRow> {
    const [row] = await tx
      .select()
      .from(assets)
      .where(and(...liveAssetConditions(scope, eq(assets.id, assetId))));
    if (!row) {
      throw new CMSError('ASSET_NOT_FOUND', {
        message: errorMessages.assetNotFound(assetId),
      });
    }
    return row;
  }

  async function writeMetadata(
    assetId: string,
    scope: ResolvedScope,
    patch: Record<string, unknown>,
    extra: Partial<Pick<AssetRow, 'provenance'>> = {},
  ) {
    const updated = await db.transaction(async (tx) => {
      const row = await loadLive(tx, assetId, scope);
      const metadata = validateMetadata(
        mergeMetadata(row.metadata ?? {}, patch),
      );
      const [next] = await tx
        .update(assets)
        .set({ metadata, ...extra, updatedAt: new Date() })
        .where(eq(assets.id, assetId))
        .returning();
      return next;
    });
    await emitMediaEvents(cmsCtx.realtime, scope, [
      { event: 'media.asset.updated', assetId },
    ]);
    return { asset: toItem(updated) };
  }

  async function restore(
    tx: DrizzleInstance,
    assetIds: string[],
    scope: ResolvedScope,
  ): Promise<string[]> {
    const conditions: SQL[] = [
      inArray(assets.id, assetIds),
      isNotNull(assets.archivedAt),
      isNull(assets.revisionOf),
      isNull(assets.variantOf),
    ];
    if (scope.assets?.where) conditions.push(scope.assets.where);
    const rows = await tx
      .select({
        id: assets.id,
        archivedAt: assets.archivedAt,
        folderId: assets.folderId,
      })
      .from(assets)
      .where(and(...conditions));
    if (rows.length === 0) return [];

    const now = new Date();
    for (const row of rows) {
      // Variants archived in the same operation come back; variants archived
      // earlier (e.g. by a replace) stay in the trash.
      await tx
        .update(assets)
        .set({ archivedAt: null, updatedAt: now })
        .where(
          and(
            eq(assets.variantOf, row.id),
            eq(assets.archivedAt, row.archivedAt!),
          ),
        );
    }
    // An asset whose folder went to the trash returns to the root level.
    const liveFolders = await tx
      .select({ id: assetFolders.id })
      .from(assetFolders)
      .where(
        and(
          inArray(
            assetFolders.id,
            rows.flatMap((r) => (r.folderId ? [r.folderId] : [])),
          ),
          isNull(assetFolders.archivedAt),
        ),
      );
    const live = new Set(liveFolders.map((f) => f.id));
    for (const row of rows) {
      await tx
        .update(assets)
        .set({
          archivedAt: null,
          folderId:
            row.folderId && live.has(row.folderId) ? row.folderId : null,
          updatedAt: now,
        })
        .where(eq(assets.id, row.id));
    }
    return rows.map((r) => r.id);
  }

  async function move(
    tx: DrizzleInstance,
    assetIds: string[],
    folderId: string | null,
    scope: ResolvedScope,
  ): Promise<string[]> {
    if (folderId) await assertFolderExists(tx, folderId, scope);
    const rows = await tx
      .select({ id: assets.id })
      .from(assets)
      .where(
        and(
          ...liveAssetConditions(
            scope,
            inArray(assets.id, assetIds),
            isNull(assets.variantOf),
          ),
        ),
      );
    const ids = rows.map((r) => r.id);
    if (ids.length === 0) return [];
    const now = new Date();
    await tx
      .update(assets)
      .set({ folderId, updatedAt: now })
      .where(inArray(assets.id, ids));
    await tx
      .update(assets)
      .set({ folderId, updatedAt: now })
      .where(and(inArray(assets.variantOf, ids), isNull(assets.archivedAt)));
    return ids;
  }

  return {
    /**
     * Edits an asset's display name, metadata and provenance with optimistic
     * concurrency: the write applies only when `expectedUpdatedAt` still
     * matches the asset's `updatedAt`. `patch.metadata` is merged key by key
     * into the stored metadata (`null` removes a key) and validated as a
     * whole; GPS and other EXIF outside the allowlist are rejected.
     *
     * @param assetId - The asset to edit.
     * @param patch - `{ originalName?, metadata?, provenance? }`.
     * @param expectedUpdatedAt - The `updatedAt` the edit is based on (ISO string).
     * @returns `{ asset }`, the updated asset.
     * @throws ASSET_CONFLICT (409) when the asset changed since; `data.asset` is the current asset.
     * @throws ASSET_NOT_FOUND if the asset is not live in scope.
     * @example await cmsClient.media.updateAsset({ assetId, patch: { originalName: 'Team.jpg' }, expectedUpdatedAt })
     */
    updateAsset: createCMSEndpoint(
      '/media/updateAsset',
      {
        method: 'POST',
        body: z.object({
          assetId: z.string(),
          patch: z.strictObject({
            originalName: z.string().trim().min(1).max(255).optional(),
            metadata: z.record(z.string(), z.unknown()).optional(),
            provenance: z.enum(ASSET_PROVENANCES).optional(),
          }),
          expectedUpdatedAt: z.iso.datetime({ offset: true }),
        }),
        metadata: cmsMeta({}, { operation: 'update', ...MEDIA_META }),
      },
      async (ctx) => {
        const { scope } = ctx.context;
        const { assetId, patch, expectedUpdatedAt } = ctx.body;
        const expected = new Date(expectedUpdatedAt);

        const updated = await db.transaction(async (tx) => {
          const row = await loadLive(tx, assetId, scope);
          if (row.updatedAt.getTime() !== expected.getTime()) {
            throw new CMSError('ASSET_CONFLICT', {
              data: { asset: toItem(row) },
            });
          }
          const metadata = patch.metadata
            ? validateMetadata(
                mergeMetadata(row.metadata ?? {}, patch.metadata),
              )
            : undefined;
          const set: Partial<AssetRow> = { updatedAt: new Date() };
          if (patch.originalName !== undefined)
            set.originalName = patch.originalName;
          if (metadata) set.metadata = metadata;
          if (patch.provenance) {
            set.provenance = patch.provenance;
            set.metadata = {
              ...(metadata ?? row.metadata),
              provenanceSource: 'user',
            };
          }
          // Compare at millisecond precision: the column keeps microseconds,
          // the client only ever saw the millisecond value.
          const [next] = await tx
            .update(assets)
            .set(set)
            .where(
              and(
                eq(assets.id, assetId),
                sql`date_trunc('milliseconds', ${assets.updatedAt}) = ${expected}`,
              ),
            )
            .returning();
          if (!next) {
            const current = await loadLive(tx, assetId, scope);
            throw new CMSError('ASSET_CONFLICT', {
              data: { asset: toItem(current) },
            });
          }
          return next;
        });

        await emitMediaEvents(cmsCtx.realtime, scope, [
          { event: 'media.asset.updated', assetId },
        ]);
        return { asset: toItem(updated) };
      },
    ),

    /**
     * Sets or clears the asset's focal point (`metadata.focal`, fractions of
     * width and height). Renderers use it as `object-position`.
     *
     * @param assetId - The asset.
     * @param focal - `{ x, y }` in 0..1, or `null` to clear it.
     * @returns `{ asset }`.
     * @throws ASSET_NOT_FOUND if the asset is not live in scope.
     */
    setFocalPoint: createCMSEndpoint(
      '/media/setFocalPoint',
      {
        method: 'POST',
        body: z.object({
          assetId: z.string(),
          focal: z
            .object({
              x: z.number().min(0).max(1),
              y: z.number().min(0).max(1),
            })
            .nullable(),
        }),
        metadata: cmsMeta({}, { operation: 'update', ...MEDIA_META }),
      },
      async (ctx) =>
        writeMetadata(ctx.body.assetId, ctx.context.scope, {
          focal: ctx.body.focal,
        }),
    ),

    /**
     * Sets the asset's provenance by hand and records the editor as its
     * source (`metadata.provenanceSource: 'user'`).
     *
     * @param assetId - The asset.
     * @param provenance - `unknown`, `captured`, `ai_generated` or `ai_edited`.
     * @returns `{ asset }`.
     * @throws ASSET_NOT_FOUND if the asset is not live in scope.
     */
    setProvenance: createCMSEndpoint(
      '/media/setProvenance',
      {
        method: 'POST',
        body: z.object({
          assetId: z.string(),
          provenance: z.enum(ASSET_PROVENANCES),
        }),
        metadata: cmsMeta({}, { operation: 'update', ...MEDIA_META }),
      },
      async (ctx) =>
        writeMetadata(
          ctx.body.assetId,
          ctx.context.scope,
          { provenanceSource: 'user' },
          { provenance: ctx.body.provenance },
        ),
    ),

    /**
     * Takes archived assets out of the trash, with the variants that were
     * archived together with them. An asset whose folder is in the trash
     * returns to the root level.
     *
     * @param assetIds - Archived asset ids (at least one).
     * @returns `{ restoredIds, skipped }`; `skipped` lists ids that matched no archived asset in scope.
     */
    restoreAssets: createCMSEndpoint(
      '/media/restoreAssets',
      {
        method: 'POST',
        body: z.object({
          assetIds: z.array(z.string()).min(1).max(MEDIA_BATCH_LIMIT),
        }),
        metadata: cmsMeta({}, { operation: 'update', ...MEDIA_META }),
      },
      async (ctx) => {
        const { scope } = ctx.context;
        const restoredIds = await db.transaction((tx) =>
          restore(tx, ctx.body.assetIds, scope),
        );
        await emitMediaEvents(
          cmsCtx.realtime,
          scope,
          restoredIds.map((assetId) => ({
            event: 'media.asset.restored',
            assetId,
          })),
        );
        return {
          restoredIds,
          skipped: ctx.body.assetIds.filter((id) => !restoredIds.includes(id)),
        };
      },
    ),

    /**
     * Applies one operation to up to 500 assets and reports the outcome per
     * id. Operations: `move` (to a folder or the root), `archive` (with the
     * usage guards of `archiveAssets`), `restore`, `setStatus`,
     * `setProvenance`.
     *
     * @param assetIds - 1 to 500 asset ids.
     * @param operation - The operation and its arguments.
     * @returns `{ results: { id, ok, error? }[] }` in input order; `error` is a code such as `ASSET_NOT_FOUND`, `in_use` or `richtext_suspect`.
     */
    batchAssets: createCMSEndpoint(
      '/media/batchAssets',
      {
        method: 'POST',
        body: z.object({
          assetIds: z.array(z.string()).min(1).max(MEDIA_BATCH_LIMIT),
          operation: z.discriminatedUnion('op', [
            z.object({
              op: z.literal('move'),
              folderId: z.string().nullable(),
            }),
            z.object({
              op: z.literal('archive'),
              force: z.boolean().optional(),
            }),
            z.object({ op: z.literal('restore') }),
            z.object({
              op: z.literal('setStatus'),
              status: z.enum(['public', 'private']),
            }),
            z.object({
              op: z.literal('setProvenance'),
              provenance: z.enum(ASSET_PROVENANCES),
            }),
          ]),
        }),
        metadata: cmsMeta({}, { operation: 'update', ...MEDIA_META }),
      },
      async (ctx) => {
        const { scope } = ctx.context;
        const { assetIds, operation } = ctx.body;
        const failures = new Map<string, string>();
        let ok: string[] = [];
        let event: Parameters<typeof emitMediaEvents>[2][number]['event'] =
          'media.asset.updated';

        switch (operation.op) {
          case 'move':
            ok = await db.transaction((tx) =>
              move(tx, assetIds, operation.folderId, scope),
            );
            break;
          case 'archive': {
            const result = await archiveAssetsInScope(db, assetIds, scope, {
              media: mediaConfig,
              force: operation.force,
            });
            ok = result.archivedIds.filter((id) => result.found.includes(id));
            for (const [id, reason] of Object.entries(result.skippedReasons)) {
              failures.set(id, reason);
            }
            event = 'media.asset.archived';
            await purgeAssetPaths(mediaConfig, ok);
            break;
          }
          case 'restore':
            ok = await db.transaction((tx) => restore(tx, assetIds, scope));
            event = 'media.asset.restored';
            break;
          case 'setStatus': {
            const live = await db
              .select({ id: assets.id })
              .from(assets)
              .where(
                and(
                  ...liveAssetConditions(scope, inArray(assets.id, assetIds)),
                ),
              );
            const result = await setAssetsVisibility(
              db,
              mediaConfig,
              live.map((r) => r.id),
              operation.status,
              scope,
            );
            ok = result.changed;
            for (const id of result.failed) failures.set(id, 'STORAGE_ERROR');
            break;
          }
          case 'setProvenance': {
            const updated = await db
              .update(assets)
              .set({
                provenance: operation.provenance,
                metadata: sql`${assets.metadata} || '{"provenanceSource":"user"}'::jsonb`,
                updatedAt: new Date(),
              })
              .where(
                and(
                  ...liveAssetConditions(scope, inArray(assets.id, assetIds)),
                ),
              )
              .returning({ id: assets.id });
            ok = updated.map((r) => r.id);
            break;
          }
        }

        await emitMediaEvents(
          cmsCtx.realtime,
          scope,
          ok.map((assetId) => ({ event, assetId })),
        );
        const done = new Set(ok);
        return {
          results: assetIds.map((id) =>
            done.has(id)
              ? { id, ok: true as const }
              : {
                  id,
                  ok: false as const,
                  error: failures.get(id) ?? 'ASSET_NOT_FOUND',
                },
          ),
        };
      },
    ),

    /**
     * The earlier revisions of an asset, newest first. A replace keeps the
     * superseded bytes as a revision.
     *
     * @param assetId - The asset.
     * @returns `{ revisions }`, each with `id`, `originalName`, `mimeType`, `size`, `width`, `height`, `note`, `uploadedBy`, `createdAt`.
     * @throws ASSET_NOT_FOUND if the asset is not live in scope.
     */
    listRevisions: createCMSEndpoint(
      '/media/listRevisions',
      {
        method: 'GET',
        query: z.object({ assetId: z.string() }),
        metadata: cmsMeta(
          { $Infer: { query: {} as { assetId: string } } },
          { operation: 'read', ...MEDIA_META },
        ),
      },
      async (ctx) => {
        const { scope } = ctx.context;
        await loadLive(db, ctx.query.assetId, scope);
        const rows = await db
          .select()
          .from(assets)
          .where(eq(assets.revisionOf, ctx.query.assetId))
          .orderBy(desc(assets.createdAt));
        return {
          revisions: rows.map((row) => ({
            id: row.id,
            originalName: row.originalName ?? row.slug,
            mimeType: row.mimeType,
            size: row.size,
            width: row.width ?? null,
            height: row.height ?? null,
            note: (row.metadata as AssetMetadata).revisionNote ?? null,
            uploadedBy: row.uploadedBy ?? null,
            createdAt: row.createdAt,
          })),
        };
      },
    ),

    /**
     * Makes a revision the current bytes of the asset again. The asset keeps
     * its id; its current bytes become the newest revision. Live variants
     * are archived (they belong to the replaced bytes), and the object moves
     * to the prefix matching the asset's status.
     *
     * @param assetId - The asset.
     * @param revisionId - One of its revisions (`listRevisions`).
     * @returns `{ asset }`, the asset with the restored bytes.
     * @throws ASSET_NOT_FOUND if the asset is not live in scope.
     * @throws REVISION_NOT_FOUND if revisionId is not a revision of the asset.
     */
    setCurrentRevision: createCMSEndpoint(
      '/media/setCurrentRevision',
      {
        method: 'POST',
        body: z.object({ assetId: z.string(), revisionId: z.string() }),
        metadata: cmsMeta({}, { operation: 'update', ...MEDIA_META }),
      },
      async (ctx) => {
        const { scope } = ctx.context;
        const { assetId, revisionId } = ctx.body;

        const status = await db.transaction(async (tx) => {
          const current = await loadLive(tx, assetId, scope);
          const [revision] = await tx
            .select()
            .from(assets)
            .where(
              and(eq(assets.id, revisionId), eq(assets.revisionOf, assetId)),
            );
          if (!revision) throw new CMSError('REVISION_NOT_FOUND');

          const now = new Date();
          const bytes = (row: AssetRow) => ({
            slug: row.slug,
            objectKey: row.objectKey,
            mimeType: row.mimeType,
            size: row.size,
            width: row.width,
            height: row.height,
            sha256: row.sha256,
            originalName: row.originalName,
            provenance: row.provenance,
          });
          // objectKey is unique: free the revision's key before the swap.
          await tx
            .update(assets)
            .set({ objectKey: `${revision.objectKey}#swap` })
            .where(eq(assets.id, revisionId));
          await tx
            .update(assets)
            .set({ ...bytes(revision), updatedAt: now })
            .where(eq(assets.id, assetId));
          await tx
            .update(assets)
            // now(), like the column default, so revision order holds.
            .set({ ...bytes(current), createdAt: sql`now()`, updatedAt: now })
            .where(eq(assets.id, revisionId));
          await tx
            .update(assets)
            .set({ archivedAt: now, updatedAt: now })
            .where(
              and(eq(assets.variantOf, assetId), isNull(assets.archivedAt)),
            );
          return current.status;
        });

        // The restored bytes may sit under the other visibility prefix.
        await setAssetsVisibility(db, mediaConfig, [assetId], status, scope);
        await purgeAssetPaths(mediaConfig, [assetId]);
        await emitMediaEvents(cmsCtx.realtime, scope, [
          { event: 'media.asset.replaced', assetId, revisionId },
        ]);
        const row = await loadLive(db, assetId, scope);
        return { asset: toItem(row) };
      },
    ),
  };
}
