import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import * as z from 'zod';

import type { CMSProcedureContext, MediaConfig } from '../types';

import { newId } from '../../utils/nanoid';
import { assetFolders, assets, mediaExports } from '../db/schema.generated';
import { cmsMeta, createCMSEndpoint } from '../endpoint';
import { CMSError } from '../errors';
import {
  BULK_TARGET_MESSAGE,
  bulkTargetFields,
  bulkTargetIds,
  hasBulkTarget,
} from '../media/asset-filter';
import {
  contentDisposition,
  safeDownloadName,
} from '../media/content-disposition';
import { scopeFingerprint } from '../media/upload-token';
import { assetUsageCounts } from '../media/usage';
import {
  type ExportEntry,
  manifestEntry,
  MAX_ACTIVE_EXPORTS,
  runZipExport,
} from '../media/zip-export';
import {
  sanitizeZipPath,
  uniqueZipPaths,
  zipLength,
} from '../media/zip-layout';
import { crossScopeColumns } from '../scope';
import { requireCapability } from '../storage/adapter';
import { getStorage } from '../storage/get-storage';

const MEDIA_META = {
  scope: 'system' as const,
  permissionResource: 'media' as const,
};

/** Most assets one export may hold. */
export const EXPORT_ASSET_LIMIT = 10_000;
/** Wall-clock budget of one background run; the pruning pass continues. */
const EXPORT_RUN_MS = 15 * 60 * 1000;
/** Lifetime of the signed URL of a finished archive. */
const EXPORT_URL_SECONDS = 300;

type ExportRow = typeof mediaExports.$inferSelect;

/**
 * Endpoints that write a ZIP archive of many assets on the server, for
 * downloads too large for the browser (or Safari on iOS), and hand out a
 * signed URL once it is ready.
 */
