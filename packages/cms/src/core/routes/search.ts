import { sql } from 'drizzle-orm';
import * as z from 'zod';

import type { CMSProcedureContext } from '../types';

import {
  assets,
  roots,
  searchIndex,
  templates,
  variables,
} from '../db/schema.generated';
import { cmsMeta, createCMSEndpoint } from '../endpoint';

const SEARCH_META = {
  scope: 'system' as const,
  permissionResource: 'search' as const,
};

const ENTITY_TYPES = [
  'root',
  'comment',
  'mergeRequest',
  'variable',
  'template',
  'asset',
  'notification',
] as const;

export function createSearchEndpoints(cmsCtx: CMSProcedureContext) {
  const { db } = cmsCtx;

  return {
    /**
     * Search across all indexed entities using full-text search.
     * Returns paginated results ranked by relevance, with optional filtering by entity type, collection, or root.
     *
     * @param search The search query string.
     * @param entityTypes Optional array of entity types to filter by (root, comment, mergeRequest, variable, template, asset, notification).
     * @param collection Optional collection name to limit results to a specific collection.
     * @param rootId Optional root id to limit results to a specific root.
     * @param limit Maximum number of results per page (default 20, max 100).
     * @param offset Number of results to skip for pagination (default 0).
     * @returns An object containing the search results array, total count of all matches, and a hasMore flag indicating if additional results exist beyond the current page.
     *
     * @example
     * const { results, total, hasMore } = await cmsClient.search.query({
     *   search: 'homepage',
     *   entityTypes: ['root', 'variable'],
     *   limit: 10,
     *   offset: 0,
     * });
     */
    query: createCMSEndpoint(
      '/search/query',
      {
        method: 'GET',
        query: z.object({
          search: z.string().min(1),
          entityTypes: z
            .union([
              z.array(z.enum(ENTITY_TYPES)),
              z
                .string()
                .transform(
                  (val) =>
                    val.split(',').filter(Boolean) as Array<
                      (typeof ENTITY_TYPES)[number]
                    >,
                ),
            ])
            .optional(),
          collection: z.string().optional(),
          rootId: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(100).default(20),
          offset: z.coerce.number().int().min(0).default(0),
        }),
        metadata: cmsMeta(
          {
            $Infer: {
              query: {} as {
                search: string;
                entityTypes?: Array<(typeof ENTITY_TYPES)[number]>;
                collection?: string;
                rootId?: string;
                limit?: number;
                offset?: number;
              },
            },
          },
          { operation: 'read', ...SEARCH_META },
        ),
      },
      async (ctx) => {
        const query = ctx.query ?? ({} as Record<string, unknown>);
        const q = (query as { search: string }).search;
        const entityTypes = (query as { entityTypes?: string[] }).entityTypes;
        const collection = (query as { collection?: string }).collection;
        const rootId = (query as { rootId?: string }).rootId;
        const limit = (query as { limit?: number }).limit ?? 20;
        const offset = (query as { offset?: number }).offset ?? 0;

        const conditions = [
          sql`${searchIndex.contentVector} @@ websearch_to_tsquery('simple', ${q})`,
        ];

        if (entityTypes && entityTypes.length > 0) {
          conditions.push(sql`${searchIndex.entityType} = ANY(${entityTypes})`);
        }

        if (collection) {
          conditions.push(sql`${searchIndex.collection} = ${collection}`);
        }

        if (rootId) {
          conditions.push(sql`${searchIndex.rootId} = ${rootId}`);
        }

        // ------------------------------------------------------------------
        // SECURITY (cms-08): the search index is a SHARED, cross-entity table,
        // so it must honour the SAME read boundary as the normal endpoints —
        // otherwise a multi-tenant tenant could find another tenant's content
        // and a user could read another user's notifications, purely via
        // full-text search.
        //
        // We do NOT store scope columns on `search_index` itself. Instead a row
        // is visible only if its UNDERLYING entity is visible under the active
        // plugin scope: we re-apply each `scope.<table>.where` predicate (the
        // exact same SQL the normal reads use) via a correlated EXISTS against
        // that entity's source table. When no scoping plugin is active every
        // `scope.*.where` is absent, so no guard is added and behaviour is
        // unchanged.
        // ------------------------------------------------------------------
        const scope = ctx.context.scope;
        const userId = ctx.context.userId;

        // (c) Notifications are per-recipient: never surface another user's
        // notifications. A row of entityType 'notification' is visible only to
        // its recipient (recorded in `meta.recipientId` at index time). With no
        // authenticated user, notifications are hidden entirely.
        conditions.push(
          userId
            ? sql`(${searchIndex.entityType} <> 'notification' OR ${searchIndex.meta} ->> 'recipientId' = ${userId})`
            : sql`${searchIndex.entityType} <> 'notification'`,
        );

        // (a)+(b) Content scope. root/comment/mergeRequest anchor to a `roots`
        // row (root via entityId, comment/mergeRequest via rootId); variable /
        // template / asset anchor to their own scoped table via entityId. Each
        // guard only restricts its own entity types and is a no-op for the rest.
        const rootsWhere = scope.roots?.where;
        if (rootsWhere) {
          conditions.push(sql`(
            ${searchIndex.entityType} NOT IN ('root', 'comment', 'mergeRequest')
            OR (${searchIndex.entityType} = 'root' AND EXISTS (
              SELECT 1 FROM ${roots}
              WHERE ${roots.id} = ${searchIndex.entityId} AND (${rootsWhere})
            ))
            OR (${searchIndex.entityType} IN ('comment', 'mergeRequest')
                AND ${searchIndex.rootId} IS NOT NULL
                AND EXISTS (
                  SELECT 1 FROM ${roots}
                  WHERE ${roots.id} = ${searchIndex.rootId} AND (${rootsWhere})
                ))
          )`);
        }

        const variablesWhere = scope.variables?.where;
        if (variablesWhere) {
          conditions.push(sql`(
            ${searchIndex.entityType} <> 'variable'
            OR EXISTS (
              SELECT 1 FROM ${variables}
              WHERE ${variables.id} = ${searchIndex.entityId} AND (${variablesWhere})
            )
          )`);
        }

        const templatesWhere = scope.templates?.where;
        if (templatesWhere) {
          conditions.push(sql`(
            ${searchIndex.entityType} <> 'template'
            OR EXISTS (
              SELECT 1 FROM ${templates}
              WHERE ${templates.id} = ${searchIndex.entityId} AND (${templatesWhere})
            )
          )`);
        }

        const assetsWhere = scope.assets?.where;
        if (assetsWhere) {
          conditions.push(sql`(
            ${searchIndex.entityType} <> 'asset'
            OR EXISTS (
              SELECT 1 FROM ${assets}
              WHERE ${assets.id} = ${searchIndex.entityId} AND (${assetsWhere})
            )
          )`);
        }

        // Defense in depth: the guards above cover every entityType this package
        // indexes, each keyed off the SAME `scope.*.where` its normal reads use.
        // But if a scoping plugin is active and a FUTURE (or plugin-added)
        // entityType were indexed without a matching guard here, it would leak
        // across scope. So when any scope is active, restrict results to the known
        // guarded set — an unrecognised entityType fails CLOSED until its guard is
        // added. With no scoping plugin (all `scope.*.where` absent) nothing is
        // restricted and behaviour is unchanged.
        if (rootsWhere || variablesWhere || templatesWhere || assetsWhere) {
          conditions.push(
            sql`${searchIndex.entityType} IN ('root', 'comment', 'mergeRequest', 'variable', 'template', 'asset', 'notification')`,
          );
        }

        const whereClause = sql.join(conditions, sql` AND `);

        const tsQuery = sql`websearch_to_tsquery('simple', ${q})`;

        const [countResult, dataResult] = await Promise.all([
          db.execute(sql`
            SELECT COUNT(*)::int AS count
            FROM ${searchIndex}
            WHERE ${whereClause}
          `),
          db.execute(sql`
            SELECT
              ${searchIndex.entityType} AS entity_type,
              ${searchIndex.entityId} AS entity_id,
              ${searchIndex.collection} AS collection,
              ${searchIndex.rootId} AS root_id,
              ${searchIndex.title} AS title,
              ${searchIndex.snippet} AS snippet,
              ${searchIndex.meta} AS meta,
              ts_rank(${searchIndex.contentVector}, ${tsQuery}) AS rank,
              ts_headline(
                'simple',
                COALESCE(${searchIndex.snippet}, ''),
                ${tsQuery},
                'StartSel=<mark>, StopSel=</mark>, MaxWords=35, MinWords=15'
              ) AS highlight
            FROM ${searchIndex}
            WHERE ${whereClause}
            ORDER BY rank DESC
            LIMIT ${limit}
            OFFSET ${offset}
          `),
        ]);

        const total = (countResult.rows[0] as { count: number }).count;

        const results = (
          dataResult.rows as Array<{
            entity_type: string;
            entity_id: string;
            collection: string | null;
            root_id: string | null;
            title: string | null;
            snippet: string | null;
            meta: Record<string, unknown> | null;
            rank: number;
            highlight: string;
          }>
        ).map((row) => ({
          entityType: row.entity_type,
          entityId: row.entity_id,
          collection: row.collection ?? undefined,
          rootId: row.root_id ?? undefined,
          title: row.title ?? undefined,
          snippet: row.snippet ?? undefined,
          meta: row.meta ?? undefined,
          rank: row.rank,
          highlight: row.highlight,
        }));

        return {
          results,
          total,
          hasMore: offset + results.length < total,
        };
      },
    ),
  };
}
