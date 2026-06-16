import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import type { ResolvedSlugConfig, TableScope } from '../types/definitions';
import type { DrizzleInstance } from '../types/drizzle';

import { newId } from '../../utils/nanoid';
import { redirects } from '../db/schema.generated';
import { scopedInsert, scopedInsertBatch } from '../scope';
import { resolveRootCurrentPath } from './resolve';

type EnabledSlugConfig = Extract<ResolvedSlugConfig, { enabled: true }>;

/**
 * The path-source redirects that ALREADY exist (active) for the given paths, in
 * the current active scope. We never clobber an existing (manual or older auto)
 * redirect, so these paths are skipped on insert.
 */
async function existingPathSources(
  tx: DrizzleInstance,
  collection: string,
  paths: string[],
  scope: TableScope | undefined,
): Promise<Set<string>> {
  if (paths.length === 0) return new Set();
  const rows = await tx
    .select({ sourcePath: redirects.sourcePath })
    .from(redirects)
    .where(
      and(
        eq(redirects.collection, collection),
        eq(redirects.sourceType, 'path'),
        inArray(redirects.sourcePath, paths),
        isNull(redirects.archivedAt),
        scope?.where,
      ),
    );
  return new Set(
    rows.map((r) => r.sourcePath).filter((p): p is string => p != null),
  );
}

/** rootId + all descendants (flat collections have no descendants). */
async function subtreeIds(
  tx: DrizzleInstance,
  slugCfg: EnabledSlugConfig,
  rootId: string,
): Promise<string[]> {
  if (!slugCfg.nested) return [rootId];
  const result = await tx.execute(sql`
    WITH RECURSIVE subtree AS (
      SELECT id FROM cms.roots WHERE id = ${rootId}
      UNION ALL
      SELECT r.id FROM cms.roots r JOIN subtree s ON r.parent_root_id = s.id
    )
    SELECT id FROM subtree
  `);
  return (result.rows as Array<{ id: string }>).map((r) => r.id);
}

/**
 * Snapshot the CURRENT full path of a root and all descendants. Call this BEFORE
 * a slug/parent change so the captured paths are the OLD ones — the move/rename
 * shifts every node in the subtree, not just the renamed node.
 */
export async function captureSubtreePaths(
  tx: DrizzleInstance,
  slugCfg: EnabledSlugConfig,
  rootId: string,
): Promise<Array<{ rootId: string; oldPath: string }>> {
  const ids = await subtreeIds(tx, slugCfg, rootId);
  const out: Array<{ rootId: string; oldPath: string }> = [];
  for (const id of ids) {
    const path = await resolveRootCurrentPath(tx, slugCfg, id);
    if (path) out.push({ rootId: id, oldPath: path });
  }
  return out;
}

/**
 * After a slug/parent change, write a path→page redirect for every captured node:
 * OLD path → the node itself (a page target, which now resolves to the node's NEW
 * path and keeps following future moves). The callers only invoke this on an
 * ACTUAL change (updateRoot guards on slug change, moveRoot on parent change), so
 * every captured node's path really shifted — no self-redirects to filter.
 *
 * A pre-check (scope-filtered) skips paths that already have an active redirect —
 * we never clobber an existing (manual or older auto) redirect; a reused path
 * keeps its first redirect (a documented edge). scopedInsert carries the
 * plugin-owned scope column; there is no DB-unique to lean on (it would be
 * global), so dedup is the app's responsibility.
 */
export async function recordSubtreeRedirects(
  tx: DrizzleInstance,
  collection: string,
  captured: Array<{ rootId: string; oldPath: string }>,
  scope?: TableScope,
): Promise<void> {
  if (captured.length === 0) return;
  const taken = await existingPathSources(
    tx,
    collection,
    captured.map((c) => c.oldPath),
    scope,
  );
  const fresh = captured.filter((c) => !taken.has(c.oldPath));
  if (fresh.length === 0) return;
  await scopedInsertBatch(
    tx,
    'cms.redirects',
    fresh.map(({ rootId, oldPath }) => ({
      id: newId('redirect'),
      collection,
      source_type: 'path',
      source_path: oldPath,
      target_type: 'page',
      target_root_id: rootId,
    })),
    scope,
  );
}

/**
 * Write the archive redirect: an archived (leaf) root's old path → its parent
 * page. No-op when there is no parent (top-level) or no old path (slug disabled).
 */
export async function recordArchiveRedirect(
  tx: DrizzleInstance,
  collection: string,
  oldPath: string | null,
  parentRootId: string | null,
  scope?: TableScope,
): Promise<void> {
  if (!oldPath || !parentRootId) return;
  const taken = await existingPathSources(tx, collection, [oldPath], scope);
  if (taken.has(oldPath)) return;
  await scopedInsert(
    tx,
    'cms.redirects',
    {
      id: newId('redirect'),
      collection,
      source_type: 'path',
      source_path: oldPath,
      target_type: 'page',
      target_root_id: parentRootId,
    },
    scope,
  );
}
