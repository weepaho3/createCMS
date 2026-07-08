import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import * as z from 'zod';

import type {
  AbTestResolver,
  AnyCollectionDefinition,
  CMSProcedureCtx,
  CollectionWithName,
  InferBlockTreeNode,
  PublishedBranchSnapshot,
  ReferenceResolver,
  ResolvedReference,
  RunningAbTest,
} from '../types';
import type { ResolvedSlugConfig } from '../types/definitions';
import type { DrizzleInstance } from '../types/drizzle';

import {
  assembleBlockTree,
  loadBlocksAtCommit,
  type BlockTreeNode,
} from '../blocks/reconstruct-snapshot';
import { approvalGatePasses, resolveBranchPolicy } from '../branch-policy';
import {
  blockVersions,
  branches,
  commitSnapshots,
  publications,
  roots,
} from '../db/schema.generated';
import { cmsMeta, createCMSEndpoint } from '../endpoint';
import { CMSError } from '../errors';
import { resolveLinkPaths } from '../links';
import { syncAssetsOnPublish, syncAssetsOnUnpublish } from '../media/discovery';
import {
  coreReferenceResolver,
  getReferencePropertyNames,
} from '../references';
import { crossScopeColumns, rootScopeConditions } from '../scope';
import {
  normalizeSlug,
  resolveAncestors,
  resolvePathToRootId,
  splitPath,
} from '../slug';
import { userEnrichment } from '../user/enrichment';
import { parseTimestampOrNull } from '../utils/parse-timestamp';
import { loadVariables, substituteVariables } from '../variables';
import { getApprovalStateForPublication } from './approvals';

// ============================================================================
// Reference resolution
// ============================================================================

function collectReferenceRootIds(
  tree: BlockTreeNode,
  collectionDef: CollectionWithName,
): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();

  function walk(node: BlockTreeNode) {
    const refProps = getReferencePropertyNames(collectionDef, node.type);
    for (const [propName, targetCollection] of refProps) {
      const value = node.properties[propName];
      if (typeof value !== 'string' || !value) continue;
      if (!result.has(targetCollection)) {
        result.set(targetCollection, new Set());
      }
      result.get(targetCollection)!.add(value);
    }
    for (const child of node.children) {
      walk(child);
    }
  }

  walk(tree);
  return result;
}

function replaceReferencesInTree(
  tree: BlockTreeNode,
  collectionDef: CollectionWithName,
  resolvedMap: Map<string, ResolvedReference>,
) {
  function walk(node: BlockTreeNode) {
    const refProps = getReferencePropertyNames(collectionDef, node.type);
    for (const [propName, _targetCollection] of refProps) {
      const value = node.properties[propName];
      if (typeof value !== 'string') continue;
      const resolved = resolvedMap.get(value);
      if (resolved) {
        (node.properties as Record<string, unknown>)[propName] = resolved;
      }
    }
    for (const child of node.children) {
      walk(child);
    }
  }

  walk(tree);
}

type LoadedRoot = {
  rootId: string;
  commitId: string;
  properties: Record<string, unknown>;
  tree: BlockTreeNode;
  /**
   * Set when this root has a running A/B test: top-level
   * `tree`/`properties` are the CONTROL branch, and `abTest.variants` carries
   * every published variant branch (incl. the control) for the client to pick.
   */
  abTest?: {
    testId: string;
    trafficPercentage: number;
    variants: PublishedBranchSnapshot[];
  };
};

