import { and, eq, type SQL } from 'drizzle-orm';

import type {
  ResolvedSlugConfig,
  RootTableScope,
  TableScope,
} from '../types/definitions';
import type { DrizzleInstance } from '../types/drizzle';

import { getApprovalStateForPublication } from '../approvals/state';
import { readRootSlug } from '../blocks/reconstruct-snapshot';
import {
  approvalGatePasses,
  type ResolvedBranchPolicy,
} from '../branch-policy';
import {
  blockVersions,
  branches,
  commitSnapshots,
  publications,
  roots,
} from '../db/schema.generated';
import { CMSError } from '../errors';
import {
  captureSubtreePaths,
  recordSubtreeRedirects,
} from '../redirects/auto-create';
import { normalizeSlug, validateSlugUniqueness } from '../slug';

// ============================================================================
// Shared publish/unpublish core — the SINGLE source of the publish rules,
// reused by the per-page endpoints (below), by releases (publishRelease), and by
// scheduled publishing (admin.runScheduled). Each runs entirely inside the
// caller's transaction; the caller owns post-commit side effects (asset sync,
// notifications).
// ============================================================================

/**
 * Publishes (or re-publishes) a branch's head commit for a root, inside `tx`.
 * Enforces scope, branch ownership, and the approval gate, then upserts the
 * publications row. Returns the publication (with `branchName`) and the published
 * `commitId` so the caller can run asset sync / notifications after commit.
 *
 * cms-05: this is ALSO where the versioned slug is materialized. The draft slug
 * rides the head root version's reserved `__slug` property; on publish it is
 * promoted to the global `roots.slug` (the live URL) — but ONLY for the default/
 * identity branch, or the first publish of ANY branch while `roots.slug` is still
 * null. Uniqueness is enforced here (drafts may collide) and a live collision
 * throws PUBLISH_SLUG_CONFLICT, rolling back an atomic release. A materialized
 * slug change also records the old→new subtree redirects. Pass `slugConfig` (and,
 * for scoping plugins, `rootScope`/`redirectScope`) to enable this; without them
 * (system callers with no collection def) the slug step is skipped.
 *
 * @throws ROOT_NOT_FOUND / BRANCH_NOT_FOUND / PUBLICATION_APPROVAL_REQUIRED
 *   / PUBLISH_SLUG_CONFLICT
 */
