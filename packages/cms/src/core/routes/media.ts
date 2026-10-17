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
import type { ResolvedScope } from '../types/definitions';

import { newId } from '../../utils/nanoid';
import { assetFolders, assets } from '../db/schema.generated';
import { cmsMeta, createCMSEndpoint } from '../endpoint';
import { CMSError, errorMessages } from '../errors';
import {
  deriveUploadKey,
  mintUploadToken,
  scopeFingerprint,
  type UploadTokenPayload,
  verifyUploadToken,
} from '../media/upload-token';
import {
  assertFolderExists,
  generateUniqueSlug,
  measureBufferSize,
  prepareAssetUpload,
  prepareSignedUpload,
  validateFiles,
} from '../media/uploads';
import {
  assetsReferencedByLiveContent,
  assetsSuspectedInRichText,
  getAssetUsageDetails,
} from '../media/usage';
import { crossScopeColumns, scopedInsert, scopedInsertBatch } from '../scope';
import {
  requireCapability,
  type StorageAdapter,
  StorageError,
} from '../storage/adapter';
import { getStorage } from '../storage/get-storage';
import {
  buildPublicObjectUrl,
  buildUploadObjectKey,
  buildVariantSlug,
} from '../storage/s3/utils';
import { MEDIA_DEFAULTS } from '../types/s3';
import { wireBooleanIsTrue, wireBooleanSchema } from '../utils/wire-boolean';

/**
 * Types the gate redirects to the bare public URL. Everything else, and every
 * `?download` request, is redirected to a signed URL whose
 * `response-content-disposition` forces a download. Raster formats are listed
 * explicitly so `image/svg+xml` never renders inline from the gate.
 */
const INLINE_SAFE =
  /^(image\/(png|jpeg|gif|webp|avif)|video\/|audio\/|application\/pdf$)/;

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
 * True when the leading bytes of a payload are consistent with
 * `declaredType`. Non-image types always pass. A declared image type fails
 * when the bytes match a different known signature, or match no signature
 * while the declared type is in SNIFFABLE_IMAGE_TYPES (the SVG/HTML-as-image
 * case). A declared type outside that set with unrecognized bytes passes and
 * is left to the declared-type allowlist.
 */
function verifyImageBytes(declaredType: string, bytes: Uint8Array): boolean {
  if (!declaredType.startsWith('image/')) return true;
  const sniffed = sniffImageType(bytes);
  if (sniffed === declaredType) return true;
  return sniffed === undefined && !SNIFFABLE_IMAGE_TYPES.has(declaredType);
}

/**
 * Content-type validation for the server upload paths (`uploadAssets`,
 * `replaceAsset`), which hold the bytes. `completeUpload` and `commitReplace`
 * apply `verifyImageBytes` to the first 12 bytes of the landed object. Runs
 * AFTER the declared-type allowlist and throws INVALID_FILE_TYPE when the
 * bytes contradict a declared image type. Video/PDF are declared-type-only.
 */
async function assertDeclaredTypeMatchesBytes(
  fileName: string,
  declaredType: string,
  buffer: Blob | ArrayBuffer,
): Promise<void> {
  if (!declaredType.startsWith('image/')) return;
  if (verifyImageBytes(declaredType, await readLeadingBytes(buffer, 12))) {
    return;
  }
  throw new CMSError('INVALID_FILE_TYPE', {
    message: errorMessages.invalidFileType(fileName, declaredType),
  });
}

/**
 * SQLSTATE and constraint name of a Postgres error. drizzle wraps the driver
 * error in `DrizzleQueryError.cause`, so both the error and its cause are read.
 */
function pgErrorInfo(err: unknown): { code?: string; constraint?: string } {
  const top = err as { code?: unknown; constraint?: unknown; cause?: unknown };
  if (typeof top?.code === 'string') {
    return top as { code: string; constraint?: string };
  }
  const cause = top?.cause as { code?: unknown; constraint?: unknown };
  if (typeof cause?.code === 'string') {
    return cause as { code: string; constraint?: string };
  }
  return {};
}

