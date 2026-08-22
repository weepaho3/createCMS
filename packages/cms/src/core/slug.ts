import { sql } from 'drizzle-orm';
import slugify from 'slugify';

import type { CMSErrorCode } from '../errors-data';
import type { DbOrTx, DrizzleInstance, ResolvedSlugConfig } from './types';

import { CMSError } from './errors';

export function normalizeSlug(raw: string): string {
  return slugify(raw, { lower: true, strict: true, trim: true });
}

/**
 * Build the full URL path for a root given its slug config and ancestor segments.
 * `segments` is ordered root-to-leaf (e.g. ['about', 'team']).
 */
export function buildFullPath(
  slugConfig: Extract<ResolvedSlugConfig, { enabled: true }>,
  segments: string[],
): string {
  const prefix = slugConfig.prefix.replace(/\/+$/, '');
  const joined = segments.filter(Boolean).join('/');
  if (!joined) return prefix || '/';
  return prefix ? `${prefix}/${joined}` : `/${joined}`;
}

/**
 * Strip the collection prefix from a URL path and split into segments.
 * Optionally normalizes each segment when `slugConfig.normalize` is true.
 */
export function splitPath(
  slugConfig: Extract<ResolvedSlugConfig, { enabled: true }>,
  path: string,
): string[] {
  const prefix = slugConfig.prefix.replace(/\/+$/, '');
  let relative = path;
  // Strip the collection prefix only at a path boundary, so a sibling top
  // path that merely string-starts with the prefix (e.g. '/pages-archive' vs
  // prefix '/pages') is not mangled into '-archive'.
  if (prefix && (relative === prefix || relative.startsWith(`${prefix}/`))) {
    relative = relative.slice(prefix.length);
  }
  relative = relative.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!relative) return [];
  const segments = relative.split('/');
  return slugConfig.normalize ? segments.map(normalizeSlug) : segments;
}

/**
 * Validate that a slug segment is unique among siblings in the same collection.
 * Throws `SLUG_ALREADY_EXISTS` (default) if a conflict is found; pass
 * `conflictError: 'PUBLISH_SLUG_CONFLICT'` to throw that typed error instead,
 * carrying `{ slug, conflictingRootId }` data.
 */
const SAFE_SCOPE_COLUMN = /^[a-z_][a-z0-9_]*$/i;

export async function validateSlugUniqueness(
  db: DbOrTx,
  collection: string,
  parentRootId: string | null,
  slug: string,
  excludeRootId?: string,
  scopeColumns?: Record<string, unknown>,
  options?: { conflictError?: CMSErrorCode },
): Promise<void> {
  const parentCondition =
    parentRootId === null
      ? sql`r.parent_root_id IS NULL`
      : sql`r.parent_root_id = ${parentRootId}`;

  const excludeCondition = excludeRootId
    ? sql`AND r.id != ${excludeRootId}`
    : sql``;

  // Authoritative app-level uniqueness over ALL active scope dimensions. The
  // core slug index is non-unique, so THIS is the authority on every slug
  // write. A scoping plugin passes its per-row scope columns (e.g. `language`,
  // `tenant_slug`, the same values it stamps on insert), each ANDed in so the
  // effective key is (scope, collection, parentRootId, slug). Single-tenant
  // installs pass nothing, which yields a global check. Plugin-owned columns
  // are referenced via raw SQL (they don't exist in the core Drizzle type); the
  // column name is validated as a safe identifier.
  const scopeConds = scopeColumns
    ? Object.entries(scopeColumns).flatMap(([col, val]) => {
        if (val === undefined || val === null) return [];
        if (!SAFE_SCOPE_COLUMN.test(col)) {
          throw new Error(
            `validateSlugUniqueness: unsafe scope column "${col}"`,
          );
        }
        return [sql`AND r.${sql.raw(col)} = ${val}`];
      })
    : [];
  const scopeCondition =
    scopeConds.length > 0 ? sql.join(scopeConds, sql` `) : sql``;

  const result = await db.execute(sql`
    SELECT r.id FROM cms.roots r
    WHERE r.collection = ${collection}
      AND ${parentCondition}
      AND r.slug = ${slug}
      ${scopeCondition}
      ${excludeCondition}
    LIMIT 1
  `);

  if (result.rows.length > 0) {
    const conflictingRootId = (result.rows[0] as { id: string }).id;
    if (options?.conflictError === 'PUBLISH_SLUG_CONFLICT') {
      throw new CMSError('PUBLISH_SLUG_CONFLICT', {
        data: { slug, conflictingRootId },
      });
    }
    throw new CMSError('SLUG_ALREADY_EXISTS');
  }
}

/**
 * Walk up the parent chain from a given root, returning ancestor rows
 * ordered from the topmost ancestor down to (but not including) the given root.
 *
 * `scopeColumns` are plugin-owned per-scope columns (e.g. `tenant_slug`,
 * `language`) that the walk must stay within: each is SELECTed in the anchor and
 * the recursion is constrained to parents whose value MATCHES the starting root's
 * (`p.<col> = a.<col>`). Combined with the always-on `collection` match, the walk
 * can never cross a tenant/language/collection boundary on corrupted data — a
 * defensive complement to the write-time parent validation. Column names are
 * validated; pass `Object.keys(scope.roots.insertColumns)`.
 */
export async function resolveAncestors(
  db: DrizzleInstance,
  rootId: string,
  scopeColumns?: readonly string[],
): Promise<
  Array<{
    rootId: string;
    slug: string | null;
    parentRootId: string | null;
  }>
