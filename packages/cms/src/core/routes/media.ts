import { APIError, createEndpoint } from 'better-call';
import {
  and,
  eq,
  getTableColumns,
  gt,
  ilike,
  inArray,
  isNull,
  lt,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import * as z from 'zod';

import type { CMSProcedureContext, MediaConfig } from '../types';
import type { S3Client } from '../types/s3';

import { newId } from '../../utils/nanoid';
import {
  assetsReferencedByLiveContent,
  getAssetUsageDetails,
} from '../media/usage';
import { assetFolders, assets } from '../db/schema.generated';
import { cmsMeta, createCMSEndpoint } from '../endpoint';
import { CMSError, errorMessages } from '../errors';
import {
  assertFolderExists,
  generateUniqueSlug,
  measureBufferSize,
  prepareAssetUpload,
  validateFiles,
} from '../media/uploads';
import { crossScopeColumns, scopedInsert, scopedInsertBatch } from '../scope';
import { createS3Client } from '../storage/s3/client';
import {
  buildObjectKey,
  buildPublicObjectUrl,
  buildVariantSlug,
  putObject,
  S3Error,
  signPutObject,
} from '../storage/s3/utils';
import { MEDIA_DEFAULTS } from '../types/s3';

const MEDIA_META = {
  scope: 'system' as const,
  permissionResource: 'media' as const,
};

/**
 * Declared image MIME types whose magic bytes `sniffImageType` recognizes. Used
 * to decide when an unrecognizable buffer is a genuine contradiction: a payload
 * declared as one of these but not matching ANY known signature (e.g. an SVG or
 * HTML file smuggled in as `image/png`) is rejected, while an exotic-but-legit
 * declared type outside this set (e.g. a custom-configured `image/avif`) is left
 * to the declared-type allowlist rather than false-rejected.
 */
const SNIFFABLE_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);

/**
 * Dependency-free magic-byte sniff for the raster image types createcms accepts
 * by default. Returns the detected MIME type, or `undefined` if the leading
 * bytes match no known image signature.
 */
function sniffImageType(bytes: Uint8Array): string | undefined {
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  // JPEG: FF D8 FF
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return 'image/jpeg';
  }
  // GIF: 47 49 46 38 ('GIF8')
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38
  ) {
    return 'image/gif';
  }
  // WebP: 'RIFF' <4-byte size> 'WEBP'
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return undefined;
}

/** Read the first `count` bytes of an upload body (Blob or ArrayBuffer). */
async function readLeadingBytes(
  buffer: Blob | ArrayBuffer,
  count: number,
): Promise<Uint8Array> {
  if (buffer instanceof Blob) {
    return new Uint8Array(await buffer.slice(0, count).arrayBuffer());
  }
  return new Uint8Array(buffer.slice(0, count));
}

/**
 * Content-type validation for the SERVER upload paths, which hold the actual
 * bytes (the client signed-upload path never does, so it cannot be sniffed
 * server-side — see createSignedUpload). Runs AFTER the declared-type allowlist:
 * for a declared `image/*` type it sniffs the buffer's magic bytes and throws
 * INVALID_FILE_TYPE if they contradict the declared type — blocking a script-
 * bearing file (e.g. an SVG) smuggled in under an allowed image content-type for
 * stored XSS. Video/PDF are declared-type-only (not sniffed).
 */
async function assertDeclaredTypeMatchesBytes(
  fileName: string,
  declaredType: string,
  buffer: Blob | ArrayBuffer,
): Promise<void> {
  if (!declaredType.startsWith('image/')) return;

  const sniffed = sniffImageType(await readLeadingBytes(buffer, 12));
  if (sniffed === declaredType) return;

  // Reject when the bytes are a recognized-but-different image type, OR when the
  // declared type is one we CAN sniff yet the bytes match no signature (the
  // SVG/HTML-as-image case). A declared type outside the sniffable set with
  // unrecognized bytes is left to the declared-type allowlist.
  if (sniffed !== undefined || SNIFFABLE_IMAGE_TYPES.has(declaredType)) {
    throw new CMSError('INVALID_FILE_TYPE', {
      message: errorMessages.invalidFileType(fileName, declaredType),
    });
  }
}

/** The public-facing shape of an asset row (listAssets / getAssets / upload). */
type AssetRow = typeof assets.$inferSelect;

/**
 * Maps a raw `assets` row to the public list-item shape shared by listAssets,
 * getAssets, uploadAssets and replaceAsset, including the ready-to-use direct
 * object `url` for internal/admin display (see listAssets for why this URL is
 * NOT for embedding in content).
 */