function isConstraintViolation(
  err: unknown,
  sqlState: '23503' | '23505',
  constraint: string,
): boolean {
  const info = pgErrorInfo(err);
  return info.code === sqlState && !!info.constraint?.includes(constraint);
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

  const maxFileSize = mediaConfig.maxFileSize ?? MEDIA_DEFAULTS.maxFileSize;
  const maxFiles = mediaConfig.maxFiles ?? MEDIA_DEFAULTS.maxFiles;
  const allowedMimeTypes = mediaConfig.allowedMimeTypes ?? [
    ...MEDIA_DEFAULTS.allowedMimeTypes,
  ];
  const signedUrlExpiresIn =
    mediaConfig.signedUrlExpiresIn ?? MEDIA_DEFAULTS.signedUrlExpiresIn;
  // `undefined` sends no `x-amz-acl` header, which buckets with ACLs
  // disabled ("Bucket owner enforced") require.
  const objectAcl =
    mediaConfig.acl === false ? undefined : (mediaConfig.acl ?? 'public-read');

  /**
   * Throws STORAGE_UNSUPPORTED unless the adapter signs uploads and, when any
   * declared type is `image/*`, can read byte ranges: an image that cannot be
   * sniffed afterwards would never pass `completeUpload` / `commitReplace`.
   */
  function requireSignedUploadCapability(
    storage: StorageAdapter,
    types: string[],
  ): void {
    const hasImage = types.some((t) => t.startsWith('image/'));
    requireCapability(
      storage,
      (c) => c.signedUpload.supported && (c.rangeRead || !hasImage),
      hasImage
        ? 'signed uploads with range reads, which verifying an uploaded image requires'
        : 'signed uploads',
    );
  }

  /**
   * Checks an object the browser PUT against the token's claim. Returns the
   * error to report when no object exists at the key, its content length is
   * missing or differs from `size`, its content type (parameters stripped)
   * differs from `type`, or the leading bytes contradict a declared image
   * type. The object is deleted in the last three cases; a failed delete is
   * logged and the error still returned. Returns `null` when the object
   * matches. Throws STORAGE_UNSUPPORTED for an image type when the adapter
   * cannot read a byte range, since an image is never accepted unsniffed.
   */
  async function inspectUploadedObject(claim: {
    name: string;
    objectKey: string;
    type: string;
    size: number;
  }): Promise<APIError | null> {
    const storage = getStorage(mediaConfig);
    const missing = () =>
      new CMSError('UPLOAD_NOT_FOUND', {
        message: `No object at "${claim.objectKey}"; the PUT to the signed URL did not complete`,
      });
    const discard = async () => {
      try {
        await storage.delete(claim.objectKey);
      } catch (err) {
        console.error('[cms:media] failed to delete rejected upload', err);
      }
    };

    if (claim.type.startsWith('image/')) {
      requireCapability(
        storage,
        (c) => c.rangeRead,
        'range reads, which verifying an uploaded image requires',
      );
    }

    const head = await storage.head(claim.objectKey);
    if (!head) return missing();
    if (head.contentLength !== claim.size) {
      await discard();
      return new APIError(400, {
        code: 'VALIDATION_ERROR',
        message: `Declared size ${claim.size} does not match the uploaded object (${head.contentLength ?? 'unknown length'})`,
      });
    }
    if (
      head.contentType !== null &&
      head.contentType.split(';')[0].trim() !== claim.type
    ) {
      await discard();
      return new APIError(400, {
        code: 'VALIDATION_ERROR',
        message: `Declared MIME type "${claim.type}" does not match the uploaded object ("${head.contentType}")`,
      });
    }
    if (claim.type.startsWith('image/')) {
      const bytes = await storage.getRange(claim.objectKey, 0, 11);
      if (!bytes) return missing();
      if (!verifyImageBytes(claim.type, bytes)) {
        await discard();
        return new CMSError('INVALID_FILE_TYPE', {
          message: errorMessages.invalidFileType(claim.name, claim.type),
        });
      }
    }
    return null;
  }

  /**
   * Inserts the `assets` row for a verified upload token and returns it
   * through drizzle. The slug is minted here, up to three times when another
   * row takes it first. A primary-key or object-key conflict means this token
   * was completed before: the live row is returned, or ASSET_NOT_FOUND is
   * thrown when that row has since been archived. A foreign-key violation
   * maps to FOLDER_NOT_FOUND / ASSET_NOT_FOUND.
   */
  async function insertCompletedUpload(
    payload: Extract<UploadTokenPayload, { kind: 'upload' }>,
    scope: ResolvedScope,
  ): Promise<AssetRow> {
    const loadRow = async () => {
      const conditions: SQL[] = [
        eq(assets.id, payload.id),
        isNull(assets.archivedAt),
      ];
      if (scope.assets?.where) conditions.push(scope.assets.where);
      const [row] = await db
        .select()
        .from(assets)
        .where(and(...conditions));
      return row;
    };

    // Slugs are unique per scope only (a scoping plugin adds its own unique
    // index); a slug that loses a concurrent insert race is excluded here so
    // the next attempt moves to the next counter.
    const taken = new Set<string>();

    for (let attempt = 0; attempt < 3; attempt++) {
      const slug = await generateUniqueSlug(db, payload.name, taken, scope);
      if (!slug) throw new CMSError('SLUG_GENERATION_FAILED');

      try {
        await scopedInsert(
          db,
          'cms.assets',
          {
            id: payload.id,
            slug,
            mime_type: payload.type,
            size: payload.size,
            object_key: payload.objectKey,
            status: 'private' as const,
            folder_id: payload.folderId,
            variant_of: payload.variantOf,
            uploaded_by: payload.actor,
          },
          scope.assets,
        );
      } catch (err) {
        if (
          isConstraintViolation(err, '23505', 'assets_pkey') ||
          isConstraintViolation(err, '23505', 'assets_object_key_unique')
        ) {
          const existing = await loadRow();
          if (existing) return existing;
          throw new CMSError('ASSET_NOT_FOUND', {
            message: errorMessages.assetNotFound(payload.id),
          });
        }
        if (isConstraintViolation(err, '23505', 'slug')) {
          taken.add(slug);
          continue;
        }
        if (isConstraintViolation(err, '23503', 'folder_id')) {
          throw new CMSError('FOLDER_NOT_FOUND', {
            message: errorMessages.folderNotFound(payload.folderId ?? ''),
          });
        }
        if (isConstraintViolation(err, '23503', 'variant_of')) {
          throw new CMSError('ASSET_NOT_FOUND', {
            message: errorMessages.assetNotFound(payload.variantOf ?? ''),
          });
        }
        throw err;
      }

      const row = await loadRow();
      if (!row) {
        throw new Error(
          `completeUpload: inserted asset ${payload.id} is not readable in scope`,
        );
      }
      return row;
    }

    throw new CMSError('SLUG_GENERATION_FAILED');
  }

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

        // Archived assets and assets outside the scope do not block: their
        // folder_id is set to NULL by the FK, and archived ones stay
        // restorable. Child folders are counted unscoped because
        // asset_folders_parent_fk cascades.
        const assetConditions: SQL[] = [
          eq(assets.folderId, folderId),
          isNull(assets.archivedAt),
        ];
        if (scope.assets?.where) assetConditions.push(scope.assets.where);
        const [assetCount] = await db
          .select({ n: sql<number>`count(*)::int` })
          .from(assets)
          .where(and(...assetConditions));
        const [childCount] = await db
          .select({ n: sql<number>`count(*)::int` })
          .from(assetFolders)
          .where(eq(assetFolders.parentId, folderId));

        if (assetCount.n > 0 || childCount.n > 0) {
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
            unfiled: wireBooleanSchema.optional(),
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
        if (wireBooleanIsTrue(unfiled)) {
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
     *
     * Inline-safe types (raster images, video, audio, PDF) redirect to the
     * public object URL. `?download=true` and every other type redirect to a
     * signed GET URL, valid for one hour, whose `response-content-disposition`
     * is `attachment`, so the bucket answers with a download. A
     * `Content-Disposition` header on the `302` itself would be ignored by
     * browsers, which apply the header of the final response only.
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
          download: wireBooleanSchema.optional(),
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
        //
        // The signed URL expires after at most 3600 s (less when the adapter
        // declares a lower `signedUrl.maxExpiresIn`).
        ctx.responseHeaders.set('cache-control', 'public, max-age=300');
        const wantsDownload = wireBooleanIsTrue(ctx.query?.download);
        const inlineSafe = INLINE_SAFE.test(asset.mimeType);
        if (!wantsDownload && inlineSafe) {
          return ctx.redirect(
            buildPublicObjectUrl(mediaConfig.publicUrl, targetKey),
          );
        }
        const safeName = asset.slug.replace(/["\\\r\n]/g, '_');
        const disposition = `attachment;filename="${safeName}";filename*=UTF-8''${encodeURIComponent(asset.slug)}`;
        const storage = getStorage(mediaConfig);
        requireCapability(
          storage,
          (c) => c.signedUrl.supported && c.signedUrl.disposition,
          'signed URLs with a bound content disposition',
        );
        const signed = await storage.signGet(targetKey, {
          expiresIn: Math.min(
            3600,
            storage.capabilities.signedUrl.maxExpiresIn,
          ),
          responseContentDisposition: disposition,
        });
        return ctx.redirect(signed);
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
        if (scope.assets?.where) selectConditions.push(scope.assets.where);

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
        if (scope.assets?.where) updateConditions.push(scope.assets.where);

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
        if (scope.assets?.where) selectConditions.push(scope.assets.where);

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
          if (scope.assets?.where) updateConditions.push(scope.assets.where);

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
     * Assets referenced by live content are skipped, not failed, allowing partial batch success.
     * With `guardRichTextReferences` on (the default), assets whose id appears inside a longer
     * string of any block version (rich text) are skipped too, unless `force` is set.
     *
     * @param assetIds - Array of asset ids to archive (at least one).
     * @param force - Archive assets suspected in rich text anyway. Live references still block.
     * @returns Count of archived assets, their ids, the skipped ids, and why each was skipped (`in_use` or `richtext_suspect`).
     * @throws ASSET_NOT_FOUND if none of the asset ids exist.
     * @example await cmsClient.media.archiveAssets({ assetIds: ['ast_...'] })
     */
    archiveAssets: createCMSEndpoint(
      '/media/archiveAssets',
      {
        method: 'POST',
        body: z.object({
          assetIds: z.array(z.string()).min(1),
          force: z.boolean().optional(),
        }),
        metadata: cmsMeta({}, { operation: 'delete', ...MEDIA_META }),
      },
      async (ctx) => {
        const { scope } = ctx.context;
        const { assetIds, force } = ctx.body;

        const selectConditions: SQL[] = [
          inArray(assets.id, assetIds),
          isNull(assets.archivedAt),
        ];
        if (scope.assets?.where) selectConditions.push(scope.assets.where);

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
        const scopeColumns = crossScopeColumns(scope.roots);
        const referenced = await assetsReferencedByLiveContent(
          db,
          existingIds,
          scopeColumns,
        );
        const suspected =
          force || mediaConfig.guardRichTextReferences === false
            ? new Set<string>()
            : await assetsSuspectedInRichText(
                db,
                existingIds.filter((id) => !referenced.has(id)),
                scopeColumns,
              );
        const toArchive: string[] = [];
        const skipped: string[] = [];
        const skippedReasons: Record<string, 'in_use' | 'richtext_suspect'> =
          {};
        for (const id of existingIds) {
          if (referenced.has(id)) {
            skipped.push(id);
            skippedReasons[id] = 'in_use';
          } else if (suspected.has(id)) {
            skipped.push(id);
            skippedReasons[id] = 'richtext_suspect';
          } else {
            toArchive.push(id);
          }
        }

        if (toArchive.length === 0) {
          return { archived: 0, archivedIds: [], skipped, skippedReasons };
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
        if (scope.assets?.where) archiveConditions.push(scope.assets.where);

        const archived = await db
          .update(assets)
          .set({ archivedAt: now, updatedAt: now })
          .where(and(...archiveConditions))
          .returning({ id: assets.id });

        return {
          archived: archived.length,
          archivedIds: archived.map((a) => a.id),
          skipped,
          skippedReasons,
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
     * Presigns direct browser uploads: validates the declared files, mints an
     * asset id and an object key (`<id>/<slug of name>`) per file, and returns
     * time-limited S3 PUT URLs plus a signed `token` per file. Writes no
     * database row; the asset exists only after `completeUpload` verifies the
     * landed object.
     *
     * @param files - Array of file metadata (name, size, type, optional variantOf).
     * @param folderId - Optional target folder id.
     * @returns `{ uploads: { id, objectKey, url, signedUrl, headers, token }[], expiresAt }`. PUT each file to its `signedUrl` with `headers`, then pass each `token` to `completeUpload`.
     * @throws TOO_MANY_FILES if file count exceeds the configured limit.
     * @throws FILE_TOO_LARGE if any file exceeds the configured size limit.
     * @throws INVALID_FILE_TYPE if any file has a disallowed MIME type.
     * @throws FOLDER_NOT_FOUND if folderId does not exist.
     * @throws ASSET_NOT_FOUND if a variantOf id does not reference an existing asset.
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
        const { folderId, prepared } = await prepareSignedUpload(db, {
          actor,
          files: ctx.body.files,
          folderId: ctx.body.folderId,
          maxFiles,
          maxFileSize,
          allowedMimeTypes,
          scope,
        });

        const storage = getStorage(mediaConfig);
        requireSignedUploadCapability(
          storage,
          prepared.map((p) => p.file.type),
        );
        const key = await deriveUploadKey(mediaConfig);
        const scopeId = await scopeFingerprint(scope.assets?.insertColumns);
        const exp = Date.now() + signedUrlExpiresIn * 1000;
        const expiresAt = new Date(exp);

        const uploads = await Promise.all(
          prepared.map(async (p) => {
            const signed = await storage.signPut(p.objectKey, {
              contentType: p.file.type,
              contentLength: p.file.size,
              expiresIn: signedUrlExpiresIn,
              acl: objectAcl,
            });
            const token = await mintUploadToken(key, {
              kind: 'upload',
              id: p.id,
              name: p.file.name,
              objectKey: p.objectKey,
              type: p.file.type,
              size: p.file.size,
              folderId: folderId ?? null,
              variantOf: p.file.variantOf ?? null,
              actor: actor ?? null,
              scope: scopeId,
              exp,
            });
            return {
              id: p.id,
              objectKey: p.objectKey,
              // Direct object URL the asset will have once the PUT and
              // completeUpload succeed — for INTERNAL/admin display like a
              // media library, not for embedding in content (which references
              // the asset id and serves through `/media/asset/{id}`).
              url: buildPublicObjectUrl(mediaConfig.publicUrl, p.objectKey),
              signedUrl: signed.url,
              headers: signed.headers,
              token,
            };
          }),
        );

        return { uploads, expiresAt };
      },
    ),

    /**
     * Creates the asset rows for objects the browser PUT to the URLs from
     * `createSignedUpload`. Per token: verifies the signature, the caller's
     * scope and user, HEADs the object (its length must equal and its content
     * type must match the token's claim), sniffs the leading bytes of a
     * declared image, mints the slug, and inserts the row as `private`. An
     * object that fails the length, type, or sniff check is deleted.
     * Idempotent per token: a second completion returns the existing asset.
     * One entry's failure never fails the call; it is reported in `errors`.
     * A bucket error while checking an entry's object is reported as
     * UPLOAD_FAILED for that entry.
     *
     * @param uploads - One `{ token }` per file, from `createSignedUpload`.
     * @returns `{ assets, errors }`: the created assets (same fields as a `listAssets` row) and `{ index, code, message }` per rejected entry, `index` into `uploads`.
     * @example await cmsClient.media.completeUpload({ uploads: signed.uploads.map(({ token }) => ({ token })) })
     */
    completeUpload: createCMSEndpoint(
      '/media/completeUpload',
      {
        method: 'POST',
        body: z.object({
          uploads: z
            .array(z.object({ token: z.string().min(1) }))
            .min(1)
            .max(maxFiles),
        }),
        metadata: cmsMeta({}, { operation: 'create', ...MEDIA_META }),
      },
      async (ctx) => {
        const { userId, scope } = ctx.context;
        const actor = userId ?? null;
        const key = await deriveUploadKey(mediaConfig);
        const scopeId = await scopeFingerprint(scope.assets?.insertColumns);

        const completed: ReturnType<typeof toAssetListItem>[] = [];
        const errors: { index: number; code: string; message: string }[] = [];
        const fail = (index: number, err: APIError) => {
          errors.push({
            index,
            code:
              (err as CMSError).cmsCode ?? err.body?.code ?? 'UPLOAD_FAILED',
            message: err.message,
          });
        };

        for (let i = 0; i < ctx.body.uploads.length; i++) {
          const payload = await verifyUploadToken(
            key,
            ctx.body.uploads[i].token,
          );
          if (
            !payload ||
            payload.kind !== 'upload' ||
            payload.scope !== scopeId ||
            payload.actor !== actor
          ) {
            fail(i, new CMSError('UPLOAD_TOKEN_INVALID'));
            continue;
          }

          try {
            const rejected = await inspectUploadedObject(payload);
            if (rejected) {
              fail(i, rejected);
              continue;
            }
            const row = await insertCompletedUpload(payload, scope);
            completed.push(toAssetListItem(row, mediaConfig.publicUrl));
          } catch (err) {
            if (err instanceof APIError) {
              fail(i, err);
              continue;
            }
            if (err instanceof StorageError) {
              fail(
                i,
                new CMSError('UPLOAD_FAILED', {
                  message: `Could not verify the uploaded object for "${payload.name}"`,
                }),
              );
              continue;
            }
            throw err;
          }
        }

        return { assets: completed, errors };
      },
    ),

    /**
     * Prepares a REPLACEMENT of an asset's bytes for client-side S3 upload —
     * the browser-callable half of `replaceAsset` (see its docstring for the
     * id/slug cache-bust rationale). Validates the target asset and the new
     * file's declared metadata the same way `replaceAsset` does, mints a new
     * slug and an object key (`<fresh id>/<slug>`), and returns a signed PUT
     * URL plus a signed `token` binding the asset, key, type, size, caller
     * and scope. Writes no database row — the target asset's row is only
     * repointed once `commitReplace` is called after the client's PUT succeeds.
     *
     * @param assetId - The asset to replace.
     * @param file - The new file's metadata (name, size, type) — no bytes; the browser PUTs them straight to S3.
     * @returns `{ assetId, slug, objectKey, url, signedUrl, headers, expiresAt, token }`.
     * @throws ASSET_NOT_FOUND if the asset does not exist (in scope) or is archived.
     * @throws CANNOT_REPLACE_VARIANT if the target is itself a variant.
     * @throws FILE_TOO_LARGE / INVALID_FILE_TYPE on validation failure.
     * @throws SLUG_GENERATION_FAILED if slug generation exhausts retry attempts.
     * @example
     * const signed = await cmsClient.media.createSignedReplace({
     *   body: { assetId, file: { name: file.name, size: file.size, type: file.type } },
     * });
     * await fetch(signed.signedUrl, { method: 'PUT', headers: signed.headers, body: file });
     * await cmsClient.media.commitReplace({ body: { token: signed.token } });
     */
    createSignedReplace: createCMSEndpoint(
      '/media/createSignedReplace',
      {
        method: 'POST',
        body: z.object({
          assetId: z.string().min(1),
          file: z.object({
            name: z.string().min(1),
            size: z.number().int().positive(),
            type: z.string().min(1),
          }),
        }),
        metadata: cmsMeta({}, { operation: 'update', ...MEDIA_META }),
      },
      async (ctx) => {
        const { userId: actor, scope } = ctx.context;
        const { assetId, file } = ctx.body;

        // 1. Load the target (live, in scope) — same guard as replaceAsset
        //    step 1.
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
        //    directly — same guard as replaceAsset step 2.
        if (target.variantOf) {
          throw new CMSError('CANNOT_REPLACE_VARIANT');
        }

        // 3. Validate the declared file (size / MIME type). The bytes are
        //    checked by commitReplace once they have landed.
        validateFiles([{ name: file.name, size: file.size, type: file.type }], {
          maxFiles,
          maxFileSize,
          allowedMimeTypes,
        });

        // 4. Mint a NEW slug and object key from the new file (cache-bust) —
        //    same as replaceAsset step 4. The key carries a fresh id so two
        //    concurrent replaces of one asset cannot overwrite each other's
        //    bytes. The row itself is repointed later, by commitReplace.
        const slug = await generateUniqueSlug(db, file.name, undefined, scope);
        if (!slug) {
          throw new CMSError('SLUG_GENERATION_FAILED');
        }
        const objectKey = buildUploadObjectKey(newId('asset'), slug);

        const storage = getStorage(mediaConfig);
        requireSignedUploadCapability(storage, [file.type]);
        const exp = Date.now() + signedUrlExpiresIn * 1000;
        const expiresAt = new Date(exp);
        const signed = await storage.signPut(objectKey, {
          contentType: file.type,
          contentLength: file.size,
          expiresIn: signedUrlExpiresIn,
          acl: objectAcl,
        });
        const token = await mintUploadToken(
          await deriveUploadKey(mediaConfig),
          {
            kind: 'replace',
            assetId,
            slug,
            objectKey,
            type: file.type,
            size: file.size,
            actor: actor ?? null,
            scope: await scopeFingerprint(scope.assets?.insertColumns),
            exp,
          },
        );

        return {
          assetId,
          slug,
          objectKey,
          // Direct object URL the asset will have once the PUT below succeeds
          // AND commitReplace repoints the row — for INTERNAL/admin display
          // only (see createSignedUpload).
          url: buildPublicObjectUrl(mediaConfig.publicUrl, objectKey),
          signedUrl: signed.url,
          headers: signed.headers,
          expiresAt,
          token,
        };
      },
    ),

    /**
     * Repoints an asset's row at the new object after the browser has PUT it
     * to the signed URL from `createSignedReplace`. The `token` names the
     * asset, object key, slug, type and size; it must have been minted for
     * the calling user and scope. The object is HEADed (length must equal and
     * content type must match the token) and a declared image is sniffed
     * before anything is written; a mismatching object is deleted. In one
     * transaction the row is repointed, the asset's old variants are
     * archived, and the superseded slug/objectKey is tombstoned (an
     * immediately-archived asset row) so the pruning pass reclaims the old
     * S3 object after the trash window. If the asset was archived or left
     * scope since `createSignedReplace`, the new object is tombstoned
     * instead, since no row will reference it. Idempotent per token: a
     * commit whose row already points at the token's object returns that
     * row unchanged.
     *
     * @param token - The `token` returned by `createSignedReplace`.
     * @returns `{ asset }` with the same fields a `listAssets` row carries.
     * @throws UPLOAD_TOKEN_INVALID if the token is malformed, expired, not a replace token, or was issued to another user or scope.
     * @throws UPLOAD_NOT_FOUND if no object exists at the token's object key (the PUT to the signed URL never completed).
     * @throws ASSET_NOT_FOUND if the asset was archived / left scope since `createSignedReplace` (TOCTOU).
     * @throws FILE_TOO_LARGE / INVALID_FILE_TYPE / TOO_MANY_FILES if the token's type/size fail the media config, or the object's bytes contradict a declared image type.
     * @throws VALIDATION_ERROR if the uploaded object's length or content type differs from the token.
     * @example await cmsClient.media.commitReplace({ body: { token: signed.token } })
     */
    commitReplace: createCMSEndpoint(
      '/media/commitReplace',
      {
        method: 'POST',
        body: z.object({ token: z.string().min(1) }),
        metadata: cmsMeta({}, { operation: 'update', ...MEDIA_META }),
      },
      async (ctx) => {
        const { userId, scope } = ctx.context;

        const payload = await verifyUploadToken(
          await deriveUploadKey(mediaConfig),
          ctx.body.token,
        );
        if (
          !payload ||
          payload.kind !== 'replace' ||
          payload.scope !==
            (await scopeFingerprint(scope.assets?.insertColumns)) ||
          payload.actor !== (userId ?? null)
        ) {
          throw new CMSError('UPLOAD_TOKEN_INVALID');
        }
        const { assetId, objectKey, slug, type: mimeType, size } = payload;

        const now = new Date();

        // The media config may have changed since the token was minted.
        validateFiles([{ name: slug, size, type: mimeType }], {
          maxFiles,
          maxFileSize,
          allowedMimeTypes,
        });

        let rejected: APIError | null;
        try {
          rejected = await inspectUploadedObject({
            name: slug,
            objectKey,
            type: mimeType,
            size,
          });
        } catch (err) {
          if (err instanceof StorageError) {
            throw new CMSError('UPLOAD_FAILED', {
              message: 'Could not verify the uploaded object',
            });
          }
          throw err;
        }
        if (rejected) throw rejected;

        // `.value` is set inside the transaction ONLY on the TOCTOU-rollback
        // branch, so the outer catch below knows to tombstone the just-PUT NEW
        // object. Read outside the transaction (after it has already rolled
        // back), because a row inserted from WITHIN a transaction that then
        // throws is rolled back along with everything else in it — the
        // tombstone for this branch must be written in a SEPARATE statement,
        // after the rollback. A one-property CARRIER object (rather than a
        // reassigned `let`) sidesteps a TS control-flow-narrowing limitation:
        // TS does not track assignments made inside a nested closure when
        // narrowing a captured `let` at a read site in the enclosing scope.
        const orphanedNewObject: {
          value: {
            slug: string;
            objectKey: string;
            mimeType: string;
            size: number;
          } | null;
        } = { value: null };

        try {
          const repointedRow = await db.transaction(async (tx) => {
            // Load the CURRENT (pre-repoint) row inside the transaction — its
            // slug/objectKey are what the tombstone below preserves.
            const loadConditions: SQL[] = [
              eq(assets.id, assetId),
              isNull(assets.archivedAt),
            ];
            if (scope.assets?.where) loadConditions.push(scope.assets.where);

            const [before] = await tx
              .select({
                slug: assets.slug,
                objectKey: assets.objectKey,
                mimeType: assets.mimeType,
                size: assets.size,
                uploadedBy: assets.uploadedBy,
              })
              .from(assets)
              .where(and(...loadConditions));

            // The asset was archived / left scope since createSignedReplace
            // (TOCTOU). Roll back so we never report a replace that didn't
            // land; the just-PUT object at `objectKey` is unreachable from any
            // row, so it is tombstoned (outside this transaction, see below)
            // rather than left for pruning to never find.
            if (!before) {
              orphanedNewObject.value = { slug, objectKey, mimeType, size };
              throw new CMSError('ASSET_NOT_FOUND', {
                message: errorMessages.assetNotFound(assetId),
              });
            }

            // The row already points at this token's object: an earlier
            // commit landed and its response was lost. The tombstone for
            // `before` exists from that commit and must not be written again.
            if (before.objectKey === objectKey) {
              const [current] = await tx
                .select()
                .from(assets)
                .where(and(...loadConditions));
              return current;
            }

            const updateConditions: SQL[] = [
              eq(assets.id, assetId),
              isNull(assets.archivedAt),
            ];
            if (scope.assets?.where) updateConditions.push(scope.assets.where);

            const repointed = await tx
              .update(assets)
              .set({ slug, objectKey, mimeType, size, updatedAt: now })
              .where(and(...updateConditions))
              .returning();

            if (repointed.length === 0) {
              orphanedNewObject.value = { slug, objectKey, mimeType, size };
              throw new CMSError('ASSET_NOT_FOUND', {
                message: errorMessages.assetNotFound(assetId),
              });
            }

            const variantConditions: SQL[] = [
              eq(assets.variantOf, assetId),
              isNull(assets.archivedAt),
            ];
            if (scope.assets?.where) variantConditions.push(scope.assets.where);

            await tx
              .update(assets)
              .set({ archivedAt: now, updatedAt: now })
              .where(and(...variantConditions));

            // Tombstone the superseded slug/objectKey so the pruning pass
            // reclaims the old S3 object. Must run after the update above:
            // both columns are globally unique, so inserting the tombstone
            // first collides with the still-live row.
            await scopedInsert(
              tx,
              'cms.assets',
              {
                // A fresh id (never reused from the live/original row) is
                // load-bearing: the pruning reclaim query's liveness check
                // joins content_usages on this asset's id, and content only
                // ever referenced the ORIGINAL id — a tombstone that reused it
                // would look "still referenced" and never be reclaimed.
                id: newId('asset'),
                slug: before.slug,
                mime_type: before.mimeType,
                size: before.size,
                object_key: before.objectKey,
                status: 'private' as const,
                folder_id: null,
                variant_of: null,
                uploaded_by: before.uploadedBy,
                archived_at: now,
              },
              scope.assets,
            );

            return repointed[0];
          });

          return {
            asset: {
              id: repointedRow.id,
              slug: repointedRow.slug,
              mimeType: repointedRow.mimeType,
              size: repointedRow.size,
              objectKey: repointedRow.objectKey,
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
        } catch (err) {
          const orphaned = orphanedNewObject.value;
          if (orphaned) {
            try {
              await scopedInsert(
                db,
                'cms.assets',
                {
                  // Fresh id — see the matching happy-path insert above for
                  // why this matters (content_usages liveness).
                  id: newId('asset'),
                  slug: orphaned.slug,
                  mime_type: orphaned.mimeType,
                  size: orphaned.size,
                  object_key: orphaned.objectKey,
                  status: 'private' as const,
                  folder_id: null,
                  variant_of: null,
                  uploaded_by: null,
                  archived_at: now,
                },
                scope.assets,
              );
            } catch (tombstoneErr) {
              console.error(
                '[cms:media] failed to tombstone orphaned commitReplace object',
                tombstoneErr,
              );
            }
          }
          throw err;
        }
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
        // Body takes in-process bytes (Blob/ArrayBuffer), which can't survive
        // the client's JSON serialization; browsers use the signed upload flow
        // instead (createSignedUpload + completeUpload).
        metadata: cmsMeta(
          { scope: 'server' as const },
          { operation: 'create', ...MEDIA_META },
        ),
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
          await assertDeclaredTypeMatchesBytes(
            file.name,
            file.type,
            file.buffer,
          );
        }

        const storage = getStorage(mediaConfig);

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
            await storage.put(p.objectKey, file.buffer, {
              contentType: file.type,
              contentLength: file.size,
              acl: objectAcl,
            });
          } catch (err) {
            // The raw S3 error must not reach the client. This log is the only
            // channel: no definition-level onAPIError hook is reachable from a
            // handler-thrown CMSError (see CMSDefinition['onAPIError']).
            console.error('[cms:media] upload failed', err);
            const status = err instanceof StorageError ? 500 : 0;
            throw new CMSError('UPLOAD_FAILED', {
              message: errorMessages.uploadFailed(file.name, status),
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
     * SERVER-SIDE ONLY: `file.buffer` must be an in-process `Blob`/`ArrayBuffer`,
     * which cannot survive the browser client's JSON request body — a `File`
     * serializes to `{}` over the wire. Browser callers MUST use the signed
     * flow instead: `createSignedReplace` (mint a slot + signed PUT URL) then
     * `commitReplace` (repoint the row) once the client's PUT succeeds.
     *
     * Server-side and atomic, like uploadAssets but reversed: the new object is
     * PUT first, then (only on success) the row is repointed in one transaction
     * that also archives the asset's old variants (they depict the old bytes and
     * are unreachable from the new slug) and tombstones the superseded
     * slug/objectKey — a fresh, immediately-archived asset row reusing the OLD
     * values — so the pruning pass's existing asset-reclaim query deletes the
     * now-unreachable S3 object once the trash window elapses.
     * Returns the updated asset.
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
        // Body takes in-process bytes (Blob/ArrayBuffer), which can't survive
        // the client's JSON serialization; browsers use the signed replace
        // flow instead (createSignedReplace + commitReplace).
        metadata: cmsMeta(
          { scope: 'server' as const },
          { operation: 'update', ...MEDIA_META },
        ),
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
        const objectKey = buildUploadObjectKey(newId('asset'), slug);

        // 5. PUT the new object FIRST — on failure the row is untouched, so the
        //    asset keeps serving its existing (still-present) object.
        try {
          await getStorage(mediaConfig).put(objectKey, file.buffer, {
            contentType: file.type,
            contentLength: measuredSize,
            acl: objectAcl,
          });
        } catch (err) {
          // The raw S3 error must not reach the client; this log is the only
          // channel (see the uploadAssets catch block).
          console.error('[cms:media] upload failed', err);
          const status = err instanceof StorageError ? 500 : 0;
          throw new CMSError('UPLOAD_FAILED', {
            message: errorMessages.uploadFailed(file.name, status),
          });
        }

        // 6. Atomically repoint the row, archive the old variants, and
        //    tombstone the superseded slug/objectKey so the pruning pass
        //    reclaims the old S3 object. id, folderId, status, variantOf are
        //    unchanged.
        const now = new Date();

        // `.value` is set inside the transaction ONLY on the TOCTOU-rollback
        // branch below, so the outer catch knows to tombstone the just-PUT NEW
        // object. Read outside the transaction (after it has already rolled
        // back), because a row inserted from WITHIN a transaction that then
        // throws is rolled back along with everything else in it — that
        // tombstone must be written in a SEPARATE statement, after the
        // rollback. A one-property CARRIER object (rather than a reassigned
        // `let`) sidesteps a TS control-flow-narrowing limitation: TS does not
        // track assignments made inside a nested closure when narrowing a
        // captured `let` at a read site in the enclosing scope.
        const orphanedNewObject: {
          value: {
            slug: string;
            objectKey: string;
            mimeType: string;
            size: number;
          } | null;
        } = { value: null };

        try {
          const repointedRow = await db.transaction(async (tx) => {
            // Load the CURRENT (pre-repoint) row's slug/objectKey/mimeType/size
            // — what the tombstone below preserves. Re-read here (not reused
            // from step 1, which only fetched id/variantOf) so the tombstoned
            // values are exactly what this UPDATE overwrites, even if the row
            // changed between step 1 and here.
            const beforeConditions: SQL[] = [
              eq(assets.id, assetId),
              isNull(assets.archivedAt),
            ];
            if (scope.assets?.where) beforeConditions.push(scope.assets.where);

            const [before] = await tx
              .select({
                slug: assets.slug,
                objectKey: assets.objectKey,
                mimeType: assets.mimeType,
                size: assets.size,
                uploadedBy: assets.uploadedBy,
              })
              .from(assets)
              .where(and(...beforeConditions));

            // The asset was archived / left scope between the load and here
            // (TOCTOU). Roll back so we never report a replace that didn't
            // land; the just-PUT object at `objectKey` is unreachable from any
            // row, so it is tombstoned (outside this transaction, see below)
            // rather than left for pruning to never find.
            if (!before) {
              orphanedNewObject.value = {
                slug,
                objectKey,
                mimeType: file.type,
                size: measuredSize,
              };
              throw new CMSError('ASSET_NOT_FOUND', {
                message: errorMessages.assetNotFound(assetId),
              });
            }

            const updateConditions: SQL[] = [
              eq(assets.id, assetId),
              isNull(assets.archivedAt),
            ];
            if (scope.assets?.where) updateConditions.push(scope.assets.where);

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

            if (repointed.length === 0) {
              orphanedNewObject.value = {
                slug,
                objectKey,
                mimeType: file.type,
                size: measuredSize,
              };
              throw new CMSError('ASSET_NOT_FOUND', {
                message: errorMessages.assetNotFound(assetId),
              });
            }

            const variantConditions: SQL[] = [
              eq(assets.variantOf, assetId),
              isNull(assets.archivedAt),
            ];
            if (scope.assets?.where) variantConditions.push(scope.assets.where);

            await tx
              .update(assets)
              .set({ archivedAt: now, updatedAt: now })
              .where(and(...variantConditions));

            // Tombstone the SUPERSEDED slug/objectKey. MUST run AFTER the
            // update above: the live row still held `before.slug`/
            // `before.objectKey` until that UPDATE ran, and both columns are
            // globally UNIQUE (core-schema.ts) — inserting this tombstone
            // first would collide with the still-live row on both indexes and
            // abort the transaction.
            await scopedInsert(
              tx,
              'cms.assets',
              {
                // A fresh id (never reused from the live/original row) is
                // load-bearing: the pruning reclaim query's liveness check
                // joins content_usages on this asset's id, and content only
                // ever referenced the ORIGINAL id — a tombstone that reused it
                // would look "still referenced" and never be reclaimed.
                id: newId('asset'),
                slug: before.slug,
                mime_type: before.mimeType,
                size: before.size,
                object_key: before.objectKey,
                status: 'private' as const,
                folder_id: null,
                variant_of: null,
                uploaded_by: before.uploadedBy,
                archived_at: now,
              },
              scope.assets,
            );

            return repointed[0];
          });

          return {
            asset: {
              id: repointedRow.id,
              slug: repointedRow.slug,
              mimeType: repointedRow.mimeType,
              size: repointedRow.size,
              objectKey: repointedRow.objectKey,
              // Direct object URL for INTERNAL/admin display only (see the
              // gate for serving in content).
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
        } catch (err) {
          const orphaned = orphanedNewObject.value;
          if (orphaned) {
            try {
              await scopedInsert(
                db,
                'cms.assets',
                {
                  // Fresh id — see the matching happy-path insert above for
                  // why this matters (content_usages liveness).
                  id: newId('asset'),
                  slug: orphaned.slug,
                  mime_type: orphaned.mimeType,
                  size: orphaned.size,
                  object_key: orphaned.objectKey,
                  status: 'private' as const,
                  folder_id: null,
                  variant_of: null,
                  uploaded_by: null,
                  archived_at: now,
                },
                scope.assets,
              );
            } catch (tombstoneErr) {
              console.error(
                '[cms:media] failed to tombstone orphaned replaceAsset object',
                tombstoneErr,
              );
            }
          }
          throw err;
        }
      },
    ),
  };
}