> {
  const cols = (scopeColumns ?? []).filter((c) => SAFE_SCOPE_COLUMN.test(c));
  const anchorSel = sql.join(
    cols.map((c) => sql`, r.${sql.raw(c)}`),
    sql``,
  );
  const recSel = sql.join(
    cols.map((c) => sql`, p.${sql.raw(c)}`),
    sql``,
  );
  const recMatch = sql.join(
    cols.map((c) => sql`AND p.${sql.raw(c)} = a.${sql.raw(c)}`),
    sql` `,
  );

  const result = await db.execute(sql`
    WITH RECURSIVE ancestors AS (
      SELECT r.id, r.slug, r.parent_root_id, r.collection${anchorSel}, 0 AS depth
      FROM cms.roots r
      WHERE r.id = ${rootId}

      UNION ALL

      SELECT p.id, p.slug, p.parent_root_id, p.collection${recSel}, a.depth + 1
      FROM cms.roots p
      JOIN ancestors a ON a.parent_root_id = p.id
      -- A root's parent is always same-collection (and same tenant/language
      -- when those plugins are active); enforcing it stops the walk from ever
      -- crossing a scope boundary on corrupted data.
      WHERE p.collection = a.collection ${recMatch}
    )
    SELECT id, slug, parent_root_id
    FROM ancestors
    WHERE id != ${rootId}
    ORDER BY depth DESC
  `);

  return (
    result.rows as Array<{
      id: string;
      slug: string | null;
      parent_root_id: string | null;
    }>
  ).map((row) => ({
    rootId: row.id,
    slug: row.slug,
    parentRootId: row.parent_root_id,
  }));
}

/**
 * Resolve a URL path to a root ID by walking segments top-down using a recursive CTE.
 * Returns null if no match is found.
 */
export async function resolvePathToRootId(
  db: DrizzleInstance,
  collection: string,
  segments: string[],
  scopeColumns?: Record<string, unknown>,
): Promise<string | null> {
  // Resolve the path WITHIN the active root scope: a scoping plugin's per-row
  // scope columns (the same it stamps on insert) are ANDed in at EVERY level of
  // the slug chain, so a shared slug in another scope neither matches nor
  // causes ambiguity. Built as `r`-aliased predicates because the CTE aliases
  // cms.roots as `r` (a table-qualified scope `where` would not bind to `r`).
  // Inert in single-scope installs (no columns). Mirrors validateSlugUniqueness.
  const scopeConds = scopeColumns
    ? Object.entries(scopeColumns).flatMap(([col, val]) => {
        if (val === undefined || val === null) return [];
        if (!SAFE_SCOPE_COLUMN.test(col)) {
          throw new Error(`resolvePathToRootId: unsafe scope column "${col}"`);
        }
        return [sql`AND r.${sql.raw(col)} = ${val}`];
      })
    : [];
  const scopeCondition =
    scopeConds.length > 0 ? sql.join(scopeConds, sql` `) : sql``;

  if (segments.length === 0) {
    const result = await db.execute(sql`
      SELECT r.id FROM cms.roots r
      WHERE r.collection = ${collection}
        AND r.parent_root_id IS NULL
        AND (r.slug IS NULL OR r.slug = '')
        AND r.archived_at IS NULL
        ${scopeCondition}
      LIMIT 1
    `);
    return (result.rows[0] as { id: string } | undefined)?.id ?? null;
  }

  // Build a recursive CTE that walks segments one by one
  const placeholders = segments.map((s, i) => sql`(${i + 1}::int, ${s}::text)`);
  const valuesClause = sql.join(placeholders, sql`, `);

  const result = await db.execute(sql`
    WITH RECURSIVE
    path_segments(depth, segment) AS (
      VALUES ${valuesClause}
    ),
    walk AS (
      SELECT r.id, 1 AS depth
      FROM cms.roots r
      JOIN path_segments ps ON ps.depth = 1 AND ps.segment = r.slug
      WHERE r.collection = ${collection}
        AND r.parent_root_id IS NULL
        AND r.archived_at IS NULL
        ${scopeCondition}

      UNION ALL

      SELECT r.id, w.depth + 1
      FROM cms.roots r
      JOIN walk w ON r.parent_root_id = w.id
      JOIN path_segments ps ON ps.depth = w.depth + 1 AND ps.segment = r.slug
      WHERE r.collection = ${collection}
        AND r.archived_at IS NULL
        ${scopeCondition}
    )
    SELECT id FROM walk
    WHERE depth = ${segments.length}
    LIMIT 1
  `);

  return (result.rows[0] as { id: string } | undefined)?.id ?? null;
}

/**
 * Check whether `candidateDescendantId` is an ancestor of (or equal to) `rootId`.
 * Used to prevent circular references in moveRoot.
 */
export async function isAncestorOf(
  db: DbOrTx,
  rootId: string,
  candidateAncestorId: string,
): Promise<boolean> {
  if (rootId === candidateAncestorId) return true;

  const result = await db.execute(sql`
    WITH RECURSIVE ancestors AS (
      SELECT r.parent_root_id
      FROM cms.roots r
      WHERE r.id = ${rootId}

      UNION ALL

      SELECT p.parent_root_id
      FROM cms.roots p
      JOIN ancestors a ON a.parent_root_id = p.id
    )
    SELECT 1 FROM ancestors
    WHERE parent_root_id = ${candidateAncestorId}
    LIMIT 1
  `);

  return result.rows.length > 0;
}
