import { sql } from 'drizzle-orm';

import type {
  AnyCollectionDefinition,
  CollectionWithName,
  ResolvedSlugConfig,
  RevalidateConfig,
  RevalidateEvent,
  RevalidateHandler,
} from './types/definitions';
import type { DrizzleInstance } from './types/drizzle';

import { buildFullPath, resolveAncestors } from './slug';

type NormalizedConfig<
  TCollections extends Record<string, AnyCollectionDefinition>,
> = {
  handler: RevalidateHandler<TCollections>;
  pathPatterns?: {
    [K in keyof TCollections & string]?: (slug: string) => string[];
  };
  debug: boolean;
};

/**
 * The Next.js cache tag for a root's published content. The A/B variant-coded
 * render routes tag their getPublishedContent fetch with this, so a single
 * `revalidateTag` invalidates the root's control + every variant cache entry on
 * a content change. Exported so consumers tag identically.
 */
export function rootRevalidateTag(rootId: string): string {
  return `cms_root_${rootId}`;
}

export function normalizeRevalidateConfig<
  TCollections extends Record<string, AnyCollectionDefinition>,
>(
  config:
    | RevalidateHandler<TCollections>
    | RevalidateConfig<TCollections>
    | undefined,
): NormalizedConfig<TCollections> | null {
  if (!config) return null;
  if (typeof config === 'function') {
    return { handler: config, debug: false };
  }
  return {
    handler: config.handler,
    pathPatterns: config.pathPatterns,
    debug: config.debug ?? false,
  };
}

function resolvePaths(
  config: NormalizedConfig<any>,
  collection: string,
  slug: string | null,
  fullPath?: string | null,
): string[] {
  const patternFn = config.pathPatterns?.[collection];
  if (patternFn && slug) return patternFn(slug);
  if (fullPath) return [fullPath];
  if (slug) return [slug];
  return [];
}

type PublicationRow = {
  slug: string | null;
  collection: string;
};

/**
 * Single-query check: is (rootId, branchId) published?
 * If yes, also resolves the slug from the roots table.
 *
 * Returns null when the branch is not published (zero rows = zero cost).
 */
async function checkPublication(
  db: DrizzleInstance,
  rootId: string,
  branchId: string,
): Promise<PublicationRow | null> {
  const result = await db.execute(sql`
    SELECT
      r.slug,
      r.collection
    FROM cms.publications p
    JOIN cms.roots r ON r.id = p.root_id
    WHERE p.root_id = ${rootId} AND p.branch_id = ${branchId}
    LIMIT 1
  `);
  if (result.rows.length === 0) return null;
  return result.rows[0] as PublicationRow;
}

/**
 * Find a published branch for a root, for branch-agnostic root mutations
 * (moveRoot / archiveRoot, whose request body carries NO branchId). Returns the
 * branch + the root's slug, or null when the root has no published branch
 * (nothing is cached → nothing to revalidate). LIMIT 1 suffices: per-root tag
 * busting (rootRevalidateTag + pageCacheTag) invalidates every variant, so one
 * branch covers them all.
 */
async function findPublishedRoot(
  db: DrizzleInstance,
  rootId: string,
): Promise<{ branchId: string; slug: string | null } | null> {
  const result = await db.execute(sql`
    SELECT p.branch_id, r.slug
    FROM cms.publications p
    JOIN cms.roots r ON r.id = p.root_id
    WHERE p.root_id = ${rootId}
    LIMIT 1
  `);
  if (result.rows.length === 0) return null;
  const row = result.rows[0] as { branch_id: string; slug: string | null };
  return { branchId: row.branch_id, slug: row.slug ?? null };
}

// ============================================================================
// Reverse-reference index (built once at startup)
// ============================================================================

type ReferenceEntry = {
  sourceCollection: string;
  propertyKey: string;
};

/**
 * Builds a map: targetCollection -> list of (sourceCollection, propertyKey)
 * that reference it. Used to find which published roots need cascade
 * revalidation when a referenced root is published/unpublished.
 */
