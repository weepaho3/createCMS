import {
  and,
  asc,
  eq,
  inArray,
  isNull,
  ne,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import * as z from 'zod';

import type { CMSProcedureContext } from '../types';
import type { ResolvedScope } from '../types/definitions';
import type { DrizzleInstance } from '../types/drizzle';

import { newId } from '../../utils/nanoid';
import { assetFolders, assets } from '../db/schema.generated';
import { cmsMeta, createCMSEndpoint } from '../endpoint';
import { CMSError, errorMessages } from '../errors';
import { emitMediaEvents } from '../media/events';
import { backfillFolderPaths } from '../media/folder-paths';
import {
  assetsReferencedByLiveContent,
  assetsSuspectedInRichText,
} from '../media/usage';
import { crossScopeColumns, scopedInsert } from '../scope';

const MEDIA_META = {
  scope: 'system' as const,
  permissionResource: 'media' as const,
};

type FolderRow = {
  id: string;
  name: string;
  parentId: string | null;
  path: string | null;
  depth: number | null;
  createdBy: string | null;
  createdAt: Date;
};

const folderColumns = {
  id: assetFolders.id,
  name: assetFolders.name,
  parentId: assetFolders.parentId,
  path: assetFolders.path,
  depth: assetFolders.depth,
  createdBy: assetFolders.createdBy,
  createdAt: assetFolders.createdAt,
};

function toFolder(row: FolderRow) {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parentId ?? null,
    createdBy: row.createdBy ?? null,
    createdAt: row.createdAt,
  };
}

async function ensureFolderPaths(db: DrizzleInstance): Promise<void> {
  const [missing] = await db
    .select({ id: assetFolders.id })
    .from(assetFolders)
    .where(isNull(assetFolders.path))
    .limit(1);
  if (missing) await backfillFolderPaths(db);
}

function liveFolderConditions(scope: ResolvedScope, ...extra: SQL[]): SQL[] {
  const conditions: SQL[] = [isNull(assetFolders.archivedAt), ...extra];
  if (scope.assetFolders?.where) conditions.push(scope.assetFolders.where);
  return conditions;
}

function liveAssetConditions(scope: ResolvedScope, ...extra: SQL[]): SQL[] {
  const conditions: SQL[] = [isNull(assets.archivedAt), ...extra];
  if (scope.assets?.where) conditions.push(scope.assets.where);
  return conditions;
}