async function loadPublishedRoots(
  db: DrizzleInstance,
  collectionName: string,
  rootIds: string[],
  scopeColumns?: Record<string, unknown>,
  abTestResolver?: AbTestResolver,
): Promise<Map<string, LoadedRoot>> {
  const result = new Map<string, LoadedRoot>();

  if (rootIds.length === 0) return result;

  const pubRows = await db
    .select({
      rootId: publications.rootId,
      branchId: publications.branchId,
      headCommitId: branches.headCommitId,
    })
    .from(publications)
    .innerJoin(branches, eq(branches.id, publications.branchId))
    .innerJoin(roots, eq(roots.id, publications.rootId))
    .where(
      and(
        inArray(publications.rootId, rootIds),
        eq(roots.collection, collectionName),
        // Defensive scoping: a referenced root must be in the active scope. The
        // caller passes CROSS-scope columns (the plugin's cross-scope columns
        // already removed — e.g. language), so a sibling in another such scope
        // still loads (the caller already resolved a specific one).
        ...rootScopeConditions(scopeColumns),
      ),
    )
    // A referenced root with several live branches (parallel-live / A/B) yields
    // several publication rows. Order deterministically (oldest publish first,
    // branchId as the stable tiebreak) so the single pick below is stable across
    // requests instead of DB-order-undefined.
    .orderBy(asc(publications.publishedAt), asc(publications.branchId));

  // Group publication rows per root, preserving the deterministic ORDER BY order.
  const pubsByRoot = new Map<
    string,
    { branchId: string; commitId: string }[]
  >();
  for (const row of pubRows) {
    const entry = { branchId: row.branchId, commitId: row.headCommitId };
    const list = pubsByRoot.get(row.rootId);
    if (list) list.push(entry);
    else pubsByRoot.set(row.rootId, [entry]);
  }

  // Which referenced roots have a running A/B test. No resolver
  // (no ab-test plugin) → empty → every root takes the deterministic single
  // pick below, byte-identical to the pre-fan-out behavior.
  const running = abTestResolver
    ? await abTestResolver.runningTests(db, scopeColumns, rootIds)
    : new Map<string, RunningAbTest>();

  /** Load + assemble one branch's published tree; null if it has no content. */
  const loadBranch = async (
    rootId: string,
    commitId: string,
  ): Promise<BlockTreeNode | null> => {
    const { blocks } = await loadBlocksAtCommit(db, commitId, rootId);
    return assembleBlockTree(blocks, rootId);
  };

  await Promise.all(
    [...pubsByRoot.entries()].map(async ([rootId, pubs]) => {
      const test = running.get(rootId);

      // Default (and fallback): the deterministic single pick — the first row
      // in the ORDER BY. Used for every non-varying embed.
      const single = async () => {
        const first = pubs[0];
        if (!first) return;
        const tree = await loadBranch(rootId, first.commitId);
        if (!tree) return;
        result.set(rootId, {
          rootId,
          commitId: first.commitId,
          properties: tree.properties,
          tree,
        });
      };

      if (!test) return single();

      // Running test → fan out: load the published tree of every variant branch.
      const commitByBranch = new Map(pubs.map((p) => [p.branchId, p.commitId]));
      const variants: PublishedBranchSnapshot[] = [];
      let control: PublishedBranchSnapshot | undefined;
      let controlCommitId: string | undefined;
      for (const v of test.variants) {
        const commitId = commitByBranch.get(v.branchId);
        if (!commitId) continue; // a declared variant that isn't published → skip
        const tree = await loadBranch(rootId, commitId);
        if (!tree) continue;
        const snapshot: PublishedBranchSnapshot = {
          branchId: v.branchId,
          isControl: v.isControl,
          properties: tree.properties,
          tree,
        };
        variants.push(snapshot);
        if (v.isControl) {
          control = snapshot;
          controlCommitId = commitId;
        }
      }

      // The control branch fills top-level tree/properties (the no-JS / AB-off
      // fallback, and what `isResolvedReference` narrows on). If the control
      // isn't published — or fewer than two variants are — degrade to the
      // deterministic single pick (no fan-out) so top-level stays populated.
      if (!control || !controlCommitId || variants.length < 2) {
        return single();
      }

      result.set(rootId, {
        rootId,
        commitId: controlCommitId,
        properties: control.properties,
        tree: control.tree,
        abTest: {
          testId: test.testId,
          trafficPercentage: test.trafficPercentage,
          variants,
        },
      });
    }),
  );

  return result;
}

// References can nest (a reusable block embeds another), and the `visited` set
// only stops CYCLES — a long ACYCLIC chain of distinct references would still
// recurse unbounded and blow the call stack. Cap the depth and fail loud on what
// is almost certainly a misconfiguration (legitimate nesting is a handful deep).
const MAX_REFERENCE_DEPTH = 20;

