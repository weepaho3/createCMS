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

/** Order-sensitive equality of two child-id arrays: children are one atomic
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
 * precedence over `targetKeys` by construction. The two sets may now overlap
 * on keys both sides agree on — callers guarantee any overlapping key carries
 * an equal final value on both sides, so taking source's value for it is
 * equivalent to taking target's, and the precedence never produces a visible
 * difference.
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
 * when the set of top-level property keys source touched (vs base) and the
 * set target touched are disjoint; children are compared as one atomic axis
 * alongside the property keys. Overlap counts per final value — identical
 * changes to the same key (the same value written, or the same key removed
 * by both) are agreement, not a conflict, exactly like git merging two
 * identical hunks. Reuse is generalized: whenever the merged outcome equals
 * one side's record outright, that side's existing version is reused instead
 * of minting a new one — this also covers the case where both sides ended up
 * fully identical.
 *
 * Deliberately NOT attempted: merging inside a single property (array-index
 * or nested-path granularity) or word-level richText merging. Index shifts
 * make sub-key merging unsound without knowing both sides' full edit
 * sequence, and richText word-merging is a CRDT-sized problem — this is a
 * classification function over already-computed diffs, not an editor. If two
 * edits land on the same top-level key with DIFFERENT final values (richText
 * or otherwise), that is always a conflict, by design.
 */
export function analyzeThreeWay(
  base: ReconstructedBlock | undefined,
  source: ReconstructedBlock | undefined,
  target: ReconstructedBlock | undefined,
): ThreeWayVerdict {
  // Any failure stays a conflict, exactly as the version-id-only detector
  // would already report.
  if (!base || base.deleted) return { verdict: 'conflict' };
  if (!source || source.deleted) return { verdict: 'conflict' };
  if (!target || target.deleted) return { verdict: 'conflict' };
  if (source.type !== target.type) return { verdict: 'conflict' };

  const sourceChanges = diffProperties(base.properties, source.properties);
  const targetChanges = diffProperties(base.properties, target.properties);
  const sourceKeys = new Set(sourceChanges.map((c) => String(c.path[0])));
  const targetKeys = new Set(targetChanges.map((c) => String(c.path[0])));

  // A key both sides touched is only a conflict when they END at different
  // values — identical changes (same value written, same key removed, same
  // nested edit) are agreement, exactly like git merging two identical
  // hunks. diffProperties(source, target) reports precisely the keys where
  // the two sides' final states differ.
  const disagreementKeys = new Set(
    diffProperties(source.properties, target.properties).map((c) =>
      String(c.path[0]),
    ),
  );
  for (const key of sourceKeys) {
    if (targetKeys.has(key) && disagreementKeys.has(key)) {
      return { verdict: 'conflict' };
    }
  }

  // Children are one atomic axis: both sides changing children to DIFFERENT
  // arrays is a conflict, same as a property-key overlap. Only one side
  // changing children (or both landing on the same array) merges cleanly,
  // preserving buildMergedSnapshot's documented orphan-block semantics (this
  // never invents a merged array from partial edits).
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

  // Generalized reuse: when the merged outcome IS one side's record, point at
  // that side's existing version instead of minting a new row. This also
  // covers the case where both sides ended up fully identical.
  if (
    diffProperties(properties, source.properties).length === 0 &&
    sameChildren(children, source.children)
  ) {
    return { verdict: 'reuse', blockVersionId: source.blockVersionId };
  }
  if (
    diffProperties(properties, target.properties).length === 0 &&
    sameChildren(children, target.children)
  ) {
    return { verdict: 'reuse', blockVersionId: target.blockVersionId };
  }

  return { verdict: 'merge', type: source.type, properties, children };
}
