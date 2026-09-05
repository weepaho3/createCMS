import { and, eq, inArray, isNull, sql, type AnyColumn } from 'drizzle-orm';
import * as z from 'zod';

import type {
  CollectionWithName,
  ListRootsResult,
  RootListItem,
} from '../types';
import type { ResolvedSlugConfig } from '../types/definitions';
import type { BlocksContext } from './blocks-context';

import { newId } from '../../utils/nanoid';
import { createInitialCommit } from '../blocks/commit-writer';
import { requireRootInScope } from '../blocks/guards';
import {
  readRootSlug,
  withRootSlug,
  ROOT_SLUG_PROP,
} from '../blocks/reconstruct-snapshot';
import {
  blockVersions,
  branches,
  commitSnapshots,
  mergeRequests,
  publications,
  roots,
} from '../db/schema.generated';
import { cmsMeta, createCMSEndpoint } from '../endpoint';
import { CMSError, errorMessages } from '../errors';
import {
  captureSubtreePaths,
  recordArchiveRedirect,
  recordSubtreeRedirects,
} from '../redirects/auto-create';
import { resolveRootCurrentPath } from '../redirects/resolve';
import { isReferencedByLiveContent } from '../references';
import { batchFetchRootListItems } from '../root/batch-fetch';
import {
  type ListRootsQuery,
  type RootInput,
  type UpdateRootInput,
  ROOT_COLUMN_FIELDS,
  buildListRootsQuerySchema,
  buildRootInputSchema,
  buildUpdateRootInputSchema,
} from '../schema-builders';
import { crossScopeColumns, scopedInsert } from '../scope';
import {
  buildFullPath,
  isAncestorOf,
  normalizeSlug,
  validateSlugUniqueness,
} from '../slug';
import { userEnrichment } from '../user/enrichment';
import { parseTimestamp } from '../utils/parse-timestamp';
import { wireBooleanIsTrue, wireBooleanSchema } from '../utils/wire-boolean';

// ============================================================================
// Root endpoints (9): createRoot, listRoots, duplicateRoot, updateRoot,
// moveRoot, getRoot, getRootBySlug, archiveRoot, getRootHistory
// ============================================================================

