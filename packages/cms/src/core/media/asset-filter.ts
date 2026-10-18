import { APIError } from 'better-call';
import {
  and,
  eq,
  inArray,
  isNotNull,
  isNull,
  not,
  notInArray,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import * as z from 'zod';

import type { ResolvedScope } from '../types/definitions';
import type { DrizzleInstance } from '../types/drizzle';

import { assets } from '../db/schema.generated';
import { crossScopeColumns } from '../scope';
import { ASSET_PROVENANCES } from '../types/asset-metadata';
import { wireBooleanIsTrue, wireBooleanSchema } from '../utils/wire-boolean';
import { ASSET_SEARCH_VECTOR_SQL } from './search-vector';
import { assetHasUsage } from './usage';

/** Asset kinds derived from the MIME type. */
/** The values of `assets.processing_state`. */
export const PROCESSING_STATES = ['pending', 'ready', 'failed'] as const;

export const ASSET_KINDS = [
  'image',
  'video',
  'audio',
  'document',
  'archive',
  'other',
] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

/** Most assets `allMatching` resolves in one bulk call. */
export const ALL_MATCHING_LIMIT = 10_000;

const splitList = z.string().transform((value) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean),
);
const csvList = () => splitList.pipe(z.array(z.string()));
const csvEnum = <const T extends readonly [string, ...string[]]>(values: T) =>
  splitList.pipe(z.array(z.enum(values)));

const dateParam = z.iso.date().or(z.iso.datetime({ offset: true }));

/**
 * The wire filter of `listAssets`, `getAssetFacets` and bulk `allMatching`.
 * Lists are comma separated (`kinds=image,video`).
 */
export const assetFilterFields = {
  folderId: z.string().optional(),
  // Wire-safe root-level filter: a `null` query param never survives URL
  // serialization, so `unfiled: true` stands for `folder_id IS NULL`.
  unfiled: wireBooleanSchema.optional(),
  recursive: wireBooleanSchema.optional(),
  status: z.enum(['private', 'public']).optional(),
  visibility: csvEnum(['private', 'public']).optional(),
  search: z.string().optional(),
  q: z.string().max(200).optional(),
  kinds: csvEnum(ASSET_KINDS).optional(),
  mime: csvList().optional(),
  provenance: csvEnum(ASSET_PROVENANCES).optional(),
  processingState: csvEnum(PROCESSING_STATES).optional(),
  uploadedBy: csvList().optional(),
  createdFrom: dateParam.optional(),
  createdTo: dateParam.optional(),
  sizeMin: z.coerce.number().int().min(0).optional(),
  sizeMax: z.coerce.number().int().min(0).optional(),
  widthMin: z.coerce.number().int().min(1).optional(),
  heightMin: z.coerce.number().int().min(1).optional(),
  orientation: z.enum(['landscape', 'portrait', 'square']).optional(),
  usage: z.enum(['used', 'unused']).optional(),
  usageScope: z.enum(['live', 'published']).optional(),
  missingAlt: wireBooleanSchema.optional(),
  unusedSinceDays: z.coerce.number().int().min(1).optional(),
  expiringWithinDays: z.coerce.number().int().min(0).optional(),
  archived: wireBooleanSchema.optional(),
};

export const assetFilterSchema = z.object(assetFilterFields);

type ParsedFilter = z.output<typeof assetFilterSchema>;

/** The `$Infer` query type of the filter, as callers write it. */
export type AssetFilterInput = {
  folderId?: string;
  unfiled?: boolean;
  recursive?: boolean;
  status?: 'private' | 'public';
  /** Comma separated `private`, `public`. */
  visibility?: string;
  /** Substring of the slug. */
  search?: string;
  /** Full-text and substring search of name, description, credit and copyright. */
  q?: string;
  /** Comma separated kinds: `image,video,audio,document,archive,other`. */
  kinds?: string;
  /** Comma separated types or prefixes such as `image/*`. */
  mime?: string;
  /** Comma separated provenances. */
  provenance?: string;
  /** Comma separated processing states: `pending,ready,failed`. */
  processingState?: string;
  /** Comma separated user ids. */
  uploadedBy?: string;
  createdFrom?: string;
  createdTo?: string;
  sizeMin?: number;
  sizeMax?: number;
  widthMin?: number;
  heightMin?: number;
  orientation?: 'landscape' | 'portrait' | 'square';
  usage?: 'used' | 'unused';
  usageScope?: 'live' | 'published';
  missingAlt?: boolean;
  unusedSinceDays?: number;
  expiringWithinDays?: number;
  archived?: boolean;
};

