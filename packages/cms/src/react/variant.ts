import type { BlockTreeNode } from '../core/blocks/reconstruct-snapshot';
import type { ResolvedReference } from '../core/types/definitions';

import { isResolvedReference } from './blocks';

// ============================================================================
// Server-side variant pick (Pattern A: cache-per-variant)
// ============================================================================
//
// The render-side counterpart of the edge decision: given getPublishedContent's
// page variants + the branch code from the variant-coded URL segment
// (/<branchId>/...), produce the single fully-picked tree for the UNCHANGED
// synchronous renderer. The variant route calls this; the control sentinel
// calls it with branchId=null. It is deterministic (no visitor input here —
// the edge already bucketed) and pure, so each variant-coded path stays a
// stable CDN/ISR cache entry.

type PageVariant = { branchId: string; tree: BlockTreeNode };

/**
 * Walk a tree and, at the (XOR ≤1) embedded A/B reference, swap in the variant
 * whose branch matches `branchId` — then strip `abTest` everywhere so the
 * renderer only ever sees a fully-picked tree. With `branchId=null` (control
 * render) it just strips, leaving every embed on its control branch. Mutates in
 * place (the caller passes a clone).
 */
function resolveVariantTree(
  tree: BlockTreeNode,
  branchId: string | null,
): void {
  for (const value of Object.values(tree.properties)) {
    if (!isResolvedReference(value)) continue;
    // `value` is narrowed to ResolvedReference — its `abTest.variants` are
    // PublishedBranchSnapshot (branchId + isControl + properties + tree).
    const ref: ResolvedReference = value;
    if (ref.abTest) {
      if (branchId) {
        const picked = ref.abTest.variants.find((v) => v.branchId === branchId);
        if (picked) {
          ref.tree = picked.tree;
          ref.properties = picked.properties;
        }
      }
      // The picked tree intentionally carries NO A/B metadata downstream:
      // attribution is owned by the edge/URL (the impression beacon), not
      // the rendered tree. Non-matching branch / control → leave control.
      delete ref.abTest;
    }
    resolveVariantTree(ref.tree, branchId); // descend into the inlined subtree
  }
  for (const child of tree.children) {
    resolveVariantTree(child, branchId);
  }
}

/**
 * Pick the tree to render for a variant-coded request.
 *
 * - `branchId` matches a published PAGE variant → that page branch (page-level
 *   test). - else `branchId` is an EMBEDDED block's branch → the control page
 *   tree with that one embedded block swapped to the branch. - `branchId=null`
 *   or no match anywhere → control (fail-closed). `abTest` is always stripped.
 *
 * `controlBranchId` designates the control page variant (page-level tests); when
 * omitted the first variant is used (correct for embedded-only pages + the
 * deterministic default).
 */
export function pickVariant(
  variants: readonly PageVariant[],
  branchId: string | null,
  controlBranchId?: string,
): BlockTreeNode | null {
  if (variants.length === 0) return null;

  const pageVariant = branchId
    ? variants.find((v) => v.branchId === branchId)
    : undefined;
  const control =
    (controlBranchId
      ? variants.find((v) => v.branchId === controlBranchId)
      : undefined) ?? variants[0]!;

  const base = pageVariant ?? control;
  const tree = structuredClone(base.tree);

  // Page-level pick already chose the right page branch; only an embedded pick
  // (branch not a page variant) needs the in-tree swap. Either way, strip abTest.
  resolveVariantTree(tree, pageVariant ? null : branchId);
  return tree;
}