export function createRootEndpoints<TDef extends CollectionWithName>(
  ctx: BlocksContext<TDef>,
) {
  const {
    def,
    db,
    collectionName,
    branchPolicy,
    commitMessage,
    runDuplicate,
    patchSingleVersion,
  } = ctx;

  return {
    /**
     * Creates a new root (page/entry) with initial draft branch and commit.
     * Validates slug uniqueness and nesting constraints against collection definition.
     * @param message Optional commit message; defaults to 'Initial commit'.
     * @param slug Root slug (if enabled in collection definition); validated for uniqueness.
     * @param parentRootId Parent root id for nested collections; required if nesting is enabled.
     * @param properties Initial root-level properties.
     * @returns Root id, initial branch id, and initial commit id.
     * @throws SLUG_EMPTY_NOT_ALLOWED when slug is required but empty.
     * @throws NESTING_NOT_ENABLED when nesting is disabled but parentRootId is provided.
     * @throws PARENT_ROOT_NOT_FOUND when parentRootId does not exist.
     * @example
     * const result = await cmsClient.pages.createRoot({
     *   message: 'New page',
     *   slug: 'my-page',
     *   properties: { title: 'My Page' }
     * });
     */
    createRoot: createCMSEndpoint(
      `/${collectionName}/createRoot`,
      {
        method: 'POST',
        body: buildRootInputSchema(def.root.properties),
        metadata: cmsMeta(
          {
            $Infer: {
              body: {} as RootInput<TDef['root']['properties']>,
            },
          },
          {
            permissionResource: 'root',
            operation: 'create',
            scope: 'collection',
            collection: collectionName,
          },
        ),
      },
      async (ctx) => {
        const { userId, scope } = ctx.context;
        const actor = userId;
        const message = ctx.body.message;
        const parentRootId = ctx.body.parentRootId ?? null;
        const slugCfg = def.slug as ResolvedSlugConfig | undefined;

        let slug: string | null = null;

        if (slugCfg?.enabled) {
          const rawSlug = (ctx.body.slug as string | undefined) ?? '';
          slug = slugCfg.normalize ? normalizeSlug(rawSlug) : rawSlug;

          if (!slug && !slugCfg.allowIndex) {
            throw new CMSError('SLUG_EMPTY_NOT_ALLOWED');
          }

          if (parentRootId && !slugCfg.nested) {
            throw new CMSError('NESTING_NOT_ENABLED');
          }
        } else if (parentRootId) {
          throw new CMSError('NESTING_NOT_ENABLED');
        }

        return db.transaction(async (tx) => {
          if (parentRootId) {
            const [parent] = await tx
              .select({ id: roots.id })
              .from(roots)
              .where(
                and(
                  eq(roots.id, parentRootId),
                  eq(roots.collection, collectionName),
                  scope.roots?.where,
                ),
              );
            if (!parent) throw new CMSError('PARENT_ROOT_NOT_FOUND');
          }

          // The slug is VERSIONED. It is seeded as the root version's
          // draft `__slug` (below) and left OFF roots.slug — the global slug
          // stays null until this root is first published. Drafts may collide,
          // so there is no blocking write-time uniqueness check; publish enforces
          // it (PUBLISH_SLUG_CONFLICT). The cheap empty check above stays.
          const root = await scopedInsert(
            tx,
            'cms.roots',
            {
              id: newId('root'),
              collection: collectionName,
              parent_root_id: parentRootId,
              slug: null,
              sort_order: 0,
              created_by: actor,
              // Plugin-contributed per-new-entry columns: a new root is
              // a new logical entry, so the i18n plugin mints a fresh
              // translation_key here; none are added without such a plugin.
              ...scope.roots?.newEntryColumns?.(),
            },
            scope.roots,
          );

          const rootProps =
            (ctx.body.properties as Record<string, unknown> | undefined) ?? {};

          const { commit, branchId } = await createInitialCommit(tx, def, {
            rootId: root.id,
            branchName: branchPolicy.defaultBranchName,
            message: commitMessage(message, 'Initial commit'),
            createdBy: actor,
            versions: [
              {
                blockId: root.id,
                type: collectionName,
                properties: slugCfg?.enabled
                  ? withRootSlug(rootProps, slug)
                  : rootProps,
                children: [],
              },
            ],
          });

          // `slug` is the DRAFT slug just seeded; `path` is a PUBLISHED concern
          // (roots.slug is still null), so it is undefined until publish.
          return {
            commit,
            rootId: root.id,
            branchId,
            slug: slug || undefined,
            path: undefined as string | undefined,
          };
        });
      },
    ),

    /**
     * Fetch a paginated list of roots with search, filter, and sort.
     * Includes publication counts, branch counts, and open merge request counts per root.
     * @param limit Pagination limit (default 20, max 100 enforced by schema).
     * @param offset Pagination offset (default 0).
     * @param search Search query for a field.
     * @param searchField Field to search (column or property name).
     * @param sortBy Field to sort by (default 'createdAt').
     * @param sortDirection 'asc' or 'desc' (default 'desc').
     * @param filterField Field to filter on.
     * @param filterValue Case-insensitive ILIKE pattern matched against filterField.
     *   Passed RAW (unlike `search`, which is auto-wrapped as %term%): a bare value
     *   is an exact case-insensitive match; include SQL `%`/`_` wildcards yourself for
     *   partial matches (e.g. 'about%'). Use `search`/`searchField` for substring search.
     * @param hasPublications Filter roots: true (has any publication), false (none), or undefined (both).
     * @param createdAfter Filter roots created after this ISO date.
     * @param createdBefore Filter roots created before this ISO date.
     * @param parentRootId Filter by parent root; use 'null' or '' for top-level roots.
     * @returns Paginated result with roots array, total count, and hasMore flag.
     * @example
     * const result = await cmsClient.pages.listRoots({
     *   limit: 20,
     *   offset: 0,
     *   sortBy: 'createdAt',
     *   sortDirection: 'desc'
     * });
     */
    listRoots: createCMSEndpoint(
      `/${collectionName}/listRoots`,
      {
        method: 'GET',
        query: buildListRootsQuerySchema(def.root.properties),
        metadata: cmsMeta(
          {
            $Infer: {
              query: {} as ListRootsQuery<TDef['root']['properties']>,
            },
          },
          {
            permissionResource: 'root',
            operation: 'read',
            scope: 'collection',
            collection: collectionName,
          },
        ),
      },
      async (ctx) => {
        const { scope } = ctx.context;
        const query = ctx.query ?? {};

        const {
          limit = 20,
          offset = 0,
          search,
          searchField,
          sortBy,
          sortDirection = 'desc',
          filterField,
          filterValue,
          hasPublications,
          createdAfter,
          createdBefore,
          parentRootId: parentFilter,
        } = query;

        const hasPublicationsFilter =
          hasPublications === undefined
            ? undefined
            : wireBooleanIsTrue(hasPublications);

        const columnFields: Record<
          string,
          { column: AnyColumn; alias: string }
        > = {
          rootId: { column: roots.id, alias: 'root_id' },
          slug: { column: roots.slug, alias: 'slug' },
          createdAt: { column: roots.createdAt, alias: 'created_at' },
          createdBy: { column: roots.createdBy, alias: 'created_by' },
        };
        const isColumnField = (f: string) =>
          (ROOT_COLUMN_FIELDS as readonly string[]).includes(f);

        const conditions = [
          eq(roots.collection, collectionName),
          eq(blockVersions.deleted, false),
          isNull(roots.archivedAt),
        ];
        if (scope.roots?.where) conditions.push(scope.roots.where);

        if (search && searchField) {
          if (isColumnField(searchField)) {
            const col = columnFields[searchField].column;
            conditions.push(sql`${col}::text ILIKE ${`%${search}%`}`);
          } else {
            conditions.push(
              sql`${blockVersions.properties}->>${searchField} ILIKE ${`%${search}%`}`,
            );
          }
        }
        if (createdAfter) {
          conditions.push(sql`${roots.createdAt} >= ${createdAfter}`);
        }
        if (createdBefore) {
          conditions.push(sql`${roots.createdAt} <= ${createdBefore}`);
        }
        if (filterField && filterValue !== undefined) {
          if (isColumnField(filterField)) {
            const col = columnFields[filterField].column;
            conditions.push(sql`${col}::text ILIKE ${filterValue}`);
          } else {
            conditions.push(
              sql`${blockVersions.properties}->>${filterField} ILIKE ${filterValue}`,
            );
          }
        }
        if (hasPublicationsFilter === true) {
          conditions.push(
            sql`EXISTS (
              SELECT 1
              FROM ${publications}
              WHERE ${publications.rootId} = ${roots.id}
            )`,
          );
        } else if (hasPublicationsFilter === false) {
          conditions.push(
            sql`NOT EXISTS (
              SELECT 1
              FROM ${publications}
              WHERE ${publications.rootId} = ${roots.id}
            )`,
          );
        }
        if (parentFilter !== undefined) {
          if (parentFilter === 'null' || parentFilter === '') {
            conditions.push(sql`${roots.parentRootId} IS NULL`);
          } else {
            conditions.push(eq(roots.parentRootId, parentFilter));
          }
        }

        const whereClause = and(...conditions)!;

        let orderExpr;
        if (!sortBy || isColumnField(sortBy)) {
          const alias = columnFields[sortBy ?? 'createdAt'].alias;
          orderExpr = sql.raw(alias);
        } else if (
          (def.root.properties as Record<string, { type?: string }>)[sortBy]
            ?.type === 'number'
        ) {
          // A numeric property must sort as a NUMBER, not as JSONB text
          // (where "10" < "9"). Number properties validate as `z.number()`, so
          // fresh data is always a JSON number or absent. Guard the cast against
          // any non-numeric text (a legacy row, a `string -> number` type change,
          // or data written outside the API): only cast values matching a numeric
          // pattern, otherwise sort them as NULL. A bare `::numeric` on "banana"
          // would raise `invalid input syntax for type numeric` and 500 the whole
          // list request.
          orderExpr = sql`CASE WHEN properties->>${sortBy} ~ '^-?[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?$' THEN (properties->>${sortBy})::numeric END`;
        } else {
          orderExpr = sql`properties->>${sortBy}`;
        }
        const dirExpr = sortDirection === 'asc' ? sql`ASC` : sql`DESC`;

        const enrich = userEnrichment(ctx, {
          cmsColumn: 'cms.roots.created_by',
          alias: 'root_user',
          outputKey: 'createdByUser',
        });

        const filteredRootsQuery = sql`
          SELECT
            ${roots.id} AS root_id,
            ${roots.createdAt} AS created_at,
            ${roots.createdBy} AS created_by,
            ${roots.parentRootId} AS parent_root_id,
            ${roots.slug} AS slug,
            ${roots.sortOrder} AS sort_order,
            ${blockVersions.properties} AS properties,
            COUNT(${publications.rootId})::int AS publication_count,
            (SELECT COUNT(*)::int FROM ${branches} AS b WHERE b.root_id = ${roots.id}) AS branch_count,
            (SELECT COUNT(*)::int FROM ${mergeRequests} AS mr WHERE mr.root_id = ${roots.id} AND mr.status = 'open') AS open_mr_count
            ${enrich.select}
          FROM ${roots}
          JOIN ${branches}
            ON ${branches.rootId} = ${roots.id}
           AND ${branches.name} = ${branchPolicy.defaultBranchName}
          JOIN ${commitSnapshots}
            ON ${commitSnapshots.commitId} = ${branches.headCommitId}
           AND ${commitSnapshots.blockId} = ${roots.id}
          JOIN ${blockVersions}
            ON ${blockVersions.id} = ${commitSnapshots.blockVersionId}
          LEFT JOIN ${publications}
            ON ${publications.rootId} = ${roots.id}
          ${enrich.join}
          WHERE ${whereClause}
          GROUP BY ${roots.id}, ${roots.createdAt}, ${roots.createdBy},
                   ${roots.parentRootId}, ${roots.slug}, ${roots.sortOrder},
                   ${blockVersions.properties}
                   ${enrich.groupBy}
        `;

        // Slim count: same filtering joins + WHERE as the main query, but drops
        // everything COUNT doesn't need — the two correlated COUNT subqueries,
        // the user-enrichment join, the LEFT JOIN publications (the publication
        // filters use self-contained EXISTS subqueries in whereClause, not the
        // join), and the GROUP BY. The roots→branches→commitSnapshots→
        // blockVersions joins are INNER and decide which roots match, so they
        // stay. COUNT(DISTINCT roots.id) mirrors the main query's GROUP BY on
        // roots.id, keeping the total equal to the distinct roots returned
        // pre-LIMIT even if the joins ever fan out to multiple rows per root.
        const countQuery = sql`
          SELECT COUNT(DISTINCT ${roots.id})::int AS count
          FROM ${roots}
          JOIN ${branches}
            ON ${branches.rootId} = ${roots.id}
           AND ${branches.name} = ${branchPolicy.defaultBranchName}
          JOIN ${commitSnapshots}
            ON ${commitSnapshots.commitId} = ${branches.headCommitId}
           AND ${commitSnapshots.blockId} = ${roots.id}
          JOIN ${blockVersions}
            ON ${blockVersions.id} = ${commitSnapshots.blockVersionId}
          WHERE ${whereClause}
        `;

        const mainQuery = sql`
          SELECT *
          FROM (${filteredRootsQuery}) AS filtered_roots
          ORDER BY ${orderExpr} ${dirExpr}
          LIMIT ${limit}
          OFFSET ${offset}
        `;

        const [countResult, result] = await Promise.all([
          db.execute(countQuery),
          db.execute(mainQuery),
        ]);

        const total = parseInt(
          (countResult.rows[0] as { count: string }).count,
          10,
        );

        // Raw-SQL row: the hand-selected column shape. Typing it lets the mapper
        // below be structurally checked against RootListItem rather than blindly
        // asserted. `properties` (JSON column) and the numeric/timestamp columns
        // stay wide — they are the coerced/dynamic leaves.
        const resultRows = result.rows as Array<{
          root_id: string;
          created_at: unknown;
          created_by: string | null;
          parent_root_id: string | null;
          slug: string | null;
          sort_order: number;
          properties: unknown;
          publication_count: unknown;
          branch_count: unknown;
          open_mr_count: unknown;
        }>;

        const rootRows = resultRows.map((row) => {
          const item: RootListItem<TDef['root']['properties']> = {
            id: row.root_id,
            createdAt: parseTimestamp(row.created_at),
            createdBy: row.created_by ?? undefined,
            parentRootId: row.parent_root_id ?? undefined,
            slug: row.slug ?? undefined,
            sortOrder: row.sort_order,
            // JSON column — the one genuinely-dynamic leaf. Strip the reserved
            // `__slug` draft key so it never leaks into list output;
            // this raw query bypasses the batchFetch helpers that strip elsewhere.
            properties: withRootSlug(
              (row.properties ?? {}) as Record<string, unknown>,
              null,
            ) as RootListItem<TDef['root']['properties']>['properties'],
            hasPublications: parseInt(String(row.publication_count), 10) > 0,
            publicationCount: parseInt(String(row.publication_count), 10),
            branchCount: parseInt(String(row.branch_count), 10),
            openMergeRequestCount: parseInt(String(row.open_mr_count), 10),
          };

          enrich.apply(item, row);

          return item;
        });

        // Full URL path per row: resolve each listed root's ancestor chain UP to
        // the top (an anchored recursive CTE — pagination-safe, unlike building
        // the path from only the loaded page), then apply the collection's slug
        // config. Parents are same-scope by construction, so no extra scope gate.
        const slugCfg = def.slug as ResolvedSlugConfig | undefined;
        if (slugCfg?.enabled && rootRows.length > 0) {
          const ids = rootRows.map((r) => r.id as string);
          const pathRes = await db.execute(sql`
            WITH RECURSIVE ancestry AS (
              SELECT ${roots.id} AS leaf_id, ${roots.id} AS id,
                     ${roots.parentRootId} AS parent_root_id,
                     ${roots.slug} AS slug, 0 AS depth
              FROM ${roots}
              WHERE ${inArray(roots.id, ids)}
              UNION ALL
              SELECT a.leaf_id, r.id, r.parent_root_id, r.slug, a.depth + 1
              FROM ${roots} r
              JOIN ancestry a ON r.id = a.parent_root_id
              WHERE r.collection = ${collectionName}
            )
            SELECT leaf_id, array_agg(slug ORDER BY depth DESC) AS segs
            FROM ancestry
            GROUP BY leaf_id
          `);
          const pathByRoot = new Map<string, string>();
          for (const row of pathRes.rows as Array<{
            leaf_id: string;
            segs: (string | null)[];
          }>) {
            const segs = (row.segs ?? []).filter((s): s is string =>
              Boolean(s),
            );
            pathByRoot.set(row.leaf_id, buildFullPath(slugCfg, segs));
          }
          for (const item of rootRows) {
            item.path = pathByRoot.get(item.id as string) ?? '/';
          }
        }

        const response: ListRootsResult<TDef['root']['properties']> = {
          roots: rootRows,
          total,
          hasMore: offset + rootRows.length < total,
        };
        return response;
      },
    ),

    /**
     * Duplicate an entire root: deep-copies the whole block tree into a NEW
     * top-level root (parent_root_id NULL). Thin wrapper over the shared
     * duplication path forced into root mode — `targetParentBlockId`/`targetIndex`
     * are omitted so `isRootDuplication` is always true and the return type is
     * static (no `mode` discriminant). For copying a subtree UNDER an existing
     * parent, use `duplicateBlock` instead.
     * @param rootId Source root id.
     * @param branchId Source branch id.
     * @param blockId Root block id to duplicate.
     * @param targetProperties Properties for the new root block (required).
     * @param targetSlug Optional slug for the new root (slug-enabled collections).
     * @param message Optional commit message; defaults to 'Duplicated root'.
     * @returns The new root: { commit, rootId, branchId, slug?, path? }.
     * @throws BLOCK_NOT_FOUND / BLOCK_ALREADY_DELETED / SLUG_ALREADY_EXISTS
     */
    duplicateRoot: createCMSEndpoint(
      `/${collectionName}/duplicateRoot`,
      {
        method: 'POST',
        body: z.object({
          rootId: z.string(),
          branchId: z.string(),
          blockId: z.string(),
          targetProperties: z.record(z.string(), z.unknown()),
          targetSlug: z.string().optional(),
          message: z.string().optional(),
        }),
        metadata: cmsMeta(
          {
            $Infer: {
              body: {} as {
                rootId: string;
                branchId: string;
                blockId: string;
                targetProperties: Record<string, unknown>;
                targetSlug?: string;
                message?: string;
              },
            },
          },
          {
            // Mints a NEW top-level root (forced root mode below) — the same
            // privileged act `createRoot` guards as 'root'. Was 'block',
            // which let a consumer granting block:create while denying
            // root:create bypass the deny via duplication.
            permissionResource: 'root',
            operation: 'create',
            scope: 'collection',
            collection: collectionName,
          },
        ),
      },
      async (ctx) => {
        const res = await db.transaction((tx) =>
          runDuplicate(tx, ctx.context.scope, ctx.context.userId, {
            ...ctx.body,
            // Force root mode: no parent → `isRootDuplication` is always true.
            targetParentBlockId: undefined,
          }),
        );
        // `res` is statically the root branch; narrow away the `child` union arm
        // so `duplicateRoot` exposes a non-union return type.
        return res as Extract<typeof res, { mode: 'root' }>;
      },
    ),

    /**
     * Update root properties and/or slug; auto-creates redirects if slug changes.
     * For slug changes, validates uniqueness, captures old subtree paths, then creates redirects.
     * @param rootId Root id.
     * @param branchId Branch id.
     * @param properties Root properties to merge (null values delete keys).
     * @param slug New slug (if slug is enabled in collection); validated and auto-redirected.
     * @param message Optional commit message; defaults to 'Update root block {rootId}'.
     * @returns New commit id.
     * @throws BLOCK_NOT_FOUND when root block does not exist.
     * @throws BLOCK_ALREADY_DELETED when root is marked deleted.
     * @throws TYPE_MISMATCH when root type does not match collection name.
     * @throws SLUG_EMPTY_NOT_ALLOWED when slug required but empty.
     * @throws BRANCH_NOT_FOUND when branch does not exist.
     * @example
     * const result = await cmsClient.pages.updateRoot({
     *   rootId: 'root_123',
     *   branchId: 'br_main',
     *   properties: { title: 'Updated Title' },
     *   slug: 'updated-slug'
     * });
     */
    updateRoot: createCMSEndpoint(
      `/${collectionName}/updateRoot`,
      {
        method: 'POST',
        body: buildUpdateRootInputSchema<TDef['root']['properties']>(
          def.root.properties,
        ),
        metadata: cmsMeta(
          {
            $Infer: {
              body: {} as UpdateRootInput<TDef['root']['properties']>,
            },
          },
          {
            permissionResource: 'root',
            operation: 'update',
            scope: 'collection',
            collection: collectionName,
          },
        ),
      },
      async (ctx) => {
        const { userId } = ctx.context;
        const {
          rootId,
          branchId,
          properties,
          slug: newSlug,
          message,
        } = ctx.body;
        const blockId = rootId;
        const slugCfg = def.slug as ResolvedSlugConfig | undefined;

        // The slug is VERSIONED — a slug edit is folded into the root
        // version's reserved `__slug` property and committed to THIS branch, so
        // it no longer touches roots.slug (the live URL) until publish. Redirects
        // and uniqueness therefore move to the publish path; here we keep only
        // the cheap empty/format check. Clearing the slug (empty, allowIndex) sends
        // `__slug: null`, which the merge-patch deletes.
        let patch = properties as Record<string, unknown> | undefined;
        if (slugCfg?.enabled && newSlug !== undefined) {
          const normalized = slugCfg.normalize
            ? normalizeSlug(newSlug)
            : newSlug;
          if (!normalized && !slugCfg.allowIndex) {
            throw new CMSError('SLUG_EMPTY_NOT_ALLOWED');
          }
          patch = {
            ...patch,
            [ROOT_SLUG_PROP]: normalized === '' ? null : normalized,
          };
        }

        return db.transaction(async (tx) => {
          const { commit } = await patchSingleVersion(
            tx,
            ctx.context.scope,
            userId,
            {
              rootId,
              branchId,
              blockId,
              properties: patch,
              message,
              fallbackMessage: `Update root block ${blockId}`,
              // Optional optimistic-concurrency head precondition (see
              // updateBlock). Field added to the update-root body schema by the
              // schema-builders; read defensively.
              expectedHeadCommitId: (
                ctx.body as { expectedHeadCommitId?: string }
              ).expectedHeadCommitId,
              verifyType: (storedType) => {
                if (storedType !== collectionName)
                  throw new CMSError('TYPE_MISMATCH', {
                    message: errorMessages.typeMismatch(
                      collectionName,
                      storedType,
                    ),
                    data: { expected: collectionName, actual: storedType },
                  });
              },
            },
          );

          // Read the committed DRAFT slug back from the new head root version, so
          // the client learns the server-normalized value without a refetch. This
          // is the per-branch draft slug — NOT the live roots.slug, which only
          // changes on publish.
          let draftSlug: string | undefined;
          if (slugCfg?.enabled) {
            const [rv] = await tx
              .select({ properties: blockVersions.properties })
              .from(commitSnapshots)
              .innerJoin(
                blockVersions,
                eq(blockVersions.id, commitSnapshots.blockVersionId),
              )
              .where(
                and(
                  eq(commitSnapshots.commitId, commit.id),
                  eq(commitSnapshots.blockId, rootId),
                ),
              );
            draftSlug = rv
              ? (readRootSlug(rv.properties as Record<string, unknown>) ??
                undefined)
              : undefined;
          }

          return {
            commit,
            slug: draftSlug,
          };
        });
      },
    ),

    /**
     * Reparent a root to a new parent (or set to top-level); auto-creates redirects if parent changes.
     * Nesting must be enabled in collection definition; circular references are rejected.
     * @param rootId Root id to move.
     * @param newParentRootId New parent root id (or null for top-level).
     * @param position Sort order in parent's children (optional).
     * @returns Root id and new parent root id.
     * @throws NESTING_NOT_ENABLED when nesting is disabled in collection definition.
     * @throws ROOT_NOT_FOUND when rootId does not exist.
     * @throws PARENT_ROOT_NOT_FOUND when newParentRootId does not exist.
     * @throws CIRCULAR_REFERENCE when newParentRootId is a descendant of rootId.
     */
    moveRoot: createCMSEndpoint(
      `/${collectionName}/moveRoot`,
      {
        method: 'POST',
        body: z.object({
          rootId: z.string(),
          newParentRootId: z.string().nullable(),
          position: z.number().optional(),
        }),
        metadata: cmsMeta(
          {
            $Infer: {
              body: {} as {
                rootId: string;
                newParentRootId: string | null;
                position?: number;
              },
            },
          },
          {
            permissionResource: 'root',
            operation: 'update',
            scope: 'collection',
            collection: collectionName,
          },
        ),
      },
      async (ctx) => {
        const slugCfg = def.slug as ResolvedSlugConfig | undefined;
        if (!slugCfg?.enabled || !slugCfg.nested) {
          throw new CMSError('NESTING_NOT_ENABLED');
        }

        const { rootId, newParentRootId, position } = ctx.body;

        return db.transaction(async (tx) => {
          const [root] = await tx
            .select({
              id: roots.id,
              slug: roots.slug,
              parentRootId: roots.parentRootId,
            })
            .from(roots)
            .where(
              and(
                eq(roots.id, rootId),
                eq(roots.collection, collectionName),
                ctx.context.scope.roots?.where,
              ),
            )
            .for('update');
          if (!root) throw new CMSError('ROOT_NOT_FOUND');

          if (newParentRootId !== null) {
            const [parent] = await tx
              .select({ id: roots.id })
              .from(roots)
              .where(
                and(
                  eq(roots.id, newParentRootId),
                  eq(roots.collection, collectionName),
                  ctx.context.scope.roots?.where,
                ),
              );
            if (!parent) throw new CMSError('PARENT_ROOT_NOT_FOUND');

            if (await isAncestorOf(tx, newParentRootId, rootId)) {
              throw new CMSError('CIRCULAR_REFERENCE');
            }
          }

          if (root.slug) {
            await validateSlugUniqueness(
              tx,
              collectionName,
              newParentRootId,
              root.slug,
              rootId,
              ctx.context.scope.roots?.insertColumns,
            );
          }

          // Only an ACTUAL reparent shifts URLs — a same-parent sort reorder
          // does not. Capture the moving subtree's OLD paths before the reparent,
          // then auto-create redirects (every descendant's URL shifts too).
          const reparented = newParentRootId !== root.parentRootId;
          const captured = reparented
            ? await captureSubtreePaths(tx, slugCfg, rootId)
            : [];

          const effectiveSortOrder = position ?? 0;
          await tx
            .update(roots)
            .set({
              parentRootId: newParentRootId,
              sortOrder: effectiveSortOrder,
            })
            .where(eq(roots.id, rootId));

          let redirectsCreated = 0;
          if (reparented) {
            redirectsCreated = await recordSubtreeRedirects(
              tx,
              collectionName,
              captured,
              ctx.context.scope.redirects,
            );
          }

          const path = slugCfg?.enabled
            ? ((await resolveRootCurrentPath(
                tx,
                slugCfg,
                rootId,
                ctx.context.scope.roots,
              )) ?? undefined)
            : undefined;

          return {
            rootId,
            newParentRootId,
            path,
            sortOrder: effectiveSortOrder,
            redirectsCreated,
          };
        });
      },
    ),

    /**
     * Fetch a single root with its current properties, metadata, and publication info.
     * @param rootId Root id.
     * @returns Root summary including properties, createdAt, createdBy, slug, publication count, etc.
     * @throws ROOT_NOT_FOUND when root does not exist.
     * @example
     * const root = await cmsClient.pages.getRoot({
     *   rootId: 'root_123'
     * });
     *
     * @remarks Draft reads are intentionally split by handle: `getRoot` (by id)
     * and `getRootBySlug` (by slug/parent). This differs from
     * `getPublishedContent`, which multiplexes rootId|slug|path behind one public
     * content-delivery entrypoint. Draft callers already know which handle they
     * hold, so two narrow endpoints give sharper types/errors; `path` resolution
     * is a published-content concern and is deliberately absent here.
     */
    getRoot: createCMSEndpoint(
      `/${collectionName}/getRoot`,
      {
        method: 'GET',
        query: z.object({ rootId: z.string() }),
        metadata: cmsMeta(
          {
            $Infer: {
              query: {} as { rootId: string },
            },
          },
          {
            permissionResource: 'root',
            operation: 'read',
            scope: 'collection',
            collection: collectionName,
          },
        ),
      },
      async (ctx) => {
        const { rootId } = ctx.query;

        await requireRootInScope(
          db,
          rootId,
          collectionName,
          ctx.context.scope.roots,
        );

        const map = await batchFetchRootListItems(db, [rootId], {
          collectionName,
          defaultBranchName: branchPolicy.defaultBranchName,
          slugConfig: def.slug as ResolvedSlugConfig | undefined,
        });
        const root = map.get(rootId);
        if (!root) throw new CMSError('ROOT_NOT_FOUND');

        return root as unknown as RootListItem<TDef['root']['properties']>;
      },
    ),

    /**
     * Lookup a root by its DRAFT slug (and optional parent); returns root summary
     * if unique. This is a DRAFT read (companion to `getRoot` by id): the
     * slug is versioned, so it matches the per-branch `__slug` stored on the
     * default branch's head root version — NOT the published `roots.slug` (which
     * `getPublishedContent` resolves). An unpublished page is therefore findable by
     * the slug the editor is about to publish. Slugs are normalized if
     * normalization is enabled in the collection definition.
     * @param slug Draft slug to search for.
     * @param parentRootId Parent id for nested lookup (omit for top-level roots).
     * @returns Root summary (same fields as getRoot).
     * @throws SLUG_NOT_ENABLED when slug feature is disabled in collection definition.
     * @throws ROOT_NOT_FOUND when no root matches the slug.
     * @throws AMBIGUOUS_SLUG when multiple roots match (drafts may collide).
     */
    getRootBySlug: createCMSEndpoint(
      `/${collectionName}/getRootBySlug`,
      {
        method: 'GET',
        query: z.object({
          slug: z.string(),
          parentRootId: z.string().optional(),
        }),
        metadata: cmsMeta(
          {
            $Infer: {
              query: {} as { slug: string; parentRootId?: string },
            },
          },
          {
            permissionResource: 'root',
            operation: 'read',
            scope: 'collection',
            collection: collectionName,
          },
        ),
      },
      async (ctx) => {
        const slugCfg = def.slug as ResolvedSlugConfig | undefined;
        if (!slugCfg?.enabled) throw new CMSError('SLUG_NOT_ENABLED');

        const lookupSlug = slugCfg.normalize
          ? normalizeSlug(ctx.query.slug)
          : ctx.query.slug;
        const parent = ctx.query.parentRootId ?? null;

        // Match the DRAFT slug on the default branch's head root version
        // (block_versions.properties->>'__slug'). `roots` is left un-aliased so
        // an active scope `where` (which references "cms"."roots") still binds.
        const parentCond =
          parent === null
            ? sql`cms.roots.parent_root_id IS NULL`
            : sql`cms.roots.parent_root_id = ${parent}`;
        const scopeCond = ctx.context.scope.roots?.where
          ? sql`AND ${ctx.context.scope.roots.where}`
          : sql``;
        const matchResult = await db.execute(sql`
          SELECT cms.roots.id
          FROM cms.roots
          JOIN cms.branches b
            ON b.root_id = cms.roots.id
           AND b.name = ${branchPolicy.defaultBranchName}
          JOIN cms.commit_snapshots cs
            ON cs.commit_id = b.head_commit_id
           AND cs.block_id = cms.roots.id
          JOIN cms.block_versions bv
            ON bv.id = cs.block_version_id
          WHERE cms.roots.collection = ${collectionName}
            AND cms.roots.archived_at IS NULL
            AND (bv.properties->>${ROOT_SLUG_PROP}) = ${lookupSlug}
            AND ${parentCond}
            ${scopeCond}
        `);
        const matches = matchResult.rows as Array<{ id: string }>;

        if (matches.length === 0) throw new CMSError('ROOT_NOT_FOUND');
        if (matches.length > 1) throw new CMSError('AMBIGUOUS_SLUG');

        const rootId = matches[0].id;
        const map = await batchFetchRootListItems(db, [rootId], {
          collectionName,
          defaultBranchName: branchPolicy.defaultBranchName,
          slugConfig: def.slug as ResolvedSlugConfig | undefined,
        });
        const root = map.get(rootId);
        if (!root) throw new CMSError('ROOT_NOT_FOUND');

        return root as unknown as RootListItem<TDef['root']['properties']>;
      },
    ),

    /**
     * Soft-archive a root (history preserved); auto-creates redirect from old path to parent.
     * Rejects deletion if root has active child pages or is embedded as a reusable block.
     * @param rootId Root id.
     * @returns Root id.
     * @throws ROOT_NOT_FOUND when root does not exist or is already archived.
     * @throws ROOT_HAS_CHILDREN when root has unarchived child pages.
     * @throws ROOT_IN_USE when root is embedded as a reusable block on live pages.
     * @example
     * const result = await cmsClient.pages.archiveRoot({
     *   rootId: 'root_123'
     * });
     */
    archiveRoot: createCMSEndpoint(
      `/${collectionName}/archiveRoot`,
      {
        method: 'POST',
        body: z.object({ rootId: z.string() }),
        metadata: cmsMeta(
          {
            $Infer: {
              body: {} as { rootId: string },
            },
          },
          {
            permissionResource: 'root',
            operation: 'delete',
            scope: 'collection',
            collection: collectionName,
          },
        ),
      },
      async (ctx) => {
        const { rootId } = ctx.body;

        return db.transaction(async (tx) => {
          // Scoped + locked existence check. Archived roots are already "gone",
          // so re-deleting one 404s (excluded via archivedAt IS NULL).
          const [root] = await tx
            .select({ id: roots.id })
            .from(roots)
            .where(
              and(
                eq(roots.id, rootId),
                eq(roots.collection, collectionName),
                isNull(roots.archivedAt),
                ctx.context.scope.roots?.where,
              ),
            )
            .for('update');
          if (!root) throw new CMSError('ROOT_NOT_FOUND');

          // Refuse to archive a page that still has live child pages — archiving
          // a parent must never orphan or hide its children (nesting + SEO).
          const [child] = await tx
            .select({ id: roots.id })
            .from(roots)
            .where(
              and(eq(roots.parentRootId, rootId), isNull(roots.archivedAt)),
            )
            .limit(1);
          if (child) throw new CMSError('ROOT_HAS_CHILDREN');

          // Refuse to archive a root that is the DIRECTLY-referenced ANCHOR of any
          // live reference (a reusable block embedded on a live page) — archiving
          // it would make the block VANISH from those pages. ANCHOR-only: a
          // translation SIBLING reached only via read-time auto-upgrade is
          // NOT protected here, so removing a translation degrades hosts gracefully
          // to the stored anchor rather than being blocked. This protects EVERY
          // referenced root regardless of the `reusableBlock` flag (the flag is
          // ergonomics only, never a safety gate).
          if (
            await isReferencedByLiveContent(
              tx,
              rootId,
              crossScopeColumns(ctx.context.scope.roots),
            )
          ) {
            throw new CMSError('ROOT_IN_USE');
          }

          // Capture the old path + parent BEFORE archiving so the gone URL can
          // redirect to the parent page.
          const slugCfg = def.slug as ResolvedSlugConfig | undefined;
          let oldPath: string | null = null;
          let parentRootId: string | null = null;
          if (slugCfg?.enabled) {
            const [r] = await tx
              .select({ parentRootId: roots.parentRootId })
              .from(roots)
              .where(eq(roots.id, rootId));
            parentRootId = r?.parentRootId ?? null;
            oldPath = await resolveRootCurrentPath(tx, slugCfg, rootId);
          }

          // Soft-archive: history (branches/commits/blockVersions) is preserved;
          // physical removal is the pruning layer's job.
          await tx
            .update(roots)
            .set({ archivedAt: new Date() })
            .where(eq(roots.id, rootId));

          const redirectsCreated = await recordArchiveRedirect(
            tx,
            collectionName,
            oldPath,
            parentRootId,
            ctx.context.scope.redirects,
          );

          // `path` is the now-archived URL (for a "removed /x" confirmation);
          // `redirectsCreated` is 1 when an archive redirect was written.
          return {
            rootId,
            path: oldPath ?? undefined,
            redirectsCreated,
          };
        });
      },
    ),

    /**
     * Fetch commit history for a root across all branches, ordered by creation time descending.
     * Returns commit details including message, author, branch, parents, and publish status.
     * @param rootId Root id.
     * @param limit Max commits to return (default 50, max 200).
     * @param offset Offset for pagination (default 0).
     * @param withChanges When true, each returned commit gains a `changes` field
     *   with `{ added, modified, deleted }` block counts — a cheap ID-level
     *   set-diff between the commit's snapshot and its parent commit's snapshot
     *   (no block properties are loaded). Counts are VERSION-level: any block
     *   whose stored version changed is counted, so a pure move counts as
     *   `modified` on the parent whose children array changed — coarser than
     *   getDiff's classification, intended for history badges. Initial commits
     *   count every live block as added. Merge commits diff against their FIRST
     *   parent only (parent_commit_id — the target-side parent), so the counts
     *   read as "what this merge landed on the target branch". Merge and revert
     *   snapshots drop deletion-landed blocks entirely instead of carrying
     *   tombstones; such absence-based deletions count as `deleted` all the
     *   same (and a revert that restores a dropped block counts it as `added`).
     *   Commits without a snapshot — or whose parent's snapshot is gone (admin
     *   pruning) — omit
     *   `changes` entirely rather than reporting a meaningless diff; in practice
     *   every commit writer (writeCommit, createInitialCommit, executeMerge,
     *   revertBranch) writes a full snapshot, so this only guards repaired or
     *   pruned histories.
     * @returns Array of commit records with total count, offset, and limit.
     * @throws ROOT_NOT_FOUND when rootId does not exist.
     * @example
     * const history = await cmsClient.pages.getRootHistory({
     *   rootId: 'root_123',
     *   limit: 20,
     *   offset: 0
     * });
     */
    getRootHistory: createCMSEndpoint(
      `/${collectionName}/getRootHistory`,
      {
        method: 'GET',
        query: z.object({
          rootId: z.string(),
          limit: z.coerce.number().min(1).max(200).optional(),
          offset: z.coerce.number().min(0).optional(),
          withChanges: wireBooleanSchema.optional(),
        }),
        metadata: cmsMeta(
          {
            $Infer: {
              query: {} as {
                rootId: string;
                limit?: number;
                offset?: number;
                withChanges?: boolean;
              },
            },
          },
          {
            permissionResource: 'root',
            operation: 'read',
            scope: 'collection',
            collection: collectionName,
          },
        ),
      },
      async (ctx) => {
        const { rootId } = ctx.query;
        const limit = ctx.query.limit ?? 50;
        const offset = ctx.query.offset ?? 0;
        const withChanges = wireBooleanIsTrue(ctx.query.withChanges);

        await requireRootInScope(
          db,
          rootId,
          collectionName,
          ctx.context.scope.roots,
        );

        const enrich = userEnrichment(ctx, {
          cmsColumn: 'c.created_by',
          alias: 'commit_user',
          outputKey: 'createdByUser',
        });

        // Branch attribution is STORED on each commit (commits.branch_id /
        // origin_branch_name), set at write time — deterministic, no heuristic.
        // Join the live branch for its current name (follows renames) and fall
        // back to the deletion-proof snapshot if the branch was removed.
        // Total from a separate count (not a per-row CROSS JOIN), so it stays
        // correct — and `hasMore` with it — even when a page past the end returns
        // zero rows.
        const [countResult, result] = await Promise.all([
          db.execute(sql`
            SELECT COUNT(*)::int AS cnt FROM cms.commits WHERE root_id = ${rootId}
          `),
          db.execute(sql`
            SELECT
              c.id,
              c.parent_commit_id,
              c.merge_source_commit_id,
              c.message,
              c.created_by,
              c.created_at,
              EXISTS (SELECT 1 FROM cms.publications p WHERE p.commit_id = c.id) AS is_published,
              COALESCE(b.name, c.origin_branch_name) AS branch_name
              ${enrich.select}
            FROM cms.commits c
            LEFT JOIN cms.branches b ON b.id = c.branch_id
            ${enrich.join}
            WHERE c.root_id = ${rootId}
            GROUP BY c.id, c.parent_commit_id, c.merge_source_commit_id,
                     c.message, c.created_by, c.created_at,
                     b.name, c.origin_branch_name
                     ${enrich.groupBy}
            ORDER BY c.created_at DESC
            LIMIT ${limit} OFFSET ${offset}
          `),
        ]);

        const rows = result.rows as Array<Record<string, unknown>>;
        const total = (countResult.rows[0] as { cnt: number })?.cnt ?? 0;

        // withChanges (opt-in): version-level change counts per commit, computed
        // as an ID-level set-diff between each commit's snapshot and its parent
        // commit's snapshot — ONE query for the whole page, no block properties
        // loaded. Snapshots are complete per-commit maps, but the two sides are
        // NOT id-subsets of each other: writeCommit copies tombstones forward,
        // yet merge snapshots EXCLUDE one-side-deleted blocks entirely
        // (buildMergedSnapshot and the fast-forward path filter tombstones) and
        // revert snapshots are exactly the target commit's map — so a block
        // live in the parent can be simply ABSENT from the child. A per-pair
        // FULL OUTER JOIN between the two snapshots (LATERAL, because the
        // pairs CTE itself cannot be full-outer-joined) sees both sides.
        // Per block id, child version C vs parent version P:
        //   same version id            → unchanged, not counted
        //   no P row, C live           → added (initial commits hit this for
        //                                 every live block; only-in-C tombstones
        //                                 are not counted)
        //   C live,    P tombstone     → added (re-created block id)
        //   C live,    P live          → modified
        //   C tombstone, P live        → deleted
        //   no C row,  P live          → deleted (merge/revert dropped the id)
        //   C tombstone, P tombstone   → not counted (nor "no C row, P
        //                                 tombstone" — already deleted)
        // Merge commits diff against parent_commit_id only (the target-side
        // parent) — see the endpoint JSDoc.
        const changesByCommit = new Map<
          string,
          { added: number; modified: number; deleted: number }
        >();
        if (withChanges && rows.length > 0) {
          const pairs = sql.join(
            rows.map(
              (r) =>
                sql`(${r.id as string}::text, ${(r.parent_commit_id as string | null) ?? null}::text)`,
            ),
            sql`, `,
          );
          const changesResult = await db.execute(sql`
            WITH pairs(child_id, parent_id) AS (VALUES ${pairs})
            SELECT
              p.child_id,
              -- A side whose snapshot is gone (pruned/repaired history) would
              -- make every surviving row count as "added" (parent gone) or
              -- "deleted" (child gone); flag both so the entry omits
              -- \`changes\` instead of reporting a meaningless diff. A pair
              -- where NEITHER side has snapshot rows yields no lateral rows,
              -- so it produces no group and is omitted the same way.
              (p.parent_id IS NOT NULL AND NOT EXISTS (
                SELECT 1 FROM cms.commit_snapshots ps WHERE ps.commit_id = p.parent_id
              )) AS parent_snapshot_missing,
              NOT EXISTS (
                SELECT 1 FROM cms.commit_snapshots cs WHERE cs.commit_id = p.child_id
              ) AS child_snapshot_missing,
              COUNT(*) FILTER (WHERE
                d.c_version_id IS NOT NULL AND NOT bv_c.deleted
                AND (d.p_version_id IS NULL
                     OR (d.p_version_id <> d.c_version_id AND bv_p.deleted))
              )::int AS added,
              COUNT(*) FILTER (WHERE
                d.c_version_id IS NOT NULL AND d.p_version_id IS NOT NULL
                AND d.p_version_id <> d.c_version_id
                AND NOT bv_c.deleted AND NOT bv_p.deleted
              )::int AS modified,
              COUNT(*) FILTER (WHERE
                d.p_version_id IS NOT NULL AND NOT bv_p.deleted
                AND (d.c_version_id IS NULL
                     OR (d.p_version_id <> d.c_version_id AND bv_c.deleted))
              )::int AS deleted
            FROM pairs p
            CROSS JOIN LATERAL (
              SELECT
                cs_c.block_version_id AS c_version_id,
                cs_p.block_version_id AS p_version_id
              FROM (SELECT block_id, block_version_id FROM cms.commit_snapshots
                    WHERE commit_id = p.child_id) cs_c
              FULL OUTER JOIN
                   (SELECT block_id, block_version_id FROM cms.commit_snapshots
                    WHERE commit_id = p.parent_id) cs_p
                ON cs_p.block_id = cs_c.block_id
            ) d
            LEFT JOIN cms.block_versions bv_c ON bv_c.id = d.c_version_id
            LEFT JOIN cms.block_versions bv_p ON bv_p.id = d.p_version_id
            GROUP BY p.child_id, p.parent_id
          `);
          for (const row of changesResult.rows as Array<{
            child_id: string;
            parent_snapshot_missing: boolean;
            child_snapshot_missing: boolean;
            added: number;
            modified: number;
            deleted: number;
          }>) {
            if (row.parent_snapshot_missing || row.child_snapshot_missing) {
              continue;
            }
            changesByCommit.set(row.child_id, {
              added: row.added,
              modified: row.modified,
              deleted: row.deleted,
            });
          }
        }

        const data = rows.map((r) => {
          const parents: string[] = [];
          if (r.parent_commit_id) parents.push(r.parent_commit_id as string);
          if (r.merge_source_commit_id)
            parents.push(r.merge_source_commit_id as string);

          const type: 'commit' | 'merge' | 'initial' = r.merge_source_commit_id
            ? 'merge'
            : !r.parent_commit_id
              ? 'initial'
              : 'commit';

          // Intersection keeps the enrichment keys open (enrich.apply writes
          // dynamic columns) while still typing `changes` for callers.
          const item: Record<string, unknown> & {
            changes?: { added: number; modified: number; deleted: number };
          } = {
            id: r.id,
            message: r.message,
            createdBy: r.created_by,
            // A Date, like every other list endpoint (listRoots, listBranches,
            // comments, approvals) — not an ISO string.
            createdAt: parseTimestamp(r.created_at),
            branch: r.branch_name as string,
            parents,
            type,
            isPublished: r.is_published,
          };

          // Empty map unless withChanges — entries without a computable diff
          // (missing snapshots) omit the field entirely.
          const changes = changesByCommit.get(r.id as string);
          if (changes) item.changes = changes;

          enrich.apply(item, r);

          return item;
        });

        return {
          commits: data,
          total,
          hasMore: offset + data.length < total,
        };
      },
    ),
  };
}
