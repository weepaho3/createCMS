import { and, desc, eq, isNull, ne, sql } from 'drizzle-orm';
import * as z from 'zod';

import type { CMSProcedureCtx, CollectionWithName } from '../types';
import type { ResolvedSlugConfig, TableScope } from '../types/definitions';
import type { DrizzleInstance } from '../types/drizzle';

import { newId } from '../../utils/nanoid';
import { requireRootInScope } from '../blocks/guards';
import { redirects } from '../db/schema.generated';
import { cmsMeta, createCMSEndpoint } from '../endpoint';
import { CMSError } from '../errors';
import { resolveRedirect, resolveRootCurrentPath } from '../redirects/resolve';
import { scopedInsert } from '../scope';
import { buildFullPath, splitPath } from '../slug';

type EnabledSlugConfig = Extract<ResolvedSlugConfig, { enabled: true }>;

const ENDPOINT_TYPE = z.enum(['page', 'path']);
const STATUS_CODE = z.union([
  z.literal(301),
  z.literal(302),
  z.literal(307),
  z.literal(308),
]);

type RedirectInput = {
  sourceType: 'page' | 'path';
  sourceRootId?: string;
  sourcePath?: string;
  targetType: 'page' | 'path';
  targetRootId?: string;
  targetPath?: string;
  statusCode?: 301 | 302 | 307 | 308;
};

const REDIRECT_META = {
  permissionResource: 'redirect',
  scope: 'collection' as const,
};

/**
 * Validate + normalize one endpoint of a redirect. A 'page' endpoint requires a
 * rootId that exists in this collection + scope; a 'path' endpoint requires a
 * path. SOURCE paths are canonicalized (buildFullPath∘splitPath) so the resolver
 * can match them by exact equality; TARGET paths are stored verbatim (they may be
 * external / cross-collection destinations).
 */
async function validateEndpoint(
  db: DrizzleInstance,
  collection: string,
  slugCfg: EnabledSlugConfig,
  rootScope: TableScope | undefined,
  type: 'page' | 'path',
  rootId: string | undefined,
  path: string | undefined,
  canonicalize: boolean,
): Promise<{ rootId: string | null; path: string | null }> {
  if (type === 'page') {
    if (!rootId) throw new CMSError('REDIRECT_INVALID');
    await requireRootInScope(db, rootId, collection, rootScope);
    return { rootId, path: null };
  }
  if (!path) throw new CMSError('REDIRECT_INVALID');
  const stored = canonicalize
    ? buildFullPath(slugCfg, splitPath(slugCfg, path))
    : path;
  return { rootId: null, path: stored };
}

/**
 * Reject a second ACTIVE redirect for the same source. This is the AUTHORITATIVE
 * uniqueness check: the core table has no DB-unique on the source (it would be
 * global, blocking cross-scope paths), so app-level + the scoping plugin's
 * per-scope partial-unique together enforce it. `scope.where` narrows the check
 * to the current scope.
 */
async function assertSourceUnique(
  db: DrizzleInstance,
  collection: string,
  sourceType: 'page' | 'path',
  sourceRootId: string | null,
  sourcePath: string | null,
  scope: TableScope | undefined,
  excludeId?: string,
): Promise<void> {
  const conds = [
    eq(redirects.collection, collection),
    isNull(redirects.archivedAt),
    eq(redirects.sourceType, sourceType),
    sourceType === 'page'
      ? eq(redirects.sourceRootId, sourceRootId!)
      : eq(redirects.sourcePath, sourcePath!),
    scope?.where,
  ];
  if (excludeId) conds.push(ne(redirects.id, excludeId));
  const [existing] = await db
    .select({ id: redirects.id })
    .from(redirects)
    .where(and(...conds))
    .limit(1);
  if (existing) throw new CMSError('REDIRECT_SOURCE_EXISTS');
}

/**
 * Redirect read path + management. `resolveRedirect` is the consumer's public
 * routing call; the rest is the admin CRUD that backs the UI. See
 * REDIRECTS_DESIGN.md.
 */
