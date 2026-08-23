import type { ReferenceResolver } from '../../core/types/definitions';
import type { DrizzleInstance } from '../../core/types/drizzle';

import { referenceEdges } from '../../core/references';

// The render-tree traversal that powers the A/B cross-embed XOR rule. Built on
// core's generic `referenceEdges` (the live-head graph primitive) composed with
// `scope.referenceResolver` (group resolution): without the i18n plugin the
// resolver is identity and this degrades to a plain rootId graph; with it, the
// walk is translation-group aware.

const MAX_CORENDER_DEPTH = 20; // mirrors MAX_REFERENCE_DEPTH in publications.ts

/**
 * Down-only transitive embed closure reachable from `startRoots`: the render
 * subtrees below them. Translation-group aware and tenant-scoped, bounded by
 * MAX_CORENDER_DEPTH. Mutates and reads `seen` for dedup; returns the newly
 * reached roots (not in `seen` initially).
 */
async function embedClosure(
  db: DrizzleInstance,
  startRoots: string[],
  seen: Set<string>,
  resolver: ReferenceResolver,
  scopeColumns?: Record<string, unknown>,
): Promise<Set<string>> {
  const down = new Set<string>();
  let frontier = [...startRoots];
  for (let d = 0; d < MAX_CORENDER_DEPTH && frontier.length > 0; d++) {
    const rawTargets = await referenceEdges(
      db,
      frontier,
      'embeds',
      scopeColumns,
    );
    const resolved = await resolver.resolveConflictTargets(
      db,
      scopeColumns,
      rawTargets,
    );
    const expanded = await resolver.expandGroup(db, scopeColumns, resolved);
    const next: string[] = [];
    for (const t of expanded) {
      if (!seen.has(t)) {
        seen.add(t);
        down.add(t);
        next.push(t);
      }
    }
    frontier = next;
  }
  return down;
}

/**
 * The roots in `rootId`'s own rendered subtree (its transitive embeds),
 * group-aware, excluding rootId's own group. Used by the publishBranch
 * backstop, which cares only about the render tree the published root
 * produces.
 */
export async function collectEmbeddedRoots(
  db: DrizzleInstance,
  rootId: string,
  resolver: ReferenceResolver,
  scopeColumns?: Record<string, unknown>,
): Promise<Set<string>> {
  const ownGroup = new Set(
    await resolver.expandGroup(db, scopeColumns, [rootId]),
  );
  return embedClosure(
    db,
    [...ownGroup],
    new Set(ownGroup),
    resolver,
    scopeColumns,
  );
}

/**
 * All roots that can appear in the same rendered page tree as `rootId`: the
 * conflict set for the A/B XOR rule. This is the transitive hosts of rootId
 * (every root that embeds it, going up), then the transitive embeds of rootId
 * AND each host (going down), covering co-embedded siblings. Translation-group
 * aware (a reference may store a tgr_ group key, resolved like the read path)
 * and bounded by MAX_CORENDER_DEPTH; a conservative superset, so over-inclusion
 * fails safe. rootId's own translation group is excluded.
 */
export async function collectCoRenderRoots(
  db: DrizzleInstance,
  rootId: string,
  resolver: ReferenceResolver,
  scopeColumns?: Record<string, unknown>,
): Promise<Set<string>> {
  const ownGroup = new Set(
    await resolver.expandGroup(db, scopeColumns, [rootId]),
  );

  // Up: transitive hosts. A host may embed via the rootId or the group's tgr_
  // key, so match both forms.
  const up = new Set<string>();
  let frontier = [...ownGroup];
  for (let d = 0; d < MAX_CORENDER_DEPTH && frontier.length > 0; d++) {
    const tgrKeys = await resolver.groupKeysFor(db, scopeColumns, frontier);
    const hosts = await referenceEdges(
      db,
      [...frontier, ...tgrKeys],
      'embeddedBy',
      scopeColumns,
    );
    const expanded = await resolver.expandGroup(db, scopeColumns, hosts);
    const next: string[] = [];
    for (const h of expanded) {
      if (!up.has(h) && !ownGroup.has(h)) {
        up.add(h);
        next.push(h);
      }
    }
    frontier = next;
  }

  // Down: transitive embeds of rootId and every host, so co-embedded siblings
  // are included.
  const seen = new Set<string>([...ownGroup, ...up]);
  const down = await embedClosure(db, [...seen], seen, resolver, scopeColumns);

  const result = new Set<string>();
  for (const r of up) if (!ownGroup.has(r)) result.add(r);
  for (const r of down) if (!ownGroup.has(r)) result.add(r);
  return result;
}