async function resolveTreeReferences(
  db: DrizzleInstance,
  tree: BlockTreeNode,
  collectionDef: CollectionWithName,
  allCollections: Record<string, CollectionWithName>,
  resolver: ReferenceResolver,
  scopeColumns: Record<string, unknown> | undefined,
  visited: Set<string> = new Set(),
  depth = 0,
  abTestResolver?: AbTestResolver,
): Promise<void> {
  if (depth > MAX_REFERENCE_DEPTH) {
    throw new CMSError('REFERENCE_DEPTH_EXCEEDED');
  }
  const refValues = collectReferenceRootIds(tree, collectionDef);
  if (refValues.size === 0) return;

  // Keyed by the STORED reference value (a rootId OR, under i18n, a translationKey)
  // so replaceReferencesInTree can look it up by what's actually in the block.
  const resolvedMap = new Map<string, ResolvedReference>();

  for (const [targetCollectionName, valueSet] of refValues) {
    const targetDef = allCollections[targetCollectionName];
    if (!targetDef) continue;

    // Resolve each stored reference value to the single rootId it RENDERS as,
    // via the scope's reference resolver: identity (value -> value) without a
    // plugin; i18n translation-group resolution (tgr_ -> best sibling along the
    // fallback chain; rot_ -> active-language sibling of its group, else the
    // stored anchor) when the i18n plugin provides one. The resolution policy +
    // any tenant scoping live in the resolver; core only threads it through the
    // recursion so nested references resolve in the same scope.
    const valueToRootId = await resolver.resolveRenderTargets(
      db,
      scopeColumns,
      targetCollectionName,
      [...valueSet],
    );

    const targetRootIds = [...new Set(valueToRootId.values())];
    const unvisitedIds = targetRootIds.filter((id) => !visited.has(id));
    for (const id of unvisitedIds) visited.add(id);

    const loaded = await loadPublishedRoots(
      db,
      targetCollectionName,
      unvisitedIds,
      scopeColumns,
      abTestResolver,
    );

    for (const [storedValue, rootId] of valueToRootId) {
      const data = loaded.get(rootId);
      if (!data) continue; // unresolved / already-visited (cycle guard)

      // Snapshot the cycle-guard state BEFORE resolving this block's branches:
      // each A/B variant is an alternate rendering of the SAME block and almost
      // always re-embeds the same sub-references as the control. The shared
      // `visited` set (which the control recursion below extends) would treat
      // those as already-loaded and leave them UNRESOLVED in the variant copies,
      // so each variant resolves against its own clone of this pre-control state.
      // XOR guarantees at most one varying root per render, so this clones for at
      // most one block per page. Non-A/B refs keep the shared-`visited` path.
      const branchVisited = data.abTest ? new Set(visited) : null;

      await resolveTreeReferences(
        db,
        data.tree,
        targetDef,
        allCollections,
        resolver,
        scopeColumns,
        visited,
        depth + 1,
        abTestResolver,
      );

      if (data.abTest && branchVisited) {
        for (const variant of data.abTest.variants) {
          // The control variant's tree IS data.tree — already resolved above.
          if (variant.tree === data.tree) continue;
          await resolveTreeReferences(
            db,
            variant.tree,
            targetDef,
            allCollections,
            resolver,
            scopeColumns,
            new Set(branchVisited),
            depth + 1,
            abTestResolver,
          );
        }
      }

      resolvedMap.set(storedValue, {
        rootId,
        collection: targetCollectionName,
        properties: data.properties,
        tree: data.tree,
        ...(data.abTest ? { abTest: data.abTest } : {}),
      });
    }
  }

  replaceReferencesInTree(tree, collectionDef, resolvedMap);
}

/**
 * Builds a sidecar map of PUBLISHED previews for every reference embedded in
 * `tree`, keyed by the STORED reference value (rootId / `tgr_`). Each preview is
 * the referenced root's published render tree in the active scope — its own
 * nested references resolved and `{{variables}}` substituted, exactly like
 * getPublishedContent. References that are not published (or out of scope) are
 * omitted. This lets getBlockTree return the raw editable tree PLUS all reference
 * previews in ONE call instead of N getPublishedContent round-trips, while
 * reusing the same resolution machinery (no duplication).
 */
export async function buildReferencePreviews(
  db: DrizzleInstance,
  tree: BlockTreeNode,
  collectionDef: CollectionWithName,
  allCollections: Record<string, CollectionWithName>,
  resolver: ReferenceResolver,
  scopeColumns: Record<string, unknown> | undefined,
  vars: Map<string, string>,
  abTestResolver?: AbTestResolver,
): Promise<Record<string, BlockTreeNode>> {
  const previews: Record<string, BlockTreeNode> = {};
  const refsByCollection = collectReferenceRootIds(tree, collectionDef);

  for (const [targetCollectionName, valueSet] of refsByCollection) {
    const targetDef = allCollections[targetCollectionName];
    if (!targetDef) continue;

    const valueToRootId = await resolver.resolveRenderTargets(
      db,
      scopeColumns,
      targetCollectionName,
      [...valueSet],
    );
    const loaded = await loadPublishedRoots(
      db,
      targetCollectionName,
      [...new Set(valueToRootId.values())],
      scopeColumns,
      abTestResolver,
    );

    for (const [storedValue, rootId] of valueToRootId) {
      const data = loaded.get(rootId);
      if (!data) continue; // not published / out of scope — omit from the sidecar

      // Fully render the preview: resolve its own nested references, then vars.
      await resolveTreeReferences(
        db,
        data.tree,
        targetDef,
        allCollections,
        resolver,
        scopeColumns,
        new Set([rootId]),
        1,
        abTestResolver,
      );
      substituteVariables(data.tree, vars);
      // Resolve links and image assets in the preview, exactly like
      // getPublishedContent renders the same tree.
      await resolveLinkPaths(
        db,
        data.tree,
        targetDef,
        allCollections,
        resolver,
        scopeColumns,
      );
      previews[storedValue] = data.tree;
    }
  }

  return previews;
}