const DOCUMENT_TYPES = sql.raw(
  `'^(application/(pdf|msword|rtf|vnd\\.(ms-|openxmlformats-|oasis\\.))|text/)'`,
);
const ARCHIVE_TYPES = sql.raw(
  `'^application/(zip|x-zip-compressed|gzip|x-gzip|x-tar|x-7z-compressed|x-rar-compressed|vnd\\.rar|x-bzip2)$'`,
);

/** The kind of an asset row, as SQL. */
export const assetKindSql = sql<AssetKind>`CASE
  WHEN ${assets.mimeType} LIKE 'image/%' THEN 'image'
  WHEN ${assets.mimeType} LIKE 'video/%' THEN 'video'
  WHEN ${assets.mimeType} LIKE 'audio/%' THEN 'audio'
  WHEN ${assets.mimeType} ~ ${ARCHIVE_TYPES} THEN 'archive'
  WHEN ${assets.mimeType} ~ ${DOCUMENT_TYPES} THEN 'document'
  ELSE 'other' END`;

const searchVector = sql.raw(ASSET_SEARCH_VECTOR_SQL);

function escapeLike(value: string) {
  return value.replace(/[%_\\]/g, '\\$&');
}

export type FilterDimension = 'kinds' | 'provenance' | 'visibility';

/**
 * WHERE conditions for a parsed filter: originals only (no variants or
 * revisions), live unless `archived`, in the caller's asset scope. Usage
 * filters read the usage index in the caller's root scope. `omit` leaves a
 * dimension out (facet counts).
 */
