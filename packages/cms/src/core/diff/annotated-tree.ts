import type { ReconstructedBlock } from '../blocks/reconstruct-snapshot';
import type {
  AnnotatedBlockTreeNode,
  BlockChange,
  BlockDiffAnnotation,
} from './types';

import { ROOT_SLUG_PROP } from '../blocks/reconstruct-snapshot';

// ============================================================================
// Annotated diff tree
//
// Assembles the render-facing tree for a visual diff: the SOURCE (draft) tree
// — built with the exact alive-block semantics of `assembleBlockTree` — where
// every changed node carries a `diff` annotation projected from the flat
// change list, and deleted blocks are re-inserted as ghost nodes at their old
// base position (carrying their last-known base properties).
// ============================================================================

// ============================================================================
// Annotation projection
// ============================================================================

/**
 * Projects the render-relevant fields of a {@link BlockChange} onto a
 * {@link BlockDiffAnnotation}. The heavy `sourceVersion` / `targetVersion` /
 * `baseVersion` payloads intentionally never reach the tree — the tree is the
 * render surface, the flat list is the inspection surface.
 */
function toAnnotation(change: BlockChange): BlockDiffAnnotation {
  const annotation: BlockDiffAnnotation = { changeTypes: change.changeTypes };
  if (change.propertyChanges) {
    annotation.propertyChanges = change.propertyChanges;
  }
  if (change.typeChange) annotation.typeChange = change.typeChange;
  if (change.slugChange) annotation.slugChange = change.slugChange;
  if (change.moved) annotation.moved = change.moved;
  if (change.attribution) annotation.attribution = change.attribution;
  return annotation;
}

// ============================================================================
// Ghost placement
// ============================================================================

/**
 * Depth of a block in the BASE tree (root = 0), walking the alive-parent map
 * upward. The `seen` guard makes a corrupt parent cycle terminate instead of
 * looping forever.
 */
function baseDepth(blockId: string, parentInBase: Map<string, string>): number {
  const seen = new Set<string>([blockId]);
  let depth = 0;
  let current = parentInBase.get(blockId);
  while (current !== undefined && !seen.has(current)) {
    seen.add(current);
    depth++;
    current = parentInBase.get(current);
  }
  return depth;
}

/**
 * Inserts the pre-built ghost nodes under their BASE parents, positioned
 * relative to the base sibling order.
 *
 * Per parent, the base children are replayed in base order while tracking an
 * insertion anchor: a base child still alive under this parent in source moves
 * the anchor to its current index; a deleted base child gets its ghost spliced
 * in right after the anchor (so consecutive deletions keep their base relative
 * order). A base child that survived under a DIFFERENT parent (reparented
 * away) gets no ghost and leaves the anchor untouched.
 *
 * Parents are processed top-down by base-tree depth so a deleted parent's
 * ghost receives the ghosts of its own deleted base children, nesting whole
 * deleted subtrees.
 */
function placeGhosts(opts: {
  ghostById: Map<string, AnnotatedBlockTreeNode>;
  nodeById: Map<string, AnnotatedBlockTreeNode>;
  baseBlocks: Map<string, ReconstructedBlock>;
}): void {
  const { ghostById, nodeById, baseBlocks } = opts;

  const parentInBase = new Map<string, string>();
  for (const [, block] of baseBlocks) {
    if (block.deleted) continue;
    for (const childId of block.children) {
      // First parent wins, matching classify's buildParentIndex — a corrupted
      // snapshot referencing one block from two parents stays consistent.
      if (!parentInBase.has(childId)) {
        parentInBase.set(childId, block.blockId);
      }
    }
  }

  // A deleted block whose base parent is neither alive in source nor deleted
  // itself (e.g. the parent was already a tombstone in base, or the parent id
  // is dangling) has no position to re-insert at — it is SKIPPED here and
  // surfaces only through the flat change list.
  const parentIds = new Set<string>();
  for (const ghostId of ghostById.keys()) {
    const parentId = parentInBase.get(ghostId);
    if (parentId !== undefined) parentIds.add(parentId);
  }

  const orderedParentIds = [...parentIds].sort(
    (a, b) => baseDepth(a, parentInBase) - baseDepth(b, parentInBase),
  );

  // Guards against corrupted duplicate base references: each ghost node is
  // spliced into the tree at most once, under its first-encountered parent.
  const placed = new Set<string>();

  for (const parentId of orderedParentIds) {
    const container =
      nodeById.get(parentId)?.children ?? ghostById.get(parentId)?.children;
    if (!container) continue;

    let anchor = -1;
    for (const childId of baseBlocks.get(parentId)?.children ?? []) {
      const ghost = ghostById.get(childId);
      if (ghost && !placed.has(childId)) {
        placed.add(childId);
        anchor += 1;
        container.splice(anchor, 0, ghost);
        continue;
      }
      const index = container.findIndex((node) => node.blockId === childId);
      if (index !== -1) anchor = index;
    }
  }
}

