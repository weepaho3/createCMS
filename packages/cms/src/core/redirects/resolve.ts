import { and, eq, isNull } from 'drizzle-orm';

import type { ResolvedSlugConfig, TableScope } from '../types/definitions';
import type { DbOrTx, DrizzleInstance } from '../types/drizzle';

import { publications, redirects, roots } from '../db/schema.generated';
import {
  buildFullPath,
  resolveAncestors,
  resolvePathToRootId,
  splitPath,
} from '../slug';

type EnabledSlugConfig = Extract<ResolvedSlugConfig, { enabled: true }>;

/**
 * The plugin-injected scope the resolver honours. `roots` gates path→root
 * resolution (an identical path outside the active scope must not terminate THIS
 * scope's resolution); `redirects` scopes the redirect-row lookups themselves.
 * Both are undefined when no scoping plugin is active.
 */
export type RedirectScope = { roots?: TableScope; redirects?: TableScope };

/** The routing decision a consumer applies: emit a 3xx, or `null` to proceed. */
export type RedirectResolution = { status: number; location: string };

// A redirect chain longer than this is treated as a misconfiguration (loop).
const MAX_HOPS = 10;

/**
 * Resolve a path to a rootId, then gate it through the root scope: a global
 * path-to-root match that belongs outside the active scope is treated as "no
 * live page here" (null) so resolution falls through to this scope's
 * path-source redirects. Mirrors getPublishedContent's scope gate.
 */
async function resolveScopedRootId(
  db: DrizzleInstance,
  collection: string,
  segments: string[],
  rootScope: TableScope | undefined,
): Promise<string | null> {
  // Resolve within the active root scope so a shared path doesn't match an
  // out-of-scope sibling that the scope gate below would then reject. The
  // per-row scope columns ride the roots insert-scope.
  const rootId = await resolvePathToRootId(
    db,
    collection,
    segments,
    rootScope?.insertColumns,
  );
  if (!rootId || !rootScope?.where) return rootId;
  const [r] = await db
    .select({ id: roots.id })
    .from(roots)
    .where(and(eq(roots.id, rootId), rootScope.where))
    .limit(1);
  return r ? rootId : null;
}

/** True if the root has at least one publication (i.e. the consumer would serve it). */
async function isPublished(
  db: DrizzleInstance,
  rootId: string,
): Promise<boolean> {
  const rows = await db
    .select({ rootId: publications.rootId })
    .from(publications)
    .where(eq(publications.rootId, rootId))
    .limit(1);
  return rows.length > 0;
}

/**
 * Resolve a root to its CURRENT full path (from its live slug chain). Returns the
 * archived flag and parent so a caller can fall back when the target is archived.
 * `null` if the root no longer exists.
 */
async function resolveRootPath(
  db: DrizzleInstance,
  slugCfg: EnabledSlugConfig,
  rootId: string,
  rootScope?: TableScope,
): Promise<{
  path: string;
  archived: boolean;
  parentRootId: string | null;
} | null> {
  const [root] = await db
    .select({
      slug: roots.slug,
      parentRootId: roots.parentRootId,
      archivedAt: roots.archivedAt,
    })
    .from(roots)
    // Gate the target by the active scope (tenant + language) so a page-target
    // pointing out of scope resolves to nothing rather than leaking its path,
    // symmetric with the scoped source resolution (resolveScopedRootId).
    .where(and(eq(roots.id, rootId), rootScope?.where))
    .limit(1);
  if (!root) return null;

  const ancestors = slugCfg.nested
    ? await resolveAncestors(
        db,
        rootId,
        rootScope?.insertColumns
          ? Object.keys(rootScope.insertColumns)
          : undefined,
      )
    : [];
  const segments = [...ancestors.map((a) => a.slug ?? ''), root.slug ?? ''];
  return {
    path: buildFullPath(slugCfg, segments),
    archived: root.archivedAt != null,
    parentRootId: root.parentRootId,
  };
}

/** A page-reference's CURRENT path (for UI display), or `null` if the root is
 *  gone — or out of `rootScope` when one is passed (defensive scope gate). */
export async function resolveRootCurrentPath(
  db: DbOrTx,
  slugCfg: EnabledSlugConfig,
  rootId: string,
  rootScope?: TableScope,
): Promise<string | null> {
  return (await resolveRootPath(db, slugCfg, rootId, rootScope))?.path ?? null;
}