export function createRedirectEndpoints<TDef extends CollectionWithName>(
  def: TDef,
  cmsCtx: CMSProcedureCtx,
) {
  const { db } = cmsCtx;
  const collectionName = def.name;
  const slugCfg = def.slug as ResolvedSlugConfig | undefined;

  return {
    /**
     * Resolves a request path to its redirect target, if one exists.
     * @param path The request path to resolve (e.g. '/about' or '/old-page').
     * @returns An object with a `redirect` field containing the target URL and status code, or null if no redirect matches.
     * @throws SLUG_NOT_ENABLED if the collection does not have slugs enabled.
     * @example await cmsClient.pages.resolveRedirect({ path: '/old-page' })
     */
    resolveRedirect: createCMSEndpoint(
      `/${collectionName}/resolveRedirect`,
      {
        method: 'GET',
        query: z.object({ path: z.string() }),
        // Public routing, like getPublishedContent — same permission resource so
        // the consumer's anon-read carve-out applies.
        metadata: cmsMeta(
          { $Infer: { query: {} as { path: string } } },
          {
            permissionResource: 'publishedContent',
            operation: 'read',
            scope: 'collection',
            collection: collectionName,
          },
        ),
      },
      async (ctx) => {
        if (!slugCfg?.enabled) return { redirect: null };
        const redirect = await resolveRedirect(
          db,
          collectionName,
          slugCfg,
          ctx.query.path,
          {
            roots: ctx.context.scope.roots,
            redirects: ctx.context.scope.redirects,
          },
        );
        return { redirect };
      },
    ),

    /**
     * Creates a new redirect from a source (page or path) to a target (page or path).
     * Source paths are canonicalized and must be unique; target paths are stored verbatim and may reference external destinations.
     * @param sourceType Whether the source is a 'page' (requires sourceRootId) or 'path' (requires sourcePath).
     * @param sourceRootId The root id of the source page (required if sourceType is 'page').
     * @param sourcePath The source path (required if sourceType is 'path').
     * @param targetType Whether the target is a 'page' or 'path'.
     * @param targetRootId The root id of the target page (required if targetType is 'page').
     * @param targetPath The target path or URL (required if targetType is 'path').
     * @param statusCode HTTP status code for the redirect (301, 302, 307, or 308; defaults to 301).
     * @returns The created redirect object.
     * @throws SLUG_NOT_ENABLED if slugs are not enabled for this collection.
     * @throws REDIRECT_INVALID if a source page root does not exist or a required field is missing.
     * @throws REDIRECT_SOURCE_EXISTS if an active redirect with the same source already exists.
     * @example await cmsClient.pages.createRedirect({ sourceType: 'path', sourcePath: '/old-page', targetType: 'page', targetRootId: 'root_123', statusCode: 301 })
     */
    createRedirect: createCMSEndpoint(
      `/${collectionName}/createRedirect`,
      {
        method: 'POST',
        body: z.object({
          sourceType: ENDPOINT_TYPE,
          sourceRootId: z.string().optional(),
          sourcePath: z.string().optional(),
          targetType: ENDPOINT_TYPE,
          targetRootId: z.string().optional(),
          targetPath: z.string().optional(),
          statusCode: STATUS_CODE.optional(),
        }),
        metadata: cmsMeta(
          { $Infer: { body: {} as RedirectInput } },
          { operation: 'create', ...REDIRECT_META, collection: collectionName },
        ),
      },
      async (ctx) => {
        if (!slugCfg?.enabled) throw new CMSError('SLUG_NOT_ENABLED');
        const b = ctx.body;
        const rootScope = ctx.context.scope.roots;
        const redirectScope = ctx.context.scope.redirects;

        const source = await validateEndpoint(
          db,
          collectionName,
          slugCfg,
          rootScope,
          b.sourceType,
          b.sourceRootId,
          b.sourcePath,
          true,
        );
        const target = await validateEndpoint(
          db,
          collectionName,
          slugCfg,
          rootScope,
          b.targetType,
          b.targetRootId,
          b.targetPath,
          false,
        );
        await assertSourceUnique(
          db,
          collectionName,
          b.sourceType,
          source.rootId,
          source.path,
          redirectScope,
        );

        // scopedInsert (raw SQL) so the plugin-injected scope column is set; a
        // plain Drizzle insert can't carry the plugin-owned column. Re-select via
        // Drizzle afterwards for the typed (camelCase) row the API returns.
        const inserted = await scopedInsert(
          db,
          'cms.redirects',
          {
            id: newId('redirect'),
            collection: collectionName,
            source_type: b.sourceType,
            source_root_id: source.rootId,
            source_path: source.path,
            target_type: b.targetType,
            target_root_id: target.rootId,
            target_path: target.path,
            status_code: b.statusCode ?? 301,
            created_by: ctx.context.userId ?? null,
          },
          redirectScope,
        );
        const [created] = await db
          .select()
          .from(redirects)
          .where(eq(redirects.id, inserted.id))
          .limit(1);
        return { redirect: created };
      },
    ),

    /**
     * Updates an existing redirect's source, target, or status code.
     * Source uniqueness is re-validated, excluding the current redirect from the check.
     * @param redirectId The id of the redirect to update.
     * @param sourceType Whether the source is a 'page' or 'path'.
     * @param sourceRootId The root id of the source page (required if sourceType is 'page').
     * @param sourcePath The source path (required if sourceType is 'path').
     * @param targetType Whether the target is a 'page' or 'path'.
     * @param targetRootId The root id of the target page (required if targetType is 'page').
     * @param targetPath The target path or URL (required if targetType is 'path').
     * @param statusCode HTTP status code for the redirect (301, 302, 307, or 308; defaults to 301).
     * @returns The updated redirect object.
     * @throws SLUG_NOT_ENABLED if slugs are not enabled for this collection.
     * @throws REDIRECT_NOT_FOUND if the redirect does not exist or is not in scope.
     * @throws REDIRECT_INVALID if a source page root does not exist or a required field is missing.
     * @throws REDIRECT_SOURCE_EXISTS if another active redirect with the same source already exists.
     * @example await cmsClient.pages.updateRedirect({ redirectId: 'redirect_123', sourceType: 'path', sourcePath: '/new-path', targetType: 'page', targetRootId: 'root_456' })
     */
    updateRedirect: createCMSEndpoint(
      `/${collectionName}/updateRedirect`,
      {
        method: 'POST',
        body: z.object({
          redirectId: z.string(),
          sourceType: ENDPOINT_TYPE,
          sourceRootId: z.string().optional(),
          sourcePath: z.string().optional(),
          targetType: ENDPOINT_TYPE,
          targetRootId: z.string().optional(),
          targetPath: z.string().optional(),
          statusCode: STATUS_CODE.optional(),
        }),
        metadata: cmsMeta(
          {
            $Infer: {
              body: {} as RedirectInput & { redirectId: string },
            },
          },
          { operation: 'update', ...REDIRECT_META, collection: collectionName },
        ),
      },
      async (ctx) => {
        if (!slugCfg?.enabled) throw new CMSError('SLUG_NOT_ENABLED');
        const b = ctx.body;
        const rootScope = ctx.context.scope.roots;
        const redirectScope = ctx.context.scope.redirects;

        const [existing] = await db
          .select({ id: redirects.id })
          .from(redirects)
          .where(
            and(
              eq(redirects.id, b.redirectId),
              eq(redirects.collection, collectionName),
              isNull(redirects.archivedAt),
              redirectScope?.where,
            ),
          )
          .limit(1);
        if (!existing) throw new CMSError('REDIRECT_NOT_FOUND');

        const source = await validateEndpoint(
          db,
          collectionName,
          slugCfg,
          rootScope,
          b.sourceType,
          b.sourceRootId,
          b.sourcePath,
          true,
        );
        const target = await validateEndpoint(
          db,
          collectionName,
          slugCfg,
          rootScope,
          b.targetType,
          b.targetRootId,
          b.targetPath,
          false,
        );
        await assertSourceUnique(
          db,
          collectionName,
          b.sourceType,
          source.rootId,
          source.path,
          redirectScope,
          b.redirectId,
        );

        const [updated] = await db
          .update(redirects)
          .set({
            sourceType: b.sourceType,
            sourceRootId: source.rootId,
            sourcePath: source.path,
            targetType: b.targetType,
            targetRootId: target.rootId,
            targetPath: target.path,
            statusCode: b.statusCode ?? 301,
            updatedAt: new Date(),
          })
          .where(and(eq(redirects.id, b.redirectId), redirectScope?.where))
          .returning();
        return { redirect: updated };
      },
    ),

    /**
     * Archives (soft-deletes) an active redirect by setting its archivedAt timestamp.
     * @param redirectId The id of the redirect to archive.
     * @returns The archived redirect's id.
     * @throws REDIRECT_NOT_FOUND if the redirect does not exist, is already archived, or is not in scope.
     * @example await cmsClient.pages.archiveRedirect({ redirectId: 'redirect_123' })
     */
    archiveRedirect: createCMSEndpoint(
      `/${collectionName}/archiveRedirect`,
      {
        method: 'POST',
        body: z.object({ redirectId: z.string() }),
        metadata: cmsMeta(
          { $Infer: { body: {} as { redirectId: string } } },
          { operation: 'delete', ...REDIRECT_META, collection: collectionName },
        ),
      },
      async (ctx) => {
        const now = new Date();
        const [archived] = await db
          .update(redirects)
          .set({ archivedAt: now, updatedAt: now })
          .where(
            and(
              eq(redirects.id, ctx.body.redirectId),
              eq(redirects.collection, collectionName),
              isNull(redirects.archivedAt),
              ctx.context.scope.redirects?.where,
            ),
          )
          .returning({ id: redirects.id });
        if (!archived) throw new CMSError('REDIRECT_NOT_FOUND');
        return { redirectId: archived.id };
      },
    ),

    /**
     * Lists all active redirects in the collection, with pagination and resolved current paths for page references.
     * Source and target page references are resolved to their current paths for display.
     * @param limit Maximum number of redirects to return (1–100; defaults to 50).
     * @param offset Number of redirects to skip (defaults to 0).
     * @returns An object with `redirects` (array of redirect objects with resolved paths), `total` (count of all active redirects), and `hasMore` (boolean indicating more results).
     * @example await cmsClient.pages.listRedirects({ limit: 25, offset: 0 })
     */
    listRedirects: createCMSEndpoint(
      `/${collectionName}/listRedirects`,
      {
        method: 'GET',
        query: z
          .object({
            limit: z.coerce.number().int().min(1).max(100).default(50),
            offset: z.coerce.number().int().min(0).default(0),
          })
          .optional(),
        metadata: cmsMeta(
          {
            $Infer: {
              query: {} as { limit?: number; offset?: number },
            },
          },
          { operation: 'read', ...REDIRECT_META, collection: collectionName },
        ),
      },
      async (ctx) => {
        if (!slugCfg?.enabled) {
          return { redirects: [], total: 0, hasMore: false };
        }
        const limit = ctx.query?.limit ?? 50;
        const offset = ctx.query?.offset ?? 0;
        const where = and(
          eq(redirects.collection, collectionName),
          isNull(redirects.archivedAt),
          ctx.context.scope.redirects?.where,
        );

        const rows = await db
          .select()
          .from(redirects)
          .where(where)
          .orderBy(desc(redirects.createdAt))
          .limit(limit)
          .offset(offset);

        const [{ count }] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(redirects)
          .where(where);

        // Resolve page references to their CURRENT path for display.
        const items = await Promise.all(
          rows.map(async (r) => ({
            ...r,
            sourceCurrentPath:
              r.sourceType === 'page' && r.sourceRootId
                ? await resolveRootCurrentPath(db, slugCfg, r.sourceRootId)
                : r.sourcePath,
            targetCurrentPath:
              r.targetType === 'page' && r.targetRootId
                ? await resolveRootCurrentPath(db, slugCfg, r.targetRootId)
                : r.targetPath,
          })),
        );

        return {
          redirects: items,
          total: count,
          hasMore: offset + items.length < count,
        };
      },
    ),
  };
}