export function assetFilterConditions(
  input: ParsedFilter | AssetFilterInput,
  scope: ResolvedScope,
  omit?: FilterDimension,
): SQL[] {
  const filter = normalizeLists(input);
  const conditions: SQL[] = [
    wireBooleanIsTrue(filter.archived)
      ? isNotNull(assets.archivedAt)
      : isNull(assets.archivedAt),
    isNull(assets.variantOf),
    isNull(assets.revisionOf),
  ];
  if (scope.assets?.where) conditions.push(scope.assets.where);

  const usageFilter = {
    scopeColumns: crossScopeColumns(scope.roots),
    rootsWhere: scope.roots?.where,
  };
  const usageScope = filter.usageScope ?? 'live';
  if (filter.usage) {
    const used = assetHasUsage(assets.id, {
      ...usageFilter,
      scope: usageScope,
    });
    conditions.push(filter.usage === 'used' ? used : not(used));
  }
  if (filter.unusedSinceDays !== undefined) {
    conditions.push(
      not(assetHasUsage(assets.id, { ...usageFilter, scope: usageScope })),
      sql`${assets.createdAt} < now() - make_interval(days => ${filter.unusedSinceDays})`,
    );
  }
  if (wireBooleanIsTrue(filter.missingAlt)) {
    conditions.push(
      assetHasUsage(assets.id, {
        ...usageFilter,
        scope: 'live',
        missingAlt: true,
      }),
    );
  }

  if (wireBooleanIsTrue(filter.unfiled)) {
    conditions.push(isNull(assets.folderId));
  } else if (filter.folderId !== undefined) {
    if (wireBooleanIsTrue(filter.recursive)) {
      const folderScope = scope.assetFolders?.where
        ? sql`AND ${scope.assetFolders.where}`
        : sql``;
      conditions.push(sql`${assets.folderId} IN (
        SELECT d.id FROM cms.asset_folders AS d
         WHERE d.archived_at IS NULL
           AND starts_with(d.path, (
             SELECT p.path FROM cms.asset_folders AS p WHERE p.id = ${filter.folderId}
           ))
           ${folderScope}
      )`);
    } else {
      conditions.push(eq(assets.folderId, filter.folderId));
    }
  }

  const statuses = new Set([
    ...(filter.status ? [filter.status] : []),
    ...(omit === 'visibility' ? [] : (filter.visibility ?? [])),
  ]);
  if (statuses.size > 0) conditions.push(inArray(assets.status, [...statuses]));

  if (filter.search) {
    conditions.push(
      sql`${assets.slug} ILIKE ${`%${escapeLike(filter.search)}%`}`,
    );
  }
  const q = filter.q?.trim();
  if (q) {
    const like = `%${escapeLike(q.toLowerCase())}%`;
    conditions.push(
      or(
        sql`${searchVector} @@ websearch_to_tsquery('simple', ${q})`,
        sql`lower(${assets.originalName}) LIKE ${like}`,
        sql`lower(${assets.slug}) LIKE ${like}`,
      )!,
    );
  }

  if (omit !== 'kinds' && filter.kinds && filter.kinds.length > 0) {
    conditions.push(inArray(assetKindSql, filter.kinds));
  }
  if (filter.mime && filter.mime.length > 0) {
    conditions.push(
      or(
        ...filter.mime.map((type) =>
          type.endsWith('/*')
            ? sql`${assets.mimeType} LIKE ${`${escapeLike(type.slice(0, -1))}%`}`
            : eq(assets.mimeType, type),
        ),
      )!,
    );
  }
  if (
    omit !== 'provenance' &&
    filter.provenance &&
    filter.provenance.length > 0
  ) {
    conditions.push(inArray(assets.provenance, filter.provenance));
  }
  if (filter.processingState && filter.processingState.length > 0) {
    conditions.push(inArray(assets.processingState, filter.processingState));
  }
  if (filter.uploadedBy && filter.uploadedBy.length > 0) {
    conditions.push(inArray(assets.uploadedBy, filter.uploadedBy));
  }
  if (filter.createdFrom) {
    conditions.push(
      sql`${assets.createdAt} >= ${filter.createdFrom}::timestamptz`,
    );
  }
  if (filter.createdTo) {
    // A date without a time includes that whole day.
    conditions.push(
      /^\d{4}-\d{2}-\d{2}$/.test(filter.createdTo)
        ? sql`${assets.createdAt} < (${filter.createdTo}::date + 1)`
        : sql`${assets.createdAt} <= ${filter.createdTo}::timestamptz`,
    );
  }
  if (filter.sizeMin !== undefined)
    conditions.push(sql`${assets.size} >= ${filter.sizeMin}`);
  if (filter.sizeMax !== undefined)
    conditions.push(sql`${assets.size} <= ${filter.sizeMax}`);
  if (filter.widthMin !== undefined)
    conditions.push(sql`${assets.width} >= ${filter.widthMin}`);
  if (filter.heightMin !== undefined)
    conditions.push(sql`${assets.height} >= ${filter.heightMin}`);
  if (filter.orientation) {
    const comparison =
      filter.orientation === 'landscape'
        ? sql`${assets.width} > ${assets.height}`
        : filter.orientation === 'portrait'
          ? sql`${assets.width} < ${assets.height}`
          : sql`${assets.width} = ${assets.height}`;
    conditions.push(
      and(isNotNull(assets.width), isNotNull(assets.height), comparison)!,
    );
  }
  if (filter.expiringWithinDays !== undefined) {
    // `expiresAt` is validated on write; the pattern keeps older rows from
    // failing the cast.
    conditions.push(sql`(CASE
      WHEN ${assets.metadata}->'rights'->>'expiresAt' ~ '^\\d{4}-\\d{2}-\\d{2}'
      THEN (${assets.metadata}->'rights'->>'expiresAt')::timestamptz
      END) <= now() + make_interval(days => ${filter.expiringWithinDays})`);
  }
  return conditions;
}