function buildReverseReferenceIndex(
  collections: Record<string, CollectionWithName>,
): Map<string, ReferenceEntry[]> {
  const index = new Map<string, ReferenceEntry[]>();

  for (const [collName, collDef] of Object.entries(collections)) {
    const allProps: {
      key: string;
      spec: { type: string; collection?: string };
    }[] = [];

    for (const [key, spec] of Object.entries(collDef.root.properties)) {
      allProps.push({ key, spec });
    }
    for (const blockDef of Object.values(collDef.blocks)) {
      for (const [key, spec] of Object.entries(blockDef.properties)) {
        allProps.push({ key, spec });
      }
    }

    for (const { key, spec } of allProps) {
      if (spec.type !== 'reference') continue;
      const target = (spec as { collection: string }).collection;
      if (!index.has(target)) index.set(target, []);
      index.get(target)!.push({ sourceCollection: collName, propertyKey: key });
    }
  }

  return index;
}

type ReferencingRoot = {
  rootId: string;
  branchId: string;
  collection: string;
  slug: string | null;
};

/**
 * Finds all published roots whose block tree contains a reference property
 * pointing to `targetRootId`. The predicate is `properties->>key = value`
 * (scalar equality), which a jsonb_ops GIN index cannot serve — this query
 * does a scan filtered by the join to branch-head published versions.
 */
async function findReferencingPublishedRoots(
  db: DrizzleInstance,
  targetRootId: string,
  entries: ReferenceEntry[],
): Promise<ReferencingRoot[]> {
  if (entries.length === 0) return [];

  const conditions = entries.map(
    (e) =>
      sql`(r.collection = ${e.sourceCollection} AND bv.properties->>  ${e.propertyKey} = ${targetRootId})`,
  );

  const orCondition =
    conditions.length === 1 ? conditions[0] : sql.join(conditions, sql` OR `);

  const result = await db.execute(sql`
    SELECT DISTINCT
      p.root_id,
      p.branch_id,
      r.collection,
      r.slug
    FROM cms.publications p
    JOIN cms.roots r ON r.id = p.root_id
    JOIN cms.branches b ON b.id = p.branch_id
    JOIN cms.commit_snapshots cs ON cs.commit_id = b.head_commit_id
    JOIN cms.block_versions bv ON bv.id = cs.block_version_id
    WHERE (${orCondition})
  `);

  return (result.rows as any[]).map((row) => ({
    rootId: row.root_id,
    branchId: row.branch_id,
    collection: row.collection,
    slug: row.slug ?? null,
  }));
}

/**
 * The source paths of every active path→page redirect that targets the given
 * root OR any of its descendants. On a slug-change / reparent these OLD urls
 * are exactly the ones that should now serve a redirect — so they must be
 * revalidated, or their cached 404 / old-page ISR entry would keep serving until
 * the route's TTL instead of the freshly-created redirect. Redirects target the
 * ROOT (not a path), so this also stays correct across re-renames. The subtree
 * walk makes it correct for nested collections (a parent rename shifts every
 * descendant's path); a flat collection's CTE just yields the root itself.
 */
async function subtreeInboundRedirectPaths(
  db: DrizzleInstance,
  collection: string,
  rootId: string,
): Promise<string[]> {
  const result = await db.execute(sql`
    WITH RECURSIVE subtree AS (
      SELECT id FROM cms.roots WHERE id = ${rootId}
      UNION ALL
      SELECT r.id FROM cms.roots r JOIN subtree s ON r.parent_root_id = s.id
    )
    SELECT DISTINCT rd.source_path AS source_path
    FROM cms.redirects rd
    JOIN subtree st ON rd.target_root_id = st.id
    WHERE rd.collection = ${collection}
      AND rd.target_type = 'page'
      AND rd.source_type = 'path'
      AND rd.archived_at IS NULL
  `);
  return (result.rows as Array<{ source_path: string | null }>)
    .map((r) => r.source_path)
    .filter((p): p is string => p != null);
}

