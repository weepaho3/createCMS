import { sql } from 'drizzle-orm';
import * as z from 'zod';

import type {
  CollectionWithName,
  ResolvedSlugConfig,
} from '../../core/types/definitions';

import { cmsMeta, createCMSEndpoint } from '../../core/endpoint';
import { coreReferenceResolver } from '../../core/references';
import { crossScopeColumns, rootScopeConditions } from '../../core/scope';
import { resolvePathToRootId, splitPath } from '../../core/slug';
import { collectEmbeddedRoots } from './co-render';

// Edge-readable resolve seam
// ============================================================================
//
// The edge middleware needs a lightweight, publicly readable, cacheable lookup
// for a request path: "does a running A/B test vary this page's render, and
// what are its variants?" It carries no visitor input, so it is a pure
// function of (path, scope) and safe to cache (the edge tags it by rootId for
// revalidation on test start/stop).
//
// The XOR invariant guarantees at most one varying root per render, so this
// returns the single running test reachable from the page root (the page root
// itself or one transitively embedded block), or none.

/** One variant branch of the resolved test (enough for edge bucketing). */
export type ResolvedAbVariant = {
  /** ab_test_variants.id: the `variantId` resolveVariant buckets to. */
  variantId: string;
  /** The published branch this variant renders. */
  branchId: string;
  weight: number;
  isControl: boolean;
};

export type AbResolveResult = {
  test: {
    testId: string;
    /** The root the test attaches to (page root or an embedded block root). */
    rootId: string;
    trafficPercentage: number;
    variants: ResolvedAbVariant[];
  } | null;
};

/**
 * The per-collection `resolveAbVariant` endpoint. Surfaces at
 * `cms.api.<collection>.resolveAbVariant({ query: { path } })`. Lives as a
 * collection endpoint so it has the collection's slug config for `splitPath`.
 */
export function createAbResolveEndpoints(def: CollectionWithName) {
  const collectionName = def.name;
  const slugCfg = def.slug as ResolvedSlugConfig | undefined;

  return {
    resolveAbVariant: createCMSEndpoint(
      `/${collectionName}/resolveAbVariant`,
      {
        method: 'GET',
        query: z.object({ path: z.string() }),
        metadata: cmsMeta(
          { $Infer: { query: {} as { path: string } } },
          {
            // Publicly readable (like getPublishedContent) so the edge can
            // fetch and cache it without auth; carries no visitor-specific
            // data.
            permissionResource: 'publishedContent',
            operation: 'read',
            scope: 'collection',
            collection: collectionName,
          },
        ),
      },
      async (reqCtx): Promise<AbResolveResult> => {
        // Declared edge/CDN-cacheable: a pure function of (path, scope). The
        // default abTestMiddleware fetch is NOT served by the Next.js Data
        // Cache (a middleware-fetch caveat), so it runs this cheap query per
        // request and test start/stop reflects on the edge almost immediately.
        // The short s-maxage only bounds staleness if some CDN or HTTP layer
        // caches the response; in that case a test activates within s-maxage,
        // serving valid control content meanwhile. revalidateTag does not touch
        // that HTTP cache. setHeader is a no-op off-request.
        reqCtx.setHeader(
          'Cache-Control',
          'public, s-maxage=10, stale-while-revalidate=30',
        );

        const { db, scope } = reqCtx.context;
        const { path } = reqCtx.query;

        if (!slugCfg?.enabled) return { test: null };
        const rootId = await resolvePathToRootId(
          db,
          collectionName,
          splitPath(slugCfg, path),
          scope.roots?.insertColumns,
        );
        if (!rootId) return { test: null };

        // The page's full render set: the page root plus its transitive embeds
        // (group-aware, cross-scope, mirroring the XOR closure). The one
        // running test among them varies this render.
        const resolver = scope.referenceResolver ?? coreReferenceResolver;
        const scopeColumns = crossScopeColumns(scope.roots);
        const embeds = await collectEmbeddedRoots(
          db,
          rootId,
          resolver,
          scopeColumns,
        );
        const renderSet = [rootId, ...embeds];

        // One query: the running tests on the render set, restricted to their
        // published variant branches (JOIN publications skips unpublished
        // branches), re-scoped to the active tenant as defense in depth.
        const scopeConds = rootScopeConditions(scopeColumns);
        const rows = (await db.execute(sql`
          SELECT t.id AS test_id, t.root_id, t.traffic_percentage,
                 v.id AS variant_id, v.branch_id, v.weight, v.is_control
          FROM cms.ab_tests t
          JOIN cms.roots ON cms.roots.id = t.root_id
          JOIN cms.ab_test_variants v ON v.test_id = t.id
          JOIN cms.publications p
            ON p.root_id = t.root_id AND p.branch_id = v.branch_id
          WHERE t.status = 'running'
            AND t.root_id IN (${sql.join(
              renderSet.map((r) => sql`${r}`),
              sql`, `,
            )})
            ${scopeConds.length ? sql`AND ${sql.join(scopeConds, sql` AND `)}` : sql``}
          ORDER BY t.root_id, v.id
        `)) as {
          rows: Array<{
            test_id: string;
            root_id: string;
            traffic_percentage: number;
            variant_id: string;
            branch_id: string;
            weight: number;
            is_control: boolean;
          }>;
        };
        if (rows.rows.length === 0) return { test: null };

        // Fail-closed: if the render set somehow carries more than one running
        // test (an XOR breach or graph drift), serve control to everyone rather
        // than pick one arbitrarily.
        const testIds = new Set(rows.rows.map((r) => r.test_id));
        if (testIds.size > 1) return { test: null };

        const first = rows.rows[0]!;
        // Dedup variants (a branch may have several publication rows).
        const variantsById = new Map<string, ResolvedAbVariant>();
        for (const r of rows.rows) {
          if (!variantsById.has(r.variant_id)) {
            variantsById.set(r.variant_id, {
              variantId: r.variant_id,
              branchId: r.branch_id,
              weight: r.weight,
              isControl: r.is_control,
            });
          }
        }
        const variants = [...variantsById.values()];

        // Degrade to no fan-out (control) when fewer than two variant branches
        // are published or the control branch is unpublished, matching the
        // loadPublishedRoots fallback.
        if (variants.length < 2 || !variants.some((v) => v.isControl)) {
          return { test: null };
        }

        return {
          test: {
            testId: first.test_id,
            rootId: first.root_id,
            trafficPercentage: first.traffic_percentage,
            variants,
          },
        };
      },
    ),
  };
}
