import { createEndpoint } from 'better-call';
import { and, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import * as z from 'zod';

import type { CMSProcedureCtx, MediaConfig } from '../types';
import type { S3Client } from '../types/s3';

import { newId } from '../../utils/nanoid';
import {
  getAssetUsageDetails,
  isAssetReferencedByLiveContent,
} from '../assets';
import { assetFolders, assets } from '../db/schema.generated';
import { cmsMeta, createCMSEndpoint } from '../endpoint';
import { CMSError, errorMessages } from '../errors';
import { prepareAssetUpload } from '../media/uploads';
import { crossScopeColumns, scopedInsert, scopedInsertBatch } from '../scope';
import { createS3Client } from '../storage/s3/client';
import {
  buildPublicObjectUrl,
  buildVariantSlug,
  getContentTypeForVariant,
  putObject,
  S3Error,
  signGetObject,
  signPutObject,
} from '../storage/s3/utils';
import { MEDIA_DEFAULTS } from '../types/s3';

const MEDIA_META = { scope: 'system' as const, permissionResource: 'media' };

export function createMediaEndpoints(
  cmsCtx: CMSProcedureCtx,
  mediaConfig: MediaConfig,
) {
  const { db } = cmsCtx;

  let s3Client: S3Client | null = null;
  function getS3Client(): S3Client {
    if (!s3Client) {
      s3Client = createS3Client(mediaConfig);
    }
    return s3Client;
  }

  const maxFileSize = mediaConfig.maxFileSize ?? MEDIA_DEFAULTS.maxFileSize;
  const maxFiles = mediaConfig.maxFiles ?? MEDIA_DEFAULTS.maxFiles;
  const allowedMimeTypes = mediaConfig.allowedMimeTypes ?? [
    ...MEDIA_DEFAULTS.allowedMimeTypes,
  ];
  const signedUrlExpiresIn =
    mediaConfig.signedUrlExpiresIn ?? MEDIA_DEFAULTS.signedUrlExpiresIn;
  const bucketName = mediaConfig.bucketName;

  return {
    // ========================================================================
    // Folder Operations
    // ========================================================================

    /**
     * Creates a new folder in the asset library.
     *
     * @param name - Folder name.
     * @param parentFolderId - Optional parent folder id; if omitted, creates a root-level folder.
     * @returns The created folder with its metadata (id, name, parentId, createdBy, createdAt).
     * @throws PARENT_NOT_FOUND if parentFolderId does not reference an existing folder.
     * @example await cmsClient.media.createFolder({ name: 'Images' })
     */
    createFolder: createCMSEndpoint(
      '/media/createFolder',
      {
        method: 'POST',
        body: z.object({
          name: z.string().min(1),
          parentFolderId: z.string().optional(),
        }),
        metadata: cmsMeta({}, { operation: 'create', ...MEDIA_META }),
      },
      async (ctx) => {
        const { userId: actor, scope } = ctx.context;

        if (ctx.body.parentFolderId) {
          const conditions = [eq(assetFolders.id, ctx.body.parentFolderId)];
          if (scope.assetFolders?.where)
            conditions.push(scope.assetFolders.where);

          const [parentFolder] = await db
            .select({ id: assetFolders.id })
            .from(assetFolders)
            .where(and(...conditions));

          if (!parentFolder) {
            throw new CMSError('PARENT_NOT_FOUND', {
              message: errorMessages.parentNotFound(ctx.body.parentFolderId),
            });
          }
        }

        const folder = await scopedInsert(
          db,
          'cms.asset_folders',
          {
            id: newId('assetFolder'),
            name: ctx.body.name,
            parent_id: ctx.body.parentFolderId ?? null,
            created_by: actor ?? null,
          },
          scope.assetFolders,
        );

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
     * Moves a folder to a new parent folder or to root level.
     *
     * @param folderId - The folder to move.
     * @param newParentFolderId - Optional new parent folder id; if omitted, moves to root level.
     * @returns The updated folder with its new parent relationship.
     * @throws FOLDER_NOT_FOUND if folderId does not exist.
     * @throws PARENT_NOT_FOUND if newParentFolderId does not exist.
     * @throws CANNOT_MOVE_INTO_SELF if folderId equals newParentFolderId.
     * @throws CANNOT_MOVE_INTO_DESCENDANT if newParentFolderId is a descendant of folderId.
     */
    moveFolder: createCMSEndpoint(
      '/media/moveFolder',
      {
        method: 'POST',
        body: z.object({
          folderId: z.string(),
          newParentFolderId: z.string().optional(),
        }),
        metadata: cmsMeta({}, { operation: 'update', ...MEDIA_META }),
      },
      async (ctx) => {
        const { scope } = ctx.context;
        const { folderId, newParentFolderId } = ctx.body;

        if (newParentFolderId === folderId) {
          throw new CMSError('CANNOT_MOVE_INTO_SELF');
        }

        const folderConditions = [eq(assetFolders.id, folderId)];
        if (scope.assetFolders?.where)
          folderConditions.push(scope.assetFolders.where);

        const [folder] = await db
          .select({ id: assetFolders.id, parentId: assetFolders.parentId })
          .from(assetFolders)
          .where(and(...folderConditions));

        if (!folder) {
          throw new CMSError('FOLDER_NOT_FOUND', {
            message: errorMessages.folderNotFound(folderId),
          });
        }

        if (newParentFolderId) {
          const parentConditions = [eq(assetFolders.id, newParentFolderId)];
          if (scope.assetFolders?.where)
            parentConditions.push(scope.assetFolders.where);

          const [newParent] = await db
            .select({ id: assetFolders.id })
            .from(assetFolders)
            .where(and(...parentConditions));

          if (!newParent) {
            throw new CMSError('PARENT_NOT_FOUND', {
              message: errorMessages.parentNotFound(newParentFolderId),
            });
          }

          const [cycle] = await db
            .select({
              isCycle: sql<boolean>`EXISTS (
                WITH RECURSIVE ancestors AS (
                  SELECT id, parent_id FROM cms.asset_folders
                    WHERE id = ${newParentFolderId}
                  UNION ALL
                  SELECT f.id, f.parent_id FROM cms.asset_folders f
                    INNER JOIN ancestors a ON a.parent_id = f.id
                )
                SELECT 1 FROM ancestors WHERE id = ${folderId}
              )`,
            })
            .from(sql`(SELECT 1) AS _`);

          if (cycle?.isCycle) {
            throw new CMSError('CANNOT_MOVE_INTO_DESCENDANT');
          }
        }

        const updateConditions = [eq(assetFolders.id, folderId)];
        if (scope.assetFolders?.where)
          updateConditions.push(scope.assetFolders.where);

        const [updatedFolder] = await db
          .update(assetFolders)
          .set({ parentId: newParentFolderId ?? null })
          .where(and(...updateConditions))
          .returning();

        return {
          folder: {
            id: updatedFolder.id,
            name: updatedFolder.name,
            parentId: updatedFolder.parentId ?? null,
            createdBy: updatedFolder.createdBy ?? null,
            createdAt: updatedFolder.createdAt,
          },
        };
      },
    ),

    /**
     * Deletes an empty folder.
     *
     * @param folderId - The folder to delete.
     * @returns The deleted folder id.
     * @throws FOLDER_NOT_FOUND if folderId does not exist.
     * @throws FOLDER_HAS_CONTENT if the folder contains assets or subfolders.
     */
    deleteFolder: createCMSEndpoint(
      '/media/deleteFolder',
      {
        method: 'POST',
        body: z.object({
          folderId: z.string(),
        }),
        metadata: cmsMeta({}, { operation: 'delete', ...MEDIA_META }),
      },
      async (ctx) => {
        const { scope } = ctx.context;
        const { folderId } = ctx.body;

        const folderConditions = [eq(assetFolders.id, folderId)];
        if (scope.assetFolders?.where)
          folderConditions.push(scope.assetFolders.where);

        const [folder] = await db
          .select({ id: assetFolders.id })
          .from(assetFolders)
          .where(and(...folderConditions));

        if (!folder) {
          throw new CMSError('FOLDER_NOT_FOUND', {
            message: errorMessages.folderNotFound(folderId),
          });
        }

        const [counts] = await db
          .select({
            assetCount: sql<number>`(SELECT count(*)::int FROM cms.assets WHERE folder_id = ${folderId})`,
            childCount: sql<number>`(SELECT count(*)::int FROM cms.asset_folders WHERE parent_id = ${folderId})`,
          })
          .from(sql`(SELECT 1) AS _`);

        if (counts.assetCount > 0 || counts.childCount > 0) {
          throw new CMSError('FOLDER_HAS_CONTENT', {
            message: errorMessages.folderHasContent(folderId),
          });
        }

        await db.delete(assetFolders).where(and(...folderConditions));

        return { folderId };
      },
    ),

    // ========================================================================
    // Asset Listing & Retrieval
    // ========================================================================

    /**
     * Lists assets in the media library with optional filtering and pagination.
     *
     * @param folderId - Optional folder id to filter by.
     * @param status - Optional status filter ('private' or 'public').
     * @param search - Optional substring search by asset slug.
     * @param limit - Max results per page (1–100, default 20).
     * @param offset - Pagination offset (default 0).
     * @param sortBy - Sort field: 'createdAt', 'slug', or 'size' (default 'createdAt').
     * @param sortOrder - Sort direction: 'asc' or 'desc' (default 'desc').
     * @returns Paginated list of assets with total count and hasMore flag.
     * @example await cmsClient.media.listAssets({ limit: 20, status: 'public' })
     */
    listAssets: createCMSEndpoint(
      '/media/listAssets',
      {
        method: 'GET',
        query: z
          .object({
            folderId: z.string().optional(),
            status: z.enum(['private', 'public']).optional(),
            search: z.string().optional(),
            limit: z.coerce
              .number()
              .int()
              .min(1)
              .max(100)
              .optional()
              .default(20),
            offset: z.coerce.number().int().min(0).optional().default(0),
            sortBy: z
              .enum(['createdAt', 'slug', 'size'])
              .optional()
              .default('createdAt'),
            sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
          })
          .optional(),
        metadata: cmsMeta(
          {
            $Infer: {
              query: {} as {
                folderId?: string;
                status?: 'private' | 'public';
                search?: string;
                limit?: number;
                offset?: number;
                sortBy?: 'createdAt' | 'slug' | 'size';
                sortOrder?: 'asc' | 'desc';
              },
            },
          },
          { operation: 'read', ...MEDIA_META },
        ),
      },
      async (ctx) => {
        const { scope } = ctx.context;
        const {
          folderId,
          status,
          search,
          limit = 20,
          offset = 0,
          sortBy = 'createdAt',
          sortOrder = 'desc',
        } = ctx.query ?? {};

        const conditions: ReturnType<typeof eq>[] = [isNull(assets.archivedAt)];
        if (scope.assets?.where) conditions.push(scope.assets.where as any);

        if (folderId) {
          conditions.push(eq(assets.folderId, folderId));
        }

        if (status) {
          conditions.push(eq(assets.status, status));
        }

        if (search) {
          const escaped = search.replace(/[%_\\]/g, '\\$&');
          conditions.push(ilike(assets.slug, `%${escaped}%`));
        }

        const whereClause =
          conditions.length > 0 ? and(...conditions) : undefined;

        const sortColumn =
          sortBy === 'slug'
            ? assets.slug
            : sortBy === 'size'
              ? assets.size
              : assets.createdAt;

        const orderBy =
          sortOrder === 'asc'
            ? sql`${sortColumn} ASC`
            : sql`${sortColumn} DESC`;

        const [assetRows, [{ count }]] = await Promise.all([
          db
            .select()
            .from(assets)
            .where(whereClause)
            .orderBy(orderBy)
            .limit(limit)
            .offset(offset),
          db
            .select({ count: sql<number>`count(*)::int` })
            .from(assets)
            .where(whereClause),
        ]);

        return {
          assets: assetRows.map((asset) => ({
            id: asset.id,
            slug: asset.slug,
            mimeType: asset.mimeType,
            size: asset.size,
            objectKey: asset.objectKey,
            status: asset.status,
            folderId: asset.folderId ?? null,
            variantOf: asset.variantOf ?? null,
            uploadedBy: asset.uploadedBy ?? null,
            createdAt: asset.createdAt,
            updatedAt: asset.updatedAt,
          })),
          total: count,
          hasMore: offset + assetRows.length < count,
        };
      },
    ),

    /**
     * Public asset redirect. Marked `public: true` so toCMSEndpoints skips the
     * auth/scope/hook chain — it serves <img>-style requests and does its own
     * access control (rejects assets whose status is `private`).
     */
    asset: createEndpoint(
      '/media/asset/{assetSlug}',
      {
        method: 'GET',
        query: z.object({
          format: z.enum(['webp', 'jpeg', 'png']).optional(),
          w: z.coerce.number().int().positive().optional(),
          download: z.coerce.boolean().optional(),
        }),
        metadata: cmsMeta(
          {},
          { public: true, operation: 'read', scope: 'system' },
        ),
      },
      async (ctx) => {
        const params = ctx.params as { assetSlug: string };
        const assetSlug = params.assetSlug;

        const [asset] = await db
          .select({
            id: assets.id,
            objectKey: assets.objectKey,
            status: assets.status,
            mimeType: assets.mimeType,
            slug: assets.slug,
          })
          .from(assets)
          .where(and(eq(assets.slug, assetSlug), isNull(assets.archivedAt)));

        if (!asset) {
          throw new CMSError('ASSET_NOT_FOUND', {
            message: errorMessages.assetNotFound(assetSlug),
          });
        }

        if (asset.status === 'private') {
          throw new CMSError('ASSET_ACCESS_DENIED');
        }

        let targetKey = asset.objectKey;
        const hasVariantParams = !!(ctx.query?.format || ctx.query?.w);

        if (hasVariantParams) {
          const variantSlug = buildVariantSlug(
            asset.slug,
            ctx.query?.format,
            ctx.query?.w,
          );
          const [variant] = await db
            .select({ objectKey: assets.objectKey })
            .from(assets)
            .where(
              and(eq(assets.slug, variantSlug), eq(assets.variantOf, asset.id)),
            );

          if (variant) {
            targetKey = variant.objectKey;
          }
        }

        const location = buildPublicObjectUrl(mediaConfig.publicUrl, targetKey);
        const contentType = getContentTypeForVariant(
          asset.mimeType,
          ctx.query?.format,
        );

        return {
          headers: {
            location,
            'cache-control':
              'public, max-age=31536000, s-maxage=86400, immutable',
            'content-type': contentType,
            ...(hasVariantParams ? { vary: 'Accept' } : {}),
            ...(ctx.query?.download
              ? {
                  'content-disposition': `attachment; filename="${asset.slug.replace(/["\\\r\n]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(asset.slug)}`,
                }
              : {}),
          },
          body: {},
        };
      },
    ),

    /**
     * Generates a time-limited signed URL for authenticated asset access.
     *
     * @param assetSlug - The asset slug.
     * @param expiresIn - Optional TTL in seconds (60–86400); defaults to 3600 for public assets, 300 for private.
     * @returns Signed URL, asset status, and Unix timestamp when the URL expires.
     * @throws ASSET_NOT_FOUND if the asset does not exist.
     * @example await cmsClient.media.getAssetUrlAuthenticated({ assetSlug: 'photo' })
     */
    getAssetUrlAuthenticated: createCMSEndpoint(
      '/media/getAssetUrlAuthenticated',
      {
        method: 'POST',
        body: z.object({
          assetSlug: z.string(),
          expiresIn: z.number().int().min(60).max(86400).optional(),
        }),
        metadata: cmsMeta({}, { operation: 'read', ...MEDIA_META }),
      },
      async (ctx) => {
        const { scope } = ctx.context;

        const conditions = [
          eq(assets.slug, ctx.body.assetSlug),
          isNull(assets.archivedAt),
        ];
        if (scope.assets?.where) conditions.push(scope.assets.where as any);

        const [asset] = await db
          .select({
            id: assets.id,
            objectKey: assets.objectKey,
            status: assets.status,
          })
          .from(assets)
          .where(and(...conditions));

        if (!asset) {
          throw new CMSError('ASSET_NOT_FOUND', {
            message: errorMessages.assetNotFound(ctx.body.assetSlug),
          });
        }

        const ttl =
          ctx.body.expiresIn ?? (asset.status === 'public' ? 3600 : 300);
        const client = getS3Client();
        const url = await signGetObject(client, {
          bucket: bucketName,
          key: asset.objectKey,
          expiresIn: ttl,
        });

        return {
          url,
          status: asset.status,
          expiresAt: Date.now() + ttl * 1000,
        };
      },
    ),

    // ========================================================================
    // Asset Status Management
    // ========================================================================

    /**
     * Changes the privacy status of one or more assets.
     *
     * @param assetIds - Array of asset ids to update (at least one).
     * @param status - Target status: 'private' or 'public'.
     * @returns Count of successfully updated assets.
     * @throws ASSET_NOT_FOUND if none of the asset ids exist.
     * @example await cmsClient.media.updateAssetStatus({ assetIds: ['ast_...'], status: 'public' })
     */
    updateAssetStatus: createCMSEndpoint(
      '/media/updateAssetStatus',
      {
        method: 'POST',
        body: z.object({
          assetIds: z.array(z.string()).min(1),
          status: z.enum(['private', 'public']),
        }),
        metadata: cmsMeta({}, { operation: 'update', ...MEDIA_META }),
      },
      async (ctx) => {
        const { scope } = ctx.context;
        const { assetIds, status } = ctx.body;

        const selectConditions = [inArray(assets.id, assetIds)];
        if (scope.assets?.where)
          selectConditions.push(scope.assets.where as any);

        const existing = await db
          .select({ id: assets.id })
          .from(assets)
          .where(and(...selectConditions));

        if (existing.length === 0) {
          throw new CMSError('ASSET_NOT_FOUND', {
            message: 'No assets found for the given IDs',
          });
        }

        const existingIds = existing.map((a) => a.id);
        const updateConditions = [inArray(assets.id, existingIds)];
        if (scope.assets?.where)
          updateConditions.push(scope.assets.where as any);

        await db
          .update(assets)
          .set({ status, updatedAt: new Date() })
          .where(and(...updateConditions));

        return { updated: existing.length };
      },
    ),

    /**
     * Archives one or more assets and their variants, soft-deleting them for later garbage collection.
     * Assets referenced by live (published) content are skipped, not failed, allowing partial batch success.
     *
     * @param assetIds - Array of asset ids to archive (at least one).
     * @returns Count of archived assets, their ids, and ids of skipped (in-use) assets.
     * @throws ASSET_NOT_FOUND if none of the asset ids exist.
     * @example await cmsClient.media.archiveAsset({ assetIds: ['ast_...'] })
     */
    archiveAsset: createCMSEndpoint(
      '/media/archiveAsset',
      {
        method: 'POST',
        body: z.object({
          assetIds: z.array(z.string()).min(1),
        }),
        metadata: cmsMeta({}, { operation: 'delete', ...MEDIA_META }),
      },
      async (ctx) => {
        const { scope } = ctx.context;
        const { assetIds } = ctx.body;

        const selectConditions = [
          inArray(assets.id, assetIds),
          isNull(assets.archivedAt),
        ];
        if (scope.assets?.where)
          selectConditions.push(scope.assets.where as any);

        const existing = await db
          .select({ id: assets.id })
          .from(assets)
          .where(and(...selectConditions));

        if (existing.length === 0) {
          throw new CMSError('ASSET_NOT_FOUND', {
            message: 'No assets found for the given IDs',
          });
        }

        const existingIds = existing.map((a) => a.id);

        // Guard: never archive an asset still referenced by live content.
        // Archiving starts the pruning trash clock, so archiving an in-use asset
        // would eventually delete it (and its S3 object) out from under a live
        // page. The check is authoritative against branch-head block versions
        // (the version-keyed content_usages index joined to branch heads). In-use
        // assets are skipped, not failed, so a batch still archives the rest.
        const toArchive: string[] = [];
        const skipped: string[] = [];
        for (const id of existingIds) {
          if (
            await isAssetReferencedByLiveContent(
              db,
              id,
              crossScopeColumns(scope.roots),
            )
          ) {
            skipped.push(id);
          } else {
            toArchive.push(id);
          }
        }

        if (toArchive.length === 0) {
          return { archived: 0, archivedIds: [], skipped };
        }

        // Archive the assets together with their variants so a variant object is
        // never left orphaned without its original. The stored S3 object is kept
        // until the pruning layer reclaims unreferenced, archived, old assets.
        const now = new Date();
        const archiveConditions = [
          or(
            inArray(assets.id, toArchive),
            inArray(assets.variantOf, toArchive),
          )!,
          isNull(assets.archivedAt),
        ];
        if (scope.assets?.where)
          archiveConditions.push(scope.assets.where as any);

        const archived = await db
          .update(assets)
          .set({ archivedAt: now, updatedAt: now })
          .where(and(...archiveConditions))
          .returning({ id: assets.id });

        return {
          archived: archived.length,
          archivedIds: archived.map((a) => a.id),
          skipped,
        };
      },
    ),

    /**
     * Returns page-centric usage details for an asset across all live content.
     *
     * @param assetId - The asset id to query.
     * @returns Page count and a list of each live (non-archived) page using the asset, with per-block occurrences.
     * @throws ASSET_NOT_FOUND if the asset does not exist.
     * @example await cmsClient.media.getAssetUsages({ assetId: 'ast_...' })
     */
    getAssetUsages: createCMSEndpoint(
      '/media/getAssetUsages',
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
        const { assetId } = ctx.query;

        // Scope/IDOR guard: only report usage for an asset in the caller's scope.
        const conditions = [eq(assets.id, assetId)];
        if (scope.assets?.where) conditions.push(scope.assets.where as any);
        const [asset] = await db
          .select({ id: assets.id })
          .from(assets)
          .where(and(...conditions));
        if (!asset) {
          throw new CMSError('ASSET_NOT_FOUND', {
            message: errorMessages.assetNotFound(assetId),
          });
        }

        return getAssetUsageDetails(
          db,
          assetId,
          crossScopeColumns(scope.roots),
        );
      },
    ),

    // ========================================================================
    // Upload Operations
    // ========================================================================

    /**
     * Prepares assets for client-side S3 upload and returns signed PUT URLs.
     * Creates database records and generates time-limited S3 signed URLs for direct browser upload.
     *
     * @param files - Array of file metadata (name, size, type, optional variantOf).
     * @param folderId - Optional target folder id.
     * @returns Array of assets with their signed upload URLs and headers, plus expiration timestamp.
     * @throws TOO_MANY_FILES if file count exceeds the configured limit.
     * @throws FILE_TOO_LARGE if any file exceeds the configured size limit.
     * @throws INVALID_FILE_TYPE if any file has a disallowed MIME type.
     * @throws FOLDER_NOT_FOUND if folderId does not exist.
     * @throws ASSET_NOT_FOUND if a variantOf id does not reference an existing asset.
     * @throws SLUG_GENERATION_FAILED if slug generation exhausts retry attempts.
     * @example await cmsClient.media.createSignedUpload({ files: [{ name: 'photo.jpg', size: 512000, type: 'image/jpeg' }] })
     */
    createSignedUpload: createCMSEndpoint(
      '/media/createSignedUpload',
      {
        method: 'POST',
        body: z.object({
          files: z
            .array(
              z.object({
                name: z.string().min(1),
                size: z.number().int().positive(),
                type: z.string().min(1),
                variantOf: z.string().optional(),
              }),
            )
            .min(1),
          folderId: z.string().optional(),
        }),
        metadata: cmsMeta({}, { operation: 'create', ...MEDIA_META }),
      },
      async (ctx) => {
        const { userId: actor, scope } = ctx.context;
        const { folderId, prepared } = await prepareAssetUpload(db, {
          actor,
          files: ctx.body.files,
          folderId: ctx.body.folderId,
          maxFiles,
          maxFileSize,
          allowedMimeTypes,
          scope,
        });

        const client = getS3Client();
        const expiresAt = Date.now() + signedUrlExpiresIn * 1000;

        await scopedInsertBatch(
          db,
          'cms.assets',
          prepared.map((p) => ({
            id: p.id,
            slug: p.slug,
            mime_type: p.file.type,
            size: p.file.size,
            object_key: p.objectKey,
            status: 'private' as const,
            folder_id: folderId ?? null,
            variant_of: p.file.variantOf ?? null,
            uploaded_by: actor ?? null,
          })),
          scope.assets,
        );

        const signedResults = await Promise.all(
          prepared.map(async (p) => {
            const signedUrl = await signPutObject(client, {
              bucket: bucketName,
              key: p.objectKey,
              contentType: p.file.type,
              contentLength: p.file.size,
              expiresIn: signedUrlExpiresIn,
              acl: 'public-read',
            });
            return {
              id: p.id,
              slug: p.slug,
              objectKey: p.objectKey,
              signedUrl,
              headers: {
                'Content-Type': p.file.type,
                'x-amz-acl': 'public-read',
              },
            };
          }),
        );

        return { assets: signedResults, expiresAt };
      },
    ),

    /**
     * Server-side uploads assets directly to S3 with buffer/Blob bodies.
     * Creates database records and synchronously uploads file content; use for small files or server-initiated uploads.
     *
     * @param files - Array of files with buffer or Blob content (name, size, type, buffer, optional variantOf).
     * @param folderId - Optional target folder id.
     * @returns Array of uploaded assets with their ids, slugs, and object keys.
     * @throws TOO_MANY_FILES if file count exceeds the configured limit.
     * @throws FILE_TOO_LARGE if any file exceeds the configured size limit.
     * @throws INVALID_FILE_TYPE if any file has a disallowed MIME type.
     * @throws FOLDER_NOT_FOUND if folderId does not exist.
     * @throws ASSET_NOT_FOUND if a variantOf id does not reference an existing asset.
     * @throws SLUG_GENERATION_FAILED if slug generation exhausts retry attempts.
     * @throws UPLOAD_FAILED if the S3 upload fails.
     * @example await cmsClient.media.uploadAssets({ files: [{ name: 'photo.jpg', size: 512000, type: 'image/jpeg', buffer }] })
     */
    uploadAssets: createCMSEndpoint(
      '/media/uploadAssets',
      {
        method: 'POST',
        body: z.object({
          files: z
            .array(
              z.object({
                name: z.string().min(1),
                size: z.number().int().positive(),
                type: z.string().min(1),
                buffer: z.instanceof(Blob).or(z.instanceof(ArrayBuffer)),
                variantOf: z.string().optional(),
              }),
            )
            .min(1),
          folderId: z.string().optional(),
        }),
        metadata: cmsMeta({}, { operation: 'create', ...MEDIA_META }),
      },
      async (ctx) => {
        const { userId: actor, scope } = ctx.context;
        const { folderId, prepared } = await prepareAssetUpload(db, {
          actor,
          files: ctx.body.files,
          folderId: ctx.body.folderId,
          maxFiles,
          maxFileSize,
          allowedMimeTypes,
          scope,
        });

        const client = getS3Client();

        const filesByIndex = new Map(ctx.body.files.map((f, i) => [i, f]));

        await scopedInsertBatch(
          db,
          'cms.assets',
          prepared.map((p) => ({
            id: p.id,
            slug: p.slug,
            mime_type: p.file.type,
            size: p.file.size,
            object_key: p.objectKey,
            status: 'private' as const,
            folder_id: folderId ?? null,
            variant_of: p.file.variantOf ?? null,
            uploaded_by: actor ?? null,
          })),
          scope.assets,
        );

        for (let i = 0; i < prepared.length; i++) {
          const p = prepared[i];
          const file = filesByIndex.get(i)!;
          try {
            await putObject(client, {
              bucket: bucketName,
              key: p.objectKey,
              body: file.buffer,
              contentType: file.type,
              contentLength: file.size,
              acl: 'public-read',
            });
          } catch (err) {
            const status = err instanceof S3Error ? 500 : 0;
            throw new CMSError('UPLOAD_FAILED', {
              message: errorMessages.uploadFailed(file.name, status),
            });
          }
        }

        return {
          assets: prepared.map((p) => ({
            id: p.id,
            slug: p.slug,
            objectKey: p.objectKey,
          })),
        };
      },
    ),
  };
}
