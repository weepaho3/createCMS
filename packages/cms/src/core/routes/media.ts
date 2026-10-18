import { APIError, createEndpoint } from 'better-call';
import {
  and,
  asc,
  eq,
  getTableColumns,
  inArray,
  isNotNull,
  isNull,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import * as z from 'zod';

import type { VariantFormat } from '../media/variant-key';
import type { CMSProcedureContext, MediaConfig } from '../types';
import type { AssetMetadata, AssetProvenance } from '../types/asset-metadata';
import type { ResolvedScope } from '../types/definitions';

import { newId } from '../../utils/nanoid';
import { assets } from '../db/schema.generated';
import {
  cmsMeta,
  createCMSEndpoint,
  type PublicEndpointContext,
} from '../endpoint';
import { CMSError, errorMessages } from '../errors';
import { archiveAssetsInScope } from '../media/archive';
import {
  assetFilterConditions,
  type AssetFilterInput,
  assetFilterFields,
  assetKindSql,
  BULK_TARGET_MESSAGE,
  bulkTargetIds,
  bulkTargetFields,
  type FilterDimension,
  hasBulkTarget,
} from '../media/asset-filter';
import { contentDisposition } from '../media/content-disposition';
import { readImageDimensions } from '../media/dimensions';
import { normalizeDisplayName } from '../media/display-name';
import { emitMediaEvents } from '../media/events';
import {
  MAX_PARTS_PER_SIGN,
  MULTIPART_THRESHOLD,
  MULTIPART_TOKEN_SECONDS,
  PART_URL_SECONDS,
  partLength,
  planParts,
} from '../media/multipart-plan';
import {
  assetObjectKey,
  cacheControlFor,
  purgeAssetPaths,
  setAssetsVisibility,
  uploadAcl,
} from '../media/placement';
import { PROVENANCE_SCAN_BYTES, readProvenance } from '../media/provenance';
import { createRateWindow } from '../media/rate-window';
import { initialProcessingState, uploadVisibility } from '../media/scan';
import { checkDeclaredType, SNIFF_BYTES, sniffType } from '../media/sniff';
import {
  deriveUploadKey,
  mintUploadToken,
  scopeFingerprint,
  type UploadTokenPayload,
  isTokenBoundTo,
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
import { formatVariantKey, parseVariantKey } from '../media/variant-key';
import { scopedInsert, scopedInsertBatch } from '../scope';
import {
  requireCapability,
  type StorageAdapter,
  StorageError,
} from '../storage/adapter';
import { getStorage } from '../storage/get-storage';
import { buildPublicObjectUrl, buildVariantSlug } from '../storage/s3/utils';
import {
  ASSET_PROVENANCES,
  assetMetadataSchema,
} from '../types/asset-metadata';
import { MEDIA_DEFAULTS } from '../types/s3';
import { wireBooleanIsTrue, wireBooleanSchema } from '../utils/wire-boolean';
import { createMediaAssetEndpoints } from './media-assets';
import { createMediaFolderEndpoints } from './media-folders';
import { createMediaUsageEndpoints } from './media-usage';

/**
 * Types the gate redirects to the bare public URL. Everything else, and every
 * `?download` request, is redirected to a signed URL whose
 * `response-content-disposition` forces a download. Raster formats are listed
 * explicitly so `image/svg+xml` never renders inline from the gate.
 */
const INLINE_SAFE =
  /^(image\/(png|jpeg|gif|webp|avif)|video\/|audio\/|application\/pdf$)/;

/**
 * Fields of one uploaded file. `variantKey` (see core/media/variant-key.ts)
 * names the variant of `variantOf` the file is, and needs `variantOf`.
 */
/** Base64 SHA-256 of the bytes; signed into the PUT where the storage verifies it. */
const sha256Base64 = z
  .string()
  .regex(/^[A-Za-z0-9+/]{43}=$/, 'Must be a base64 SHA-256')
  .optional();

const uploadFileFields = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  variantOf: z.string().optional(),
  variantKey: z
    .string()
    .refine((key) => parseVariantKey(key) !== null, 'Invalid variant key')
    .optional(),
  sha256: sha256Base64,
});

function base64ToHex(value: string): string {
  return Buffer.from(value, 'base64').toString('hex');
}

function requireVariantOfForKey<
  T extends z.ZodType<{ variantOf?: string; variantKey?: string }>,
>(schema: T) {
  return schema.refine((file) => !file.variantKey || file.variantOf, {
    message: 'variantKey requires variantOf',
    path: ['variantKey'],
  });
}

/**
 * The host a request addressed (`x-forwarded-host` before `host`), or
 * `null` for a server call without request headers.
 */
function requestHost(ctx: {
  headers?: Headers;
  request?: Request;
}): string | null {
  const headers = ctx.headers ?? ctx.request?.headers;
  const host = headers?.get('x-forwarded-host') ?? headers?.get('host');
  return host ? host.split(',')[0].trim().toLowerCase() : null;
}

/** Files one actor may sign per minute unless `media.uploadRateLimit` says otherwise. */
const UPLOAD_RATE_DEFAULT = 60;

/** Lifetime of the signed GET a private asset redirects to. */
const PRIVATE_SIGNED_GET_SECONDS = 300;

const MEDIA_META = {
  scope: 'system' as const,
  permissionResource: 'media' as const,
};

/**
 * Descriptive metadata a client may send with `completeUpload` (computed by
 * the media-optimize worker). Untrusted: validated against
 * `assetMetadataSchema`, and only these keys are kept.
 */
const HINT_METADATA_KEYS = [
  'placeholder',
  'dominantColor',
  'exif',
  'media',
] as const satisfies readonly (keyof AssetMetadata)[];

const uploadHintsSchema = z.object({
  metadata: assetMetadataSchema.optional(),
  provenance: z.enum(ASSET_PROVENANCES).optional(),
});

type UploadHints = z.infer<typeof uploadHintsSchema>;

type CompletedUploadExtra = {
  width?: number;
  height?: number;
  provenance?: AssetProvenance;
  metadata?: AssetMetadata;
};

/** Content type of each rendition format. */
const RENDITION_MIME: Readonly<Record<VariantFormat, string>> = {
  webp: 'image/webp',
  avif: 'image/avif',
  jpeg: 'image/jpeg',
  png: 'image/png',
};

/** Leading bytes read to verify a rendition's format and dimensions. */
const RENDITION_HEADER_BYTES = 64 * 1024;

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
 * Content check for the server upload paths (`uploadAssets`,
 * `replaceAsset`), which hold the bytes: the first `SNIFF_BYTES` must fit
 * the declared type (`checkDeclaredType`). Runs after the allowlist and
 * throws INVALID_FILE_TYPE on markup, a contradicting signature, or an
 * unrecognizable renderable type.
 */