/** Resolve a redirect's target to a destination path, or `null` if unreachable. */
async function resolveTarget(
  db: DrizzleInstance,
  slugCfg: EnabledSlugConfig,
  redirect: typeof redirects.$inferSelect,
  rootScope?: TableScope,
): Promise<string | null> {
  if (redirect.targetType === 'path') {
    return redirect.targetPath ?? null;
  }
  // 'page' target: the root's current path (so it follows future moves), gated
  // to the active scope.
  if (!redirect.targetRootId) return null;
  const target = await resolveRootPath(
    db,
    slugCfg,
    redirect.targetRootId,
    rootScope,
  );
  if (!target) return null;
  if (!target.archived) return target.path;

  // Archived target → fall back to the parent's path (one level), else give up.
  if (!target.parentRootId) return null;
  const parent = await resolveRootPath(
    db,
    slugCfg,
    target.parentRootId,
    rootScope,
  );
  if (!parent || parent.archived) return null;
  return parent.path;
}

/**
 * One hop: find the redirect (if any) that applies to `path`, plus its
 * canonical form (used for cycle detection). A live published page with no
 * page-source redirect terminates resolution (the consumer serves it). A page
 * that exists but is not published is a 404 to the consumer, so a path-source
 * redirect still applies; hence the published check before consulting
 * path-source.
 */
async function lookupRedirect(
  db: DrizzleInstance,
  collection: string,
  slugCfg: EnabledSlugConfig,
  path: string,
  scope: RedirectScope | undefined,
): Promise<{
  redirect: typeof redirects.$inferSelect | null;
  canonical: string;
}> {
  const segments = splitPath(slugCfg, path);
  const canonical = buildFullPath(slugCfg, segments);
  const rootId = await resolveScopedRootId(
    db,
    collection,
    segments,
    scope?.roots,
  );

  if (rootId) {
    const [pageRedirect] = await db
      .select()
      .from(redirects)
      .where(
        and(
          eq(redirects.collection, collection),
          eq(redirects.sourceType, 'page'),
          eq(redirects.sourceRootId, rootId),
          isNull(redirects.archivedAt),
          scope?.redirects?.where,
        ),
      )
      .limit(1);
    if (pageRedirect) return { redirect: pageRedirect, canonical };
    // No page-source redirect: a published page is served (terminal); an
    // unpublished page falls through to a path-source redirect.
    if (await isPublished(db, rootId)) return { redirect: null, canonical };
  }

  const [pathRedirect] = await db
    .select()
    .from(redirects)
    .where(
      and(
        eq(redirects.collection, collection),
        eq(redirects.sourceType, 'path'),
        eq(redirects.sourcePath, canonical),
        isNull(redirects.archivedAt),
        scope?.redirects?.where,
      ),
    )
    .limit(1);
  return { redirect: pathRedirect ?? null, canonical };
}

/**
 * The redirect resolver (read path). Given an incoming `path` in a collection,
 * returns a redirect decision or `null` (the consumer then serves content or
 * 404s). Follows redirect chains: a page-target resolves to the target's
 * current path, which may itself redirect; chains are collapsed into one 3xx
 * using the first hop's status. A repeated path (cycle) or an over-long chain
 * yields `null` so a misconfigured loop never reaches the client.
 */
export async function resolveRedirect(
  db: DrizzleInstance,
  collection: string,
  slugCfg: EnabledSlugConfig,
  path: string,
  scope?: RedirectScope,
): Promise<RedirectResolution | null> {
  const visited = new Set<string>();
  let current = path;
  let firstStatus: number | null = null;
  let location: string | null = null;

  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const { redirect, canonical } = await lookupRedirect(
      db,
      collection,
      slugCfg,
      current,
      scope,
    );

    if (visited.has(canonical)) return null; // cycle (also catches self-loops)
    visited.add(canonical);

    if (!redirect) {
      // Chain ended at a non-redirecting destination.
      return location !== null && firstStatus !== null
        ? { status: firstStatus, location }
        : null;
    }

    const target = await resolveTarget(db, slugCfg, redirect, scope?.roots);
    if (target === null) {
      // Target unreachable: keep whatever we've already resolved, else null.
      return location !== null && firstStatus !== null
        ? { status: firstStatus, location }
        : null;
    }

    if (firstStatus === null) firstStatus = redirect.statusCode;
    location = target;
    current = target; // follow the chain
  }

  return null; // too many hops → treat as a loop
}