export function createMediaFolderEndpoints(cmsCtx: CMSProcedureContext) {
  const { db } = cmsCtx;

  async function loadFolder(
    tx: DrizzleInstance,
    folderId: string,
    scope: ResolvedScope,
    notFound: 'FOLDER_NOT_FOUND' | 'PARENT_NOT_FOUND' = 'FOLDER_NOT_FOUND',
  ): Promise<FolderRow & { path: string; depth: number }> {
    await ensureFolderPaths(tx);
    const [row] = await tx
      .select(folderColumns)
      .from(assetFolders)
      .where(
        and(...liveFolderConditions(scope, eq(assetFolders.id, folderId))),
      );
    if (!row) {
      throw new CMSError(notFound, {
        message:
          notFound === 'FOLDER_NOT_FOUND'
            ? errorMessages.folderNotFound(folderId)
            : errorMessages.parentNotFound(folderId),
      });
    }
    return { ...row, path: row.path!, depth: row.depth ?? 0 };
  }

  /**
   * Throws FOLDER_NAME_TAKEN when a live folder in scope already has `name`
   * under `parentId`. Root names have no core unique index (see
   * core-schema.ts), so this check is their guarantee without a scoping
   * plugin.
   */
  async function assertNameFree(
    tx: DrizzleInstance,
    parentId: string | null,
    name: string,
    scope: ResolvedScope,
    exceptId?: string,
  ) {
    const extra: SQL[] = [
      parentId
        ? eq(assetFolders.parentId, parentId)
        : isNull(assetFolders.parentId),
      eq(assetFolders.name, name),
    ];
    if (exceptId) extra.push(ne(assetFolders.id, exceptId));
    const [taken] = await tx
      .select({ id: assetFolders.id })
      .from(assetFolders)
      .where(and(...liveFolderConditions(scope, ...extra)))
      .limit(1);
    if (taken) throw new CMSError('FOLDER_NAME_TAKEN');
  }

  function rethrowNameConflict(err: unknown): never {
    const code =
      (err as { code?: string; cause?: { code?: string } }).code ??
      (err as { cause?: { code?: string } }).cause?.code;
    if (code === '23505') throw new CMSError('FOLDER_NAME_TAKEN');
    throw err;
  }

  /** Reparents `folder` and rewrites the paths of its whole subtree. */
  async function reparent(
    tx: DrizzleInstance,
    folder: { id: string; path: string; depth: number },
    parent: { id: string; path: string; depth: number } | null,
    scope: ResolvedScope,
  ) {
    const newPath = `${parent ? parent.path : '/'}${folder.id}/`;
    const delta = (parent ? parent.depth + 1 : 0) - folder.depth;
    const scopeWhere = scope.assetFolders?.where;
    await tx
      .update(assetFolders)
      .set({ parentId: parent?.id ?? null, updatedAt: new Date() })
      .where(eq(assetFolders.id, folder.id));
    await tx.execute(sql`
      UPDATE cms.asset_folders
         SET path = ${newPath} || substr(path, length(${folder.path}) + 1),
             depth = depth + ${delta}
       WHERE starts_with(path, ${folder.path})
         ${scopeWhere ? sql`AND ${scopeWhere}` : sql``}
    `);
  }

  return {
    /**
     * Creates a new folder in the asset library.
     *
     * @param name - Folder name, unique among the live siblings.
     * @param parentFolderId - Optional parent folder id; if omitted, creates a root-level folder.
     * @returns The created folder (id, name, parentId, createdBy, createdAt).
     * @throws PARENT_NOT_FOUND if parentFolderId does not reference a live folder.
     * @throws FOLDER_NAME_TAKEN if a sibling already has this name.
     * @example await cmsClient.media.createFolder({ name: 'Images' })
     */
    createFolder: createCMSEndpoint(
      '/media/createFolder',
      {
        method: 'POST',
        body: z.object({
          name: z.string().trim().min(1).max(255),
          parentFolderId: z.string().optional(),
        }),
        metadata: cmsMeta({}, { operation: 'create', ...MEDIA_META }),
      },
      async (ctx) => {
        const { userId: actor, scope } = ctx.context;
        const { name, parentFolderId } = ctx.body;
        const parent = parentFolderId
          ? await loadFolder(db, parentFolderId, scope, 'PARENT_NOT_FOUND')
          : null;
        await assertNameFree(db, parent?.id ?? null, name, scope);

        const id = newId('assetFolder');
        const folder = await scopedInsert(
          db,
          'cms.asset_folders',
          {
            id,
            name,
            parent_id: parent?.id ?? null,
            path: `${parent ? parent.path : '/'}${id}/`,
            depth: parent ? parent.depth + 1 : 0,
            created_by: actor ?? null,
          },
          scope.assetFolders,
        ).catch(rethrowNameConflict);

        await emitMediaEvents(cmsCtx.realtime, scope, [
          { event: 'media.folder.created', folderId: id },
        ]);
        return {
          folder: {
            id: folder.id,
            name: folder.name,
            parentId: folder.parent_id ?? null,
            createdBy: folder.created_by ?? null,
            createdAt: folder.created_at,
          },
        };
      },
    ),

    /**
     * Renames a folder.
     *
     * @param folderId - The folder to rename.
     * @param name - The new name, unique among the live siblings.
     * @returns The renamed folder.
     * @throws FOLDER_NOT_FOUND if folderId is not a live folder in scope.
     * @throws FOLDER_NAME_TAKEN if a sibling already has this name.
     * @example await cmsClient.media.renameFolder({ folderId, name: 'Brand' })
     */
    renameFolder: createCMSEndpoint(
      '/media/renameFolder',
      {
        method: 'POST',
        body: z.object({
          folderId: z.string(),
          name: z.string().trim().min(1).max(255),
        }),
        metadata: cmsMeta({}, { operation: 'update', ...MEDIA_META }),
      },
      async (ctx) => {
        const { scope } = ctx.context;
        const { folderId, name } = ctx.body;
        const folder = await loadFolder(db, folderId, scope);
        await assertNameFree(db, folder.parentId, name, scope, folderId);
        const [renamed] = await db
          .update(assetFolders)
          .set({ name, updatedAt: new Date() })
          .where(eq(assetFolders.id, folderId))
          .returning(folderColumns)
          .catch(rethrowNameConflict);
        await emitMediaEvents(cmsCtx.realtime, scope, [
          { event: 'media.folder.renamed', folderId },
        ]);
        return { folder: toFolder(renamed) };
      },
    ),

    /**
     * Moves a folder (and its subtree) to a new parent or to the root level.
     *
     * @param folderId - The folder to move.
     * @param newParentFolderId - New parent folder id. Omit or pass `null` to move it to the root level.
     * @returns The updated folder.
     * @throws FOLDER_NOT_FOUND if folderId does not exist.
     * @throws PARENT_NOT_FOUND if newParentFolderId does not exist.
     * @throws CANNOT_MOVE_INTO_SELF if folderId equals newParentFolderId.
     * @throws CANNOT_MOVE_INTO_DESCENDANT if newParentFolderId is a descendant of folderId.
     * @throws FOLDER_NAME_TAKEN if the new parent already has a folder with this name.
     */
    moveFolder: createCMSEndpoint(
      '/media/moveFolder',
      {
        method: 'POST',
        body: z.object({
          folderId: z.string(),
          newParentFolderId: z.string().nullable().optional(),
        }),
        metadata: cmsMeta({}, { operation: 'update', ...MEDIA_META }),
      },
      async (ctx) => {
        const { scope } = ctx.context;
        const { folderId, newParentFolderId } = ctx.body;
        if (newParentFolderId === folderId) {
          throw new CMSError('CANNOT_MOVE_INTO_SELF');
        }

        const moved = await db.transaction(async (tx) => {
          const folder = await loadFolder(tx, folderId, scope);
          const parent = newParentFolderId
            ? await loadFolder(tx, newParentFolderId, scope, 'PARENT_NOT_FOUND')
            : null;
          if (parent && parent.path.startsWith(folder.path)) {
            throw new CMSError('CANNOT_MOVE_INTO_DESCENDANT');
          }
          await assertNameFree(
            tx,
            parent?.id ?? null,
            folder.name,
            scope,
            folderId,
          );
          await reparent(tx, folder, parent, scope).catch(rethrowNameConflict);
          const [row] = await tx
            .select(folderColumns)
            .from(assetFolders)
            .where(eq(assetFolders.id, folderId));
          return row;
        });

        await emitMediaEvents(cmsCtx.realtime, scope, [
          { event: 'media.folder.moved', folderId },
        ]);
        return { folder: toFolder(moved) };
      },
    ),

    /**
     * The folders from the root down to `folderId`, in order, the folder
     * itself last. Use it to render breadcrumbs for a folder opened by id.
     *
     * @param folderId - The folder to resolve.
     * @returns `{ path }`, root first.
     * @throws FOLDER_NOT_FOUND if folderId is not a live folder in scope.
     * @example await cmsClient.media.getFolderPath({ folderId })
     */
    getFolderPath: createCMSEndpoint(
      '/media/getFolderPath',
      {
        method: 'GET',
        query: z.object({ folderId: z.string() }),
        metadata: cmsMeta(
          { $Infer: { query: {} as { folderId: string } } },
          { operation: 'read', ...MEDIA_META },
        ),
      },
      async (ctx) => {
        const { scope } = ctx.context;
        const folder = await loadFolder(db, ctx.query.folderId, scope);
        const ids = folder.path.split('/').filter(Boolean);
        const rows = await db
          .select(folderColumns)
          .from(assetFolders)
          .where(
            and(...liveFolderConditions(scope, inArray(assetFolders.id, ids))),
          );
        const byId = new Map(rows.map((row) => [row.id, row]));
        return {
          path: ids.flatMap((id) => {
            const row = byId.get(id);
            return row ? [toFolder(row)] : [];
          }),
        };
      },
    ),

    /**
     * Lists the live folders of one level: the children of `parentFolderId`,
     * or the root level when omitted. Each folder carries `assetCount` (live
     * assets directly in it) and `assetCountRecursive` (including all
     * subfolders), counting originals in scope only.
     *
     * @param parentFolderId - Optional parent folder id.
     * @returns The direct child folders, sorted by name.
     * @example await cmsClient.media.listFolders()
     * @example await cmsClient.media.listFolders({ parentFolderId })
     */
    listFolders: createCMSEndpoint(
      '/media/listFolders',
      {
        method: 'GET',
        query: z.object({ parentFolderId: z.string().optional() }).optional(),
        metadata: cmsMeta(
          { $Infer: { query: {} as { parentFolderId?: string } } },
          { operation: 'read', ...MEDIA_META },
        ),
      },
      async (ctx) => {
        const { scope } = ctx.context;
        const parentFolderId = ctx.query?.parentFolderId;
        await ensureFolderPaths(db);

        const assetScope = scope.assets?.where
          ? sql`AND ${scope.assets.where}`
          : sql``;
        const rows = await db
          .select({
            ...folderColumns,
            // The outer folder is referenced fully qualified: inside these
            // subqueries an unqualified column resolves to the inner table.
            assetCount: sql<number>`(
              SELECT count(*)::int FROM cms.assets
               WHERE cms.assets.folder_id = "cms"."asset_folders"."id"
                 AND cms.assets.archived_at IS NULL
                 AND cms.assets.variant_of IS NULL
                 ${assetScope}
            )`,
            assetCountRecursive: sql<number>`(
              SELECT count(*)::int FROM cms.assets
                JOIN cms.asset_folders AS d ON d.id = cms.assets.folder_id
               WHERE starts_with(d.path, "cms"."asset_folders"."path")
                 AND d.archived_at IS NULL
                 AND cms.assets.archived_at IS NULL
                 AND cms.assets.variant_of IS NULL
                 ${assetScope}
            )`,
          })
          .from(assetFolders)
          .where(
            and(
              ...liveFolderConditions(
                scope,
                parentFolderId
                  ? eq(assetFolders.parentId, parentFolderId)
                  : isNull(assetFolders.parentId),
              ),
            ),
          )
          .orderBy(asc(assetFolders.name));

        return {
          folders: rows.map((row) => ({
            ...toFolder(row),
            assetCount: row.assetCount,
            assetCountRecursive: row.assetCountRecursive,
          })),
        };
      },
    ),

    /**
     * Deletes a folder by one of three modes; deleted folders go to the
     * trash (`archivedAt`), never cascade.
     *
     * - `empty-only` (default): only a folder without live assets or
     *   subfolders.
     * - `move-to-parent`: its direct subfolders and assets move one level up.
     * - `archive-contents`: every folder and asset of the subtree is
     *   archived; assets still in use (or suspected in rich text) are skipped
     *   and moved to the parent instead.
     *
     * With `dryRun`, nothing changes and the counts preview the deletion.
     *
     * @returns `{ folderId, folders, assets, assetsInUse, skipped }`: folders and assets in the subtree (the folder itself excluded), how many assets are in use, and the ids skipped by `archive-contents`.
     * @throws FOLDER_NOT_FOUND if folderId does not exist.
     * @throws FOLDER_HAS_CONTENT for `empty-only` on a folder with content.
     * @throws FOLDER_NAME_TAKEN for `move-to-parent` when a subfolder's name is taken in the parent.
     */
    deleteFolder: createCMSEndpoint(
      '/media/deleteFolder',
      {
        method: 'POST',
        body: z.object({
          folderId: z.string(),
          mode: z
            .enum(['empty-only', 'move-to-parent', 'archive-contents'])
            .optional(),
          dryRun: z.boolean().optional(),
        }),
        metadata: cmsMeta({}, { operation: 'delete', ...MEDIA_META }),
      },
      async (ctx) => {
        const { scope } = ctx.context;
        const { folderId, dryRun } = ctx.body;
        const mode = ctx.body.mode ?? 'empty-only';

        const result = await db.transaction(async (tx) => {
          const folder = await loadFolder(tx, folderId, scope);
          const subtree = await tx
            .select({ id: assetFolders.id })
            .from(assetFolders)
            .where(
              and(
                ...liveFolderConditions(
                  scope,
                  sql`starts_with(${assetFolders.path}, ${folder.path})`,
                ),
              ),
            );
          const subtreeIds = subtree.map((f) => f.id);
          const assetRows = await tx
            .select({ id: assets.id, folderId: assets.folderId })
            .from(assets)
            .where(
              and(
                ...liveAssetConditions(
                  scope,
                  inArray(assets.folderId, subtreeIds),
                  isNull(assets.variantOf),
                ),
              ),
            );
          const assetIds = assetRows.map((a) => a.id);
          const scopeColumns = crossScopeColumns(scope.roots);
          const inUse = await assetsReferencedByLiveContent(
            tx,
            assetIds,
            scopeColumns,
          );
          const summary = {
            folderId,
            folders: subtreeIds.length - 1,
            assets: assetIds.length,
            assetsInUse: inUse.size,
            skipped: [] as string[],
          };
          if (dryRun) return summary;

          const now = new Date();
          const archiveFolders = (ids: string[]) =>
            tx
              .update(assetFolders)
              .set({ archivedAt: now, updatedAt: now })
              .where(inArray(assetFolders.id, ids));

          if (mode === 'empty-only') {
            if (summary.folders > 0 || summary.assets > 0) {
              throw new CMSError('FOLDER_HAS_CONTENT', {
                message: errorMessages.folderHasContent(folderId),
              });
            }
            await archiveFolders([folderId]);
            return summary;
          }

          const parent = folder.parentId
            ? await loadFolder(tx, folder.parentId, scope)
            : null;

          if (mode === 'move-to-parent') {
            const children = await tx
              .select(folderColumns)
              .from(assetFolders)
              .where(
                and(
                  ...liveFolderConditions(
                    scope,
                    eq(assetFolders.parentId, folderId),
                  ),
                ),
              );
            for (const child of children) {
              await assertNameFree(tx, parent?.id ?? null, child.name, scope);
              await reparent(
                tx,
                { id: child.id, path: child.path!, depth: child.depth ?? 0 },
                parent,
                scope,
              );
            }
            await tx
              .update(assets)
              .set({ folderId: parent?.id ?? null, updatedAt: now })
              .where(
                and(
                  ...liveAssetConditions(scope, eq(assets.folderId, folderId)),
                ),
              );
            await archiveFolders([folderId]);
            return summary;
          }

          const suspected =
            cmsCtx.media?.guardRichTextReferences === false
              ? new Set<string>()
              : await assetsSuspectedInRichText(
                  tx,
                  assetIds.filter((id) => !inUse.has(id)),
                  scopeColumns,
                );
          const keep = assetIds.filter(
            (id) => inUse.has(id) || suspected.has(id),
          );
          const toArchive = assetIds.filter((id) => !keep.includes(id));
          if (keep.length > 0) {
            await tx
              .update(assets)
              .set({ folderId: parent?.id ?? null, updatedAt: now })
              .where(inArray(assets.id, keep));
          }
          if (toArchive.length > 0) {
            await tx
              .update(assets)
              .set({ archivedAt: now, updatedAt: now })
              .where(
                and(
                  or(
                    inArray(assets.id, toArchive),
                    inArray(assets.variantOf, toArchive),
                  )!,
                  isNull(assets.archivedAt),
                ),
              );
          }
          await archiveFolders(subtreeIds);
          return { ...summary, skipped: keep };
        });

        if (!dryRun) {
          await emitMediaEvents(cmsCtx.realtime, scope, [
            { event: 'media.folder.deleted', folderId },
          ]);
        }
        return result;
      },
    ),
  };
}