async function assertDeclaredTypeMatchesBytes(
  fileName: string,
  declaredType: string,
  buffer: Blob | ArrayBuffer,
): Promise<void> {
  const verdict = checkDeclaredType(
    declaredType,
    await readLeadingBytes(buffer, SNIFF_BYTES),
  );
  if (verdict.ok) return;
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
/** A live variant of an asset, as listed with it. */
export type AssetVariantSummary = {
  variantKey: string;
  width: number | null;
  height: number | null;
  size: number;
};

function toAssetListItem(
  asset: AssetRow,
  urls: AssetUrls,
  variants: AssetVariantSummary[] = [],
) {
  return {
    id: asset.id,
    slug: asset.slug,
    originalName: asset.originalName ?? null,
    mimeType: asset.mimeType,
    size: asset.size,
    width: asset.width ?? null,
    height: asset.height ?? null,
    objectKey: asset.objectKey,
    url: urls.object(asset.status, asset.objectKey),
    deliveryUrl: urls.delivery(asset.id),
    status: asset.status,
    provenance: asset.provenance,
    processingState: asset.processingState,
    metadata: asset.metadata as AssetMetadata,
    variants,
    folderId: asset.folderId ?? null,
    variantOf: asset.variantOf ?? null,
    uploadedBy: asset.uploadedBy ?? null,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
  };
}

/**
 * `object`: the direct bucket URL, only for public assets (`null` for
 * private ones, whose bytes are reachable through the gate alone).
 * `delivery`: the gate path `{basePath}/media/asset/{id}`, valid for every
 * asset and the URL to render.
 */
type AssetUrls = {
  object: (status: 'public' | 'private', objectKey: string) => string | null;
  delivery: (id: string) => string;
};

function assetUrls(publicUrl: string, basePath: string): AssetUrls {
  const base = basePath.replace(/\/+$/, '');
  return {
    object: (status, objectKey) =>
      status === 'public' ? buildPublicObjectUrl(publicUrl, objectKey) : null,
    delivery: (id) => `${base}/media/asset/${encodeURIComponent(id)}`,
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

type AssetSortBy =
  | 'createdAt'
  | 'slug'
  | 'size'
  | 'originalName'
  | 'updatedAt'
  | 'width';

/**
 * The sort expression of each key. Nullable columns are coalesced so the
 * keyset comparison never meets a NULL: names fall back to the slug,
 * widths to -1 (sorting dimensionless assets last in `desc`).
 */
const ASSET_SORT_SQL: Record<AssetSortBy, SQL> = {
  createdAt: sql`${assets.createdAt}`,
  updatedAt: sql`${assets.updatedAt}`,
  slug: sql`${assets.slug}`,
  size: sql`${assets.size}`,
  originalName: sql`lower(coalesce(${assets.originalName}, ${assets.slug}))`,
  width: sql`coalesce(${assets.width}, -1)`,
};

/** Timestamp sorts compare at full (microsecond) precision through text. */
const TIMESTAMP_SORTS = new Set<AssetSortBy>(['createdAt', 'updatedAt']);

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
type AssetCursorRow = AssetRow & { sortCursor: string | number };

function encodeAssetCursor(row: AssetCursorRow): string {
  const payload: CursorPosition = { v: row.sortCursor, id: row.id };
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
  basePath = '/api/cms',
) {
  const { db } = cmsCtx;
  const urls = assetUrls(mediaConfig.publicUrl, basePath);

  /** Live, keyed variants of `assetIds` in one query, grouped by asset. */
  async function loadVariants(
    assetIds: string[],
  ): Promise<Map<string, AssetVariantSummary[]>> {
    const grouped = new Map<string, AssetVariantSummary[]>();
    if (assetIds.length === 0) return grouped;
    const rows = await db
      .select({
        variantOf: assets.variantOf,
        variantKey: assets.variantKey,
        width: assets.width,
        height: assets.height,
        size: assets.size,
      })
      .from(assets)
      .where(
        and(
          inArray(assets.variantOf, assetIds),
          isNull(assets.archivedAt),
          isNotNull(assets.variantKey),
        ),
      )
      .orderBy(asc(assets.width));
    for (const row of rows) {
      const list = grouped.get(row.variantOf!) ?? [];
      list.push({
        variantKey: row.variantKey!,
        width: row.width,
        height: row.height,
        size: row.size,
      });
      grouped.set(row.variantOf!, list);
    }
    return grouped;
  }

  const renditionWidths = [
    ...new Set(mediaConfig.renditionWidths ?? MEDIA_DEFAULTS.renditionWidths),
  ].sort((a, b) => a - b);

  /**
   * The rendition of `asset` the asset endpoint serves for `?w` and
   * `?format` (default `webp`). `w` snaps up to the next rendition width;
   * without `w` the largest width is asked for. `exact`: the live variant
   * with that `variantKey` (or, for variants not yet backfilled, the former
   * slug scheme). `nearest`: the smallest live image variant of the same
   * format that is at least as wide. `miss`: neither exists.
   */
  async function resolveRendition(
    asset: { id: string; slug: string },
    format: VariantFormat | undefined,
    requestedWidth: number | undefined,
  ): Promise<{
    variantKey: string;
    match: 'exact' | 'nearest' | 'miss';
    variant: { objectKey: string; mimeType: string } | null;
  }> {
    let width = renditionWidths.at(-1) ?? requestedWidth ?? 1;
    if (requestedWidth !== undefined) {
      const snapped = renditionWidths.find((w) => w >= requestedWidth);
      if (snapped === undefined) {
        throw new CMSError('RENDITION_WIDTH_UNSUPPORTED', {
          message: `Width ${requestedWidth} is larger than the largest rendition width (${renditionWidths.at(-1)})`,
        });
      }
      width = snapped;
    }
    const wanted = { kind: 'image' as const, width, format: format ?? 'webp' };
    const variantKey = formatVariantKey(wanted);

    const variants = await db
      .select({
        objectKey: assets.objectKey,
        mimeType: assets.mimeType,
        variantKey: assets.variantKey,
        slug: assets.slug,
      })
      .from(assets)
      .where(
        and(
          eq(assets.variantOf, asset.id),
          isNull(assets.archivedAt),
          eq(assets.processingState, 'ready'),
        ),
      );

    const legacySlug = buildVariantSlug(asset.slug, format, requestedWidth);
    const exact =
      variants.find((v) => v.variantKey === variantKey) ??
      variants.find((v) => v.variantKey === null && v.slug === legacySlug);
    if (exact) return { variantKey, match: 'exact', variant: exact };

    let nearest: { width: number; variant: (typeof variants)[number] } | null =
      null;
    for (const v of variants) {
      const spec = v.variantKey ? parseVariantKey(v.variantKey) : null;
      if (
        !spec ||
        spec.kind !== 'image' ||
        spec.format !== wanted.format ||
        spec.width < width
      ) {
        continue;
      }
      if (!nearest || spec.width < nearest.width) {
        nearest = { width: spec.width, variant: v };
      }
    }
    if (nearest) {
      return { variantKey, match: 'nearest', variant: nearest.variant };
    }
    return { variantKey, match: 'miss', variant: null };
  }

  const maxFileSize = mediaConfig.maxFileSize ?? MEDIA_DEFAULTS.maxFileSize;
  const maxFiles = mediaConfig.maxFiles ?? MEDIA_DEFAULTS.maxFiles;
  const allowedMimeTypes = mediaConfig.allowedMimeTypes ?? [
    ...MEDIA_DEFAULTS.allowedMimeTypes,
  ];
  const signedUrlExpiresIn =
    mediaConfig.signedUrlExpiresIn ?? MEDIA_DEFAULTS.signedUrlExpiresIn;
  const objectAcl = uploadAcl(mediaConfig, getStorage(mediaConfig));
  // New rows are `private`; replaces keep the asset's status.
  const newObjectKey =
    (scope: ResolvedScope, visibility: 'public' | 'private') =>
    (id: string, fileName: string) =>
      assetObjectKey(mediaConfig, { id, fileName, visibility, scope });

  /**
   * Throws INVALID_FILE_TYPE when `allowReplaceWithDifferentType` is `false`
   * and the new file's MIME type (parameters stripped) differs from the
   * asset's.
   */
  function assertReplaceType(current: string, next: string): void {
    if (mediaConfig.allowReplaceWithDifferentType !== false) return;
    const base = (type: string) => type.split(';')[0].trim().toLowerCase();
    if (base(current) !== base(next)) {
      throw new CMSError('INVALID_FILE_TYPE', {
        message: `A replace must keep the asset's type ${base(current)}; got ${base(next)}`,
      });
    }
  }

  type MultipartPayload = Extract<UploadTokenPayload, { kind: 'upload' }> & {
    multipart: { uploadId: string; partSize: number; partCount: number };
  };

  /** The verified multipart token of this caller and host, or UPLOAD_TOKEN_INVALID. */
  async function multipartPayload(
    ctx: {
      context: { userId?: string; scope: ResolvedScope };
      headers?: Headers;
      request?: Request;
    },
    token: string,
  ): Promise<MultipartPayload> {
    const payload = await verifyUploadToken(
      await deriveUploadKey(mediaConfig),
      token,
    );
    if (
      !payload ||
      payload.kind !== 'upload' ||
      !payload.multipart ||
      !isTokenBoundTo(payload, 'completeUpload', requestHost(ctx)) ||
      payload.scope !==
        (await scopeFingerprint(ctx.context.scope.assets?.insertColumns)) ||
      payload.actor !== (ctx.context.userId ?? null)
    ) {
      throw new CMSError('UPLOAD_TOKEN_INVALID');
    }
    requireCapability(
      getStorage(mediaConfig),
      (c) => c.multipart.supported,
      'multipart uploads',
    );
    return payload as MultipartPayload;
  }

  /**
   * Assembles a multipart upload from the parts the storage holds: every
   * planned part must be there with its exact length. Returns an error to
   * report, or `null` once the object exists (also when an earlier
   * completion already assembled it).
   */
  async function assembleMultipart(
    payload: Extract<UploadTokenPayload, { kind: 'upload' }>,
  ): Promise<APIError | null> {
    const plan = payload.multipart;
    if (!plan) return null;
    const multipart = getStorage(mediaConfig).multipart!;
    const parts: { partNumber: number; size: number; etag: string }[] = [];
    let marker: number | null = null;
    try {
      do {
        const page = await multipart.listParts(
          payload.objectKey,
          plan.uploadId,
          {
            marker,
          },
        );
        parts.push(...page.parts);
        marker = page.marker;
      } while (marker !== null);
    } catch (err) {
      if (err instanceof StorageError && /NoSuchUpload/.test(err.message)) {
        return null;
      }
      throw err;
    }
    parts.sort((a, b) => a.partNumber - b.partNumber);
    const complete =
      parts.length === plan.partCount &&
      parts.every(
        (part, i) =>
          part.partNumber === i + 1 &&
          part.size === partLength(payload.size, plan.partSize, i + 1),
      );
    if (!complete) {
      return new CMSError('UPLOAD_NOT_FOUND', {
        message: `The upload of "${payload.name}" holds ${parts.length} of ${plan.partCount} parts`,
      });
    }
    await multipart.complete(
      payload.objectKey,
      plan.uploadId,
      parts.map(({ partNumber, etag }) => ({ partNumber, etag })),
    );
    return null;
  }

  const uploadRateWindow = createRateWindow();

  /**
   * Checks a batch about to be signed: the actor's per-minute signing limit
   * (`uploadRateLimit`, RATE_LIMITED with Retry-After), the scope's quota
   * (`quota`, QUOTA_EXCEEDED) and that no key already belongs to an asset,
   * since a presigned PUT would overwrite it. `newAssets` counts the
   * originals the batch adds.
   */
  async function guardSignedBatch(batch: {
    actor: string | null;
    scope: ResolvedScope;
    objectKeys: string[];
    bytes: number;
    newAssets: number;
  }): Promise<void> {
    const limit = mediaConfig.uploadRateLimit ?? UPLOAD_RATE_DEFAULT;
    if (limit > 0) {
      const wait = uploadRateWindow(
        batch.actor ?? 'anonymous',
        batch.objectKeys.length,
        limit,
      );
      if (wait > 0) {
        throw new CMSError('RATE_LIMITED', {
          headers: { 'retry-after': String(wait) },
          data: { retryAfter: wait },
        });
      }
    }

    const limits = await mediaConfig.quota?.({
      actor: batch.actor,
      scope: batch.scope,
    });
    if (limits?.maxBytes !== undefined || limits?.maxAssets !== undefined) {
      const inScope = batch.scope.assets?.where;
      const [usage] = await db
        .select({
          bytes: sql<string>`coalesce(sum(${assets.size}), 0)`,
          originals: sql<string>`count(*) filter (where ${assets.variantOf} is null and ${assets.revisionOf} is null and ${assets.archivedAt} is null)`,
        })
        .from(assets)
        .where(inScope);
      const usedBytes = Number(usage?.bytes ?? 0);
      const usedAssets = Number(usage?.originals ?? 0);
      if (
        (limits.maxBytes !== undefined &&
          usedBytes + batch.bytes > limits.maxBytes) ||
        (limits.maxAssets !== undefined &&
          usedAssets + batch.newAssets > limits.maxAssets)
      ) {
        throw new CMSError('QUOTA_EXCEEDED', {
          data: {
            maxBytes: limits.maxBytes ?? null,
            maxAssets: limits.maxAssets ?? null,
            usedBytes,
            usedAssets,
          },
        });
      }
    }

    const taken = await db
      .select({ objectKey: assets.objectKey })
      .from(assets)
      .where(inArray(assets.objectKey, batch.objectKeys));
    if (taken.length > 0) {
      throw new CMSError('UPLOAD_FAILED', {
        message: 'Refusing to sign an upload to the key of an existing asset',
      });
    }
  }

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
      (c) => c.signedPut.supported && (c.rangeRead || !hasImage),
      hasImage
        ? 'signed uploads with range reads, which verifying an uploaded image requires'
        : 'signed uploads',
    );
  }

  /**
   * Checks an object the browser PUT against the token's claim. Returns the
   * error to report when no object exists at the key, its content length is
   * missing or differs from `size`, its content type (parameters stripped)
   * differs from `type`, or the first `SNIFF_BYTES` do not fit the declared
   * type (`checkDeclaredType`: markup, a contradicting signature, an
   * unrecognizable image, video, audio or PDF). The object is deleted in the
   * last three cases; a failed delete is logged and the error still
   * returned. Returns `null` when the object matches. Throws
   * STORAGE_UNSUPPORTED when the adapter cannot read a byte range, since no
   * upload is accepted unsniffed.
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

    requireCapability(
      storage,
      (c) => c.rangeRead,
      'range reads, which verifying the content of an upload requires',
    );

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
    const bytes = await storage.getRange(claim.objectKey, 0, SNIFF_BYTES - 1);
    if (!bytes) return missing();
    if (!checkDeclaredType(claim.type, bytes).ok) {
      await discard();
      return new CMSError('INVALID_FILE_TYPE', {
        message: errorMessages.invalidFileType(claim.name, claim.type),
      });
    }
    return null;
  }

  /**
   * Columns the server derives for a verified upload: dimensions and
   * provenance read from the object's leading bytes, plus the client's
   * descriptive hints (placeholder, colour, EXIF allowlist, media facts).
   * Dimensions come from the bytes only. Provenance read from the bytes wins;
   * a hint can only raise an otherwise unknown provenance to an AI value.
   */
  async function describeUploadedObject(
    claim: { objectKey: string; type: string },
    hints: UploadHints | undefined,
  ): Promise<CompletedUploadExtra> {
    const metadata: AssetMetadata = {};
    for (const key of HINT_METADATA_KEYS) {
      const value = hints?.metadata?.[key];
      if (value !== undefined) Object.assign(metadata, { [key]: value });
    }
    const extra: CompletedUploadExtra = { metadata };
    if (!claim.type.startsWith('image/')) return extra;

    const bytes = await getStorage(mediaConfig).getRange(
      claim.objectKey,
      0,
      PROVENANCE_SCAN_BYTES - 1,
    );
    if (!bytes) return extra;
    const dimensions = readImageDimensions(bytes);
    if (dimensions) Object.assign(extra, dimensions);

    const reading = readProvenance(bytes);
    Object.assign(metadata, reading.metadata);
    extra.provenance = reading.provenance;
    if (
      reading.provenance === 'unknown' &&
      (hints?.provenance === 'ai_generated' ||
        hints?.provenance === 'ai_edited')
    ) {
      extra.provenance = hints.provenance;
    }
    return extra;
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
    extra: CompletedUploadExtra = {},
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

    // A folder sent to the trash after presign is gone for new uploads.
    if (payload.folderId) {
      await assertFolderExists(db, payload.folderId, scope);
    }

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
            status: payload.status ?? 'private',
            folder_id: payload.folderId,
            variant_of: payload.variantOf,
            width: extra.width ?? null,
            height: extra.height ?? null,
            provenance: extra.provenance ?? 'unknown',
            metadata: JSON.stringify(extra.metadata ?? {}),
            variant_key: payload.variantKey ?? null,
            original_name: payload.name,
            processing_state: initialProcessingState(mediaConfig),
            sha256: payload.sha256 ? base64ToHex(payload.sha256) : null,
            uploaded_by: payload.actor,
          },
          scope.assets,
        );
      } catch (err) {
        if (isConstraintViolation(err, '23505', 'assets_variant_unique')) {
          throw new CMSError('VARIANT_EXISTS');
        }
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
    ...createMediaFolderEndpoints(cmsCtx),
    ...createMediaUsageEndpoints(cmsCtx),
    ...createMediaAssetEndpoints(cmsCtx, mediaConfig, (row) =>
      toAssetListItem(row, urls),
    ),

    // ========================================================================
    // Asset Listing & Retrieval
    // ========================================================================

    /**
     * Lists the assets of the media library (originals only: no variants or
     * revisions), filtered on the server so paging counts stay right.
     *
     * Two pagination modes: legacy `offset` (bounded to the first 100 rows)
     * and stable, unbounded `cursor` (keyset) paging. Pass the previous
     * page's `nextCursor` as `cursor` to continue; it takes precedence over
     * `offset` and stays valid as rows are inserted or removed. The direct
     * object `url` on each row is for internal display only.
     *
     * @param folderId - A folder's assets; omit for every folder.
     * @param unfiled - `true` for root-level assets (no folder); wins over `folderId`.
     * @param recursive - With `folderId`: include every subfolder.
     * @param status - `private` or `public`.
     * @param visibility - Comma separated statuses (`private,public`).
     * @param search - Substring of the slug.
     * @param q - Full-text search over file name (weight A), description (B), credit and copyright (C), plus a substring match on the file name and slug.
     * @param kinds - Comma separated kinds derived from the type: `image`, `video`, `audio`, `document`, `archive`, `other`.
     * @param mime - Comma separated types or prefixes (`image/*`).
     * @param provenance - Comma separated provenances.
     * @param uploadedBy - Comma separated user ids.
     * @param createdFrom - ISO date or date-time, inclusive.
     * @param createdTo - ISO date (the whole day) or date-time, inclusive.
     * @param sizeMin - Bytes, inclusive.
     * @param sizeMax - Bytes, inclusive.
     * @param widthMin - Px, inclusive.
     * @param heightMin - Px, inclusive.
     * @param orientation - `landscape`, `portrait` or `square` (assets with dimensions).
     * @param usage - `used` or `unused`: assets with or without a usage in `usageScope`.
     * @param usageScope - `live` (default: the head of any branch) or `published`.
     * @param missingAlt - `true` for assets with at least one live image usage without alt text.
     * @param unusedSinceDays - Assets without a usage in `usageScope` created at least this many days ago.
     * @param expiringWithinDays - Assets whose `metadata.rights.expiresAt` is within this many days (or past).
     * @param archived - `true` lists the trash instead of live assets.
     * @param limit - Max results per page (1-100, default 20).
     * @param offset - Pagination offset (default 0); ignored when `cursor` is given.
     * @param cursor - Opaque keyset cursor from a previous page's `nextCursor`.
     * @param sortBy - `createdAt` (default), `updatedAt`, `slug`, `originalName`, `size` or `width`.
     * @param sortDirection - `asc` or `desc` (default `desc`).
     * @param includeTotal - `false` skips the count query; `total` is then `null`.
     * @returns The page of assets, `total` (or `null`), `hasMore` and `nextCursor` (`null` at the end).
     * @example await cmsClient.media.listAssets({ query: { limit: 20, status: 'public' } })
     * @example await cmsClient.media.listAssets({ query: { q: 'hamburg', kinds: 'image', includeTotal: false } })
     */
    listAssets: createCMSEndpoint(
      '/media/listAssets',
      {
        method: 'GET',
        query: z
          .object({
            ...assetFilterFields,
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
              .enum([
                'createdAt',
                'updatedAt',
                'slug',
                'originalName',
                'size',
                'width',
              ])
              .optional()
              .default('createdAt'),
            sortDirection: z.enum(['asc', 'desc']).optional().default('desc'),
            includeTotal: wireBooleanSchema.optional(),
          })
          .optional(),
        metadata: cmsMeta(
          {
            $Infer: {
              query: {} as AssetFilterInput & {
                limit?: number;
                offset?: number;
                cursor?: string;
                sortBy?: AssetSortBy;
                sortDirection?: 'asc' | 'desc';
                includeTotal?: boolean;
              },
            },
          },
          { operation: 'read', ...MEDIA_META },
        ),
      },
      async (ctx) => {
        const { scope } = ctx.context;
        const query = ctx.query ?? {};
        const {
          limit = 20,
          offset = 0,
          cursor,
          sortBy = 'createdAt',
          sortDirection = 'desc',
        } = query;
        const includeTotal =
          query.includeTotal === undefined ||
          wireBooleanIsTrue(query.includeTotal);

        const conditions = assetFilterConditions(query, scope);
        const countWhere = and(...conditions);
        const sortColumn = ASSET_SORT_SQL[sortBy];

        // Keyset seek: rows strictly after the cursor in sort order,
        // `(sort, id) </> (v, id)`, matching the ORDER BY (id breaks ties).
        // Timestamps compare against their full-precision text: a JS Date
        // truncates to ms and would skip or repeat rows within a millisecond.
        if (cursor) {
          const pos = decodeAssetCursor(cursor);
          const op = sql.raw(sortDirection === 'asc' ? '>' : '<');
          const boundary = TIMESTAMP_SORTS.has(sortBy)
            ? sql`${pos.v}::timestamp`
            : sql`${pos.v}`;
          conditions.push(
            sql`(${sortColumn} ${op} ${boundary} OR (${sortColumn} = ${boundary} AND ${assets.id} ${op} ${pos.id}))`,
          );
        }

        const orderBy =
          sortDirection === 'asc'
            ? sql`${sortColumn} ASC, ${assets.id} ASC`
            : sql`${sortColumn} DESC, ${assets.id} DESC`;
        const cursorValue = TIMESTAMP_SORTS.has(sortBy)
          ? sql<string>`(${sortColumn})::text`
          : sql<string | number>`${sortColumn}`;

        // Over-fetch one row to know whether a next page exists.
        const [fetched, counted] = await Promise.all([
          db
            .select({
              ...getTableColumns(assets),
              sortCursor: cursorValue.as('sort_cursor'),
            })
            .from(assets)
            .where(and(...conditions))
            .orderBy(orderBy)
            .limit(limit + 1)
            .offset(cursor ? 0 : offset),
          includeTotal
            ? db
                .select({ count: sql<number>`count(*)::int` })
                .from(assets)
                .where(countWhere)
            : Promise.resolve(null),
        ]);
        const total = counted ? counted[0].count : null;

        const hasNextPage = fetched.length > limit;
        const assetRows = hasNextPage ? fetched.slice(0, limit) : fetched;
        const lastRow = assetRows[assetRows.length - 1];

        const variants = await loadVariants(assetRows.map((a) => a.id));
        return {
          assets: assetRows.map((asset) =>
            toAssetListItem(asset, urls, variants.get(asset.id)),
          ),
          total,
          hasMore:
            cursor || total === null
              ? hasNextPage
              : offset + assetRows.length < total,
          nextCursor:
            hasNextPage && lastRow
              ? encodeAssetCursor({
                  ...lastRow,
                  // bigint and integer sorts arrive as numbers or strings.
                  sortCursor:
                    sortBy === 'size' || sortBy === 'width'
                      ? Number(lastRow.sortCursor)
                      : lastRow.sortCursor,
                })
              : null,
        };
      },
    ),

    /**
     * Counts the assets matching a filter per kind, provenance and
     * visibility, for filter chips. Each dimension is counted with the other
     * filters applied but not its own, so a chip shows what selecting it
     * would add.
     *
     * @param query - The filter parameters of `listAssets` (no paging or sort).
     * @returns `{ kinds, provenance, visibility }`, each a record of value to count (values without assets are left out).
     * @example await cmsClient.media.getAssetFacets({ query: { folderId: 'fld_...' } })
     */
    getAssetFacets: createCMSEndpoint(
      '/media/getAssetFacets',
      {
        method: 'GET',
        query: z.object(assetFilterFields).optional(),
        metadata: cmsMeta(
          { $Infer: { query: {} as AssetFilterInput } },
          { operation: 'read', ...MEDIA_META },
        ),
      },
      async (ctx) => {
        const { scope } = ctx.context;
        const query = ctx.query ?? {};
        const count = async (dimension: SQL, omit: FilterDimension) => {
          const rows = await db
            .select({
              value: sql<string>`${dimension}`,
              count: sql<number>`count(*)::int`,
            })
            .from(assets)
            .where(and(...assetFilterConditions(query, scope, omit)))
            .groupBy(dimension);
          return Object.fromEntries(rows.map((row) => [row.value, row.count]));
        };
        const [kinds, provenance, visibility] = await Promise.all([
          count(assetKindSql, 'kinds'),
          count(sql`${assets.provenance}`, 'provenance'),
          count(sql`${assets.status}`, 'visibility'),
        ]);
        return { kinds, provenance, visibility };
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
        const variantsById = await loadVariants(rows.map((a) => a.id));

        return {
          assets: rows.map((asset) =>
            toAssetListItem(asset, urls, variantsById.get(asset.id)),
          ),
        };
      },
    ),

    /**
     * The asset gate, addressed by the stable asset id. Marked `public: true`,
     * so it runs outside the auth chain and does its own access control.
     *
     * Public assets: inline-safe types (raster images, video, audio, PDF)
     * redirect to the public object URL with `public, max-age=300`;
     * `?download=true` and every other type redirect to a signed GET whose
     * `response-content-disposition` is `attachment` (a `Content-Disposition`
     * on the `302` itself would be ignored by browsers).
     *
     * Private assets: only for a caller the auth middleware accepts (with the
     * `media` resource and `read`), inside its scope. The redirect goes to a
     * signed GET valid for at most 300 s and carries
     * `Cache-Control: private, no-store`. Anonymous callers get
     * `ASSET_ACCESS_DENIED`.
     *
     * With a scoping plugin (multi-tenant), a caller whose identity resolves
     * only sees assets in its scope; other ids answer `ASSET_NOT_FOUND`.
     */
    asset: createEndpoint(
      // rou3 needs `:param`, not OpenAPI `{param}` braces.
      '/media/asset/:assetId',
      {
        method: 'GET',
        query: z.object({
          format: z.enum(['webp', 'avif', 'jpeg', 'png']).optional(),
          w: z.coerce.number().int().positive().optional(),
          download: wireBooleanSchema.optional(),
          // Answer RENDITION_NOT_FOUND instead of serving the original.
          strict: wireBooleanSchema.optional(),
          // A pinned revision (`AssetRef.revisionId`) of this asset.
          rev: z.string().optional(),
        }),
        metadata: cmsMeta(
          {},
          { public: true, operation: 'read', ...MEDIA_META },
        ),
      },
      async (ctx) => {
        const params = ctx.params as { assetId: string };
        const assetId = params.assetId;
        const gate = ctx.context as Partial<PublicEndpointContext>;

        const lookup = async (scopeWhere?: SQL) => {
          const conditions: SQL[] = [
            eq(assets.id, assetId),
            isNull(assets.archivedAt),
          ];
          if (scopeWhere) conditions.push(scopeWhere);
          const [row] = await db
            .select({
              id: assets.id,
              objectKey: assets.objectKey,
              status: assets.status,
              mimeType: assets.mimeType,
              slug: assets.slug,
              originalName: assets.originalName,
              processingState: assets.processingState,
            })
            .from(assets)
            .where(and(...conditions));
          return row;
        };
        const notFound = () =>
          new CMSError('ASSET_NOT_FOUND', {
            message: errorMessages.assetNotFound(assetId),
          });

        const asset = await lookup();
        if (!asset) throw notFound();
        // Unscanned or infected bytes are delivered to no one.
        if (asset.processingState !== 'ready') {
          throw new CMSError('ASSET_NOT_READY');
        }

        const isPrivate = asset.status === 'private';
        if (isPrivate || gate.hasScopeConditions) {
          const identity = (await gate.resolveIdentity?.()) ?? null;
          if (identity) {
            const scopeWhere = identity.scope.assets?.where;
            if (scopeWhere && !(await lookup(scopeWhere))) throw notFound();
          } else if (isPrivate) {
            throw new CMSError('ASSET_ACCESS_DENIED');
          }
        }

        let targetKey = asset.objectKey;
        let targetMime = asset.mimeType;
        if (ctx.query?.rev) {
          const [revision] = await db
            .select({ objectKey: assets.objectKey, mimeType: assets.mimeType })
            .from(assets)
            .where(
              and(
                eq(assets.id, ctx.query.rev),
                eq(assets.revisionOf, asset.id),
                eq(assets.processingState, 'ready'),
              ),
            );
          if (!revision) throw notFound();
          targetKey = revision.objectKey;
          targetMime = revision.mimeType;
        } else if (ctx.query?.format || ctx.query?.w) {
          const rendition = await resolveRendition(
            asset,
            ctx.query?.format,
            ctx.query?.w,
          );
          ctx.responseHeaders.set('x-cms-rendition', rendition.match);
          if (rendition.variant) {
            targetKey = rendition.variant.objectKey;
            targetMime = rendition.variant.mimeType;
          } else {
            if (mediaConfig.onRenditionMiss) {
              try {
                await mediaConfig.onRenditionMiss({
                  assetId: asset.id,
                  variantKey: rendition.variantKey,
                });
              } catch (err) {
                console.error('[cms] media onRenditionMiss failed:', err);
              }
            }
            if (wireBooleanIsTrue(ctx.query?.strict)) {
              throw new CMSError('RENDITION_NOT_FOUND', {
                message: `Asset ${asset.id} has no rendition ${rendition.variantKey}`,
              });
            }
          }
        }

        // better-call applies headers from `ctx.responseHeaders` and the
        // status from `ctx.redirect`; a returned `{ headers }` object would
        // never reach the HTTP response. The public redirect is short-cached
        // because `replaceAsset` repoints the id to a new object.
        ctx.responseHeaders.set(
          'cache-control',
          isPrivate ? 'private, no-store' : 'public, max-age=300',
        );
        const wantsDownload = wireBooleanIsTrue(ctx.query?.download);
        const inlineSafe = INLINE_SAFE.test(asset.mimeType);
        // A revision kept under `prv/` is unreadable through the public URL.
        const privateKey = /^(t\/[^/]+\/)?prv\//.test(targetKey);
        if (!isPrivate && !privateKey && !wantsDownload && inlineSafe) {
          return ctx.redirect(
            buildPublicObjectUrl(mediaConfig.publicUrl, targetKey),
          );
        }

        const storage = getStorage(mediaConfig);
        const attachment = wantsDownload || !inlineSafe;
        requireCapability(
          storage,
          (c) =>
            c.signedGet.supported && (!attachment || c.signedGet.disposition),
          attachment
            ? 'signed URLs with a bound content disposition'
            : 'signed URLs',
        );
        const signed = await storage.signGet(targetKey, {
          expiresIn: Math.min(
            isPrivate ? PRIVATE_SIGNED_GET_SECONDS : 3600,
            storage.capabilities.signedGet.maxExpiresIn,
          ),
          responseContentDisposition: attachment
            ? contentDisposition(asset.originalName ?? asset.slug, targetMime)
            : undefined,
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
        body: z
          .object({
            ...bulkTargetFields,
            status: z.enum(['private', 'public']),
          })
          .refine(hasBulkTarget, BULK_TARGET_MESSAGE),
        metadata: cmsMeta({}, { operation: 'update', ...MEDIA_META }),
      },
      async (ctx) => {
        const { scope } = ctx.context;
        const { status } = ctx.body;
        const assetIds = await bulkTargetIds(db, ctx.body, scope);

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
        const { changed } = await setAssetsVisibility(
          db,
          mediaConfig,
          existingIds,
          status,
          scope,
        );

        await emitMediaEvents(
          cmsCtx.realtime,
          scope,
          changed.map((assetId) => ({ event: 'media.asset.updated', assetId })),
        );
        const skipped = assetIds.filter((id) => !changed.includes(id));
        return {
          updated: changed.length,
          updatedIds: changed,
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
        body: z
          .object({
            ...bulkTargetFields,
            folderId: z.string().min(1).nullable(),
          })
          .refine(hasBulkTarget, BULK_TARGET_MESSAGE),
        metadata: cmsMeta({}, { operation: 'update', ...MEDIA_META }),
      },
      async (ctx) => {
        const { scope } = ctx.context;
        const { folderId } = ctx.body;

        // Validate the target folder (scoped) unless moving to the root. An
        // out-of-scope/missing folder yields no row → FOLDER_NOT_FOUND, no leak.
        if (folderId !== null) {
          await assertFolderExists(db, folderId, scope);
        }
        const assetIds = await bulkTargetIds(db, ctx.body, scope);

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
        await emitMediaEvents(
          cmsCtx.realtime,
          ctx.context.scope,
          movedIds.map((assetId) => ({
            event: 'media.asset.updated',
            assetId,
          })),
        );
        return { moved: movedIds.length, movedIds, skipped };
      },
    ),

    /**
     * Archives one or more assets and their variants, soft-deleting them for later garbage collection.
     * Without `force`, assets used by live content (`in_use`), by a configured usage source (`external`) or whose id appears inside rich text (`richtext_suspect`) are skipped, not failed, allowing partial batch success.
     * With `force` they are archived as well; pruning still reclaims an asset only once no commit (history and archived roots included) and no usage source uses it.
     *
     * @param assetIds - Array of asset ids to archive (at least one).
     * @param force - Archive assets that are in use too (after the caller confirmed the usage list).
     * @returns Count of archived assets, their ids, the skipped ids, why each was skipped (`in_use`, `external` or `richtext_suspect`), `usage` root counts for the `in_use` ones, and `usedByArchivedRoots` (archived ids that roots in the trash still use).
     * @throws ASSET_NOT_FOUND if none of the asset ids exist.
     * @example await cmsClient.media.archiveAssets({ assetIds: ['ast_...'] })
     */
    archiveAssets: createCMSEndpoint(
      '/media/archiveAssets',
      {
        method: 'POST',
        body: z
          .object({
            ...bulkTargetFields,
            force: z.boolean().optional(),
          })
          .refine(hasBulkTarget, BULK_TARGET_MESSAGE),
        metadata: cmsMeta({}, { operation: 'delete', ...MEDIA_META }),
      },
      async (ctx) => {
        const { scope } = ctx.context;
        const { force } = ctx.body;
        const assetIds = await bulkTargetIds(db, ctx.body, scope);

        const {
          found,
          archivedIds,
          skippedReasons,
          usage,
          usedByArchivedRoots,
        } = await archiveAssetsInScope(db, assetIds, scope, {
          media: mediaConfig,
          force,
        });
        if (found.length === 0) {
          throw new CMSError('ASSET_NOT_FOUND', {
            message: 'No assets found for the given IDs',
          });
        }
        const archivedFound = archivedIds.filter((id) => found.includes(id));
        await purgeAssetPaths(mediaConfig, archivedFound);
        await emitMediaEvents(
          cmsCtx.realtime,
          scope,
          archivedFound.map((assetId) => ({
            event: 'media.asset.archived',
            assetId,
          })),
        );
        return {
          archived: archivedIds.length,
          archivedIds,
          skipped: Object.keys(skippedReasons),
          skippedReasons,
          usage,
          usedByArchivedRoots,
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
              requireVariantOfForKey(
                uploadFileFields.extend({
                  size: z.number().int().positive(),
                }),
              ),
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
          objectKeyFor: newObjectKey(scope, 'private'),
        });

        const storage = getStorage(mediaConfig);
        requireSignedUploadCapability(
          storage,
          prepared.map((p) => p.file.type),
        );
        await guardSignedBatch({
          actor: actor ?? null,
          scope,
          objectKeys: prepared.map((p) => p.objectKey),
          bytes: prepared.reduce((sum, p) => sum + p.file.size, 0),
          newAssets: prepared.filter((p) => !p.file.variantOf).length,
        });
        const key = await deriveUploadKey(mediaConfig);
        const scopeId = await scopeFingerprint(scope.assets?.insertColumns);
        const exp = Date.now() + signedUrlExpiresIn * 1000;
        const expiresAt = new Date(exp);

        const uploads = await Promise.all(
          prepared.map(async (p) => {
            // Only a storage that verifies the checksum makes the hash
            // trustworthy enough to store and deduplicate by.
            const sha256 = storage.capabilities.checksum.sha256Put
              ? p.file.sha256
              : undefined;
            const multipart =
              p.file.size >
                (mediaConfig.multipart?.threshold ?? MULTIPART_THRESHOLD) &&
              storage.multipart &&
              storage.capabilities.multipart.supported
                ? {
                    uploadId: await storage.multipart.create(p.objectKey, {
                      contentType: p.file.type,
                      acl: objectAcl,
                      cacheControl: cacheControlFor(mediaConfig, 'private'),
                    }),
                    ...planParts(
                      p.file.size,
                      storage.capabilities.multipart.minPartSize,
                      mediaConfig.multipart?.partSize,
                    ),
                  }
                : undefined;
            const signed: {
              url: string | null;
              headers: Record<string, string>;
            } = multipart
              ? { url: null, headers: {} }
              : await storage.signPut(p.objectKey, {
                  contentType: p.file.type,
                  contentLength: p.file.size,
                  expiresIn: signedUrlExpiresIn,
                  acl: objectAcl,
                  cacheControl: cacheControlFor(mediaConfig, 'private'),
                  sha256,
                });
            const token = await mintUploadToken(key, {
              kind: 'upload',
              aud: 'completeUpload',
              host: requestHost(ctx),
              id: p.id,
              name: p.file.name,
              objectKey: p.objectKey,
              type: p.file.type,
              size: p.file.size,
              folderId: folderId ?? null,
              variantOf: p.file.variantOf ?? null,
              variantKey: p.file.variantKey ?? null,
              sha256: multipart ? null : (sha256 ?? null),
              multipart,
              actor: actor ?? null,
              scope: scopeId,
              exp: multipart
                ? Date.now() + MULTIPART_TOKEN_SECONDS * 1000
                : exp,
            });
            return {
              id: p.id,
              objectKey: p.objectKey,
              multipart: multipart ?? null,
              // New assets are private, so there is no direct object URL.
              url: urls.object('private', p.objectKey),
              deliveryUrl: urls.delivery(p.id),
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
     * Signs part URLs of a multipart upload (a `createSignedUpload` entry
     * with `multipart`). Each URL is valid for 15 minutes and binds the
     * part's exact length; part numbers above the planned `partCount` are
     * refused.
     *
     * @param token - The entry's token from `createSignedUpload`.
     * @param partNumbers - 1 to 50 part numbers (1-based).
     * @returns `{ parts: { partNumber, url }[], expiresAt }`.
     * @throws UPLOAD_TOKEN_INVALID if the token is not a multipart token of this caller.
     * @example await cmsClient.media.signUploadParts({ token, partNumbers: [1, 2, 3] })
     */
    signUploadParts: createCMSEndpoint(
      '/media/signUploadParts',
      {
        method: 'POST',
        body: z.object({
          token: z.string().min(1),
          partNumbers: z
            .array(z.number().int().min(1))
            .min(1)
            .max(MAX_PARTS_PER_SIGN),
        }),
        metadata: cmsMeta({}, { operation: 'create', ...MEDIA_META }),
      },
      async (ctx) => {
        const payload = await multipartPayload(ctx, ctx.body.token);
        const { uploadId, partSize, partCount } = payload.multipart;
        const outOfRange = ctx.body.partNumbers.find((n) => n > partCount);
        if (outOfRange !== undefined) {
          throw new APIError(400, {
            code: 'VALIDATION_ERROR',
            message: `Part ${outOfRange} is beyond the ${partCount} planned parts`,
          });
        }
        const storage = getStorage(mediaConfig);
        const parts = await Promise.all(
          [...new Set(ctx.body.partNumbers)].map(async (partNumber) => ({
            partNumber,
            url: await storage.multipart!.signPart(
              payload.objectKey,
              uploadId,
              {
                partNumber,
                contentLength: partLength(payload.size, partSize, partNumber),
                expiresIn: PART_URL_SECONDS,
              },
            ),
          })),
        );
        return {
          parts,
          expiresAt: new Date(Date.now() + PART_URL_SECONDS * 1000),
        };
      },
    ),

    /**
     * The parts a multipart upload already holds, for resuming without
     * uploading a finished part again. Paged by part number.
     *
     * @param token - The entry's token from `createSignedUpload`.
     * @param marker - The `marker` of the previous page.
     * @returns `{ parts: { partNumber, size }[], marker }`; `marker` is `null` on the last page.
     * @throws UPLOAD_TOKEN_INVALID if the token is not a multipart token of this caller.
     * @throws UPLOAD_NOT_FOUND when the upload no longer exists (completed, aborted or expired).
     */
    listUploadParts: createCMSEndpoint(
      '/media/listUploadParts',
      {
        method: 'POST',
        body: z.object({
          token: z.string().min(1),
          marker: z.number().int().min(1).nullable().optional(),
        }),
        metadata: cmsMeta({}, { operation: 'create', ...MEDIA_META }),
      },
      async (ctx) => {
        const payload = await multipartPayload(ctx, ctx.body.token);
        try {
          const page = await getStorage(mediaConfig).multipart!.listParts(
            payload.objectKey,
            payload.multipart.uploadId,
            { marker: ctx.body.marker ?? null },
          );
          return {
            parts: page.parts.map(({ partNumber, size }) => ({
              partNumber,
              size,
            })),
            marker: page.marker,
          };
        } catch (err) {
          if (err instanceof StorageError && /NoSuchUpload/.test(err.message)) {
            throw new CMSError('UPLOAD_NOT_FOUND', {
              message: 'The multipart upload no longer exists',
            });
          }
          throw err;
        }
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
            .array(
              z.object({
                token: z.string().min(1),
                hints: uploadHintsSchema.optional(),
              }),
            )
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
            !isTokenBoundTo(payload, 'completeUpload', requestHost(ctx)) ||
            payload.kind !== 'upload' ||
            payload.scope !== scopeId ||
            payload.actor !== actor
          ) {
            fail(i, new CMSError('UPLOAD_TOKEN_INVALID'));
            continue;
          }

          try {
            const incomplete = await assembleMultipart(payload);
            if (incomplete) {
              fail(i, incomplete);
              continue;
            }
            const rejected = await inspectUploadedObject(payload);
            if (rejected) {
              fail(i, rejected);
              continue;
            }
            const row = await insertCompletedUpload(
              payload,
              scope,
              await describeUploadedObject(payload, ctx.body.uploads[i].hints),
            );
            completed.push(toAssetListItem(row, urls));
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

        await emitMediaEvents(
          cmsCtx.realtime,
          ctx.context.scope,
          completed.map((asset) => ({
            event: 'media.asset.created',
            assetId: asset.id,
          })),
        );
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
          .select({
            id: assets.id,
            variantOf: assets.variantOf,
            status: assets.status,
            mimeType: assets.mimeType,
          })
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
        assertReplaceType(target.mimeType, file.type);
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
        const objectKey = newObjectKey(
          scope,
          uploadVisibility(mediaConfig, target.status),
        )(newId('asset'), slug);

        const storage = getStorage(mediaConfig);
        requireSignedUploadCapability(storage, [file.type]);
        await guardSignedBatch({
          actor: actor ?? null,
          scope,
          objectKeys: [objectKey],
          bytes: file.size,
          newAssets: 0,
        });
        const exp = Date.now() + signedUrlExpiresIn * 1000;
        const expiresAt = new Date(exp);
        const signed = await storage.signPut(objectKey, {
          contentType: file.type,
          contentLength: file.size,
          expiresIn: signedUrlExpiresIn,
          acl: objectAcl,
          cacheControl: cacheControlFor(mediaConfig, target.status),
        });
        const token = await mintUploadToken(
          await deriveUploadKey(mediaConfig),
          {
            kind: 'replace',
            aud: 'commitReplace',
            host: requestHost(ctx),
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
          // The direct object URL once commitReplace repoints the row; `null`
          // for a private asset.
          url: urls.object(target.status, objectKey),
          deliveryUrl: urls.delivery(assetId),
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
        body: z.object({
          token: z.string().min(1),
          revisionNote: z.string().max(2000).optional(),
        }),
        metadata: cmsMeta({}, { operation: 'update', ...MEDIA_META }),
      },
      async (ctx) => {
        const revisionNote = ctx.body.revisionNote;
        const { userId, scope } = ctx.context;

        const payload = await verifyUploadToken(
          await deriveUploadKey(mediaConfig),
          ctx.body.token,
        );
        if (
          !payload ||
          !isTokenBoundTo(payload, 'commitReplace', requestHost(ctx)) ||
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
                width: assets.width,
                height: assets.height,
                originalName: assets.originalName,
                sha256: assets.sha256,
                provenance: assets.provenance,
                metadata: assets.metadata,
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
              .set({
                slug,
                objectKey,
                mimeType,
                size,
                originalName: slug,
                processingState: initialProcessingState(mediaConfig),
                width: null,
                height: null,
                sha256: null,
                provenance: 'unknown',
                updatedAt: now,
              })
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
                width: before.width,
                height: before.height,
                original_name: before.originalName,
                sha256: before.sha256,
                provenance: before.provenance,
                metadata: JSON.stringify(
                  revisionNote
                    ? { ...before.metadata, revisionNote }
                    : before.metadata,
                ),
                object_key: before.objectKey,
                status: 'private' as const,
                folder_id: null,
                variant_of: null,
                // The superseded bytes stay listed as a revision of the asset.
                revision_of: assetId,
                uploaded_by: before.uploadedBy,
                archived_at: now,
              },
              scope.assets,
            );

            return repointed[0];
          });

          await purgeAssetPaths(mediaConfig, [repointedRow.id]);
          await emitMediaEvents(cmsCtx.realtime, scope, [
            { event: 'media.asset.replaced', assetId: repointedRow.id },
          ]);
          return { asset: toAssetListItem(repointedRow, urls) };
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
     * Cancels a signed upload or replace that will not be completed: deletes
     * the object its PUT may have written. Idempotent; a token whose upload
     * was already completed (or whose replace was committed) is left alone.
     *
     * @param token - The token from `createSignedUpload` or `createSignedReplace`.
     * @returns `{ aborted, committed }`: `aborted` when the object was removed, `committed` when the upload had already been completed.
     * @throws UPLOAD_TOKEN_INVALID if the token is not valid for this caller.
     * @example await cmsClient.media.abortUpload({ token })
     */
    abortUpload: createCMSEndpoint(
      '/media/abortUpload',
      {
        method: 'POST',
        body: z.object({ token: z.string().min(1) }),
        metadata: cmsMeta({}, { operation: 'create', ...MEDIA_META }),
      },
      async (ctx) => {
        const { userId, scope } = ctx.context;
        const actor = userId ?? null;
        const payload = await verifyUploadToken(
          await deriveUploadKey(mediaConfig),
          ctx.body.token,
        );
        if (
          !payload ||
          !isTokenBoundTo(
            payload,
            ['completeUpload', 'commitRendition', 'commitReplace'],
            requestHost(ctx),
          ) ||
          payload.scope !==
            (await scopeFingerprint(scope.assets?.insertColumns)) ||
          payload.actor !== actor
        ) {
          throw new CMSError('UPLOAD_TOKEN_INVALID');
        }

        const [row] = await db
          .select({ objectKey: assets.objectKey })
          .from(assets)
          .where(
            eq(
              assets.id,
              payload.kind === 'upload' ? payload.id : payload.assetId,
            ),
          );
        const committed =
          payload.kind === 'upload'
            ? row !== undefined
            : row?.objectKey === payload.objectKey;
        if (committed) return { aborted: false, committed: true };

        try {
          if (payload.kind === 'upload' && payload.multipart) {
            await getStorage(mediaConfig).multipart?.abort(
              payload.objectKey,
              payload.multipart.uploadId,
            );
          }
          await getStorage(mediaConfig).delete(payload.objectKey);
        } catch (err) {
          // A missing object is the goal; anything else is left to the sweeper.
          console.error('[cms:media] abortUpload delete failed', err);
          return { aborted: false, committed: false };
        }
        return { aborted: true, committed: false };
      },
    ),

    /**
     * Looks for existing assets with the same bytes before uploading. A
     * `sha256` matches exactly (assets whose hash the storage verified); a
     * file without one, or without a hash match, matches by original name
     * and size as a hint only. Live originals in scope only.
     *
     * @param files - Up to 100 files: `{ sha256?, name, size }`.
     * @returns `{ results: { index, candidates: { assetId, folderId, matchedBy }[] }[] }`, `matchedBy` being `sha256` or `name-size`.
     * @example await cmsClient.media.findDuplicates({ files: [{ sha256, name: 'a.jpg', size: 1024 }] })
     */
    findDuplicates: createCMSEndpoint(
      '/media/findDuplicates',
      {
        method: 'POST',
        body: z.object({
          files: z
            .array(
              z.object({
                sha256: sha256Base64,
                name: z.string().min(1),
                size: z.number().int().nonnegative(),
              }),
            )
            .min(1)
            .max(100),
        }),
        metadata: cmsMeta({}, { operation: 'read', ...MEDIA_META }),
      },
      async (ctx) => {
        const { scope } = ctx.context;
        const live: SQL[] = [
          isNull(assets.archivedAt),
          isNull(assets.variantOf),
          isNull(assets.revisionOf),
        ];
        if (scope.assets?.where) live.push(scope.assets.where);
        const columns = {
          id: assets.id,
          folderId: assets.folderId,
          sha256: assets.sha256,
          originalName: assets.originalName,
          size: assets.size,
        };

        const hashes = ctx.body.files.flatMap((f) =>
          f.sha256 ? [base64ToHex(f.sha256)] : [],
        );
        const byHash = hashes.length
          ? await db
              .select(columns)
              .from(assets)
              .where(and(...live, inArray(assets.sha256, hashes)))
          : [];
        const names = ctx.body.files.map((f) => f.name);
        const byName = await db
          .select(columns)
          .from(assets)
          .where(and(...live, inArray(assets.originalName, names)));

        return {
          results: ctx.body.files.map((file, index) => {
            const hex = file.sha256 ? base64ToHex(file.sha256) : null;
            const exact = hex ? byHash.filter((a) => a.sha256 === hex) : [];
            const matches =
              exact.length > 0
                ? exact.map((a) => ({ a, matchedBy: 'sha256' as const }))
                : byName
                    .filter(
                      (a) =>
                        a.originalName === file.name && a.size === file.size,
                    )
                    .map((a) => ({ a, matchedBy: 'name-size' as const }));
            return {
              index,
              candidates: matches.map(({ a, matchedBy }) => ({
                assetId: a.id,
                folderId: a.folderId ?? null,
                matchedBy,
              })),
            };
          }),
        };
      },
    ),

    /**
     * Signs the upload of one rendition of an asset: a variant whose identity
     * is its `variantKey` (`w640.webp`, `poster-w640.webp`, see
     * `parseVariantKey`). The server picks the variant id; the object lands
     * next to the original's (same visibility prefix) and the row takes the
     * original's status. When a live variant with this key exists, nothing is
     * signed and `existing` carries it, so producing a rendition twice yields
     * one row. Complete the PUT with `commitRendition`.
     *
     * @param assetId - The original asset (not a variant or revision).
     * @param variantKey - Canonical key of the rendition; its format sets the content type.
     * @param size - Byte length of the rendition.
     * @returns `{ existing, upload }`: the live variant with this key, or `upload` (`{ id, objectKey, signedUrl, headers, token, expiresAt }`) to PUT to.
     * @throws VALIDATION_ERROR if the variant key is not canonical.
     * @throws ASSET_NOT_FOUND if the asset does not exist in scope, is archived, or is itself a variant or revision.
     * @throws FILE_TOO_LARGE if `size` exceeds `maxFileSize`.
     * @example await cmsClient.media.createSignedRendition({ assetId, variantKey: 'w640.webp', size: blob.size })
     */
    createSignedRendition: createCMSEndpoint(
      '/media/createSignedRendition',
      {
        method: 'POST',
        body: z.object({
          assetId: z.string().min(1),
          variantKey: z.string().min(1),
          size: z.number().int().positive(),
        }),
        metadata: cmsMeta({}, { operation: 'create', ...MEDIA_META }),
      },
      async (ctx) => {
        const { userId, scope } = ctx.context;
        const { assetId, variantKey, size } = ctx.body;
        const spec = parseVariantKey(variantKey);
        if (!spec || formatVariantKey(spec) !== variantKey) {
          throw new APIError(400, {
            code: 'VALIDATION_ERROR',
            message: `"${variantKey}" is not a canonical variant key`,
          });
        }

        const conditions: SQL[] = [
          eq(assets.id, assetId),
          isNull(assets.archivedAt),
          isNull(assets.variantOf),
          isNull(assets.revisionOf),
        ];
        if (scope.assets?.where) conditions.push(scope.assets.where);
        const [original] = await db
          .select({
            id: assets.id,
            slug: assets.slug,
            status: assets.status,
            folderId: assets.folderId,
          })
          .from(assets)
          .where(and(...conditions));
        if (!original) {
          throw new CMSError('ASSET_NOT_FOUND', {
            message: errorMessages.assetNotFound(assetId),
          });
        }

        const [existing] = await db
          .select()
          .from(assets)
          .where(
            and(
              eq(assets.variantOf, original.id),
              eq(assets.variantKey, variantKey),
              isNull(assets.archivedAt),
            ),
          );
        if (existing) {
          return { existing: toAssetListItem(existing, urls), upload: null };
        }

        if (size > maxFileSize) {
          throw new CMSError('FILE_TOO_LARGE', {
            message: errorMessages.fileTooLarge(variantKey, size, maxFileSize),
          });
        }

        const type = RENDITION_MIME[spec.format];
        const storage = getStorage(mediaConfig);
        requireSignedUploadCapability(storage, [type]);
        const id = newId('asset');
        const name = `${original.slug.replace(/\.[^.]*$/, '')}-${variantKey}`;
        const objectKey = assetObjectKey(mediaConfig, {
          id,
          fileName: name,
          visibility: uploadVisibility(mediaConfig, original.status),
          scope,
        });
        await guardSignedBatch({
          actor: userId ?? null,
          scope,
          objectKeys: [objectKey],
          bytes: size,
          newAssets: 0,
        });
        const exp = Date.now() + signedUrlExpiresIn * 1000;
        const signed = await storage.signPut(objectKey, {
          contentType: type,
          contentLength: size,
          expiresIn: signedUrlExpiresIn,
          acl: original.status === 'public' ? objectAcl : undefined,
          cacheControl: cacheControlFor(mediaConfig, original.status),
        });
        const token = await mintUploadToken(
          await deriveUploadKey(mediaConfig),
          {
            kind: 'upload',
            aud: 'commitRendition',
            host: requestHost(ctx),
            id,
            name,
            objectKey,
            type,
            size,
            folderId: original.folderId ?? null,
            variantOf: original.id,
            variantKey,
            status: original.status,
            actor: userId ?? null,
            scope: await scopeFingerprint(scope.assets?.insertColumns),
            exp,
          },
        );
        return {
          existing: null,
          upload: {
            id,
            objectKey,
            signedUrl: signed.url,
            headers: signed.headers,
            token,
            expiresAt: new Date(exp),
          },
        };
      },
    ),

    /**
     * Creates the variant row for a rendition PUT to the URL from
     * `createSignedRendition`. Checks the object like `completeUpload`, then
     * that its bytes are the format of the variant key and its width (and
     * height, when the key has one) match; a mismatching object is deleted.
     * Idempotent: when a live variant with the key exists (a second commit,
     * or another producer won), that row is returned and this object is
     * deleted.
     *
     * @param token - The token from `createSignedRendition`.
     * @returns `{ asset }`: the variant, with the same fields as a `listAssets` row.
     * @throws UPLOAD_TOKEN_INVALID if the token is malformed, expired, for another caller, or not a rendition token.
     * @throws UPLOAD_NOT_FOUND if the PUT never landed.
     * @throws RENDITION_MISMATCH if the bytes are not the declared format or size.
     * @example await cmsClient.media.commitRendition({ token: upload.token })
     */
    commitRendition: createCMSEndpoint(
      '/media/commitRendition',
      {
        method: 'POST',
        body: z.object({ token: z.string().min(1) }),
        metadata: cmsMeta({}, { operation: 'create', ...MEDIA_META }),
      },
      async (ctx) => {
        const { userId, scope } = ctx.context;
        const payload = await verifyUploadToken(
          await deriveUploadKey(mediaConfig),
          ctx.body.token,
        );
        const spec =
          payload?.kind === 'upload' && payload.variantKey
            ? parseVariantKey(payload.variantKey)
            : null;
        if (
          !payload ||
          !isTokenBoundTo(payload, 'commitRendition', requestHost(ctx)) ||
          payload.kind !== 'upload' ||
          !payload.variantOf ||
          !spec ||
          payload.scope !==
            (await scopeFingerprint(scope.assets?.insertColumns)) ||
          payload.actor !== (userId ?? null)
        ) {
          throw new CMSError('UPLOAD_TOKEN_INVALID');
        }

        const storage = getStorage(mediaConfig);
        const loadLive = async () => {
          const [row] = await db
            .select()
            .from(assets)
            .where(
              and(
                eq(assets.variantOf, payload.variantOf!),
                eq(assets.variantKey, payload.variantKey!),
                isNull(assets.archivedAt),
              ),
            );
          return row;
        };
        const dropObject = async () => {
          try {
            await storage.delete(payload.objectKey);
          } catch (err) {
            console.error('[cms:media] failed to delete rendition', err);
          }
        };

        const [committed] = await db
          .select()
          .from(assets)
          .where(eq(assets.id, payload.id));
        if (committed) return { asset: toAssetListItem(committed, urls) };

        const rejected = await inspectUploadedObject(payload);
        if (rejected) throw rejected;

        const bytes = await storage.getRange(
          payload.objectKey,
          0,
          RENDITION_HEADER_BYTES - 1,
        );
        const dimensions = bytes ? readImageDimensions(bytes) : null;
        if (
          !bytes ||
          sniffType(bytes) !== RENDITION_MIME[spec.format] ||
          !dimensions ||
          dimensions.width !== spec.width ||
          (spec.height !== undefined && dimensions.height !== spec.height)
        ) {
          await dropObject();
          throw new CMSError('RENDITION_MISMATCH', {
            message: `The object is not a ${spec.format} of width ${spec.width}`,
          });
        }

        let row: AssetRow;
        try {
          row = await insertCompletedUpload(payload, scope, {
            width: dimensions.width,
            height: dimensions.height,
          });
        } catch (err) {
          if ((err as CMSError).cmsCode !== 'VARIANT_EXISTS') throw err;
          const live = await loadLive();
          if (!live) throw err;
          await dropObject();
          return { asset: toAssetListItem(live, urls) };
        }

        // Cached `?w=` redirects may point at a larger rendition or the original.
        await purgeAssetPaths(mediaConfig, [payload.variantOf]);
        await emitMediaEvents(cmsCtx.realtime, scope, [
          { event: 'media.rendition.created', assetId: payload.variantOf },
        ]);
        return { asset: toAssetListItem(row, urls) };
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
              requireVariantOfForKey(
                uploadFileFields.extend({
                  size: z.number().int().positive(),
                  buffer: z.instanceof(Blob).or(z.instanceof(ArrayBuffer)),
                }),
              ),
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
          objectKeyFor: newObjectKey(scope, 'private'),
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

        const inserted = await (async () => {
          try {
            return await scopedInsertBatch(
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
                variant_key: p.file.variantKey ?? null,
                original_name: p.file.name,
                processing_state: initialProcessingState(mediaConfig),
                uploaded_by: actor ?? null,
              })),
              scope.assets,
            );
          } catch (err) {
            if (isConstraintViolation(err, '23505', 'assets_variant_unique')) {
              throw new CMSError('VARIANT_EXISTS');
            }
            throw err;
          }
        })();
        const insertedById = new Map(inserted.map((row) => [row.id, row]));

        for (let i = 0; i < prepared.length; i++) {
          const p = prepared[i];
          const file = filesByIndex.get(i)!;
          try {
            await storage.put(p.objectKey, file.buffer, {
              contentType: file.type,
              contentLength: file.size,
              acl: objectAcl,
              cacheControl: cacheControlFor(mediaConfig, 'private'),
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

        await emitMediaEvents(
          cmsCtx.realtime,
          scope,
          prepared.map((p) => ({
            event: 'media.asset.created',
            assetId: p.id,
          })),
        );

        // Read back through Drizzle so timestamps map exactly as in listAssets
        // (a raw row's timestamp string carries no zone).
        const rows = await db
          .select()
          .from(assets)
          .where(inArray(assets.id, [...insertedById.keys()]));
        const rowsById = new Map(rows.map((row) => [row.id, row]));
        return {
          assets: prepared.map((p) =>
            toAssetListItem(rowsById.get(p.id)!, urls),
          ),
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
          revisionNote: z.string().max(2000).optional(),
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
        const revisionNote = ctx.body.revisionNote;
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
          .select({
            id: assets.id,
            variantOf: assets.variantOf,
            status: assets.status,
            mimeType: assets.mimeType,
          })
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
        assertReplaceType(target.mimeType, file.type);
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
        const objectKey = newObjectKey(
          scope,
          uploadVisibility(mediaConfig, target.status),
        )(newId('asset'), slug);

        // 5. PUT the new object FIRST — on failure the row is untouched, so the
        //    asset keeps serving its existing (still-present) object.
        try {
          await getStorage(mediaConfig).put(objectKey, file.buffer, {
            contentType: file.type,
            contentLength: measuredSize,
            acl: objectAcl,
            cacheControl: cacheControlFor(mediaConfig, target.status),
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
                width: assets.width,
                height: assets.height,
                originalName: assets.originalName,
                sha256: assets.sha256,
                provenance: assets.provenance,
                metadata: assets.metadata,
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
                originalName: normalizeDisplayName(file.name, file.type),
                processingState: initialProcessingState(mediaConfig),
                width: null,
                height: null,
                sha256: null,
                provenance: 'unknown',
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
                width: before.width,
                height: before.height,
                original_name: before.originalName,
                sha256: before.sha256,
                provenance: before.provenance,
                metadata: JSON.stringify(
                  revisionNote
                    ? { ...before.metadata, revisionNote }
                    : before.metadata,
                ),
                object_key: before.objectKey,
                status: 'private' as const,
                folder_id: null,
                variant_of: null,
                // The superseded bytes stay listed as a revision of the asset.
                revision_of: assetId,
                uploaded_by: before.uploadedBy,
                archived_at: now,
              },
              scope.assets,
            );

            return repointed[0];
          });

          await purgeAssetPaths(mediaConfig, [repointedRow.id]);
          await emitMediaEvents(cmsCtx.realtime, scope, [
            { event: 'media.asset.replaced', assetId: repointedRow.id },
          ]);
          return { asset: toAssetListItem(repointedRow, urls) };
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
