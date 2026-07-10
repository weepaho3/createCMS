import { APIError } from 'better-call';
import { and, asc, desc, eq } from 'drizzle-orm';
import * as z from 'zod';

import type { CMSProcedureContext } from '../types';
import type { ResolvedSlugConfig } from '../types/definitions';
import type { DrizzleInstance } from '../types/drizzle';

import { resolveBranchPolicy } from '../branch-policy';
import { branches, releaseItems, releases, roots } from '../db/schema.generated';
import { cmsMeta, createCMSEndpoint } from '../endpoint';
import { CMSError } from '../errors';
import { syncAssetsOnPublish } from '../media/discovery';
import { publishBranchInTx } from '../publish/publish-branch';

// ============================================================================
// Release-specific errors. These domain codes are NOT part of the core
// CMS_ERRORS registry (errors-data.ts), so they are raised as plain better-call
// APIErrors — the client still receives `{ code, message }` and can match on it
// via getCMSErrorCode, same as an unknown plugin code.
// ============================================================================

const RELEASE_NOT_FOUND = () =>
  new APIError(404, { code: 'RELEASE_NOT_FOUND', message: 'Release not found' });

const RELEASE_NOT_DRAFT = () =>
  new APIError(400, {
    code: 'RELEASE_NOT_DRAFT',
    message: 'Release is already published and can no longer be modified',
  });

const RELEASE_EMPTY = () =>
  new APIError(400, {
    code: 'RELEASE_EMPTY',
    message: 'Cannot publish a release with no items',
  });

const META = {
  scope: 'system' as const,
  permissionResource: 'release' as const,
};

/**
 * Validates that a (rootId, branchId) pair is a real root with a branch that
 * belongs to it, before it is added to a release. System-scoped: no per-collection
 * or plugin-scope filter (a release may span collections).
 *
 * @throws ROOT_NOT_FOUND / BRANCH_NOT_FOUND
 */
async function assertItemExists(
  db: DrizzleInstance,
  rootId: string,
  branchId: string,
): Promise<void> {
  const [root] = await db
    .select({ id: roots.id })
    .from(roots)
    .where(eq(roots.id, rootId));
  if (!root) throw new CMSError('ROOT_NOT_FOUND');

  const [branch] = await db
    .select({ id: branches.id })
    .from(branches)
    .where(and(eq(branches.id, branchId), eq(branches.rootId, rootId)));
  if (!branch) throw new CMSError('BRANCH_NOT_FOUND');
}