const WRITE_ACTIONS: Set<string> = new Set([
  'publishBranch',
  'unpublishBranch',
  'executeMerge',
  'createBlock',
  'updateBlock',
  'updateRoot',
  'updateBlocks',
  'deleteBlock',
  'moveBlock',
  'duplicateBlock',
  'moveRoot',
  'archiveRoot',
]);

export type RevalidationRunner = {
  shouldProcess(action: string): boolean;
  /**
   * Pre-resolve slug for unpublish (before the publication row is deleted).
   * Only called for `unpublish`.
   */
  preProcess(
    action: string,
    collection: string,
    input: Record<string, unknown>,
  ): Promise<void>;
  /**
   * After the endpoint handler + hooks complete, check publication status
   * and fire onRevalidate if the branch is published.
   */
  postProcess(
    action: string,
    collection: string,
    input: Record<string, unknown>,
    result: unknown,
  ): Promise<void>;
  fireManual(opts: {
    collection: string;
    rootId: string;
    branchId: string;
  }): Promise<void>;
};

export function createRevalidationRunner<
  TCollections extends Record<string, AnyCollectionDefinition>,
>(
  db: DrizzleInstance,
  config: NormalizedConfig<TCollections>,
  collections?: Record<string, CollectionWithName>,
): RevalidationRunner {
  const preResolvedSlugs = new Map<string, string | null>();
  const reverseRefIndex = collections
    ? buildReverseReferenceIndex(collections)
    : new Map<string, ReferenceEntry[]>();

  function debugLog(message: string) {
    if (config.debug) {
      console.log(`[cms:revalidate] ${message}`);
    }
  }

  async function fireEvent(event: RevalidateEvent<TCollections>) {
    debugLog(
      `${event.action} on ${event.collection} (rootId=${event.rootId}) -> slug=${event.slug ?? '(none)'} -> revalidating [${event.paths.join(', ')}]`,
    );
    try {
      await config.handler(event);
    } catch (err) {
      console.error('[cms:revalidate] handler error:', err);
    }
  }

  async function computeFullPath(
    collection: string,
    rootId: string,
    slug: string | null,
  ): Promise<string | null> {
    const collDef = collections?.[collection];
    const slugCfg = collDef?.slug as ResolvedSlugConfig | undefined;
    if (!slugCfg?.enabled) return null;

    if (slugCfg.nested) {
      const ancestors = await resolveAncestors(db, rootId);
      const segments = [
        ...ancestors.map((a) => a.slug).filter(Boolean),
        slug,
      ].filter(Boolean) as string[];
      return buildFullPath(slugCfg, segments);
    }

    if (slug) {
      return buildFullPath(slugCfg, [slug]);
    }
    return null;
  }

  async function buildAndFire(
    action: string,
    collection: string,
    rootId: string,
    branchId: string,
    slug: string | null,
    extraPaths: readonly string[] = [],
  ) {
    const fullPath = await computeFullPath(collection, rootId, slug);
    const paths = [
      ...new Set([
        ...resolvePaths(config, collection, slug, fullPath),
        ...extraPaths,
      ]),
    ];
    return fireEvent({
      action,
      collection: collection as keyof TCollections & string,
      rootId,
      branchId,
      slug,
      paths,
      tags: [rootRevalidateTag(rootId)],
    });
  }

  /**
   * After a publish/unpublish, find all published roots that reference the
   * affected rootId and fire cascade revalidation events for each.
   */
  async function cascadeRevalidation(
    triggerAction: string,
    collection: string,
    rootId: string,
  ) {
    const entries = reverseRefIndex.get(collection);
    if (!entries || entries.length === 0) return;

    const referencing = await findReferencingPublishedRoots(
      db,
      rootId,
      entries,
    );

    if (referencing.length === 0) return;

    debugLog(
      `cascade: ${collection} rootId=${rootId} is referenced by ${referencing.length} published root(s)`,
    );

    await Promise.all(
      referencing.map((ref) =>
        buildAndFire(
          triggerAction,
          ref.collection,
          ref.rootId,
          ref.branchId,
          ref.slug,
        ),
      ),
    );
  }

  /**
   * When a nested page's slug changes, all published descendants need
   * revalidation because their full paths have changed.
   */
  async function cascadeDescendantRevalidation(
    action: string,
    collection: string,
    rootId: string,
  ) {
    const collDef = collections?.[collection];
    const slugCfg = collDef?.slug as ResolvedSlugConfig | undefined;
    if (!slugCfg?.enabled || !slugCfg.nested) return;

    const result = await db.execute(sql`
      WITH RECURSIVE descendants AS (
        SELECT r.id, r.slug
        FROM cms.roots r
        WHERE r.parent_root_id = ${rootId}
          AND r.collection = ${collection}

        UNION ALL

        SELECT r.id, r.slug
        FROM cms.roots r
        JOIN descendants d ON r.parent_root_id = d.id
        WHERE r.collection = ${collection}
      )
      SELECT d.id AS root_id, d.slug, p.branch_id
      FROM descendants d
      JOIN cms.publications p ON p.root_id = d.id
    `);

    const rows = result.rows as Array<{
      root_id: string;
      slug: string | null;
      branch_id: string;
    }>;

    if (rows.length === 0) return;

    debugLog(
      `descendant cascade: ${collection} rootId=${rootId} has ${rows.length} published descendant(s)`,
    );

    await Promise.all(
      rows.map((row) =>
        buildAndFire(action, collection, row.root_id, row.branch_id, row.slug),
      ),
    );
  }

  return {
    shouldProcess(action: string): boolean {
      return WRITE_ACTIONS.has(action);
    },

    async preProcess(
      action: string,
      _collection: string,
      input: Record<string, unknown>,
    ) {
      if (action !== 'unpublishBranch') return;

      // For unpublish we must resolve the slug *before* the publication
      // row is deleted by the endpoint handler.
      const rootId = input.rootId as string;
      const branchId = input.branchId as string;
      if (rootId && branchId) {
        const pub = await checkPublication(db, rootId, branchId);
        preResolvedSlugs.set(`${rootId}:${branchId}`, pub?.slug ?? null);
      }
    },

    async postProcess(
      action: string,
      collection: string,
      input: Record<string, unknown>,
      result: unknown,
    ) {
      // ── publish ──────────────────────────────────────────────────
      // Always fires. The publication row was just created/updated,
      // so checkPublication will find it and resolve the slug.
      if (action === 'publishBranch') {
        const rootId = input.rootId as string;
        const branchId = input.branchId as string;
        if (rootId && branchId) {
          const pub = await checkPublication(db, rootId, branchId);
          await buildAndFire(
            action,
            collection,
            rootId,
            branchId,
            pub?.slug ?? null,
          );
          await cascadeRevalidation(action, collection, rootId);
        }
        return;
      }

      // ── unpublish ────────────────────────────────────────────────
      // Always fires. Slug was pre-resolved in preProcess (before
      // the publication row was deleted). No extra query needed.
      if (action === 'unpublishBranch') {
        const rootId = input.rootId as string;
        const branchId = input.branchId as string;
        if (rootId && branchId) {
          const key = `${rootId}:${branchId}`;
          const slug = preResolvedSlugs.get(key) ?? null;
          preResolvedSlugs.delete(key);
          await buildAndFire(action, collection, rootId, branchId, slug);
          await cascadeRevalidation(action, collection, rootId);
        }
        return;
      }

      // ── merge ────────────────────────────────────────────────────
      // executeMerge exposes rootId and targetBranchId in its result,
      // so we read them directly — zero extra queries for routing.
      // Only the publication check query is needed.
      if (action === 'executeMerge') {
        const mergeResult = result as {
          rootId?: string;
          targetBranchId?: string;
        } | null;
        const rootId = mergeResult?.rootId;
        const branchId = mergeResult?.targetBranchId;
        if (!rootId || !branchId) return;

        const pub = await checkPublication(db, rootId, branchId);
        if (!pub) {
          debugLog(
            `${action} on ${collection} (rootId=${rootId}, branchId=${branchId}) -> branch not published, skipping`,
          );
          return;
        }

        await buildAndFire(action, collection, rootId, branchId, pub.slug);
        return;
      }

      // ── branch-agnostic root mutations: moveRoot / archiveRoot ────────
      // These mutate cms.roots directly and carry NO branchId in the body, so
      // the generic tail below (which requires branchId) would skip them — yet
      // both auto-create OLD→page redirects (reparent shifts the subtree's
      // paths; archive points the old path at the parent). Resolve the root's
      // published branch and revalidate the OLD paths + the root's own/new path,
      // else the freshly-created redirect stays shadowed by the cached ISR entry
      // until the route's TTL.
      if (action === 'moveRoot' || action === 'archiveRoot') {
        const movedRootId = input.rootId as string | undefined;
        if (!movedRootId) return;
        const pub = await findPublishedRoot(db, movedRootId);
        if (!pub) {
          debugLog(
            `${action} on ${collection} (rootId=${movedRootId}) -> root not published, skipping`,
          );
          return;
        }
        const oldPaths = await subtreeInboundRedirectPaths(
          db,
          collection,
          movedRootId,
        );
        await buildAndFire(
          action,
          collection,
          movedRootId,
          pub.branchId,
          pub.slug,
          oldPaths,
        );
        // A reparent shifts every published descendant's full path too (nested).
        // (archiveRoot blocks roots-with-children, so archive has no descendants.)
        if (action === 'moveRoot') {
          await cascadeDescendantRevalidation(action, collection, movedRootId);
        }
        return;
      }

      // ── block mutations ──────────────────────────────────────────
      // rootId and branchId come directly from the request body.
      // Single publication check query — returns nothing for
      // non-published branches (indexed lookup, near-zero cost).
      const rootId = input.rootId as string | undefined;
      const branchId = input.branchId as string | undefined;
      if (!rootId || !branchId) return;

      const pub = await checkPublication(db, rootId, branchId);
      if (!pub) {
        debugLog(
          `${action} on ${collection} (rootId=${rootId}, branchId=${branchId}) -> branch not published, skipping`,
        );
        return;
      }

      // A slug-change via updateRoot shifts this root's — and, in a nested
      // collection, its whole subtree's — published path and auto-creates
      // OLD→page redirects (core/redirects/auto-create.ts). Revalidate those OLD
      // paths alongside the new one, so the freshly-created redirect surfaces
      // immediately instead of after the route's ISR TTL. The `slug` gate skips
      // property-only updateRoots (no path change → no redirect). (moveRoot /
      // archiveRoot are branch-agnostic and handled in their own branch above.)
      const pathMayHaveChanged =
        action === 'updateRoot' && input.slug !== undefined;
      const oldPaths = pathMayHaveChanged
        ? await subtreeInboundRedirectPaths(db, collection, rootId)
        : [];
      await buildAndFire(
        action,
        collection,
        rootId,
        branchId,
        pub.slug,
        oldPaths,
      );

      // When the slug changes on a published page via updateRoot,
      // cascade revalidation to all published descendants
      if (action === 'updateRoot') {
        await cascadeDescendantRevalidation(action, collection, rootId);
      }
    },

    async fireManual(opts) {
      const pub = await checkPublication(db, opts.rootId, opts.branchId);
      if (!pub) {
        debugLog(
          `manual revalidation for ${opts.collection} (rootId=${opts.rootId}, branchId=${opts.branchId}) -> branch not published, skipping`,
        );
        return;
      }
      await buildAndFire(
        'publishBranch',
        opts.collection,
        opts.rootId,
        opts.branchId,
        pub.slug,
      );
    },
  };
}
