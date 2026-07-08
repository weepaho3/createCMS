import { and, eq, isNull } from 'drizzle-orm';

import type { ResolvedBranchPolicy } from '../branch-policy';
import type { TableScope } from '../types/definitions';
import type { DrizzleInstance } from '../types/drizzle';

import { branches, publications, roots } from '../db/schema.generated';
import { CMSError, type CMSErrorCode } from '../errors';

/**
 * Loads a root by id, scoped to the collection AND the active plugin scope
 * (e.g. multi-tenant's `tenant_slug` predicate). Throws when the root does not
 * exist or lies outside the caller's scope.
 *
 * This is the single choke point that closes IDOR on by-id endpoints: a caller in one scope
 * cannot read or mutate a root in another scope by guessing its id, because the
 * scope predicate is ANDed into the existence check. Pass the active
 * transaction (or `db`) as `exec` so the guard participates in the same tx.
 *
 * Soft-archived roots (`archivedAt` set) are treated as gone: they are excluded
 * here, so every by-id read/mutation 404s on an archived root. Physical removal
 * is the pruning layer's job; archiveRoot and pruning query roots directly.
 */
export async function requireRootInScope(
  exec: DrizzleInstance,
  rootId: string,
  collection: string,
  rootScope?: TableScope,
  // A core error code (default ROOT_NOT_FOUND) OR a factory returning the error
  // to throw — the latter lets a plugin raise its OWN error (e.g. the i18n
  // plugin's TRANSLATION_SOURCE_NOT_FOUND) without core naming a plugin code.
  notFound: CMSErrorCode | (() => Error) = 'ROOT_NOT_FOUND',
): Promise<void> {
  const [row] = await exec
    .select({ id: roots.id })
    .from(roots)
    .where(
      and(
        eq(roots.id, rootId),
        eq(roots.collection, collection),
        isNull(roots.archivedAt),
        rootScope?.where,
      ),
    )
    .limit(1);
  if (!row) {
    throw typeof notFound === 'function' ? notFound() : new CMSError(notFound);
  }
}

/**
 * Enforces `branchProtection.protectPublishedBranches`: a branch is read-only for
 * direct content mutations exactly while it is published. A publication is one
 * row in `publications` keyed by `(rootId, branchId)`, so this is a single
 * indexed existence check. No-op when the policy is off or the branch has no
 * publication; throws `PROTECTED_BRANCH` otherwise.
 *
 * This is the single choke point every content-mutation route calls (createBlock
 * / updateBlock / deleteBlock / moveBlock / duplicateBlock / updateBlocks /
 * updateRoot in blocks.ts, and revertBranch in branches.ts). Merge into a
 * published branch is intentionally NOT gated here — it is the sanctioned path
 * for updating live content. Pass the active tx so the check shares the row lock
 * and sees uncommitted state.
 */
export async function assertBranchWritable(
  exec: DrizzleInstance,
  policy: ResolvedBranchPolicy,
  rootId: string,
  branchId: string,
): Promise<void> {
  if (!policy.protectPublishedBranches) return;
  const [pub] = await exec
    .select({ rootId: publications.rootId })
    .from(publications)
    .where(
      and(eq(publications.rootId, rootId), eq(publications.branchId, branchId)),
    )
    .limit(1);
  if (pub) throw new CMSError('PROTECTED_BRANCH');
}

/**
 * Locks a branch row `FOR UPDATE` and asserts it is writable — the shared
 * preamble every content-mutation route runs before advancing a branch head.
 * The branch is selected scoped to `(id, rootId)`, so a caller cannot lock
 * another root's branch by guessing its id; a missing branch throws
 * `BRANCH_NOT_FOUND`, and {@link assertBranchWritable} then enforces the
 * branch-protection policy. Returns the locked row so the caller can read its
 * `headCommitId`. Pass the active tx so the row lock is held for the rest of the
 * transaction.
 */
export async function lockWritableBranch(
  exec: DrizzleInstance,
  policy: ResolvedBranchPolicy,
  rootId: string,
  branchId: string,
): Promise<{ id: string; name: string; headCommitId: string }> {
  const [branch] = await exec
    .select({
      id: branches.id,
      name: branches.name,
      headCommitId: branches.headCommitId,
    })
    .from(branches)
    .where(and(eq(branches.id, branchId), eq(branches.rootId, rootId)))
    .for('update');
  if (!branch) throw new CMSError('BRANCH_NOT_FOUND');
  await assertBranchWritable(exec, policy, rootId, branchId);
  return branch;
}