const listOf = <T extends string>(
  value: string | readonly string[] | undefined,
  allowed?: readonly T[],
): T[] | undefined => {
  if (value === undefined) return undefined;
  const items =
    typeof value === 'string'
      ? value.split(',').map((v) => v.trim())
      : [...value];
  return items.filter(
    (item): item is T =>
      item !== '' &&
      (!allowed || (allowed as readonly string[]).includes(item)),
  );
};

/**
 * Lists in their parsed form. Endpoints receive arrays from the query
 * schema; their `$Infer` type still describes the comma-separated wire form.
 */
function normalizeLists(input: ParsedFilter | AssetFilterInput) {
  return {
    ...input,
    visibility: listOf(input.visibility, ['private', 'public'] as const),
    kinds: listOf(input.kinds, ASSET_KINDS),
    mime: listOf<string>(input.mime),
    provenance: listOf(input.provenance, ASSET_PROVENANCES),
    processingState: listOf(input.processingState, PROCESSING_STATES),
    uploadedBy: listOf<string>(input.uploadedBy),
  };
}

/** Parses a filter object (bulk `allMatching.query`) with the wire rules. */
export function parseAssetFilter(query: unknown): ParsedFilter {
  return assetFilterSchema.parse(query ?? {});
}

/**
 * The ids of every asset matching `filter` minus `except`, in the caller's
 * scope. Throws `VALIDATION_ERROR` above `ALL_MATCHING_LIMIT` assets.
 */
export async function resolveAllMatching(
  db: DrizzleInstance,
  filter: ParsedFilter,
  except: readonly string[],
  scope: ResolvedScope,
): Promise<string[]> {
  const conditions = assetFilterConditions(filter, scope);
  if (except.length > 0) conditions.push(notInArray(assets.id, [...except]));
  const rows = await db
    .select({ id: assets.id })
    .from(assets)
    .where(and(...conditions))
    .limit(ALL_MATCHING_LIMIT + 1);
  if (rows.length > ALL_MATCHING_LIMIT) {
    throw new APIError(400, {
      code: 'VALIDATION_ERROR',
      message: `allMatching selects more than ${ALL_MATCHING_LIMIT} assets; narrow the filter.`,
    });
  }
  return rows.map((row) => row.id);
}

/** Body shape of bulk endpoints: explicit ids or a server-side selection. */
export const bulkTargetFields = {
  assetIds: z.array(z.string()).min(1).optional(),
  allMatching: z
    .object({
      query: z.record(z.string(), z.unknown()),
      except: z.array(z.string()).default([]),
    })
    .optional(),
};

export const BULK_TARGET_MESSAGE = 'Pass assetIds or allMatching.';

/** Refines a bulk body: one of `assetIds` and `allMatching` is required. */
export function hasBulkTarget(body: {
  assetIds?: string[];
  allMatching?: unknown;
}): boolean {
  return (body.assetIds?.length ?? 0) > 0 || body.allMatching !== undefined;
}

/** The ids a bulk body targets; `allMatching` is resolved on the server. */
export async function bulkTargetIds(
  db: DrizzleInstance,
  body: {
    assetIds?: string[];
    allMatching?: { query: Record<string, unknown>; except?: string[] };
  },
  scope: ResolvedScope,
  options: { archived?: boolean } = {},
): Promise<string[]> {
  if (body.assetIds && body.assetIds.length > 0) return body.assetIds;
  if (body.allMatching) {
    const query: Record<string, unknown> = { ...body.allMatching.query };
    if (options.archived) query.archived = true;
    const filter = parseAssetFilter(query);
    return resolveAllMatching(db, filter, body.allMatching.except ?? [], scope);
  }
  throw new APIError(400, {
    code: 'VALIDATION_ERROR',
    message: BULK_TARGET_MESSAGE,
  });
}

/** The `$Infer` body type of a bulk target. */
export type BulkTargetInput =
  | { assetIds: string[]; allMatching?: never }
  | {
      assetIds?: never;
      allMatching: { query: AssetFilterInput; except?: string[] };
    };