export function createMediaExportEndpoints(
  cmsCtx: CMSProcedureContext,
  mediaConfig: MediaConfig,
) {
  const { db } = cmsCtx;

  async function ownExport(
    id: string,
    userId: string | undefined,
    scope: { assets?: { insertColumns?: Record<string, unknown> } },
  ): Promise<ExportRow> {
    const [row] = await db
      .select()
      .from(mediaExports)
      .where(eq(mediaExports.id, id))
      .limit(1);
    if (
      !row ||
      row.createdBy !== (userId ?? null) ||
      row.scope !== (await scopeFingerprint(scope.assets?.insertColumns))
    ) {
      throw new CMSError('EXPORT_NOT_FOUND');
    }
    return row;
  }

  async function view(row: ExportRow) {
    const entries = row.entries as ExportEntry[];
    let url: string | null = null;
    if (row.status === 'ready') {
      const storage = getStorage(mediaConfig);
      url = await storage.signGet(row.objectKey, {
        expiresIn: Math.min(
          EXPORT_URL_SECONDS,
          storage.capabilities.signedGet.maxExpiresIn,
        ),
        responseContentDisposition: contentDisposition(
          row.name,
          'application/zip',
        ),
      });
    }
    return {
      id: row.id,
      name: row.name,
      status: row.status,
      files: entries.filter((e) => e.assetId !== null && !e.skipped).length,
      skipped: entries
        .filter((e) => e.assetId !== null && e.skipped)
        .map((e) => e.assetId!),
      loaded: row.writtenBytes,
      total: row.totalBytes,
      url,
      error: row.error,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt?.toISOString() ?? null,
    };
  }

  function start(id: string) {
    const task = async () => {
      try {
        await runZipExport(
          db,
          mediaConfig,
          cmsCtx.realtime,
          id,
          Date.now() + EXPORT_RUN_MS,
        );
      } catch (err) {
        console.error(`[cms] media export ${id} failed:`, err);
      }
    };
    if (mediaConfig.runExport) mediaConfig.runExport(task);
    else void task();
  }

  return {
    /**
     * Starts writing a ZIP archive of assets on the server. The archive
     * holds the originals (folders as directories unless `flatten`), with
     * the same names as a browser download and an optional `manifest.csv`.
     * Poll `getZipExport` or listen for `media.export.ready`; the archive
     * stays downloadable for 24 hours.
     *
     * @param assetIds - Asset ids, or `allMatching` for a server-side selection (up to 10,000 assets).
     * @param name - Archive file name; `.zip` is appended when missing.
     * @param flatten - Put every file at the top level.
     * @param manifest - Add `manifest.csv` (id, path, size, usage count).
     * @returns `{ export }`, the export as `getZipExport` returns it.
     * @throws RATE_LIMITED (429) when the caller already has 3 unfinished exports.
     * @throws STORAGE_UNSUPPORTED when the storage cannot write multipart uploads or sign reads with a disposition.
     * @example const { export: job } = await cmsClient.media.createZipExport({ assetIds: ['ast_1', 'ast_2'], name: 'campaign' })
     */
    createZipExport: createCMSEndpoint(
      '/media/createZipExport',
      {
        method: 'POST',
        body: z
          .object({
            assetIds: bulkTargetFields.assetIds
              .unwrap()
              .max(EXPORT_ASSET_LIMIT)
              .optional(),
            allMatching: bulkTargetFields.allMatching,
            name: z.string().min(1).max(200).optional(),
            flatten: z.boolean().optional(),
            manifest: z.boolean().optional(),
          })
          .refine(hasBulkTarget, BULK_TARGET_MESSAGE),
        metadata: cmsMeta({}, { operation: 'read', ...MEDIA_META }),
      },
      async (ctx) => {
        const { scope, userId } = ctx.context;
        const storage = getStorage(mediaConfig);
        requireCapability(
          storage,
          (c) =>
            c.multipart.supported &&
            c.signedGet.supported &&
            c.signedGet.disposition,
          'multipart uploads and signed URLs with a bound content disposition',
        );

        const active = await db
          .select({ id: mediaExports.id })
          .from(mediaExports)
          .where(
            and(
              userId
                ? eq(mediaExports.createdBy, userId)
                : isNull(mediaExports.createdBy),
              inArray(mediaExports.status, ['pending', 'running']),
            ),
          )
          .limit(MAX_ACTIVE_EXPORTS);
        if (active.length >= MAX_ACTIVE_EXPORTS) {
          throw new CMSError('RATE_LIMITED', {
            message: `At most ${MAX_ACTIVE_EXPORTS} exports run at once; wait for one to finish`,
            headers: { 'retry-after': '60' },
            data: { retryAfter: 60 },
          });
        }

        const ids = await bulkTargetIds(db, ctx.body, scope);
        const conditions = [
          isNull(assets.archivedAt),
          isNull(assets.revisionOf),
          isNull(assets.variantOf),
          eq(assets.processingState, 'ready'),
        ];
        if (scope.assets?.where) conditions.push(scope.assets.where);
        const found = new Map<string, typeof assets.$inferSelect>();
        for (let i = 0; i < ids.length; i += 1000) {
          const rows = await db
            .select()
            .from(assets)
            .where(
              and(inArray(assets.id, ids.slice(i, i + 1000)), ...conditions),
            );
          for (const row of rows) found.set(row.id, row);
        }
        const rows = ids.flatMap((id) => found.get(id) ?? []);

        const folderPaths = new Map<string, string>();
        if (!ctx.body.flatten) {
          const folderIds = [
            ...new Set(rows.flatMap((row) => row.folderId ?? [])),
          ];
          const folders = folderIds.length
            ? await db
                .select({ id: assetFolders.id, path: assetFolders.path })
                .from(assetFolders)
                .where(inArray(assetFolders.id, folderIds))
            : [];
          const ancestorIds = [
            ...new Set(
              folders.flatMap((f) => (f.path ?? '').split('/').filter(Boolean)),
            ),
          ];
          const names = new Map(
            (ancestorIds.length
              ? await db
                  .select({ id: assetFolders.id, name: assetFolders.name })
                  .from(assetFolders)
                  .where(inArray(assetFolders.id, ancestorIds))
              : []
            ).map((f) => [f.id, f.name]),
          );
          for (const folder of folders) {
            const segments = (folder.path ?? `/${folder.id}/`)
              .split('/')
              .filter(Boolean)
              .map((id) => names.get(id) ?? id);
            folderPaths.set(folder.id, segments.join('/'));
          }
        }

        const paths = uniqueZipPaths(
          rows.map((row) => {
            const file = safeDownloadName(
              row.originalName ?? row.slug,
              row.mimeType,
            );
            const folder = row.folderId ? folderPaths.get(row.folderId) : null;
            return sanitizeZipPath(folder ? `${folder}/${file}` : file);
          }),
        );
        const usage: Record<string, { roots: number }> = {};
        if (ctx.body.manifest) {
          for (let i = 0; i < rows.length; i += 500) {
            Object.assign(
              usage,
              await assetUsageCounts(
                db,
                rows.slice(i, i + 500).map((row) => row.id),
                'live',
                crossScopeColumns(scope.roots),
              ),
            );
          }
        }
        const entries: ExportEntry[] = rows.map((row, i) => {
          const entry: ExportEntry = {
            assetId: row.id,
            objectKey: row.objectKey,
            name: paths[i],
            size: row.size,
            crc: null,
          };
          if (ctx.body.manifest) entry.usage = usage[row.id]?.roots ?? 0;
          return entry;
        });
        if (ctx.body.manifest) entries.push(manifestEntry(entries));

        const base = ctx.body.name ?? 'media';
        const name = sanitizeZipPath(
          base.toLowerCase().endsWith('.zip') ? base : `${base}.zip`,
        ).replace(/\//g, '_');
        const id = newId('mediaExport');
        const [row] = await db
          .insert(mediaExports)
          .values({
            id,
            name,
            createdBy: userId ?? null,
            scope: await scopeFingerprint(scope.assets?.insertColumns),
            channelKey: scope.channelKey ?? null,
            objectKey: `exports/${id}/${name}`,
            entries,
            manifest: ctx.body.manifest ?? false,
            totalBytes: zipLength(entries),
          })
          .returning();

        if (mediaConfig.onAssetDownload && rows.length > 0) {
          try {
            await mediaConfig.onAssetDownload({
              assetIds: rows.map((r) => r.id),
              actorId: userId ?? null,
              variantKey: null,
              bulkJobId: id,
              ipHash: null,
            });
          } catch (err) {
            console.error('[cms] media onAssetDownload failed:', err);
          }
        }
        start(id);
        return { export: await view(row) };
      },
    ),

    /**
     * The state of an export: `pending`, `running` (with `loaded` and
     * `total` bytes), `ready` with a signed `url` (5 minutes; call again for
     * a fresh one), or `failed` with an `error` code.
     *
     * @param exportId - The id from `createZipExport`.
     * @returns `{ export: { id, name, status, files, skipped, loaded, total, url, error, createdAt, expiresAt } }`.
     * @throws EXPORT_NOT_FOUND for an unknown or expired export, or one of another user.
     */
    getZipExport: createCMSEndpoint(
      '/media/getZipExport',
      {
        method: 'POST',
        body: z.object({ exportId: z.string().min(1) }),
        metadata: cmsMeta({}, { operation: 'read', ...MEDIA_META }),
      },
      async (ctx) => {
        const row = await ownExport(
          ctx.body.exportId,
          ctx.context.userId,
          ctx.context.scope,
        );
        return { export: await view(row) };
      },
    ),

    /**
     * The caller's exports, newest first, including finished ones until
     * they expire.
     *
     * @returns `{ exports }` in the shape of `getZipExport`.
     */
    listZipExports: createCMSEndpoint(
      '/media/listZipExports',
      {
        method: 'POST',
        body: z.object({}).optional(),
        metadata: cmsMeta({}, { operation: 'read', ...MEDIA_META }),
      },
      async (ctx) => {
        const { userId, scope } = ctx.context;
        const fingerprint = await scopeFingerprint(scope.assets?.insertColumns);
        const rows = await db
          .select()
          .from(mediaExports)
          .where(
            and(
              userId
                ? eq(mediaExports.createdBy, userId)
                : isNull(mediaExports.createdBy),
              eq(mediaExports.scope, fingerprint),
            ),
          )
          .orderBy(desc(mediaExports.createdAt))
          .limit(50);
        return { exports: await Promise.all(rows.map(view)) };
      },
    ),

    /**
     * Cancels an unfinished export or deletes a finished archive before it
     * expires. Idempotent for the caller's own exports.
     *
     * @param exportId - The id from `createZipExport`.
     * @returns `{ deleted: true }`.
     * @throws EXPORT_NOT_FOUND for an unknown export or one of another user.
     */
    deleteZipExport: createCMSEndpoint(
      '/media/deleteZipExport',
      {
        method: 'POST',
        body: z.object({ exportId: z.string().min(1) }),
        metadata: cmsMeta({}, { operation: 'read', ...MEDIA_META }),
      },
      async (ctx) => {
        const row = await ownExport(
          ctx.body.exportId,
          ctx.context.userId,
          ctx.context.scope,
        );
        const storage = getStorage(mediaConfig);
        const cursor = row.cursor as { uploadId: string } | null;
        await db.delete(mediaExports).where(eq(mediaExports.id, row.id));
        try {
          if (cursor)
            await storage.multipart?.abort(row.objectKey, cursor.uploadId);
          await storage.delete(row.objectKey);
        } catch {
          // The bucket's lifecycle rule removes abandoned parts.
        }
        return { deleted: true as const };
      },
    ),
  };
}
