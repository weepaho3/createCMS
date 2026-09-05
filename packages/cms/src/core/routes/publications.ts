import { and, asc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import * as z from 'zod';

import type {
  AnyCollectionDefinition,
  CMSProcedureContext,
  CollectionWithName,
  InferBlockTreeNode,
} from '../types';
import type { ResolvedSlugConfig } from '../types/definitions';
import type { DrizzleInstance } from '../types/drizzle';

import {
  assembleBlockTree,
  loadBlocksAtCommit,
  withRootSlug,
} from '../blocks/reconstruct-snapshot';
import { resolveBranchPolicy } from '../branch-policy';
import {
  blockVersions,
  branches,
  commitSnapshots,
  publications,
  roots,
  scheduledPublications,
} from '../db/schema.generated';
import { cmsMeta, createCMSEndpoint } from '../endpoint';
import { CMSError, errorMessages } from '../errors';
import { resolveLinkPaths } from '../links';
import { syncAssetsOnPublish, syncAssetsOnUnpublish } from '../media/discovery';
import {
  publishBranchInTx,
  unpublishBranchInTx,
} from '../publish/publish-branch';
import { coreReferenceResolver } from '../references';
import { resolveTreeReferences } from '../references-render';
import { crossScopeColumns } from '../scope';
import {
  normalizeSlug,
  resolveAncestors,
  resolvePathToRootId,
  splitPath,
} from '../slug';
import { userEnrichment } from '../user/enrichment';
import { parseTimestampOrNull } from '../utils/parse-timestamp';
import { wireBooleanIsTrue, wireBooleanSchema } from '../utils/wire-boolean';
import { loadVariables, substituteVariables } from '../variables';

type PublishedContentQuery =
  | {
      rootId: string;
      slug?: string;
      path?: string;
      raw?: boolean;
      branchName?: string;
    }
  | {
      rootId?: string;
      slug: string;
      path?: string;
      raw?: boolean;
      branchName?: string;
    }
  | {
      rootId?: string;
      slug?: string;
      path: string;
      raw?: boolean;
      branchName?: string;
    };

/**
 * Validates a root (in scope + collection) and branch, then queues one future
 * publish/unpublish intent in `scheduled_publications`. Shared by the
 * schedulePublication / scheduleUnpublish endpoints.
 *
 * @throws ROOT_NOT_FOUND / BRANCH_NOT_FOUND
 */
async function queueScheduledAction(
  db: DrizzleInstance,
  params: {
    collectionName: string;
    rootId: string;
    branchId: string;
    action: 'publish' | 'unpublish';
    scheduledAt: Date;
    createdBy?: string;
    scopeWhere?: SQL | undefined;
  },
) {
  const {
    collectionName,
    rootId,
    branchId,
    action,
    scheduledAt,
    createdBy,
    scopeWhere,
  } = params;

  const [root] = await db
    .select({ id: roots.id })
    .from(roots)
    .where(
      and(
        eq(roots.id, rootId),
        eq(roots.collection, collectionName),
        scopeWhere,
      ),
    );
  if (!root) throw new CMSError('ROOT_NOT_FOUND');

  const [branch] = await db
    .select({ id: branches.id })
    .from(branches)
    .where(and(eq(branches.id, branchId), eq(branches.rootId, rootId)));
  if (!branch) throw new CMSError('BRANCH_NOT_FOUND');

  const [row] = await db
    .insert(scheduledPublications)
    .values({
      rootId,
      branchId,
      action,
      scheduledAt,
      createdBy: createdBy ?? null,
    })
    .returning();
  return row;
}

export function createPublicationEndpoints<
  TDef extends CollectionWithName,
  TCollections extends Record<string, AnyCollectionDefinition> = {},
>(def: TDef, cmsCtx: CMSProcedureContext) {
  const { db } = cmsCtx;
  const collectionName = def.name;
  const branchPolicy = resolveBranchPolicy(cmsCtx, def.branchProtection);

  return {
    /**
     * Creates or updates a publication of a branch, making its content publicly available.
     * Requires all approval requests (if any) to be approved before publishing.
     *
     * @param rootId The root to publish.
     * @param branchId The branch whose head commit should be published.
     * @param publishedBy Optional override for the actor performing the publication; defaults to the current user.
     *
     * @returns Object with the publication entity ({ publication }) containing rootId, branchId, commitId, publishedBy, publishedAt, and branchName.
     *
     * @throws ROOT_NOT_FOUND The root does not exist or is outside the active scope.
     * @throws BRANCH_NOT_FOUND The branch does not exist or belongs to a different root.
     * @throws PUBLICATION_APPROVAL_REQUIRED The branch has open approval requests that are not all approved.
     *
     * @example
     * const pub = await cmsClient.pages.publishBranch({
     *   rootId: 'root_123',
     *   branchId: 'branch_456'
     * });
     */
    publishBranch: createCMSEndpoint(
      `/${collectionName}/publishBranch`,
      {
        method: 'POST',
        body: z.object({
          rootId: z.string(),
          branchId: z.string(),
          publishedBy: z.string().optional(),
        }),
        metadata: cmsMeta(
          {
            $Infer: {
              body: {} as {
                rootId: string;
                branchId: string;
                publishedBy?: string;
              },
            },
          },
          {
            permissionResource: 'publication',
            operation: 'create',
            scope: 'collection',
            collection: collectionName,
          },
        ),
      },
      async (ctx) => {
        const { rootId, branchId, publishedBy } = ctx.body;
        const actor = ctx.context.userId ?? publishedBy ?? 'system';

        const { publication } = await db.transaction((tx) =>
          publishBranchInTx(tx, {
            collectionName,
            rootId,
            branchId,
            actor,
            branchPolicy,
            scopeWhere: ctx.context.scope.roots?.where,
            // Materialize the versioned draft slug on publish.
            slugConfig: def.slug as ResolvedSlugConfig | undefined,
            rootScope: ctx.context.scope.roots,
            redirectScope: ctx.context.scope.redirects,
          }),
        );

        await syncAssetsOnPublish(db, publication.commitId, rootId);

        // Stays bespoke (not on withNotifications): the recipient (branch
        // creator) is read AFTER commit, and the notify must fire AFTER asset
        // sync — withNotifications flushes on commit, before syncAssetsOnPublish.
        if (cmsCtx.notificationService) {
          const [branch] = await db
            .select({ createdBy: branches.createdBy })
            .from(branches)
            .where(eq(branches.id, branchId));

          if (branch?.createdBy && branch.createdBy !== actor) {
            cmsCtx.notificationService
              .notify({
                recipientId: branch.createdBy,
                actorId: actor,
                type: 'published',
                title: 'Content published',
                body: null,
                resourceType: 'root',
                resourceId: rootId,
                collection: collectionName,
                meta: {
                  rootId,
                  branchId,
                  commitId: publication.commitId,
                },
              })
              .catch((err) =>
                console.error('[cms] publish notification failed:', err),
              );
          }
        }

        return { publication };
      },
    ),

    /**
     * Removes a publication, taking the branch's content offline.
     *
     * @param rootId The root whose publication to remove.
     * @param branchId The branch whose publication to remove.
     *
     * @returns Object with rootId, branchId, the unpublishedCommitId that was live, and unpublishedAt.
     *
     * @throws ROOT_NOT_FOUND The root does not exist or is outside the active scope.
     * @throws PUBLICATION_NOT_FOUND No active publication exists for this root-branch pair.
     *
     * @example
     * const result = await cmsClient.pages.unpublishBranch({
     *   rootId: 'root_123',
     *   branchId: 'branch_456'
     * });
     */
    unpublishBranch: createCMSEndpoint(
      `/${collectionName}/unpublishBranch`,
      {
        method: 'POST',
        body: z.object({
          rootId: z.string(),
          branchId: z.string(),
        }),
        metadata: cmsMeta(
          {
            $Infer: {
              body: {} as {
                rootId: string;
                branchId: string;
              },
            },
          },
          {
            permissionResource: 'publication',
            operation: 'delete',
            scope: 'collection',
            collection: collectionName,
          },
        ),
      },
      async (ctx) => {
        const { rootId, branchId } = ctx.body;

        const { commitId } = await db.transaction((tx) =>
          unpublishBranchInTx(tx, {
            collectionName,
            rootId,
            branchId,
            scopeWhere: ctx.context.scope.roots?.where,
          }),
        );

        await syncAssetsOnUnpublish(db, commitId, rootId, branchId);

        return {
          rootId,
          branchId,
          unpublishedCommitId: commitId,
          unpublishedAt: new Date(),
        };
      },
    ),

    /**
     * Schedules a future publish of a branch. Queues a `scheduled_publications`
     * intent; nothing goes live until `admin.runScheduled` (cron-driven) processes
     * due rows. Validates the root (in scope) and branch up front.
     *
     * @param rootId The root to publish when due.
     * @param branchId The branch whose head commit is published when due.
     * @param scheduledAt When the publish becomes due (ISO string or Date).
     *
     * @returns Object with the queued `scheduled` row (id, rootId, branchId, action:'publish', scheduledAt, processedAt:null).
     *
     * @throws ROOT_NOT_FOUND The root does not exist or is outside the active scope.
     * @throws BRANCH_NOT_FOUND The branch does not exist or belongs to a different root.
     *
     * @example
     * await cmsClient.pages.schedulePublication({
     *   rootId: 'root_123', branchId: 'branch_456',
     *   scheduledAt: '2026-01-01T00:00:00Z',
     * });
     */
    schedulePublication: createCMSEndpoint(
      `/${collectionName}/schedulePublication`,
      {
        method: 'POST',
        body: z.object({
          rootId: z.string(),
          branchId: z.string(),
          scheduledAt: z.coerce.date(),
        }),
        metadata: cmsMeta(
          {
            $Infer: {
              body: {} as {
                rootId: string;
                branchId: string;
                scheduledAt: Date;
              },
            },
          },
          {
            permissionResource: 'publication',
            operation: 'create',
            scope: 'collection',
            collection: collectionName,
          },
        ),
      },
      async (ctx) => {
        const { rootId, branchId, scheduledAt } = ctx.body;
        const scheduled = await queueScheduledAction(db, {
          collectionName,
          rootId,
          branchId,
          action: 'publish',
          scheduledAt,
          createdBy: ctx.context.userId,
          scopeWhere: ctx.context.scope.roots?.where,
        });
        return { scheduled };
      },
    ),

    /**
     * Schedules a future unpublish (expiry) of a branch. Queues a
     * `scheduled_publications` intent with action 'unpublish'; the content is
     * taken offline when `admin.runScheduled` processes the due row. Use this to
     * expire content at a given time. Validates the root (in scope) and branch.
     *
     * @param rootId The root to unpublish when due.
     * @param branchId The branch whose publication is removed when due.
     * @param scheduledAt When the unpublish/expiry becomes due (ISO string or Date).
     *
     * @returns Object with the queued `scheduled` row (id, rootId, branchId, action:'unpublish', scheduledAt, processedAt:null).
     *
     * @throws ROOT_NOT_FOUND The root does not exist or is outside the active scope.
     * @throws BRANCH_NOT_FOUND The branch does not exist or belongs to a different root.
     *
     * @example
     * await cmsClient.pages.scheduleUnpublish({
     *   rootId: 'root_123', branchId: 'branch_456',
     *   scheduledAt: '2026-02-01T00:00:00Z',
     * });
     */
    scheduleUnpublish: createCMSEndpoint(
      `/${collectionName}/scheduleUnpublish`,
      {
        method: 'POST',
        body: z.object({
          rootId: z.string(),
          branchId: z.string(),
          scheduledAt: z.coerce.date(),
        }),
        metadata: cmsMeta(
          {
            $Infer: {
              body: {} as {
                rootId: string;
                branchId: string;
                scheduledAt: Date;
              },
            },
          },
          {
            permissionResource: 'publication',
            operation: 'delete',
            scope: 'collection',
            collection: collectionName,
          },
        ),
      },
      async (ctx) => {
        const { rootId, branchId, scheduledAt } = ctx.body;
        const scheduled = await queueScheduledAction(db, {
          collectionName,
          rootId,
          branchId,
          action: 'unpublish',
          scheduledAt,
          createdBy: ctx.context.userId,
          scopeWhere: ctx.context.scope.roots?.where,
        });
        return { scheduled };
      },
    ),

    /**
     * Retrieves published content for a root, optionally resolving embedded references and substituting variables.
     * Lookup is possible by rootId, slug, or path; at least one must be provided.
     * References are resolved inline into ResolvedReference objects; pass raw=true to skip variable substitution.
     *
     * (Draft reads use the split getRoot / getRootBySlug endpoints; this public
     *  read multiplexes rootId|slug|path on purpose — see getRoot's @remarks.)
     *
     * @param rootId Optional root identifier to fetch directly.
     * @param slug Optional slug to resolve to a root; must be unique within the active scope.
     * @param path Optional path (for nested slugs) to resolve to a root.
     * @param raw If true, skip variable substitution; otherwise variables are inlined into block properties.
     * @param branchName Optional published-branch selector. When provided, only that branch is resolved and returned (a length-1 `variants` array, identical shape); the page-level `abTest` descriptor is omitted. When omitted, every published branch is returned (unchanged contract). Throws PUBLISHED_CONTENT_NOT_FOUND if the named branch has no published content.
     *
     * @returns Object with rootId, collection, variants (each with branchId, branchName, commitId, publishedAt, publishedBy, and a resolved block tree), and optionally ancestors (for nested slugs).
     *
     * @throws PUBLISHED_CONTENT_NOT_FOUND No published content found for the given lookup; the root does not exist, is archived, is outside scope, or has no publication.
     * @throws AMBIGUOUS_SLUG Multiple roots match the slug within the active scope.
     *
     * @example
     * const content = await cmsClient.pages.getPublishedContent({
     *   rootId: 'root_123'
     * });
     */
    getPublishedContent: createCMSEndpoint(
      `/${collectionName}/getPublishedContent`,
      {
        method: 'GET',
        query: z.union([
          z.object({
            rootId: z.string(),
            slug: z.string().optional(),
            path: z.string().optional(),
            raw: wireBooleanSchema.optional(),
            branchName: z.string().optional(),
          }),
          z.object({
            rootId: z.string().optional(),
            slug: z.string(),
            path: z.string().optional(),
            raw: wireBooleanSchema.optional(),
            branchName: z.string().optional(),
          }),
          z.object({
            rootId: z.string().optional(),
            slug: z.string().optional(),
            path: z.string(),
            raw: wireBooleanSchema.optional(),
            branchName: z.string().optional(),
          }),
        ]),
        // Published content is read through the full chain so plugin scope
        // (e.g. multi-tenant) is enforced. It is meant to be publicly readable,
        // so the consumer's authMiddleware should allow anonymous reads for
        // `permissionResource: 'publishedContent'` (it still receives the
        // request, so it can resolve the request scope).
        metadata: cmsMeta(
          { $Infer: { query: {} as PublishedContentQuery } },
          {
            permissionResource: 'publishedContent',
            operation: 'read',
            scope: 'collection',
            collection: collectionName,
          },
        ),
      },
      async (ctx) => {
        const { rootId, slug, path, branchName } = ctx.query;
        const raw = wireBooleanIsTrue(ctx.query.raw);
        const scope = ctx.context.scope;
        const slugCfg = def.slug as ResolvedSlugConfig | undefined;

        let resolvedRootId: string;

        if (rootId) {
          resolvedRootId = rootId;
        } else if (path && slugCfg?.enabled) {
          const segments = splitPath(slugCfg, path);
          // Resolve WITHIN the active root scope so same-slug-per-scope pages
          // (e.g. /blog per scope dimension) resolve to the right one
          // rather than an arbitrary sibling the scope gate below would reject.
          const found = await resolvePathToRootId(
            db,
            collectionName,
            segments,
            scope.roots?.insertColumns,
          );
          if (!found) throw new CMSError('PUBLISHED_CONTENT_NOT_FOUND');
          resolvedRootId = found;
        } else if (slug) {
          const lookupSlug =
            slugCfg?.enabled && slugCfg.normalize ? normalizeSlug(slug) : slug;
          type SlugRow = { root_id: string };
          // roots is left un-aliased so scope.roots.where (which references
          // "cms"."roots") binds; this scopes slug resolution per scope so an
          // identical slug outside the active scope neither resolves nor trips the
          // ambiguity check.
          const slugResult = await db.execute(sql`
            SELECT DISTINCT p.root_id
            FROM cms.publications p
            JOIN cms.roots ON cms.roots.id = p.root_id
            WHERE cms.roots.collection = ${collectionName}
              AND cms.roots.slug = ${lookupSlug}
              ${scope.roots?.where ? sql`AND ${scope.roots.where}` : sql``}
          `);

          const slugRows = slugResult.rows as SlugRow[];

          if (slugRows.length === 0) {
            throw new CMSError('PUBLISHED_CONTENT_NOT_FOUND');
          }
          if (slugRows.length > 1) {
            throw new CMSError('AMBIGUOUS_SLUG');
          }

          resolvedRootId = slugRows[0].root_id;
        } else {
          throw new CMSError('PUBLISHED_CONTENT_NOT_FOUND');
        }

        // Scope gate: even if a slug/path/rootId resolved to a root outside the active
        // scope, this scoped lookup rejects it (scope.roots.where is the
        // plugin-injected scope predicate; undefined when no scoping applies).
        const [root] = await db
          .select({ id: roots.id, collection: roots.collection })
          .from(roots)
          .where(
            and(
              eq(roots.id, resolvedRootId),
              eq(roots.collection, collectionName),
              isNull(roots.archivedAt),
              scope.roots?.where,
            ),
          );
        if (!root) throw new CMSError('PUBLISHED_CONTENT_NOT_FOUND');

        const pubs = await db
          .select({
            branchId: publications.branchId,
            headCommitId: branches.headCommitId,
            publishedAt: publications.publishedAt,
            publishedBy: publications.publishedBy,
            branchName: branches.name,
          })
          .from(publications)
          .innerJoin(branches, eq(branches.id, publications.branchId))
          // Optional single-branch selector: when `branchName` is given, resolve
          // ONLY that published branch (still returned as a length-1 `variants[]`
          // — identical shape) instead of materializing every published branch.
          // Omitted → unchanged contract (all published branches). Branch names
          // are unique per root, so this yields at most one row.
          .where(
            branchName
              ? and(
                  eq(publications.rootId, resolvedRootId),
                  eq(branches.name, branchName),
                )
              : eq(publications.rootId, resolvedRootId),
          )
          // Deterministic variant order (oldest publish first, branchId as the
          // stable tiebreak) — so `variants[0]` is a stable control default and
          // the cache key for a variant render is reproducible.
          .orderBy(asc(publications.publishedAt), asc(publications.branchId));

        if (pubs.length === 0) {
          throw new CMSError('PUBLISHED_CONTENT_NOT_FOUND');
        }

        const variants = await Promise.all(
          pubs.map(async (pub) => {
            const { blocks } = await loadBlocksAtCommit(
              db,
              pub.headCommitId,
              resolvedRootId,
            );

            // Public render path — strip the reserved `__slug` draft key
            // so it never reaches the rendered tree, variable substitution, or
            // link/reference resolution below.
            const tree = assembleBlockTree(blocks, resolvedRootId, {
              stripReservedProps: true,
            });
            // The scoped root lookup already passed: a null tree is a snapshot
            // state (e.g. soft-deleted root block version), not a scope miss.
            if (!tree) {
              throw new CMSError('ROOT_NOT_FOUND', {
                message: errorMessages.rootMissingFromSnapshot,
              });
            }

            await resolveTreeReferences(
              db,
              tree,
              def,
              cmsCtx.collections,
              scope.referenceResolver ?? coreReferenceResolver,
              crossScopeColumns(scope.roots),
              new Set([resolvedRootId]),
              0,
              scope.abTestResolver,
            );

            return {
              branchId: pub.branchId,
              branchName: pub.branchName,
              commitId: pub.headCommitId,
              publishedAt: pub.publishedAt,
              publishedBy: pub.publishedBy,
              tree,
            };
          }),
        );

        if (!raw) {
          const vars = await loadVariables(db, ctx.context.scope);
          const scope = ctx.context.scope;
          for (const variant of variants) {
            substituteVariables(variant.tree, vars);
            // Resolve link properties to their current language-aware href.
            await resolveLinkPaths(
              db,
              variant.tree,
              def,
              cmsCtx.collections,
              scope.referenceResolver ?? coreReferenceResolver,
              crossScopeColumns(scope.roots),
            );
          }
        }

        // Page-LEVEL A/B test descriptor: when the PAGE root
        // itself has a running test, expose which published branch is the
        // control + the test id, so the variant-coded render route picks the
        // right page branch and the default (control) route renders the actual
        // control — not an arbitrary `variants[0]`. Embedded-block tests ride on
        // the per-reference `abTest` field instead. Degrades (omitted) unless ≥2
        // variant branches and the control are published.
        let pageAbTest:
          | {
              testId: string;
              trafficPercentage: number;
              controlBranchId: string;
            }
          | undefined;
        // Skipped when a single branch was explicitly selected: the caller asked
        // for one specific branch, so the page-level A/B descriptor is moot (and
        // the filtered `pubs` no longer reflects the full published-variant set).
        if (scope.abTestResolver && !branchName) {
          const running = await scope.abTestResolver.runningTests(
            db,
            crossScopeColumns(scope.roots),
            [resolvedRootId],
          );
          const test = running.get(resolvedRootId);
          if (test) {
            const published = new Set(pubs.map((p) => p.branchId));
            const publishedVariants = test.variants.filter((v) =>
              published.has(v.branchId),
            );
            const control = publishedVariants.find((v) => v.isControl);
            if (control && publishedVariants.length >= 2) {
              pageAbTest = {
                testId: test.testId,
                trafficPercentage: test.trafficPercentage,
                controlBranchId: control.branchId,
              };
            }
          }
        }

        const response: {
          rootId: string;
          collection: string;
          variants: typeof variants;
          abTest?: {
            testId: string;
            trafficPercentage: number;
            controlBranchId: string;
          };
          ancestors?: { rootId: string; slug: string | null }[];
        } = {
          rootId: resolvedRootId,
          collection: root.collection,
          variants,
        };
        if (pageAbTest) response.abTest = pageAbTest;

        if (slugCfg?.enabled && slugCfg.nested) {
          const ancestors = await resolveAncestors(
            db,
            resolvedRootId,
            scope.roots?.insertColumns
              ? Object.keys(scope.roots.insertColumns)
              : undefined,
          );
          response.ancestors = ancestors.map((a) => ({
            rootId: a.rootId,
            slug: a.slug,
          }));
        }

        // Retype ONLY the dynamic `tree` leaf per variant — not the whole
        // response. The raw assembled tree carries the schema-less BlockTreeNode
        // shape (required by the variable/link mutations above); the API surface
        // narrows it to the `resolved`-mode inferred tree. Every other field
        // flows through the spreads with its real, structurally-checked type.
        return {
          ...response,
          variants: response.variants.map((variant) => ({
            ...variant,
            // `resolved` mode: getPublishedContent inlines references, so a
            // `reference` property surfaces as a ResolvedReference whose
            // `properties` are typed from the TARGET collection's root (via
            // the threaded collections map). The editor read getBlockTree keeps
            // the raw rootId string via the default mode.
            tree: variant.tree as InferBlockTreeNode<
              TDef['blocks'],
              TDef['root']['properties'],
              'resolved',
              TCollections
            >,
          })),
        };
      },
    ),

    /**
     * Lists publications for a collection, with optional filtering by root, branch, or date range.
     *
     * @param limit Maximum number of results; defaults to 20, capped at 100.
     * @param offset Number of results to skip; defaults to 0.
     * @param rootId Optional filter to publications of a specific root.
     * @param branchId Optional filter to publications of a specific branch.
     * @param publishedAfter Optional filter to publications on or after this date.
     * @param publishedBefore Optional filter to publications on or before this date.
     * @param sortDirection Sort direction: 'asc' or 'desc'; defaults to 'desc' (newest first).
     *
     * @returns Object with publications array (each item includes rootId, branchId, commitId, publishedBy, publishedAt, branchName, rootProperties, and optionally publishedByUser if user enrichment is enabled), total count, and hasMore flag.
     */
    listPublications: createCMSEndpoint(
      `/${collectionName}/listPublications`,
      {
        method: 'GET',
        query: z
          .object({
            limit: z.coerce.number().min(1).max(100).optional(),
            offset: z.coerce.number().min(0).optional(),
            rootId: z.string().optional(),
            branchId: z.string().optional(),
            publishedAfter: z.coerce.date().optional(),
            publishedBefore: z.coerce.date().optional(),
            sortDirection: z.enum(['asc', 'desc']).optional(),
          })
          .optional(),
        metadata: cmsMeta(
          {
            $Infer: {
              query: {} as {
                limit?: number;
                offset?: number;
                rootId?: string;
                branchId?: string;
                publishedAfter?: Date;
                publishedBefore?: Date;
                sortDirection?: 'asc' | 'desc';
              },
            },
          },
          {
            permissionResource: 'publication',
            operation: 'read',
            scope: 'collection',
            collection: collectionName,
          },
        ),
      },
      async (ctx) => {
        const input = ctx.query ?? {};
        const limit = input.limit ?? 20;
        const offset = input.offset ?? 0;
        const sortDirection = input.sortDirection ?? 'desc';

        // Exclude publications whose root was soft-deleted (roots.archived_at).
        const conditions = [
          eq(roots.collection, collectionName),
          isNull(roots.archivedAt),
        ];
        if (input.rootId) {
          conditions.push(eq(publications.rootId, input.rootId));
        }
        if (input.branchId) {
          conditions.push(eq(publications.branchId, input.branchId));
        }
        if (input.publishedAfter) {
          conditions.push(
            sql`${publications.publishedAt} >= ${input.publishedAfter.toISOString()}::timestamp`,
          );
        }
        if (input.publishedBefore) {
          conditions.push(
            sql`${publications.publishedAt} <= ${input.publishedBefore.toISOString()}::timestamp`,
          );
        }

        if (ctx.context.scope.roots?.where) {
          conditions.push(ctx.context.scope.roots.where);
        }

        const whereCondition = and(...conditions)!;

        const enrich = userEnrichment(ctx, {
          cmsColumn: 'cms.publications.published_by',
          alias: 'pub_user',
          outputKey: 'publishedByUser',
        });

        const orderDir = sortDirection === 'asc' ? sql`ASC` : sql`DESC`;

        const [{ count }] = await db
          .select({ count: sql<number>`count(*)`.mapWith(Number) })
          .from(publications)
          .innerJoin(roots, eq(roots.id, publications.rootId))
          .where(whereCondition);

        const dataResult = await db.execute(sql`
          SELECT
            ${publications.rootId} AS root_id,
            ${publications.branchId} AS branch_id,
            ${branches.headCommitId} AS commit_id,
            ${publications.publishedBy} AS published_by,
            ${publications.publishedAt} AS published_at,
            ${branches.name} AS branch_name,
            ${blockVersions.properties} AS root_properties
            ${enrich.select}
          FROM ${publications}
          INNER JOIN ${branches} ON ${branches.id} = ${publications.branchId}
          INNER JOIN ${roots} ON ${roots.id} = ${publications.rootId}
          INNER JOIN ${commitSnapshots}
            ON ${commitSnapshots.commitId} = ${branches.headCommitId}
           AND ${commitSnapshots.blockId} = ${publications.rootId}
          INNER JOIN ${blockVersions}
            ON ${blockVersions.id} = ${commitSnapshots.blockVersionId}
          ${enrich.join}
          WHERE ${whereCondition}
          ORDER BY ${publications.publishedAt} ${orderDir}
          LIMIT ${limit} OFFSET ${offset}
        `);

        const publicationRows = dataResult.rows as Array<
          Record<string, unknown>
        >;

        const items = publicationRows.map((row) => {
          const item: Record<string, unknown> = {
            rootId: row.root_id,
            branchId: row.branch_id,
            commitId: row.commit_id,
            publishedBy: row.published_by,
            publishedAt: parseTimestampOrNull(row.published_at),
            branchName: row.branch_name,
            // Strip the reserved `__slug` draft key from the user-facing
            // root property bag.
            rootProperties: withRootSlug(
              (row.root_properties ?? {}) as Record<string, unknown>,
              null,
            ),
          };
          enrich.apply(item, row);
          return item;
        });

        return {
          publications: items,
          total: count,
          hasMore: offset + items.length < count,
        };
      },
    ),
  };
}