export function createReleaseEndpoints(cmsCtx: CMSProcedureContext) {
  const { db } = cmsCtx;

  return {
    /**
     * Creates a new draft release — an empty bundle to which pages are added and
     * then published atomically via publishRelease.
     *
     * @param title Human-readable name for the release.
     * @returns Object with the created `release` (id, title, status:'draft', createdBy, createdAt, publishedAt:null).
     * @example
     * const { release } = await cmsClient.releases.createRelease({ title: 'Spring launch' });
     */
    createRelease: createCMSEndpoint(
      '/releases/createRelease',
      {
        method: 'POST',
        body: z.object({ title: z.string().min(1) }),
        metadata: cmsMeta(
          { $Infer: { body: {} as { title: string } } },
          { ...META, operation: 'create' },
        ),
      },
      async (ctx) => {
        const [release] = await db
          .insert(releases)
          .values({
            title: ctx.body.title,
            createdBy: ctx.context.userId ?? null,
          })
          .returning();
        return { release };
      },
    ),

    /**
     * Adds (or updates) one page in a draft release. Upserts on (releaseId, rootId):
     * re-adding a root that is already in the release swaps which branch it will
     * publish. Validates the root and branch up front.
     *
     * @param releaseId The draft release to add to.
     * @param rootId The root (page) to include.
     * @param branchId The branch of that root to publish when the release publishes.
     * @returns Object with the created/updated `item` (id, releaseId, rootId, branchId).
     * @throws RELEASE_NOT_FOUND / RELEASE_NOT_DRAFT / ROOT_NOT_FOUND / BRANCH_NOT_FOUND
     */
    addToRelease: createCMSEndpoint(
      '/releases/addToRelease',
      {
        method: 'POST',
        body: z.object({
          releaseId: z.string(),
          rootId: z.string(),
          branchId: z.string(),
        }),
        metadata: cmsMeta(
          {
            $Infer: {
              body: {} as {
                releaseId: string;
                rootId: string;
                branchId: string;
              },
            },
          },
          { ...META, operation: 'update' },
        ),
      },
      async (ctx) => {
        const { releaseId, rootId, branchId } = ctx.body;
        await assertDraftRelease(db, releaseId);
        await assertItemExists(db, rootId, branchId);

        const [item] = await db
          .insert(releaseItems)
          .values({ releaseId, rootId, branchId })
          .onConflictDoUpdate({
            target: [releaseItems.releaseId, releaseItems.rootId],
            set: { branchId },
          })
          .returning();
        return { item };
      },
    ),

    /**
     * Removes one page (by rootId) from a draft release.
     *
     * @param releaseId The draft release.
     * @param rootId The root to remove.
     * @returns Object with `removed` (true if a matching item was deleted).
     * @throws RELEASE_NOT_FOUND / RELEASE_NOT_DRAFT
     */
    removeFromRelease: createCMSEndpoint(
      '/releases/removeFromRelease',
      {
        method: 'POST',
        body: z.object({ releaseId: z.string(), rootId: z.string() }),
        metadata: cmsMeta(
          {
            $Infer: { body: {} as { releaseId: string; rootId: string } },
          },
          { ...META, operation: 'update' },
        ),
      },
      async (ctx) => {
        const { releaseId, rootId } = ctx.body;
        await assertDraftRelease(db, releaseId);
        const deleted = await db
          .delete(releaseItems)
          .where(
            and(
              eq(releaseItems.releaseId, releaseId),
              eq(releaseItems.rootId, rootId),
            ),
          )
          .returning({ id: releaseItems.id });
        return { removed: deleted.length > 0 };
      },
    ),

    /**
     * Replaces the entire item set of a draft release in one shot. Every item is
     * validated first; then the old items are cleared and the new set inserted in a
     * single transaction.
     *
     * @param releaseId The draft release.
     * @param items The complete new list of { rootId, branchId } members.
     * @returns Object with the resulting `items` array.
     * @throws RELEASE_NOT_FOUND / RELEASE_NOT_DRAFT / ROOT_NOT_FOUND / BRANCH_NOT_FOUND
     */
    setReleaseItems: createCMSEndpoint(
      '/releases/setReleaseItems',
      {
        method: 'POST',
        body: z.object({
          releaseId: z.string(),
          items: z.array(
            z.object({ rootId: z.string(), branchId: z.string() }),
          ),
        }),
        metadata: cmsMeta(
          {
            $Infer: {
              body: {} as {
                releaseId: string;
                items: { rootId: string; branchId: string }[];
              },
            },
          },
          { ...META, operation: 'update' },
        ),
      },
      async (ctx) => {
        const { releaseId, items } = ctx.body;
        await assertDraftRelease(db, releaseId);

        // Reject duplicate roots up front — the (releaseId, rootId) unique index
        // would otherwise fail the insert mid-transaction with an opaque DB error.
        const seen = new Set<string>();
        for (const it of items) {
          if (seen.has(it.rootId)) {
            throw new APIError(400, {
              code: 'RELEASE_DUPLICATE_ROOT',
              message: `Root "${it.rootId}" appears more than once in the release items`,
            });
          }
          seen.add(it.rootId);
          await assertItemExists(db, it.rootId, it.branchId);
        }

        const result = await db.transaction(async (tx) => {
          await tx
            .delete(releaseItems)
            .where(eq(releaseItems.releaseId, releaseId));
          if (items.length === 0) return [];
          return tx
            .insert(releaseItems)
            .values(
              items.map((it) => ({
                releaseId,
                rootId: it.rootId,
                branchId: it.branchId,
              })),
            )
            .returning();
        });
        return { items: result };
      },
    ),

    /**
     * Reads a release with its items.
     *
     * @param releaseId The release to fetch.
     * @returns Object with `release` and its `items` array.
     * @throws RELEASE_NOT_FOUND
     */
    getRelease: createCMSEndpoint(
      '/releases/getRelease',
      {
        method: 'GET',
        query: z.object({ releaseId: z.string() }),
        metadata: cmsMeta(
          { $Infer: { query: {} as { releaseId: string } } },
          { ...META, operation: 'read' },
        ),
      },
      async (ctx) => {
        const [release] = await db
          .select()
          .from(releases)
          .where(eq(releases.id, ctx.query.releaseId));
        if (!release) throw RELEASE_NOT_FOUND();

        const items = await db
          .select()
          .from(releaseItems)
          .where(eq(releaseItems.releaseId, ctx.query.releaseId));
        return { release, items };
      },
    ),

    /**
     * Lists releases, newest first.
     *
     * @param status Optional filter to 'draft' or 'published'.
     * @param limit Page size (default 20, max 100).
     * @param offset Rows to skip (default 0).
     * @returns Object with `releases` array, `total`, and `hasMore`.
     */
    listReleases: createCMSEndpoint(
      '/releases/listReleases',
      {
        method: 'GET',
        query: z
          .object({
            status: z.enum(['draft', 'published']).optional(),
            limit: z.coerce.number().min(1).max(100).optional(),
            offset: z.coerce.number().min(0).optional(),
          })
          .optional(),
        metadata: cmsMeta(
          {
            $Infer: {
              query: {} as {
                status?: 'draft' | 'published';
                limit?: number;
                offset?: number;
              },
            },
          },
          { ...META, operation: 'read' },
        ),
      },
      async (ctx) => {
        const limit = ctx.query?.limit ?? 20;
        const offset = ctx.query?.offset ?? 0;
        const where = ctx.query?.status
          ? eq(releases.status, ctx.query.status)
          : undefined;

        const rows = await db
          .select()
          .from(releases)
          .where(where)
          .orderBy(desc(releases.createdAt))
          .limit(limit)
          .offset(offset);

        const all = await db
          .select({ id: releases.id })
          .from(releases)
          .where(where);
        const total = all.length;

        return {
          releases: rows,
          total,
          hasMore: offset + rows.length < total,
        };
      },
    ),

    /**
     * Publishes every item in a release ATOMICALLY. Runs the same per-root publish
     * machinery as pages.publishBranch for each item inside ONE database
     * transaction: if any item fails (e.g. an unapproved branch under a policy that
     * requires approval), the whole set rolls back and nothing goes live. On
     * success the release flips to 'published'. Asset sync runs best-effort per
     * item after commit.
     *
     * @param releaseId The draft release to publish.
     * @param publishedBy Optional actor override; defaults to the current user.
     * @returns Object with the updated `release` and the `publications` produced (one per item).
     * @throws RELEASE_NOT_FOUND / RELEASE_NOT_DRAFT / RELEASE_EMPTY / ROOT_NOT_FOUND / BRANCH_NOT_FOUND / PUBLICATION_APPROVAL_REQUIRED
     */
    publishRelease: createCMSEndpoint(
      '/releases/publishRelease',
      {
        method: 'POST',
        body: z.object({
          releaseId: z.string(),
          publishedBy: z.string().optional(),
        }),
        metadata: cmsMeta(
          {
            $Infer: {
              body: {} as { releaseId: string; publishedBy?: string },
            },
          },
          { ...META, operation: 'update' },
        ),
      },
      async (ctx) => {
        const { releaseId, publishedBy } = ctx.body;
        const actor = ctx.context.userId ?? publishedBy ?? 'system';

        // Everything below commits or rolls back together — the atomicity guarantee.
        const synced: { commitId: string; rootId: string }[] = [];
        const outcome = await db.transaction(async (tx) => {
          const [release] = await tx
            .select()
            .from(releases)
            .where(eq(releases.id, releaseId))
            .for('update');
          if (!release) throw RELEASE_NOT_FOUND();
          if (release.status !== 'draft') throw RELEASE_NOT_DRAFT();

          const items = await tx
            .select({
              rootId: releaseItems.rootId,
              branchId: releaseItems.branchId,
            })
            .from(releaseItems)
            .where(eq(releaseItems.releaseId, releaseId))
            .orderBy(asc(releaseItems.rootId));
          if (items.length === 0) throw RELEASE_EMPTY();

          const publications: Array<
            Awaited<ReturnType<typeof publishBranchInTx>>['publication']
          > = [];
          for (const item of items) {
            // Resolve the host collection so each page publishes under its own
            // collection's branch policy — one release may span collections.
            const [rootRow] = await tx
              .select({ collection: roots.collection })
              .from(roots)
              .where(eq(roots.id, item.rootId));
            if (!rootRow) throw new CMSError('ROOT_NOT_FOUND');

            const def = cmsCtx.collections[rootRow.collection];
            const branchPolicy = resolveBranchPolicy(
              cmsCtx,
              def?.branchProtection,
            );

            const { publication, commitId } = await publishBranchInTx(tx, {
              collectionName: rootRow.collection,
              rootId: item.rootId,
              branchId: item.branchId,
              actor,
              branchPolicy,
              // cms-05: materialize the versioned draft slug on publish. A
              // PUBLISH_SLUG_CONFLICT here rolls the whole atomic release back.
              slugConfig: def?.slug as ResolvedSlugConfig | undefined,
              // A release publishes WITHIN the caller's request scope, so forward
              // it for every item exactly like the single publishBranch endpoint.
              // Without it, slug uniqueness is checked across ALL tenants (a false
              // cross-tenant PUBLISH_SLUG_CONFLICT) and the old→new redirect insert
              // omits the tenant_slug scope column (a NOT-NULL violation) under the
              // multi-tenant plugin.
              scopeWhere: ctx.context.scope.roots?.where,
              rootScope: ctx.context.scope.roots,
              redirectScope: ctx.context.scope.redirects,
            });
            publications.push(publication);
            synced.push({ commitId, rootId: item.rootId });
          }

          const [updated] = await tx
            .update(releases)
            .set({ status: 'published', publishedAt: new Date() })
            .where(eq(releases.id, releaseId))
            .returning();

          return { release: updated, publications };
        });

        // Post-commit, best-effort: the publications are already durable.
        for (const s of synced) {
          await syncAssetsOnPublish(db, s.commitId, s.rootId).catch((err) =>
            console.error('[cms] release publish asset sync failed:', err),
          );
        }

        return outcome;
      },
    ),
  };
}

/**
 * Loads a release and asserts it exists and is still a draft (mutable). Item
 * mutations and publishRelease all gate on this.
 *
 * @throws RELEASE_NOT_FOUND / RELEASE_NOT_DRAFT
 */
async function assertDraftRelease(
  db: DrizzleInstance,
  releaseId: string,
): Promise<void> {
  const [release] = await db
    .select({ status: releases.status })
    .from(releases)
    .where(eq(releases.id, releaseId));
  if (!release) throw RELEASE_NOT_FOUND();
  if (release.status !== 'draft') throw RELEASE_NOT_DRAFT();
}
