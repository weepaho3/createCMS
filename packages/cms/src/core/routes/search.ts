import { sql } from 'drizzle-orm';
import * as z from 'zod';

import type { CMSProcedureCtx } from '../types';

import { searchIndex } from '../db/schema.generated';
import { cmsMeta, createCMSEndpoint } from '../endpoint';

const SEARCH_META = { scope: 'system' as const, permissionResource: 'search' };

const ENTITY_TYPES = [
  'root',
  'comment',
  'mergeRequest',
  'variable',
  'template',
  'asset',
  'notification',
] as const;

export function createSearchEndpoints(cmsCtx: CMSProcedureCtx) {
  const { db } = cmsCtx;

  return {
    /**
     * Search across all indexed entities using full-text search.
     * Returns paginated results ranked by relevance, with optional filtering by entity type, collection, or root.
     *
     * @param q The search query string.
     * @param entityTypes Optional array of entity types to filter by (root, comment, mergeRequest, variable, template, asset, notification).
     * @param collection Optional collection name to limit results to a specific collection.
     * @param rootId Optional root id to limit results to a specific root.
     * @param limit Maximum number of results per page (default 20, max 100).
     * @param offset Number of results to skip for pagination (default 0).
     * @returns An object containing the search results array, total count of all matches, and a hasMore flag indicating if additional results exist beyond the current page.
     *
     * @example
     * const { results, total, hasMore } = await cmsClient.search.search({
     *   q: 'homepage',
     *   entityTypes: ['root', 'variable'],
     *   limit: 10,
     *   offset: 0,
     * });
     */
    search: createCMSEndpoint(
      '/search/search',
      {
        method: 'GET',
        query: z.object({
          q: z.string().min(1),
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
                q: string;
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
        const q = (query as { q: string }).q;
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