function toAssetListItem(asset: AssetRow, publicUrl: string) {
  return {
    id: asset.id,
    slug: asset.slug,
    mimeType: asset.mimeType,
    size: asset.size,
    objectKey: asset.objectKey,
    url: buildPublicObjectUrl(publicUrl, asset.objectKey),
    status: asset.status,
    folderId: asset.folderId ?? null,
    variantOf: asset.variantOf ?? null,
    uploadedBy: asset.uploadedBy ?? null,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
  };
}

// ----------------------------------------------------------------------------
// Cursor-based (keyset) pagination for listAssets.
//
// A cursor is the opaque, stable position of the LAST row of a page: the value
// of the active sort column plus the row id as a tie-breaker. Keyset paging
// (WHERE (sortCol, id) </> the cursor) lets the media library page PAST the
// 100-row offset ceiling without the drift/duplication a large OFFSET causes.
// It is encoded as base64url JSON so callers treat it as opaque.
// ----------------------------------------------------------------------------

type AssetSortBy = 'createdAt' | 'slug' | 'size';

/** The decoded position: the sort-column value and the id tie-breaker. */
type CursorPosition = { v: string | number; id: string };

/**
 * A fetched list row plus `createdAtCursor` — the `createdAt` column rendered at
 * FULL (microsecond) precision as text. drizzle maps `timestamp('created_at')`
 * to a MILLISECOND-precision JS Date, so a cursor encoded from `row.createdAt`
 * truncates the keyset boundary and can skip/duplicate rows that share a
 * millisecond but differ in microseconds. The text value round-trips exactly and
 * is what the seek predicate compares against (see listAssets).
 */
type AssetCursorRow = AssetRow & { createdAtCursor: string };

function encodeAssetCursor(row: AssetCursorRow, sortBy: AssetSortBy): string {
  const v =
    sortBy === 'createdAt'
      ? row.createdAtCursor
      : sortBy === 'size'
        ? row.size
        : row.slug;
  const payload: CursorPosition = { v, id: row.id };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeAssetCursor(cursor: string): CursorPosition {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new APIError(400, {
      code: 'VALIDATION_ERROR',
      message: 'Invalid cursor',
    });
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !('v' in parsed) ||
    !('id' in parsed)
  ) {
    throw new APIError(400, {
      code: 'VALIDATION_ERROR',
      message: 'Invalid cursor',
    });
  }
  const { v, id } = parsed as Record<string, unknown>;
  if (
    (typeof v !== 'string' && typeof v !== 'number') ||
    typeof id !== 'string'
  ) {
    throw new APIError(400, {
      code: 'VALIDATION_ERROR',
      message: 'Invalid cursor',
    });
  }
  return { v, id };
}