type PublishedContentQuery =
  | {
      rootId: string;
      slug?: string;
      path?: string;
      raw?: boolean;
    }
  | {
      rootId?: string;
      slug: string;
      path?: string;
      raw?: boolean;
    }
  | {
      rootId?: string;
      slug?: string;
      path: string;
      raw?: boolean;
    };

export function createPublicationEndpoints<
  TDef extends CollectionWithName,
  TCollections extends Record<string, AnyCollectionDefinition> = {},
>(def: TDef, cmsCtx: CMSProcedureCtx) {
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

        const publication = await db.transaction(async (tx) => {
          const [root] = await tx
            .select({ id: roots.id })
            .from(roots)
            .where(
              and(
                eq(roots.id, rootId),
                eq(roots.collection, collectionName),
                ctx.context.scope.roots?.where,
              ),
            );
          if (!root) throw new CMSError('ROOT_NOT_FOUND');

          const [branch] = await tx
            .select({
              id: branches.id,
              rootId: branches.rootId,
              headCommitId: branches.headCommitId,
              name: branches.name,
            })
            .from(branches)
            .where(and(eq(branches.id, branchId), eq(branches.rootId, rootId)))
            .for('update');
          if (!branch) throw new CMSError('BRANCH_NOT_FOUND');

          const approvalState = await getApprovalStateForPublication(
            tx,
            branchId,
            branch.headCommitId,
          );
          if (branchPolicy.requireApprovalBeforePublish) {
            // Approval is mandatory, even when none was explicitly requested.
            if (
              !approvalGatePasses(approvalState, branchPolicy.requiredReviewers)
            ) {
              throw new CMSError('PUBLICATION_APPROVAL_REQUIRED');
            }
          } else if (
            approvalState.hasRequests &&
            !approvalGatePasses(approvalState, branchPolicy.requiredReviewers)
          ) {
            // Conditional (existing) behavior: only gate when approvals exist.
            throw new CMSError('PUBLICATION_APPROVAL_REQUIRED');
          }

          const [existing] = await tx
            .select()
            .from(publications)
            .where(
              and(
                eq(publications.rootId, rootId),
                eq(publications.branchId, branchId),
              ),
            );

          if (existing) {
            const [updated] = await tx
              .update(publications)
              .set({
                commitId: branch.headCommitId,
                publishedBy: actor,
                publishedAt: new Date(),
              })
              .where(
                and(
                  eq(publications.rootId, rootId),
                  eq(publications.branchId, branchId),
                ),
              )
              .returning();

            return { ...updated, branchName: branch.name };
          }

          const [created] = await tx
            .insert(publications)
            .values({
              rootId,
              branchId,
              commitId: branch.headCommitId,
              publishedBy: actor,
            })
            .returning();

          return { ...created, branchName: branch.name };
        });

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

        const commitId = await db.transaction(async (tx) => {
          const [root] = await tx
            .select({ id: roots.id })
            .from(roots)
            .where(
              and(
                eq(roots.id, rootId),
                eq(roots.collection, collectionName),
                ctx.context.scope.roots?.where,
              ),
            );
          if (!root) throw new CMSError('ROOT_NOT_FOUND');

          const [existing] = await tx
            .select({
              rootId: publications.rootId,
              branchId: publications.branchId,
              commitId: publications.commitId,
            })
            .from(publications)
            .where(
              and(
                eq(publications.rootId, rootId),
                eq(publications.branchId, branchId),
              ),
            )
            .for('update');
          if (!existing) throw new CMSError('PUBLICATION_NOT_FOUND');

          await tx
            .delete(publications)
            .where(
              and(
                eq(publications.rootId, rootId),
                eq(publications.branchId, branchId),
              ),
            );

          return existing.commitId;
        });

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
            raw: z.coerce.boolean().optional(),
          }),
          z.object({
            rootId: z.string().optional(),
            slug: z.string(),
            path: z.string().optional(),
            raw: z.coerce.boolean().optional(),
          }),
          z.object({
            rootId: z.string().optional(),
            slug: z.string().optional(),
            path: z.string(),
            raw: z.coerce.boolean().optional(),
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
        const { rootId, slug, path, raw } = ctx.query;
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
          .where(eq(publications.rootId, resolvedRootId))
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

            const tree = assembleBlockTree(blocks, resolvedRootId);
            if (!tree) throw new CMSError('ROOT_NOT_FOUND');

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
        if (scope.abTestResolver) {
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
          ...(pageAbTest ? { abTest: pageAbTest } : {}),
        };

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
            rootProperties: row.root_properties,
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
