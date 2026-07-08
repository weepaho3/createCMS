import { APIError } from 'better-call';
import { sql } from 'drizzle-orm';
import * as z from 'zod';

import type { BlockTreeNode } from '../../core/blocks/reconstruct-snapshot';
import type {
  AnyBlockDefinition,
  CollectionWithName,
  ResolvedScope,
} from '../../core/types/definitions';
import type { DrizzleInstance } from '../../core/types/drizzle';
import type { GA4ServerConfig } from './analytics/ga4-server';
import type {
  ABTestAnalyticsAdapter,
  ABTestContext,
  CMSEvent,
  ConsentState,
} from './analytics/types';

import {
  assembleBlockTree,
  loadBlocksAtCommit,
} from '../../core/blocks/reconstruct-snapshot';
import { cmsMeta, createCMSEndpoint } from '../../core/endpoint';
import { resolveWireName } from '../../core/events';
import { coreReferenceResolver } from '../../core/references';
import { crossScopeColumns } from '../../core/scope';
import { newId } from '../../utils/nanoid';
import { forwardToGa4 } from './analytics/ga4-server';
import { resolveVariant } from './assignment';
import { collectCoRenderRoots, collectEmbeddedRoots } from './co-render';
import { $ERROR_CODES } from './errors';
import { publishLiveDelta } from './realtime';

const AB_TEST_META = {
  scope: 'system' as const,
  permissionResource: 'abTest',
};

// The PUBLIC event ingest (trackEvent) uses a DISTINCT resource from the admin
// 'abTest' resource (createTest/updateTest/getResults/…), so an app can allow
// anonymous access to ONLY the ingest — public visitors record impressions/
// conversions without a session — while keeping the admin mutations gated.
const AB_EVENT_META = {
  scope: 'system' as const,
  permissionResource: 'abTestEvent',
};

// ============================================================================
// Zod Schemas
// ============================================================================

const variantInput = z.object({
  branchId: z.string(),
  name: z.string(),
  weight: z.number().int().min(0).max(100),
  isControl: z.boolean().optional().default(false),
});

const variantsSchema = z
  .array(variantInput)
  .min(2, 'At least 2 variants required')
  .refine((v) => v.reduce((sum, x) => sum + x.weight, 0) === 100, {
    message: 'Variant weights must sum to 100',
  })
  .refine((v) => v.filter((x) => x.isControl).length === 1, {
    message: 'Exactly one variant must be marked as control',
  });

const contextSchema = z.object({
  key: z.string().min(1),
  anonymous: z.boolean().optional(),
});

// ============================================================================
// Helpers
// ============================================================================

type DB = DrizzleInstance;

function abTestError(code: keyof typeof $ERROR_CODES, message?: string): never {
  throw new APIError($ERROR_CODES[code].status, {
    message: message ?? $ERROR_CODES[code].message,
    code,
  });
}

function getTenantSlug(scope: ResolvedScope): string | null {
  return (scope.roots?.insertColumns?.tenant_slug as string) ?? null;
}