export function createMediaEndpoints(
  cmsCtx: CMSProcedureContext,
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
     * @param newParentFolderId - New parent folder id. Omit or pass `null` to detach the folder to the root level.
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
     * Lists folders in the asset library, by parent — the read counterpart to
     * the folder mutations. Navigate the tree level by level: omit `parentFolderId`
     * for the root-level folders, then pass a folder's id to get its children.
     *
     * @param parentFolderId - Optional parent folder id; if omitted, returns the ROOT-level folders (those with no parent).
     * @returns The direct child folders of the given parent (or of the root), sorted by name.
     *
     * @remarks Intentionally unpaginated: this is per-level tree navigation, so
     * each call is naturally bounded by a single parent's direct-child fan-out
     * (not the whole tree). Callers page the tree by descending, not by offset.
     * If a single level is ever expected to hold thousands of siblings, revisit
     * and add `limit`/`offset` + `{ folders, total, hasMore }` to match listAssets.
     * @example await cmsClient.media.listFolders()                  // root folders
     * @example await cmsClient.media.listFolders({ parentFolderId })      // a folder's subfolders
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

        // Children of `parentFolderId`, or the root level when omitted. The scope
        // predicate is applied to the CHILDREN, so an out-of-scope `parentFolderId`
        // simply yields no rows (no cross-tenant leak).
        const conditions: SQL[] = [
          parentFolderId
            ? eq(assetFolders.parentId, parentFolderId)
            : isNull(assetFolders.parentId),
        ];
        if (scope.assetFolders?.where)
          conditions.push(scope.assetFolders.where);

        const folderRows = await db
          .select({
            id: assetFolders.id,
            name: assetFolders.name,
            parentId: assetFolders.parentId,
            createdBy: assetFolders.createdBy,
            createdAt: assetFolders.createdAt,
          })
          .from(assetFolders)
          .where(and(...conditions))
          .orderBy(sql`${assetFolders.name} ASC`);

        return {
          folders: folderRows.map((folder) => ({
            id: folder.id,
            name: folder.name,
            parentId: folder.parentId ?? null,
            createdBy: folder.createdBy ?? null,
            createdAt: folder.createdAt,
          })),
        };
      },
    ),

    /**
     * Lists assets in the media library with optional filtering and pagination.
     *
     * Supports two pagination modes: legacy `offset` (bounded to the first 100
     * rows overall — the media library outgrows it) and stable, unbounded
     * `cursor` (keyset) paging that can walk the whole library. Pass `cursor`
     * (the previous page's `nextCursor`) to continue; it takes precedence over
     * `offset` and stays valid as rows are inserted/removed. The direct-object
     * `url` on each row is for INTERNAL/admin display only (see below).
     *
     * @param folderId - Optional folder filter: a folder id to list that folder's assets. Omit for no folder filter.
     * @param unfiled - Set `true` to list ROOT-level (unfiled) assets — those with no folder. Wire-safe replacement for `folderId: null`; takes precedence over `folderId`.
     * @param status - Optional status filter ('private' or 'public').
     * @param search - Optional substring search by asset slug.
     * @param limit - Max results per page (1–100, default 20).
     * @param offset - Pagination offset (default 0); ignored when `cursor` is given.
     * @param cursor - Opaque keyset cursor from a previous page's `nextCursor`; pages past the offset ceiling.
     * @param sortBy - Sort field: 'createdAt', 'slug', or 'size' (default 'createdAt').
     * @param sortDirection - Sort direction: 'asc' or 'desc' (default 'desc').
     * @returns Paginated list of assets (each with a ready-to-use public `url`), the full `total`, a `hasMore` flag, and `nextCursor` (the cursor for the next page, or `null` at the end).
     * @example await cmsClient.media.listAssets({ limit: 20, status: 'public' })
     * @example await cmsClient.media.listAssets({ unfiled: true })  // root-level (unfiled) assets
     * @example const p1 = await cmsClient.media.listAssets({ limit: 50 }); const p2 = await cmsClient.media.listAssets({ limit: 50, cursor: p1.nextCursor })
     */
    listAssets: createCMSEndpoint(
      '/media/listAssets',
      {
        method: 'GET',
        query: z
          .object({
            folderId: z.string().optional(),
            // Wire-safe root-level filter. A `null` query param never survives
            // URL serialization (@better-fetch/fetch drops null values), so
            // `folderId: null` could never request unfiled assets over HTTP.
            // A boolean flag coerces cleanly over the wire: `unfiled: true` →
            // `folder_id IS NULL`, and it takes precedence over `folderId`.
            unfiled: z.coerce.boolean().optional(),
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
            cursor: z.string().optional(),
            sortBy: z
              .enum(['createdAt', 'slug', 'size'])
              .optional()
              .default('createdAt'),
            sortDirection: z.enum(['asc', 'desc']).optional().default('desc'),
          })
          .optional(),
        metadata: cmsMeta(
          {
            $Infer: {
              query: {} as {
                folderId?: string;
                unfiled?: boolean;
                status?: 'private' | 'public';
                search?: string;
                limit?: number;
                offset?: number;
                cursor?: string;
                sortBy?: 'createdAt' | 'slug' | 'size';
                sortDirection?: 'asc' | 'desc';
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
          unfiled,
          status,
          search,
          limit = 20,
          offset = 0,
          cursor,
          sortBy = 'createdAt',
          sortDirection = 'desc',
        } = ctx.query ?? {};

        const conditions: SQL[] = [isNull(assets.archivedAt)];
        if (scope.assets?.where) conditions.push(scope.assets.where);

        // Root-level filtering is wire-safe via the `unfiled` boolean rather
        // than a `null` folderId (which never survives URL serialization — see
        // the query schema): `unfiled: true` → `folder_id IS NULL`; else a
        // `folderId` string → that folder; else (both omitted) no folder filter.
        if (unfiled === true) {
          conditions.push(isNull(assets.folderId));
        } else if (folderId !== undefined) {
          conditions.push(eq(assets.folderId, folderId));
        }

        if (status) {
          conditions.push(eq(assets.status, status));
        }

        if (search) {
          const escaped = search.replace(/[%_\\]/g, '\\$&');
          conditions.push(ilike(assets.slug, `%${escaped}%`));
        }

        const sortColumn =
          sortBy === 'slug'
            ? assets.slug
            : sortBy === 'size'
              ? assets.size
              : assets.createdAt;

        // Keyset seek: when a cursor is supplied, restrict to rows strictly
        // AFTER it in sort order — `(sortColumn, id) </> (v, id)` — matching the
        // ORDER BY below (id is the deterministic tie-breaker). asc → later rows
        // are GREATER; desc → later rows are LESSER.
        if (cursor) {
          const pos = decodeAssetCursor(cursor);
          const cmp = sortDirection === 'asc' ? gt : lt;
          // For createdAt, the cursor value is the FULL-precision (microsecond)
          // column text (see the created_at_cursor select). Cast it back to
          // `timestamp` and compare the column directly so a row sharing a
          // millisecond but differing in microseconds is seeked exactly — a JS
          // Date boundary truncates to ms and would skip/duplicate such rows.
          // slug/size cursor values are exact primitives already.
          const boundary =
            sortBy === 'createdAt' ? sql`${pos.v}::timestamp` : pos.v;
          conditions.push(
            or(
              cmp(sortColumn, boundary),
              and(eq(sortColumn, boundary), cmp(assets.id, pos.id)),
            )!,
          );
        }

        const whereClause = and(...conditions);
        // The full-count query must NOT see the keyset seek predicate (that would
        // shrink `total` to just the remaining rows) — count the whole filtered set.
        const countConditions = cursor ? conditions.slice(0, -1) : conditions;
        const countWhere = and(...countConditions);

        // id is appended as a stable, unique tie-breaker so the order is total
        // (createdAt/size are non-unique) — this is what makes the cursor stable.
        const orderBy =
          sortDirection === 'asc'
            ? sql`${sortColumn} ASC, ${assets.id} ASC`
            : sql`${sortColumn} DESC, ${assets.id} DESC`;

        // Over-fetch one row to detect a following page precisely (independent of
        // the offset/total math), then trim back to `limit`.
        const [fetched, [{ count }]] = await Promise.all([
          db
            .select({
              ...getTableColumns(assets),
              // Full-precision (microsecond) createdAt as text for exact cursor
              // encoding — `assets.createdAt` itself maps to a ms-truncated JS
              // Date, which is not precise enough for a stable keyset boundary.
              createdAtCursor: sql<string>`${assets.createdAt}::text`.as(
                'created_at_cursor',
              ),
            })
            .from(assets)
            .where(whereClause)
            .orderBy(orderBy)
            .limit(limit + 1)
            .offset(cursor ? 0 : offset),
          db
            .select({ count: sql<number>`count(*)::int` })
            .from(assets)
            .where(countWhere),
        ]);

        const hasNextPage = fetched.length > limit;
        const assetRows = hasNextPage ? fetched.slice(0, limit) : fetched;
        const lastRow = assetRows[assetRows.length - 1];

        return {
          assets: assetRows.map((asset) =>
            toAssetListItem(asset, mediaConfig.publicUrl),
          ),
          total: count,
          // Cursor mode reports liveness from the over-fetch; offset mode keeps
          // the historical offset/total comparison.
          hasMore: cursor ? hasNextPage : offset + assetRows.length < count,
          nextCursor:
            hasNextPage && lastRow ? encodeAssetCursor(lastRow, sortBy) : null,
        };
      },
    ),

    /**
     * Bulk-resolves assets by id — the id→asset counterpart to listAssets, for
     * previewing assets that fall OUTSIDE the newest listAssets page (e.g. an
     * editor canvas rendering assets referenced by content but not on the
     * current media-library page). Same permission gate, scope, and row shape as
     * listAssets; archived assets and out-of-scope/unknown ids are simply absent
     * from the result (no error, no leak). Order is not guaranteed — callers key
     * by id.
     *
     * @param ids - Asset ids to resolve (at least one).
     * @returns `{ assets }` — the matching live, in-scope assets, each with the same fields a listAssets row carries.
     * @example await cmsClient.media.getAssets({ ids: ['ast_...', 'ast_...'] })
     */
    getAssets: createCMSEndpoint(
      '/media/getAssets',
      {
        method: 'GET',
        query: z.object({
          // A single-occurrence query param (`?ids=ast_x`) arrives as a bare
          // string, not an array — better-call only builds an array when a key
          // repeats. Normalize a lone value to a one-element array before the
          // array validation, so a single id is accepted over HTTP instead of
          // failing `z.array(...)`. `null`/`undefined` pass through so the
          // required `.min(1)` still rejects a missing/empty `ids`.
          ids: z.preprocess(
            (v) => (Array.isArray(v) ? v : v == null ? v : [v]),
            z.array(z.string().min(1)).min(1),
          ),
        }),
        metadata: cmsMeta(
          { $Infer: { query: {} as { ids: string[] } } },
          { operation: 'read', ...MEDIA_META },
        ),
      },
      async (ctx) => {
        const { scope } = ctx.context;
        const { ids } = ctx.query;

        const conditions: SQL[] = [
          inArray(assets.id, ids),
          isNull(assets.archivedAt),
        ];
        if (scope.assets?.where) conditions.push(scope.assets.where);

        const rows = await db
          .select()
          .from(assets)
          .where(and(...conditions));

        return {
          assets: rows.map((asset) =>
            toAssetListItem(asset, mediaConfig.publicUrl),
          ),
        };
      },
    ),

    /**
     * Public asset redirect. Marked `public: true` so toCMSEndpoints skips the
     * auth/scope/hook chain — it serves <img>-style requests and does its own
     * access control (rejects assets whose status is `private`).
     */
    asset: createEndpoint(
      // Addressed by the STABLE asset id, not the slug: content stores the id,
      // so an `<img src="/media/asset/{id}">` survives a `replaceAsset` (which
      // mints a new slug/objectKey) without touching content or re-rendering —
      // the gate just re-resolves the id to the current object. (rou3 needs
      // `:param`, not OpenAPI `{param}` braces, or the route never matches.)
      '/media/asset/:assetId',
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
        const params = ctx.params as { assetId: string };
        const assetId = params.assetId;

        const [asset] = await db
          .select({
            id: assets.id,
            objectKey: assets.objectKey,
            status: assets.status,
            mimeType: assets.mimeType,
            slug: assets.slug,
          })
          .from(assets)
          .where(and(eq(assets.id, assetId), isNull(assets.archivedAt)));

        if (!asset) {
          throw new CMSError('ASSET_NOT_FOUND', {
            message: errorMessages.assetNotFound(assetId),
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
              and(
                eq(assets.slug, variantSlug),
                eq(assets.variantOf, asset.id),
                isNull(assets.archivedAt),
              ),
            );

          if (variant) {
            targetKey = variant.objectKey;
          }
        }

        const location = buildPublicObjectUrl(mediaConfig.publicUrl, targetKey);

        // Redirect (302) so a real `<img src>` / browser request follows
        // `location` to the public object URL. better-call applies response
        // headers from `ctx.responseHeaders` (and the status from `ctx.redirect`),
        // NOT from a returned `{ headers, body }` object — that shape is only
        // visible to the server-side caller, never on the HTTP response, so the
        // router would otherwise answer 200 with an empty body (a broken image).
        //
        // The redirect is SHORT-cached (NOT immutable) because the id->object
        // mapping changes on `replaceAsset`: a brief TTL lets a swapped image
        // propagate to already-rendered pages within minutes, while the bytes
        // themselves stay long-cached at the CDN (each object key is unique per
        // version). The 302 is bodyless, so re-resolving it is cheap.
        ctx.responseHeaders.set('cache-control', 'public, max-age=300');
        if (ctx.query?.download) {
          ctx.responseHeaders.set(
            'content-disposition',
            `attachment; filename="${asset.slug.replace(/["\\\r\n]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(asset.slug)}`,
          );
        }
        return ctx.redirect(location);
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
     * @returns `{ updated, updatedIds, skipped }` — the count and ids of the
     *   updated assets, plus the requested ids that matched no live, in-scope asset.
     * @throws ASSET_NOT_FOUND if none of the asset ids exist.
     * @example await cmsClient.media.updateAssetsStatus({ assetIds: ['ast_...'], status: 'public' })
     */
    updateAssetsStatus: createCMSEndpoint(
      '/media/updateAssetsStatus',
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

        // Exclude archived (soft-deleted) assets, matching moveAssets/archiveAssets:
        // an archived id is reported in `skipped`, never silently counted as updated.
        const selectConditions: SQL[] = [
          inArray(assets.id, assetIds),
          isNull(assets.archivedAt),
        ];
        if (scope.assets?.where)
          selectConditions.push(scope.assets.where);

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
        const updateConditions: SQL[] = [inArray(assets.id, existingIds)];
        if (scope.assets?.where)
          updateConditions.push(scope.assets.where);

        await db
          .update(assets)
          .set({ status, updatedAt: new Date() })
          .where(and(...updateConditions));

        const skipped = assetIds.filter((id) => !existingIds.includes(id));
        return {
          updated: existingIds.length,
          updatedIds: existingIds,
          skipped,
        };
      },
    ),

    /**
     * Moves one or more assets into a folder (or to the root with `folderId: null`).
     * Mirrors updateAssetsStatus's bulk-by-ids + scope pattern; non-existent,
     * out-of-scope, and archived ids are skipped (surfaced in `skipped`), so a
     * batch partially succeeds. A moved asset's variants follow it into the same
     * folder, so an original and its variants are never split apart — and a
     * variant id passed on its own is skipped (variants are not moved directly).
     *
     * @param assetIds - Asset ids to move (at least one).
     * @param folderId - Target folder id, or `null` to move to the root.
     * @returns `{ moved, movedIds, skipped }`.
     * @throws FOLDER_NOT_FOUND if `folderId` is given but does not exist (in scope).
     * @throws ASSET_NOT_FOUND if none of the ids reference a live, in-scope asset.
     * @example await cmsClient.media.moveAssets({ assetIds: ['ast_...'], folderId: 'fld_...' })
     */
    moveAssets: createCMSEndpoint(
      '/media/moveAssets',
      {
        method: 'POST',
        body: z.object({
          assetIds: z.array(z.string()).min(1),
          folderId: z.string().min(1).nullable(),
        }),
        metadata: cmsMeta({}, { operation: 'update', ...MEDIA_META }),
      },
      async (ctx) => {
        const { scope } = ctx.context;
        const { assetIds, folderId } = ctx.body;

        // Validate the target folder (scoped) unless moving to the root. An
        // out-of-scope/missing folder yields no row → FOLDER_NOT_FOUND, no leak.
        if (folderId !== null) {
          await assertFolderExists(db, folderId, scope);
        }

        // Live, in-scope assets among the requested ids.
        const selectConditions: SQL[] = [
          inArray(assets.id, assetIds),
          isNull(assets.archivedAt),
        ];
        if (scope.assets?.where)
          selectConditions.push(scope.assets.where);

        const existing = await db
          .select({ id: assets.id, variantOf: assets.variantOf })
          .from(assets)
          .where(and(...selectConditions));

        if (existing.length === 0) {
          throw new CMSError('ASSET_NOT_FOUND', {
            message: 'No assets found for the given IDs',
          });
        }

        // Only ORIGINALS move directly; a variant follows its original via the
        // cascade below and is never relocated on its own, so it stays
        // co-located. A variant id passed alone is therefore skipped (it is not
        // independently movable), not split off from its original.
        const movedIds = existing
          .filter((a) => a.variantOf === null)
          .map((a) => a.id);

        if (movedIds.length > 0) {
          // Move the assets AND their variants (co-located), scoped + non-archived.
          const updateConditions: SQL[] = [
            or(
              inArray(assets.id, movedIds),
              inArray(assets.variantOf, movedIds),
            )!,
            isNull(assets.archivedAt),
          ];
          if (scope.assets?.where)
            updateConditions.push(scope.assets.where);

          await db
            .update(assets)
            .set({ folderId, updatedAt: new Date() })
            .where(and(...updateConditions));
        }

        const skipped = assetIds.filter((id) => !movedIds.includes(id));
        return { moved: movedIds.length, movedIds, skipped };
      },
    ),

    /**
     * Archives one or more assets and their variants, soft-deleting them for later garbage collection.
     * Assets referenced by live (published) content are skipped, not failed, allowing partial batch success.
     *
     * @param assetIds - Array of asset ids to archive (at least one).
     * @returns Count of archived assets, their ids, and ids of skipped (in-use) assets.
     * @throws ASSET_NOT_FOUND if none of the asset ids exist.
     * @example await cmsClient.media.archiveAssets({ assetIds: ['ast_...'] })
     */
    archiveAssets: createCMSEndpoint(
      '/media/archiveAssets',
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

        const selectConditions: SQL[] = [
          inArray(assets.id, assetIds),
          isNull(assets.archivedAt),
        ];
        if (scope.assets?.where)
          selectConditions.push(scope.assets.where);

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
        const referenced = await assetsReferencedByLiveContent(
          db,
          existingIds,
          crossScopeColumns(scope.roots),
        );
        const toArchive: string[] = [];
        const skipped: string[] = [];
        for (const id of existingIds) {
          if (referenced.has(id)) {
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
        const archiveConditions: SQL[] = [
          or(
            inArray(assets.id, toArchive),
            inArray(assets.variantOf, toArchive),
          )!,
          isNull(assets.archivedAt),
        ];
        if (scope.assets?.where)
          archiveConditions.push(scope.assets.where);

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
     * Each page carries `storedSlug` — the page's OWN bare stored slug segment
     * (e.g. `about`), NOT a full URL path. It is a single ancestor-relative
     * segment (root pages are `null`), so it is deliberately named `storedSlug`
     * rather than exposed as a leading-slash `path`: assembling the full path
     * would require walking the ancestor chain, which this usage query does not
     * do (toe-int-14).
     *
     * @param assetId - The asset id to query.
     * @returns Page count and a list of each live (non-archived) page using the asset (each with its bare `storedSlug`), with per-block occurrences.
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
        const conditions: SQL[] = [eq(assets.id, assetId)];
        if (scope.assets?.where) conditions.push(scope.assets.where);
        const [asset] = await db
          .select({ id: assets.id })
          .from(assets)
          .where(and(...conditions));
        if (!asset) {
          throw new CMSError('ASSET_NOT_FOUND', {
            message: errorMessages.assetNotFound(assetId),
          });
        }

        const usage = await getAssetUsageDetails(
          db,
          assetId,
          crossScopeColumns(scope.roots),
        );

        // Rename the bare page slug to `storedSlug` (per the slug/path
        // convention): the value is a single stored slug segment, never a
        // URL-shaped leading-slash path, so it must not masquerade as one.
        return {
          pageCount: usage.pageCount,
          pages: usage.pages.map((page) => ({
            rootId: page.rootId,
            collection: page.collection,
            storedSlug: page.slug,
            occurrences: page.occurrences,
          })),
        };
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
     * @returns Array of assets with their signed upload URLs and headers, plus the `expiresAt` Date the signed URLs expire at.
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
        const expiresAt = new Date(Date.now() + signedUrlExpiresIn * 1000);

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
              // Direct object URL the asset will have once the PUT below succeeds
              // (deterministic from the object key) — for INTERNAL/admin display
              // like a media library, not for embedding in content (which
              // references the asset id and serves through `/media/asset/{slug}`).
              url: buildPublicObjectUrl(mediaConfig.publicUrl, p.objectKey),
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
     * @returns Array of uploaded assets, each with the same fields a `listAssets` row carries (id, slug, mimeType, size, objectKey, url, status, folderId, variantOf, uploadedBy, createdAt, updatedAt).
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
        // Measure the real bytes; the client-declared `size` is not trusted here.
        const files = ctx.body.files.map((f) => ({
          ...f,
          size: measureBufferSize(f.buffer),
        }));
        const { folderId, prepared } = await prepareAssetUpload(db, {
          actor,
          files,
          folderId: ctx.body.folderId,
          maxFiles,
          maxFileSize,
          allowedMimeTypes,
          scope,
        });

        // We hold the bytes here: verify each declared image type against the
        // buffer's magic bytes and reject a spoof (e.g. SVG-as-PNG) BEFORE any
        // DB row or S3 object is written.
        for (const file of files) {
          await assertDeclaredTypeMatchesBytes(file.name, file.type, file.buffer);
        }

        const client = getS3Client();

        const filesByIndex = new Map(files.map((f, i) => [i, f]));

        const inserted = await scopedInsertBatch(
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
        const insertedById = new Map(inserted.map((row) => [row.id, row]));

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
            console.error('[cms:media] upload failed', err);
            const status = err instanceof S3Error ? 500 : 0;
            throw new CMSError('UPLOAD_FAILED', {
              message: errorMessages.uploadFailed(file.name, status),
              data: { cause: err instanceof Error ? err.message : String(err) },
            });
          }
        }

        return {
          assets: prepared.map((p) => {
            const row = insertedById.get(p.id)!;
            return {
              id: p.id,
              slug: p.slug,
              mimeType: p.file.type,
              size: p.file.size,
              objectKey: p.objectKey,
              // Direct object URL for INTERNAL/admin display (see createSignedUpload) —
              // not for content, which references the asset id and serves via the gate.
              url: buildPublicObjectUrl(mediaConfig.publicUrl, p.objectKey),
              status: 'private' as const,
              folderId: folderId ?? null,
              variantOf: p.file.variantOf ?? null,
              uploadedBy: actor ?? null,
              // scopedInsertBatch returns a raw db.execute row: timestamptz comes
              // back as a string, so wrap it in a Date to match listAssets (which
              // reads Dates via a Drizzle .select()).
              createdAt: new Date(row.created_at as string),
              updatedAt: new Date(row.updated_at as string),
            };
          }),
        };
      },
    ),

    /**
     * Replaces the bytes behind an existing asset, keeping its `id` (and
     * `folderId`/`status`) stable so every content reference picks up the new
     * image with no content change — the read path stores the id and the gate
     * re-resolves it. A NEW slug/objectKey is minted (not an overwrite): the gate
     * stamps a long CDN cache on each object, so reusing the key would serve the
     * stale image; a new key is a natural cache-bust, and the short-cached gate
     * redirect propagates it within minutes.
     *
     * Server-side and atomic, like uploadAssets but reversed: the new object is
     * PUT first, then (only on success) the row is repointed in one transaction
     * that also archives the asset's old variants (they depict the old bytes and
     * are unreachable from the new slug). The old object is left orphaned for a
     * future pruning pass. Returns the updated asset.
     *
     * @param assetId - The asset to replace.
     * @param file - The new file (`buffer` of bytes, like uploadAssets).
     * @returns `{ asset }` with the same fields a `listAssets` row carries (id, slug, mimeType, size, objectKey, url, status, folderId, variantOf, uploadedBy, createdAt, updatedAt).
     * @throws ASSET_NOT_FOUND if the asset does not exist (in scope) or is archived.
     * @throws CANNOT_REPLACE_VARIANT if the target is itself a variant.
     * @throws FILE_TOO_LARGE / INVALID_FILE_TYPE on validation failure.
     * @throws UPLOAD_FAILED if the S3 upload fails (the asset is left unchanged).
     * @example await cmsClient.media.replaceAsset({ assetId: 'ast_...', file: { name, size, type, buffer } })
     */
    replaceAsset: createCMSEndpoint(
      '/media/replaceAsset',
      {
        method: 'POST',
        body: z.object({
          assetId: z.string().min(1),
          file: z.object({
            name: z.string().min(1),
            size: z.number().int().positive(),
            type: z.string().min(1),
            buffer: z.instanceof(Blob).or(z.instanceof(ArrayBuffer)),
          }),
        }),
        metadata: cmsMeta({}, { operation: 'update', ...MEDIA_META }),
      },
      async (ctx) => {
        const { scope } = ctx.context;
        const { assetId, file } = ctx.body;
        // Measure the real bytes; the client-declared `size` is not trusted here.
        const measuredSize = measureBufferSize(file.buffer);

        // 1. Load the target (live, in scope).
        const loadConditions: SQL[] = [
          eq(assets.id, assetId),
          isNull(assets.archivedAt),
        ];
        if (scope.assets?.where) loadConditions.push(scope.assets.where);

        const [target] = await db
          .select({ id: assets.id, variantOf: assets.variantOf })
          .from(assets)
          .where(and(...loadConditions));

        if (!target) {
          throw new CMSError('ASSET_NOT_FOUND', {
            message: errorMessages.assetNotFound(assetId),
          });
        }

        // 2. A variant must be regenerated via its original, never replaced
        //    directly (the gate computes variant slugs from the original).
        if (target.variantOf) {
          throw new CMSError('CANNOT_REPLACE_VARIANT');
        }

        // 3. Validate the new file (size / declared mime type), then sniff its
        //    magic bytes — we hold the buffer, so reject a declared-image spoof
        //    (e.g. SVG-as-PNG stored XSS) before minting a new object.
        validateFiles(
          [{ name: file.name, size: measuredSize, type: file.type }],
          { maxFiles, maxFileSize, allowedMimeTypes },
        );
        await assertDeclaredTypeMatchesBytes(file.name, file.type, file.buffer);

        // 4. Mint a NEW slug/objectKey from the new file (cache-bust).
        const slug = await generateUniqueSlug(db, file.name, undefined, scope);
        if (!slug) {
          throw new CMSError('SLUG_GENERATION_FAILED');
        }
        const objectKey = buildObjectKey(slug);

        // 5. PUT the new object FIRST — on failure the row is untouched, so the
        //    asset keeps serving its existing (still-present) object.
        try {
          await putObject(getS3Client(), {
            bucket: bucketName,
            key: objectKey,
            body: file.buffer,
            contentType: file.type,
            contentLength: measuredSize,
            acl: 'public-read',
          });
        } catch (err) {
          console.error('[cms:media] upload failed', err);
          const status = err instanceof S3Error ? 500 : 0;
          throw new CMSError('UPLOAD_FAILED', {
            message: errorMessages.uploadFailed(file.name, status),
            data: { cause: err instanceof Error ? err.message : String(err) },
          });
        }

        // 6. Atomically repoint the row at the new object AND archive the old
        //    variants (stale bytes, unreachable from the new slug). id, folderId,
        //    status, variantOf are unchanged. Old object is left for pruning.
        const now = new Date();
        const repointedRow = await db.transaction(async (tx) => {
          const updateConditions: SQL[] = [
            eq(assets.id, assetId),
            isNull(assets.archivedAt),
          ];
          if (scope.assets?.where)
            updateConditions.push(scope.assets.where);

          const repointed = await tx
            .update(assets)
            .set({
              slug,
              objectKey,
              mimeType: file.type,
              size: measuredSize,
              updatedAt: now,
            })
            .where(and(...updateConditions))
            .returning();

          // The asset was archived / left scope between the load and here
          // (TOCTOU). Roll back so we never report a replace that didn't land;
          // the just-PUT object is left orphaned for the pruning pass.
          if (repointed.length === 0) {
            throw new CMSError('ASSET_NOT_FOUND', {
              message: errorMessages.assetNotFound(assetId),
            });
          }

          const variantConditions: SQL[] = [
            eq(assets.variantOf, assetId),
            isNull(assets.archivedAt),
          ];
          if (scope.assets?.where)
            variantConditions.push(scope.assets.where);

          await tx
            .update(assets)
            .set({ archivedAt: now, updatedAt: now })
            .where(and(...variantConditions));

          return repointed[0];
        });

        return {
          asset: {
            id: repointedRow.id,
            slug: repointedRow.slug,
            mimeType: repointedRow.mimeType,
            size: repointedRow.size,
            objectKey: repointedRow.objectKey,
            // Direct object URL for INTERNAL/admin display only (see the gate
            // for serving in content).
            url: buildPublicObjectUrl(
              mediaConfig.publicUrl,
              repointedRow.objectKey,
            ),
            status: repointedRow.status,
            folderId: repointedRow.folderId ?? null,
            variantOf: repointedRow.variantOf ?? null,
            uploadedBy: repointedRow.uploadedBy ?? null,
            createdAt: repointedRow.createdAt,
            updatedAt: repointedRow.updatedAt,
          },
        };
      },
    ),
  };
}