export async function publishBranchInTx(
  tx: DrizzleInstance,
  params: {
    collectionName: string;
    rootId: string;
    branchId: string;
    actor: string;
    branchPolicy: ResolvedBranchPolicy;
    /** Optional plugin scope predicate (multi-tenant); omit for system callers. */
    scopeWhere?: SQL | undefined;
    /** The collection's resolved slug config; omit to skip slug materialization. */
    slugConfig?: ResolvedSlugConfig;
    /** Roots scope for slug-uniqueness / path resolution (per-tenant columns). */
    rootScope?: RootTableScope;
    /** Redirects scope for the old→new redirects written on a slug change. */
    redirectScope?: TableScope;
  },
) {
  const {
    collectionName,
    rootId,
    branchId,
    actor,
    branchPolicy,
    scopeWhere,
    slugConfig,
    rootScope,
    redirectScope,
  } = params;

  const [root] = await tx
    .select({
      id: roots.id,
      slug: roots.slug,
      parentRootId: roots.parentRootId,
    })
    .from(roots)
    .where(
      and(
        eq(roots.id, rootId),
        eq(roots.collection, collectionName),
        scopeWhere,
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
    if (!approvalGatePasses(approvalState, branchPolicy.requiredReviewers)) {
      throw new CMSError('PUBLICATION_APPROVAL_REQUIRED');
    }
  } else if (
    approvalState.hasRequests &&
    !approvalGatePasses(approvalState, branchPolicy.requiredReviewers)
  ) {
    // Conditional (existing) behavior: only gate when approvals exist.
    throw new CMSError('PUBLICATION_APPROVAL_REQUIRED');
  }

  // cms-05: materialize the versioned draft slug (see the function doc).
  if (slugConfig?.enabled) {
    const isDefaultBranch = branch.name === branchPolicy.defaultBranchName;
    const seedNullSlug = root.slug === null;
    if (isDefaultBranch || seedNullSlug) {
      // The draft slug lives on the head ROOT block version's `__slug` property.
      const [rootVersion] = await tx
        .select({ properties: blockVersions.properties })
        .from(commitSnapshots)
        .innerJoin(
          blockVersions,
          eq(blockVersions.id, commitSnapshots.blockVersionId),
        )
        .where(
          and(
            eq(commitSnapshots.commitId, branch.headCommitId),
            eq(commitSnapshots.blockId, rootId),
          ),
        );
      const draftSlug = rootVersion
        ? readRootSlug(rootVersion.properties as Record<string, unknown>)
        : null;
      const publishedSlug =
        draftSlug !== null && slugConfig.normalize
          ? normalizeSlug(draftSlug)
          : draftSlug;

      // Only act on an ACTUAL published-slug change. A null draft slug (an
      // allowIndex home page, or never-set) leaves roots.slug untouched.
      //
      // KNOWN LIMITATION (cms-05 #3): clearing a draft slug back to null — e.g.
      // an allowIndex page being demoted to the home page — is NOT materialized on
      // republish; roots.slug keeps its last published value. Distinguishing an
      // "explicitly cleared" draft from a "never set" one is a future enhancement.
      //
      // KNOWN LIMITATION (cms-05 #4): the uniqueness check below is scoped to the
      // ACTIVE request scope (rootScope). Under i18n, publish a translation within
      // its own language context — a cross-language publish would check uniqueness
      // against the active language, not the branch's own.
      if (publishedSlug !== null && publishedSlug !== root.slug) {
        // Capture the subtree's OLD paths BEFORE the change — but only when the
        // page already had a live slug (a seed had no prior URL to redirect).
        const captured =
          root.slug !== null
            ? await captureSubtreePaths(tx, slugConfig, rootId)
            : [];

        // Uniqueness against the LIVE scoped set: drafts may collide, so this is
        // the authority. Throws PUBLISH_SLUG_CONFLICT on a live collision.
        await validateSlugUniqueness(
          tx,
          collectionName,
          root.parentRootId,
          publishedSlug,
          rootId,
          rootScope?.insertColumns,
          { conflictError: 'PUBLISH_SLUG_CONFLICT' },
        );

        await tx
          .update(roots)
          .set({ slug: publishedSlug })
          .where(eq(roots.id, rootId));

        if (captured.length > 0) {
          await recordSubtreeRedirects(
            tx,
            collectionName,
            captured,
            redirectScope,
          );
        }
      }
    }
  }

  const [existing] = await tx
    .select()
    .from(publications)
    .where(
      and(eq(publications.rootId, rootId), eq(publications.branchId, branchId)),
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
    return {
      publication: { ...updated, branchName: branch.name },
      commitId: branch.headCommitId,
    };
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
  return {
    publication: { ...created, branchName: branch.name },
    commitId: branch.headCommitId,
  };
}

/**
 * Removes a branch's publication, inside `tx`. Enforces scope + existence and
 * returns the `commitId` that was live so the caller can run asset unsync.
 *
 * @throws ROOT_NOT_FOUND / PUBLICATION_NOT_FOUND
 */
export async function unpublishBranchInTx(
  tx: DrizzleInstance,
  params: {
    collectionName: string;
    rootId: string;
    branchId: string;
    scopeWhere?: SQL | undefined;
  },
): Promise<{ commitId: string }> {
  const { collectionName, rootId, branchId, scopeWhere } = params;

  const [root] = await tx
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

  const [existing] = await tx
    .select({
      rootId: publications.rootId,
      branchId: publications.branchId,
      commitId: publications.commitId,
    })
    .from(publications)
    .where(
      and(eq(publications.rootId, rootId), eq(publications.branchId, branchId)),
    )
    .for('update');
  if (!existing) throw new CMSError('PUBLICATION_NOT_FOUND');

  await tx
    .delete(publications)
    .where(
      and(eq(publications.rootId, rootId), eq(publications.branchId, branchId)),
    );

  return { commitId: existing.commitId };
}
