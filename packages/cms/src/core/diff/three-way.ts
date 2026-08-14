import type { ReconstructedBlock } from '../blocks/reconstruct-snapshot';

import { diffProperties } from './property-diff';

export type ThreeWayVerdict =
  | { verdict: 'conflict' }
  | { verdict: 'reuse'; blockVersionId: string }
  | {
      verdict: 'merge';
      type: string;
      properties: Record<string, unknown>;
      children: string[];
    };

/** Order-sensitive equality of two child-id arrays — children are one atomic
 * axis (see {@link analyzeThreeWay}), so a plain index-wise compare is enough;
 * no deep-equal needed for an array of ids. */
function sameChildren(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Builds the merged property record for the `merge` verdict: for every key in
 * the union of base/source/target, the side that actually changed the key
 * (relative to base) wins; untouched keys come from base. `sourceKeys` takes
 * precedence over `targetKeys` by construction — callers only reach this once
 * the two sets are already known to be disjoint, so the precedence never
 * matters in practice.
 */
function buildMergedProperties(
  base: Record<string, unknown>,
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  sourceKeys: Set<string>,
  targetKeys: Set<string>,
): Record<string, unknown> {
  const keys = new Set<string>([
    ...Object.keys(base),
    ...Object.keys(source),
    ...Object.keys(target),
  ]);

  const merged: Record<string, unknown> = {};
  for (const key of keys) {
    if (sourceKeys.has(key)) {
      if (key in source) merged[key] = source[key];
    } else if (targetKeys.has(key)) {
      if (key in target) merged[key] = target[key];
    } else if (key in base) {
      merged[key] = base[key];
    }
  }
  return merged;
}

/**
 * Decides whether a block that BOTH branches changed since the common
 * ancestor can be auto-merged, at top-level-property granularity — the CMS's
 * git analogy is root ≈ repo, block ≈ file, property ≈ line, and git merges
 * within a file when two edits land on different lines. A block auto-merges
 * only when the set of top-level property keys source touched (vs base) and
 * the set target touched are disjoint; children are compared as one atomic
 * axis alongside the property keys.
 *
 * Deliberately NOT attempted: merging inside a single property (array-index
 * or nested-path granularity) or word-level richText merging. Index shifts
 * make sub-key merging unsound without knowing both sides' full edit
 * sequence, and richText word-merging is a CRDT-sized problem — this is a
 * classification function over already-computed diffs, not an editor. If two
 * edits land on the same top-level key (richText or otherwise), that is
 * always a conflict, by design.
 */
export function analyzeThreeWay(
  base: ReconstructedBlock | undefined,
  source: ReconstructedBlock | undefined,
  target: ReconstructedBlock | undefined,
): ThreeWayVerdict {
  // Preconditions (design decisions 4 & 5): any failure stays a conflict,
  // exactly as today's version-id-only detector would already report.
  if (!base || base.deleted) return { verdict: 'conflict' };
  if (!source || source.deleted) return { verdict: 'conflict' };
  if (!target || target.deleted) return { verdict: 'conflict' };
  if (source.type !== target.type) return { verdict: 'conflict' };

  const sourceChanges = diffProperties(base.properties, source.properties);
  const targetChanges = diffProperties(base.properties, target.properties);
  const sourceKeys = new Set(sourceChanges.map((c) => String(c.path[0])));
  const targetKeys = new Set(targetChanges.map((c) => String(c.path[0])));

  // Reuse shortcut (decision 6): checked BEFORE the key-disjointness test so
  // that two sides changing the SAME key to the SAME value — which looks like
  // an overlap by key alone — is recognized as a no-op difference instead of
  // a spurious conflict. EXCLUDES the case where both sides removed the same
  // key: a shared deletion still reaches an "identical" (absent) outcome, but
  // a delete is a deliberate action, not a value that happens to coincide —
  // it stays a conflict for a human to confirm, same as two different values
  // would. Falling through here lets the ordinary overlap check below catch
  // it (the key is in both changed-sets either way).
  const sourceRemovedKeys = new Set(
    sourceChanges
      .filter((c) => c.kind === 'removed')
      .map((c) => String(c.path[0])),
  );
  const targetRemovedKeys = new Set(
    targetChanges
      .filter((c) => c.kind === 'removed')
      .map((c) => String(c.path[0])),
  );
  const bothRemovedSameKey = [...sourceRemovedKeys].some((key) =>
    targetRemovedKeys.has(key),
  );

  if (
    !bothRemovedSameKey &&
    sameChildren(source.children, target.children) &&
    diffProperties(source.properties, target.properties).length === 0
  ) {
    return { verdict: 'reuse', blockVersionId: source.blockVersionId };
  }

  for (const key of sourceKeys) {
    if (targetKeys.has(key)) return { verdict: 'conflict' };
  }

  // Children are one atomic axis (decision 5): both sides changing children
  // to DIFFERENT arrays is a conflict, same as a property-key overlap. Only
  // one side changing children — or both landing on the same array — merges
  // cleanly, preserving buildMergedSnapshot's documented orphan-block
  // semantics (this never invents a merged array from partial edits).
  const sourceChildrenChanged = !sameChildren(base.children, source.children);
  const targetChildrenChanged = !sameChildren(base.children, target.children);

  let children: string[];
  if (sourceChildrenChanged && targetChildrenChanged) {
    if (!sameChildren(source.children, target.children)) {
      return { verdict: 'conflict' };
    }
    children = source.children;
  } else if (sourceChildrenChanged) {
    children = source.children;
  } else if (targetChildrenChanged) {
    children = target.children;
  } else {
    children = base.children;
  }

  const properties = buildMergedProperties(
    base.properties,
    source.properties,
    target.properties,
    sourceKeys,
    targetKeys,
  );

  return { verdict: 'merge', type: source.type, properties, children };
}