// ============================================================================
// buildAnnotatedTree
// ============================================================================

/**
 * Builds the annotated diff tree for one root: the source (draft) tree with
 * per-node change annotations, plus ghost nodes for deleted blocks.
 *
 * The alive part mirrors `assembleBlockTree` exactly — one node per
 * non-deleted source block, children wired from the parent's ordered
 * `children` array (dropping references to deleted or absent blocks), and the
 * root translated to the logical `'root'` type with the reserved draft-slug
 * key stripped. Nodes without a change entry omit `diff` entirely.
 *
 * Each `deleted` change becomes a ghost node built from its `baseVersion`
 * (base type + base properties) and is re-inserted under its BASE parent at
 * its old relative position (see {@link placeGhosts}).
 *
 * Returns `null` when `rootId` is absent from — or deleted in — the source.
 */
export function buildAnnotatedTree(opts: {
  sourceBlocks: Map<string, ReconstructedBlock>;
  baseBlocks: Map<string, ReconstructedBlock>;
  changes: BlockChange[];
  rootId: string;
}): AnnotatedBlockTreeNode | null {
  const { sourceBlocks, baseBlocks, changes, rootId } = opts;

  const deletedInSource = new Set<string>();
  const nodeById = new Map<string, AnnotatedBlockTreeNode>();

  for (const [id, block] of sourceBlocks) {
    if (block.deleted) {
      deletedInSource.add(id);
      continue;
    }
    nodeById.set(id, {
      blockId: block.blockId,
      type: block.type,
      properties: block.properties,
      children: [],
    });
  }

  const rootNode = nodeById.get(rootId);
  if (!rootNode) return null;

  for (const [, block] of sourceBlocks) {
    if (block.deleted) continue;
    const node = nodeById.get(block.blockId)!;
    // Drop child references that point at a deleted block or at a block absent
    // from this snapshot — same rule as `assembleBlockTree` (a parent
    // legitimately keeps a reference to a child a merge excluded).
    node.children = block.children
      .filter((childId) => !deletedInSource.has(childId))
      .map((childId) => nodeById.get(childId))
      .filter(
        (candidate): candidate is AnnotatedBlockTreeNode =>
          candidate !== undefined,
      );
  }

  const ghostById = new Map<string, AnnotatedBlockTreeNode>();
  for (const change of changes) {
    const node = nodeById.get(change.blockId);
    if (node) {
      node.diff = toAnnotation(change);
      continue;
    }
    if (!change.changeTypes.includes('deleted')) continue;
    const base = change.baseVersion;
    if (!base) continue;
    ghostById.set(change.blockId, {
      blockId: change.blockId,
      type: base.type,
      properties: base.properties,
      diff: toAnnotation(change),
      children: [],
    });
  }

  placeGhosts({ ghostById, nodeById, baseBlocks });

  // Stored → logical root translation + reserved-key strip, mirroring
  // `assembleBlockTree` with `stripReservedProps`: the diff tree renders
  // through the same component maps as a page tree, so the top node must be
  // the logical `'root'` and the `__slug` draft-slug key must never leak.
  rootNode.type = 'root';
  if (ROOT_SLUG_PROP in rootNode.properties) {
    const { [ROOT_SLUG_PROP]: _omit, ...rest } = rootNode.properties;
    rootNode.properties = rest;
  }

  return rootNode;
}
