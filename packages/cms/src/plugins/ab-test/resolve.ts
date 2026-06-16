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

// ============================================================================
// AB_FANOUT FA1 — edge-readable RESOLVE seam
// ============================================================================
//
// Pattern A (edge cache-per-variant) needs a lightweight, PUBLICLY-readable,
// CACHEABLE lookup the edge middleware can fetch for a request path: "does a
// running A/B test vary this page's render, and what are its variants?" — the
// data the edge needs to deterministically bucket the visitor (resolveVariant)
// and rewrite to a variant-coded path. It carries NO visitor input, so it is a
// pure function of (path, scope) and safe to cache (the edge tags it by rootId
// for revalidation on test start/stop).
//
// XOR (F1) guarantees AT MOST ONE varying root per render, so this returns the
// single running test reachable from the page root (the page root itself OR one
// transitively-embedded block), or none.

/** One variant branch of the resolved test (enough for edge bucketing). */
export type ResolvedAbVariant = {
  /** ab_test_variants.id — the `variantId` resolveVariant buckets to. */
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
 * The per-collection `resolveAbVariant` endpoint (Seam A / FA1). Surfaces at
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
            // Publicly readable (like getPublishedContent) so the edge can fetch
            // + cache it without auth; carries no visitor-specific data.
            permissionResource: 'publishedContent',
            operation: 'read',
            scope: 'collection',
            collection: collectionName,
          },
        ),
      },
      async (reqCtx): Promise<AbResolveResult> => {
        // Pure function of (path, scope) — declared edge/CDN-cacheable. The
        // DEFAULT abTestMiddleware fetch is NOT served by the Next.js Data Cache
        // (a middleware-fetch caveat), so it runs this (cheap) query per request
        // → test start/stop reflects on the edge ~immediately. The short s-maxage
        // only bounds staleness IF some CDN/HTTP layer caches the response (then
        // a test activates within ≤ s-maxage, serving valid control meanwhile —
        // never wrong content; revalidateTag does NOT touch this HTTP cache). For
        // guaranteed-instant activation AT SCALE, back the middleware's `resolve`
        // with Edge Config / KV written on test start/stop (the injectable path).
        // setHeader is a no-op off-request (direct server calls / tests).
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

        // The page's full render set: the page root + its transitive embeds
        // (group-aware, cross-scope — a sibling-language/host embed still counts),
        // mirroring the F1 XOR closure. The one running test among them varies
        // this render.
        const resolver = scope.referenceResolver ?? coreReferenceResolver;
        const scopeColumns = crossScopeColumns(scope.roots);
        const embeds = await collectEmbeddedRoots(
          db,
          rootId,
          resolver,
          scopeColumns,
        );
        const renderSet = [rootId, ...embeds];

        // One query: the running test(s) on the render set, restricted to their
        // PUBLISHED variant branches (JOIN publications — mirrors F2's skip of
        // unpublished branches) and re-scoped to the active tenant (defense in
        // depth; the render set is already scope-resolved).
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

        // Fail-closed: if the render set somehow carries >1 running test (an XOR
        // breach / graph drift), serve control to everyone rather than pick one
        // arbitrarily by root_id order.
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

        // Degrade to "no fan-out" (→ control) when fewer than two variant
        // branches are published or the control branch is unpublished — exactly
        // F2's loadPublishedRoots fallback.
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