type TestRow = {
  id: string;
  root_id: string;
  collection: string;
  name: string;
  goal_handle: string | null;
  goal_event: string | null;
  status: string;
  traffic_percentage: number;
  started_at: string | null;
  ended_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type VariantRow = {
  id: string;
  test_id: string;
  branch_id: string;
  name: string;
  weight: number;
  is_control: boolean;
};

function mapTestRow(row: TestRow) {
  return {
    id: row.id,
    rootId: row.root_id,
    collection: row.collection,
    name: row.name,
    goalHandle: row.goal_handle,
    goalEvent: row.goal_event,
    status: row.status,
    trafficPercentage: row.traffic_percentage,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapVariantRow(row: VariantRow) {
  return {
    id: row.id,
    branchId: row.branch_id,
    name: row.name,
    weight: row.weight,
    isControl: row.is_control,
  };
}

async function findTestOrThrow(
  db: DB,
  testId: string,
  tenantSlug?: string | null,
) {
  let result: { rows: TestRow[] };
  if (tenantSlug) {
    result = (await db.execute(sql`
      SELECT t.* FROM cms.ab_tests t
      INNER JOIN cms.roots r ON r.id = t.root_id
      WHERE t.id = ${testId} AND r.tenant_slug = ${tenantSlug}
    `)) as { rows: TestRow[] };
  } else {
    result = (await db.execute(sql`
      SELECT * FROM cms.ab_tests WHERE id = ${testId}
    `)) as { rows: TestRow[] };
  }
  if (result.rows.length === 0) abTestError('AB_TEST_NOT_FOUND');
  return result.rows[0];
}

async function getVariantsForTest(db: DB, testId: string) {
  const result = (await db.execute(sql`
    SELECT * FROM cms.ab_test_variants WHERE test_id = ${testId} ORDER BY id
  `)) as { rows: VariantRow[] };
  return result.rows;
}

async function validateBranchesPublished(
  db: DB,
  rootId: string,
  branchIds: string[],
) {
  if (branchIds.length === 0) return;

  const placeholders = branchIds.map((id) => sql`${id}`);
  const arrayExpr = sql`ARRAY[${sql.join(placeholders, sql`, `)}]::text[]`;

  const result = (await db.execute(sql`
    SELECT p.branch_id
    FROM cms.publications p
    WHERE p.root_id = ${rootId}
      AND p.branch_id = ANY(${arrayExpr})
  `)) as { rows: Array<{ branch_id: string }> };

  const publishedSet = new Set(result.rows.map((r) => r.branch_id));
  for (const bid of branchIds) {
    if (!publishedSet.has(bid)) {
      abTestError(
        'AB_TEST_BRANCH_NOT_PUBLISHED',
        `Branch ${bid} is not published for root ${rootId}`,
      );
    }
  }
}

async function insertVariants(
  db: DB,
  testId: string,
  variants: Array<{
    branchId: string;
    name: string;
    weight: number;
    isControl?: boolean;
  }>,
) {
  for (const v of variants) {
    const id = newId('abTestVariant');
    await db.execute(sql`
      INSERT INTO cms.ab_test_variants (id, test_id, branch_id, name, weight, is_control)
      VALUES (${id}, ${testId}, ${v.branchId}, ${v.name}, ${v.weight}, ${v.isControl ?? false})
    `);
  }
}

async function deleteVariantsForTest(db: DB, testId: string) {
  await db.execute(sql`
    DELETE FROM cms.ab_test_variants WHERE test_id = ${testId}
  `);
}

// ============================================================================
// Goal discovery (M4 — listGoalEvents)
// ============================================================================

/** One pickable A/B goal: a declared event on a functional block INSTANCE. */
export type GoalCandidate = {
  /** The block instance's authored trackingId (stable goal anchor); null if unset. */
  handle: string | null;
  blockType: string;
  blockId: string;
  /** The declared event KEY (what code fires). */
  event: string;
  /** The resolved GA4/dataLayer wire name + stored event_type (what to match on). */
  name: string;
  label?: string;
  /** Declared scalar param keys. */
  params: string[];
  /**
   * True when this candidate sits in the tested root's OWN tree (the varying
   * render). False for a candidate in an EMBEDDED reusable block — shared,
   * co-rendered content whose conversions won't reflect THIS page's variants
   * cleanly (§6g attribution caution).
   */
  inVaryingRoot: boolean;
  /** The root whose tree this candidate lives in. */
  hostRootId: string;
};

/** Walk a tree, emitting a goal candidate per (functional block instance × event). */
function collectGoalsFromTree(
  node: BlockTreeNode,
  blocks: Record<string, AnyBlockDefinition>,
  hostRootId: string,
  inVaryingRoot: boolean,
  out: GoalCandidate[],
): void {
  const def = blocks[node.type];
  const events = def?.events;
  if (events && Object.keys(events).length > 0) {
    const handle =
      typeof node.properties.trackingId === 'string'
        ? node.properties.trackingId
        : null;
    for (const [event, decl] of Object.entries(events)) {
      out.push({
        handle,
        blockType: node.type,
        blockId: node.blockId,
        event,
        name: resolveWireName(event, node.type, events),
        label: decl.label,
        params: decl.params ? Object.keys(decl.params) : [],
        inVaryingRoot,
        hostRootId,
      });
    }
  }
  for (const child of node.children) {
    collectGoalsFromTree(child, blocks, hostRootId, inVaryingRoot, out);
  }
}

/**
 * Loads a root's published tree (the FIRST published branch, deterministically)
 * + the root's collection, and enumerates goal candidates from that one branch.
 * Goal anchors are branch-stable ONLY once a test RUNS (the trackingId drift
 * guard enforces matching sets across running variants) — at pick time the test
 * is still draft, so a functional block present only on a non-first / not-yet-
 * published variant branch is NOT offered until that branch is the enumerated
 * one. Acceptable for the common case (pick a goal present on control); the
 * running-time drift guard rejects divergent sets later. Returns null when the
 * root has no published content / is out of scope.
 */
async function loadRootPublishedTree(
  db: DB,
  rootId: string,
  tenantSlug: string | null,
): Promise<{ tree: BlockTreeNode; collection: string } | null> {
  const rows = (await db.execute(sql`
    SELECT r.collection AS collection, b.head_commit_id AS commit_id
    FROM cms.publications p
    INNER JOIN cms.branches b ON b.id = p.branch_id
    INNER JOIN cms.roots r ON r.id = p.root_id
    WHERE p.root_id = ${rootId}
      ${tenantSlug ? sql`AND r.tenant_slug = ${tenantSlug}` : sql``}
    ORDER BY p.published_at ASC, p.branch_id ASC
    LIMIT 1
  `)) as { rows: Array<{ collection: string; commit_id: string }> };

  if (rows.rows.length === 0) return null;
  const { collection, commit_id } = rows.rows[0]!;
  const { blocks } = await loadBlocksAtCommit(db, commit_id, rootId);
  const tree = assembleBlockTree(blocks, rootId);
  if (!tree) return null;
  return { tree, collection };
}

// ============================================================================
// Endpoints
// ============================================================================

/**
 * Creates all A/B test endpoints.
 *
 * Every handler reads `db` from `reqCtx.context.db`, which is injected
 * by the CMS endpoint wrapper at runtime -- just like better-auth does
 * with `ctx.context.db`. No closure or holder needed.
 */
export function createABTestEndpoints(
  adapter: ABTestAnalyticsAdapter,
  getCollections: () => Record<string, CollectionWithName>,
  ga4Config?: GA4ServerConfig,
) {
  return {
    createTest: createCMSEndpoint(
      '/abTest/createTest',
      {
        method: 'POST',
        body: z.object({
          rootId: z.string(),
          collection: z.string(),
          name: z.string(),
          trafficPercentage: z
            .number()
            .int()
            .min(0)
            .max(100)
            .optional()
            .default(100),
          goalHandle: z.string().min(1).optional(),
          goalEvent: z.string().min(1).optional(),
          variants: variantsSchema,
        }),
        metadata: cmsMeta(
          {
            $Infer: {
              body: {} as {
                rootId: string;
                collection: string;
                name: string;
                trafficPercentage?: number;
                goalHandle?: string;
                goalEvent?: string;
                variants: Array<{
                  branchId: string;
                  name: string;
                  weight: number;
                  isControl?: boolean;
                }>;
              },
            },
          },
          { operation: 'create', ...AB_TEST_META },
        ),
      },
      async (reqCtx) => {
        const { db, scope } = reqCtx.context;
        const tenantSlug = getTenantSlug(scope);
        const {
          rootId,
          collection,
          name,
          trafficPercentage,
          goalHandle,
          goalEvent,
          variants,
        } = reqCtx.body;
        const userId = reqCtx.context.userId;

        if (tenantSlug) {
          const rootCheck = (await db.execute(sql`
            SELECT 1 FROM cms.roots
            WHERE id = ${rootId} AND tenant_slug = ${tenantSlug}
          `)) as { rows: unknown[] };
          if (rootCheck.rows.length === 0) {
            abTestError('AB_TEST_NOT_FOUND', 'Root not found for this tenant');
          }
        }

        await validateBranchesPublished(
          db,
          rootId,
          variants.map((v) => v.branchId),
        );

        const testId = newId('abTest');
        await db.execute(sql`
          INSERT INTO cms.ab_tests (id, root_id, collection, name, goal_handle, goal_event, status, traffic_percentage, created_by, created_at, updated_at)
          VALUES (${testId}, ${rootId}, ${collection}, ${name}, ${goalHandle ?? null}, ${goalEvent ?? null}, 'draft', ${trafficPercentage}, ${userId ?? null}, NOW(), NOW())
        `);

        await insertVariants(db, testId, variants);

        return { testId };
      },
    ),

    updateTest: createCMSEndpoint(
      '/abTest/updateTest',
      {
        method: 'POST',
        body: z.object({
          testId: z.string(),
          name: z.string().optional(),
          status: z
            .enum(['draft', 'running', 'paused', 'completed'])
            .optional(),
          trafficPercentage: z.number().int().min(0).max(100).optional(),
          // nullable → an explicit null clears the goal; omitted → unchanged.
          // min(1) rejects '' so a stored goal is always a usable goal.
          goalHandle: z.string().min(1).nullable().optional(),
          goalEvent: z.string().min(1).nullable().optional(),
          variants: variantsSchema.optional(),
        }),
        metadata: cmsMeta(
          {
            $Infer: {
              body: {} as {
                testId: string;
                name?: string;
                status?: 'draft' | 'running' | 'paused' | 'completed';
                trafficPercentage?: number;
                goalHandle?: string | null;
                goalEvent?: string | null;
                variants?: Array<{
                  branchId: string;
                  name: string;
                  weight: number;
                  isControl?: boolean;
                }>;
              },
            },
          },
          { operation: 'update', ...AB_TEST_META },
        ),
      },
      async (reqCtx) => {
        const { db, scope } = reqCtx.context;
        const tenantSlug = getTenantSlug(scope);
        const {
          testId,
          name,
          status,
          trafficPercentage,
          goalHandle,
          goalEvent,
          variants,
        } = reqCtx.body;
        const test = await findTestOrThrow(db, testId, tenantSlug);

        if (status) {
          const allowed: Record<string, string[]> = {
            draft: ['running'],
            running: ['paused', 'completed'],
            paused: ['running', 'completed'],
            completed: [],
          };
          if (!allowed[test.status]?.includes(status)) {
            abTestError(
              'AB_TEST_INVALID_STATUS',
              `Cannot transition from "${test.status}" to "${status}"`,
            );
          }
        }

        // For a →running transition, compute the XOR conflict set up-front so we
        // know which root rows to lock. Locking them FOR UPDATE (id-ordered →
        // deadlock-free) inside the transaction serialises concurrent →running
        // calls on overlapping conflict sets, closing the check-then-update race.
        let coRender = new Set<string>();
        let lockRootIds: string[] = [];
        if (status === 'running') {
          coRender = await collectCoRenderRoots(
            db,
            test.root_id,
            scope.referenceResolver ?? coreReferenceResolver,
            crossScopeColumns(scope.roots),
          );
          lockRootIds = [test.root_id, ...coRender].sort();
        }

        await db.transaction(async (tx) => {
          if (lockRootIds.length > 0) {
            await tx.execute(sql`
              SELECT id FROM cms.roots
              WHERE id IN (${sql.join(
                lockRootIds.map((r) => sql`${r}`),
                sql`, `,
              )})
              ORDER BY id
              FOR UPDATE
            `);
          }

          if (status === 'running') {
            // Same-root: only one running test per root.
            const running = (await tx.execute(sql`
              SELECT id FROM cms.ab_tests
              WHERE root_id = ${test.root_id} AND status = 'running' AND id != ${testId}
              LIMIT 1
            `)) as { rows: Array<{ id: string }> };
            if (running.rows.length > 0) {
              abTestError('AB_TEST_DUPLICATE_RUNNING');
            }

            // XOR (cross-embed): a co-rendering root — the host page that embeds
            // this block, a block it embeds, or a co-embedded sibling,
            // transitively — must not ALSO have a running test, else a single
            // render would vary on two axes (unattributable). Conservative +
            // group-aware. Re-checked here under the lock.
            if (coRender.size > 0) {
              const conflict = (await tx.execute(sql`
                SELECT id FROM cms.ab_tests
                WHERE root_id IN (${sql.join(
                  [...coRender].map((r) => sql`${r}`),
                  sql`, `,
                )})
                  AND status = 'running' AND id != ${testId}
                LIMIT 1
              `)) as { rows: Array<{ id: string }> };
              if (conflict.rows.length > 0) {
                abTestError('AB_TEST_CROSS_EMBED_CONFLICT');
              }
            }
          }

          if (variants) {
            if (test.status !== 'draft' && test.status !== 'paused') {
              abTestError(
                'AB_TEST_INVALID_STATUS',
                'Variants can only be updated when test is draft or paused',
              );
            }
            await validateBranchesPublished(
              tx,
              test.root_id,
              variants.map((v) => v.branchId),
            );
            await deleteVariantsForTest(tx, testId);
            await insertVariants(tx, testId, variants);
          }

          const sets: ReturnType<typeof sql>[] = [sql`updated_at = NOW()`];
          if (name !== undefined) sets.push(sql`name = ${name}`);
          if (trafficPercentage !== undefined)
            sets.push(sql`traffic_percentage = ${trafficPercentage}`);
          if (goalHandle !== undefined)
            sets.push(sql`goal_handle = ${goalHandle}`);
          if (goalEvent !== undefined)
            sets.push(sql`goal_event = ${goalEvent}`);
          if (status) {
            sets.push(sql`status = ${status}`);
            if (status === 'running' && !test.started_at) {
              sets.push(sql`started_at = NOW()`);
            }
            if (status === 'completed') {
              sets.push(sql`ended_at = NOW()`);
            }
          }

          const setClause = sql.join(sets, sql`, `);
          await tx.execute(
            sql`UPDATE cms.ab_tests SET ${setClause} WHERE id = ${testId}`,
          );
        });

        // Toggling the test into/out of `running` changes what
        // getPublishedContent returns for the root (the page-level `abTest`
        // descriptor + variant fan-out appear/disappear). That is NOT a content
        // write, so the normal write-action revalidation never sees it — fire a
        // manual revalidation for the root so the app busts that page's render
        // caches (unstable_cache + the variant-coded ISR entries). Without this,
        // a freshly started/stopped test serves stale (pre-toggle) renders.
        const togglesRunning =
          status !== undefined &&
          (test.status === 'running') !== (status === 'running');
        if (togglesRunning && reqCtx.context.revalidationRunner) {
          const allVariants = await getVariantsForTest(db, testId);
          const control =
            allVariants.find((v) => v.is_control) ?? allVariants[0];
          if (control) {
            await reqCtx.context.revalidationRunner.fireManual({
              collection: test.collection,
              rootId: test.root_id,
              branchId: control.branch_id,
            });
          }
        }

        return { testId };
      },
    ),

    deleteTest: createCMSEndpoint(
      '/abTest/deleteTest',
      {
        method: 'POST',
        body: z.object({ testId: z.string() }),
        metadata: cmsMeta(
          { $Infer: { body: {} as { testId: string } } },
          { operation: 'delete', ...AB_TEST_META },
        ),
      },
      async (reqCtx) => {
        const { db, scope } = reqCtx.context;
        const tenantSlug = getTenantSlug(scope);
        const test = await findTestOrThrow(db, reqCtx.body.testId, tenantSlug);

        if (test.status !== 'draft' && test.status !== 'completed') {
          abTestError(
            'AB_TEST_INVALID_STATUS',
            'Can only delete tests in draft or completed status',
          );
        }

        await db.execute(sql`
          DELETE FROM cms.ab_tests WHERE id = ${reqCtx.body.testId}
        `);

        return { testId: reqCtx.body.testId };
      },
    ),

    getTest: createCMSEndpoint(
      '/abTest/getTest',
      {
        method: 'GET',
        query: z.object({ testId: z.string() }),
        metadata: cmsMeta(
          { $Infer: { query: {} as { testId: string } } },
          { operation: 'read', ...AB_TEST_META },
        ),
      },
      async (reqCtx) => {
        const { db, scope } = reqCtx.context;
        const tenantSlug = getTenantSlug(scope);
        const test = await findTestOrThrow(db, reqCtx.query.testId, tenantSlug);
        const variants = await getVariantsForTest(db, test.id);

        return {
          ...mapTestRow(test),
          variants: variants.map(mapVariantRow),
        };
      },
    ),

    /**
     * M4 goal-picker: the pickable A/B goals for a root. Reads each block type's
     * declared `events` (off the collection definitions) for the blocks present
     * in the root's published tree, returning one candidate per (functional block
     * instance × event). Candidates in the tested root's own tree are
     * `inVaryingRoot: true`; candidates in embedded reusable blocks are
     * `inVaryingRoot: false` (§6g attribution caution). The `name` is the
     * resolved wire name (the same string fire() stores as event_type), so the
     * UI-pickable goals are exactly the code-fireable events.
     */
    listGoalEvents: createCMSEndpoint(
      '/abTest/listGoalEvents',
      {
        method: 'GET',
        query: z.object({ rootId: z.string() }),
        metadata: cmsMeta(
          { $Infer: { query: {} as { rootId: string } } },
          { operation: 'read', ...AB_TEST_META },
        ),
      },
      async (reqCtx) => {
        const { db, scope } = reqCtx.context;
        const tenantSlug = getTenantSlug(scope);
        const collections = getCollections();
        const { rootId } = reqCtx.query;

        const goals: GoalCandidate[] = [];

        // The tested root's OWN tree → candidates in the varying render.
        const own = await loadRootPublishedTree(db, rootId, tenantSlug);
        if (own) {
          const blocks = collections[own.collection]?.blocks ?? {};
          collectGoalsFromTree(own.tree, blocks, rootId, true, goals);
        }

        // Embedded reusable blocks (down-only) → shared, co-rendered content;
        // their goals are offered but flagged inVaryingRoot:false (§6g caution).
        const resolver = scope.referenceResolver ?? coreReferenceResolver;
        const scopeColumns = crossScopeColumns(scope.roots);
        const embedded = await collectEmbeddedRoots(
          db,
          rootId,
          resolver,
          scopeColumns,
        );
        for (const embRootId of embedded) {
          const emb = await loadRootPublishedTree(db, embRootId, tenantSlug);
          if (!emb) continue;
          const blocks = collections[emb.collection]?.blocks ?? {};
          collectGoalsFromTree(emb.tree, blocks, embRootId, false, goals);
        }

        return { rootId, goals };
      },
    ),

    listTests: createCMSEndpoint(
      '/abTest/listTests',
      {
        method: 'GET',
        query: z.object({
          collection: z.string().optional(),
          status: z
            .enum(['draft', 'running', 'paused', 'completed'])
            .optional(),
          limit: z.coerce.number().int().min(1).max(100).optional().default(50),
          offset: z.coerce.number().int().min(0).optional().default(0),
        }),
        metadata: cmsMeta(
          {
            $Infer: {
              query: {} as {
                collection?: string;
                status?: string;
                limit?: number;
                offset?: number;
              },
            },
          },
          { operation: 'read', ...AB_TEST_META },
        ),
      },
      async (reqCtx) => {
        const { db, scope } = reqCtx.context;
        const tenantSlug = getTenantSlug(scope);
        const { collection, status, limit, offset } = reqCtx.query;

        const conditions = [sql`1=1`];
        if (collection) conditions.push(sql`t.collection = ${collection}`);
        if (status) conditions.push(sql`t.status = ${status}`);

        const tenantJoin = tenantSlug
          ? sql`INNER JOIN cms.roots r ON r.id = t.root_id`
          : sql``;
        if (tenantSlug) {
          conditions.push(sql`r.tenant_slug = ${tenantSlug}`);
        }

        const where = sql.join(conditions, sql` AND `);

        const countResult = (await db.execute(sql`
          SELECT COUNT(*)::int AS total FROM cms.ab_tests t ${tenantJoin} WHERE ${where}
        `)) as { rows: Array<{ total: number }> };

        const result = (await db.execute(sql`
          SELECT t.* FROM cms.ab_tests t
          ${tenantJoin}
          WHERE ${where}
          ORDER BY t.created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `)) as { rows: TestRow[] };

        return {
          tests: result.rows.map(mapTestRow),
          total: countResult.rows[0].total,
          hasMore:
            (offset ?? 0) + result.rows.length < countResult.rows[0].total,
        };
      },
    ),

    assignVariant: createCMSEndpoint(
      '/abTest/assignVariant',
      {
        method: 'POST',
        body: z.object({
          testId: z.string(),
          context: contextSchema,
        }),
        metadata: cmsMeta(
          {
            $Infer: {
              body: {} as { testId: string; context: ABTestContext },
            },
          },
          { operation: 'read', ...AB_TEST_META },
        ),
      },
      async (reqCtx) => {
        const { db, scope } = reqCtx.context;
        const tenantSlug = getTenantSlug(scope);
        const { testId, context } = reqCtx.body;
        const test = await findTestOrThrow(db, testId, tenantSlug);

        if (test.status !== 'running') {
          abTestError(
            'AB_TEST_INVALID_STATUS',
            'Can only assign variants for running tests',
          );
        }

        const variants = await getVariantsForTest(db, testId);
        const result = resolveVariant(
          context.key,
          testId,
          test.traffic_percentage,
          variants.map((v) => ({
            id: v.id,
            weight: v.weight,
            isControl: v.is_control,
          })),
        );

        const variant = variants.find((v) => v.id === result.variantId);

        return {
          variantId: result.variantId,
          branchId: variant?.branch_id ?? '',
          inTest: result.inTest,
        };
      },
    ),

    trackEvent: createCMSEndpoint(
      '/abTest/trackEvent',
      {
        method: 'POST',
        body: z.object({
          // A/B attribution is optional: non-A/B analytics events
          // (form_submit, page_view) omit testId/variantId.
          testId: z.string().optional(),
          variantId: z.string().optional(),
          // Pattern A: the edge/render route knows the served BRANCH, not the
          // variant id. Sending branchId (with testId) resolves the variant id
          // server-side — the impression beacon uses this.
          branchId: z.string().optional(),
          // Optional: the anonymous Pattern A path stores NO identifier (the
          // variant comes from the URL/variant-cookie, not a visitor id). A
          // visitor id is only sent for the consent-gated unique-visitor / GA4
          // path.
          visitorId: z.string().min(1).optional(),
          anonymous: z.boolean().optional().default(false),
          // Open vocabulary (blocks declare their own event names) but bounded,
          // so this ingest path never accepts arbitrary unbounded input.
          eventType: z.string().min(1).max(80),
          metadata: z
            .record(z.string(), z.unknown())
            .optional()
            .refine((m) => !m || JSON.stringify(m).length <= 8192, {
              message: 'metadata exceeds 8KB',
            }),
          source: z
            .object({
              handle: z.string().max(128).optional(),
              type: z.string().max(128).optional(),
            })
            .optional(),
          // Funnel grouping (M4): shared by the attempt + success legs of one
          // interaction. Bounded; groups, does NOT dedup.
          interactionId: z.string().min(1).max(128).optional(),
          // GA4 stitching ids (M5): the client sends these ONLY when consent is
          // granted, so the server-MP forward can attribute the hit. Bounded.
          transport: z
            .object({
              clientId: z.string().min(1).max(128).optional(),
              sessionId: z.string().min(1).max(128).optional(),
              engagementTimeMsec: z
                .number()
                .int()
                .min(0)
                .max(86_400_000)
                .optional(),
            })
            .optional(),
          // Consent Mode v2 state the client emitted under (optional). Used for
          // a server-side denial guard + forwarded to consent-aware sinks.
          consent: z
            .object({
              analytics_storage: z.enum(['granted', 'denied']),
              ad_storage: z.enum(['granted', 'denied']),
              ad_user_data: z.enum(['granted', 'denied']),
              ad_personalization: z.enum(['granted', 'denied']),
            })
            .optional(),
        }),
        metadata: cmsMeta(
          {
            $Infer: {
              body: {} as {
                testId?: string;
                variantId?: string;
                branchId?: string;
                visitorId?: string;
                anonymous?: boolean;
                eventType: string;
                metadata?: Record<string, unknown>;
                source?: { handle?: string; type?: string };
                interactionId?: string;
                transport?: {
                  clientId?: string;
                  sessionId?: string;
                  engagementTimeMsec?: number;
                };
                consent?: ConsentState;
              },
            },
          },
          { operation: 'create', ...AB_EVENT_META },
        ),
      },
      async (reqCtx) => {
        const { db, scope } = reqCtx.context;
        const tenantSlug = getTenantSlug(scope);
        const {
          testId,
          variantId,
          branchId,
          visitorId,
          anonymous,
          eventType,
          metadata,
          source,
          interactionId,
          transport,
          consent,
        } = reqCtx.body;

        // Courtesy no-op for a self-reported denial: if a caller explicitly
        // sends analytics_storage='denied', don't record. This is NOT a server
        // enforcement boundary — `consent` is optional, so a caller can simply
        // omit it. True server-read consent gating is deferred to M5; the client
        // gate remains the consent authority.
        if (consent && consent.analytics_storage === 'denied') {
          return {};
        }

        let ab: { testId: string; variantId: string } | undefined;
        if (
          testId !== undefined ||
          variantId !== undefined ||
          branchId !== undefined
        ) {
          // A/B-attributed event: it must resolve to a variant that belongs to
          // the test — otherwise a caller could record events against an
          // arbitrary (or another test's) variant and poison the analytics.
          if (!testId) {
            abTestError(
              'AB_TEST_VARIANT_NOT_FOUND',
              'A/B events require testId',
            );
          }
          await findTestOrThrow(db, testId, tenantSlug);
          const variants = await getVariantsForTest(db, testId);
          // Accept either an explicit variantId or a branchId (Pattern A).
          const resolvedVariantId =
            variantId ??
            (branchId
              ? variants.find((v) => v.branch_id === branchId)?.id
              : undefined);
          if (
            !resolvedVariantId ||
            !variants.some((v) => v.id === resolvedVariantId)
          ) {
            abTestError(
              'AB_TEST_VARIANT_NOT_FOUND',
              'A/B events require a variantId or a branchId that belongs to the test',
            );
          }
          ab = { testId, variantId: resolvedVariantId };
        }

        // The storage PK is always server-minted in M0 (id omitted here). A
        // client-supplied, tenant-namespaced idempotency key — distinct from
        // the PK — is an M3 concern (see AB_MEASUREMENT_DESIGN §9 carry-forward).
        const event: CMSEvent = {
          name: eventType,
          visitorId,
          anonymous: anonymous ?? false,
          ab,
          source,
          interactionId,
          transport,
          consent,
          metadata,
          timestamp: new Date(),
        };
        await adapter.track(event);

        // Push a live result delta to the test's dashboard channel over the
        // shared realtime transport (best-effort; getResults stays canonical).
        if (ab) {
          publishLiveDelta(
            reqCtx.context.realtime,
            ab.testId,
            ab.variantId,
            event.name,
          );
        }

        // M5: opt-in server-side GA4 forward. No-op without a configured
        // endpoint, or when the event is not a consenting, client_id-bearing hit
        // (buildGa4Payload returns null). Best-effort — never breaks the ingest.
        if (ga4Config) await forwardToGa4(event, ga4Config);

        return {};
      },
    ),

    getResults: createCMSEndpoint(
      '/abTest/getResults',
      {
        method: 'GET',
        query: z.object({
          testId: z.string(),
          from: z.coerce.date().optional(),
          to: z.coerce.date().optional(),
        }),
        metadata: cmsMeta(
          {
            $Infer: {
              query: {} as { testId: string; from?: Date; to?: Date },
            },
          },
          { operation: 'read', ...AB_TEST_META },
        ),
      },
      async (reqCtx) => {
        const { db, scope } = reqCtx.context;
        const tenantSlug = getTenantSlug(scope);
        const { testId, from, to } = reqCtx.query;
        const test = await findTestOrThrow(db, testId, tenantSlug);
        const results = await adapter.query(testId, { from, to });

        // M4: when the test has a chosen goal, count ITS event (the resolved
        // wire name, already present in each variant's eventBreakdown) as the
        // conversion + recompute the rate. The adapter's default 'conversion'
        // eventType is the goal-less fallback (unchanged when no goal is set).
        // `|| null` coerces a legacy/degenerate '' to the goal-less path.
        const goal = test.goal_event || null;
        // Surface the goal so the live dashboard applies deltas to conversions
        // with the same rule (null = goal-less default → 'conversion').
        results.goalEvent = goal;
        if (goal) {
          for (const v of results.variants) {
            v.conversions = v.eventBreakdown[goal]?.count ?? 0;
            v.conversionRate =
              v.impressions > 0
                ? Math.round((v.conversions / v.impressions) * 10000) / 100
                : 0;
            // Funnel (M4): of the interactions started (attempts = distinct
            // interaction ids), how many reached the goal event. 0 when the goal
            // is a non-funnel event (no interaction ids) → attempts is 0.
            const goalInteractions =
              v.eventBreakdown[goal]?.distinctInteractions ?? 0;
            v.completionRate =
              v.attempts > 0
                ? Math.round((goalInteractions / v.attempts) * 10000) / 100
                : 0;
          }
          results.totalConversions = results.variants.reduce(
            (s, v) => s + v.conversions,
            0,
          );
        }
        return results;
      },
    ),

    flushEvents: createCMSEndpoint(
      '/abTest/flushEvents',
      {
        method: 'POST',
        body: z.object({
          testId: z.string().optional(),
        }),
        metadata: cmsMeta(
          { $Infer: { body: {} as { testId?: string } } },
          { operation: 'update', ...AB_TEST_META },
        ),
      },
      async (reqCtx) => {
        if (!adapter.flush) {
          abTestError('AB_TEST_FLUSH_NOT_SUPPORTED');
        }
        if (reqCtx.body.testId) {
          const { db, scope } = reqCtx.context;
          const tenantSlug = getTenantSlug(scope);
          await findTestOrThrow(db, reqCtx.body.testId, tenantSlug);
        }
        return adapter.flush(reqCtx.body.testId);
      },
    ),
  };
}
