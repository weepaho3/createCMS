import type { BlockTreeNode, ReconstructedBlock } from './reconstruct-snapshot';

// ============================================================================
// Types
// ============================================================================

export type CreatedBlock = {
  blockId: string;
  type: string;
  properties: Record<string, unknown>;
  children: string[];
};

export type UpdatedBlock = {
  blockId: string;
  type: string;
  properties: Record<string, unknown>;
  children: string[];
};

export type TreeDiffResult = {
  created: CreatedBlock[];
  updated: UpdatedBlock[];
  deleted: string[];
  allIncomingBlockIds: Set<string>;
};

type FlatNode = {
  blockId: string;
  type: string;
  properties: Record<string, unknown>;
  childIds: string[];
  parentBlockId: string | null;
  position: number;
};

// ============================================================================
// Helpers
// ============================================================================

function flattenTree(
  node: BlockTreeNode,
  parentBlockId: string | null,
  position: number,
  out: Map<string, FlatNode>,
): void {
  out.set(node.blockId, {
    blockId: node.blockId,
    type: node.type,
    properties: node.properties,
    childIds: node.children.map((c) => c.blockId),
    parentBlockId,
    position,
  });
  for (let i = 0; i < node.children.length; i++) {
    flattenTree(node.children[i], node.blockId, i, out);
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;

  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;

  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);
  if (aKeys.length !== bKeys.length) return false;

  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(bObj, key)) return false;
    if (!deepEqual(aObj[key], bObj[key])) return false;
  }
  return true;
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// ============================================================================
// diffTree
// ============================================================================

/**
 * Compares an incoming BlockTreeNode (desired state) against the current
 * snapshot and returns the minimal changeset needed to transition.
 */
export function diffTree(
  incoming: BlockTreeNode,
  current: Map<string, ReconstructedBlock>,
): TreeDiffResult {
  const flat = new Map<string, FlatNode>();
  flattenTree(incoming, null, 0, flat);

  const created: CreatedBlock[] = [];
  const updated: UpdatedBlock[] = [];
  const deleted: string[] = [];

  for (const [blockId, node] of flat) {
    const existing = current.get(blockId);

    if (!existing || existing.deleted) {
      created.push({
        blockId: node.blockId,
        type: node.type,
        properties: node.properties,
        children: node.childIds,
      });
      continue;
    }

    const propsChanged = !deepEqual(node.properties, existing.properties);
    const childrenChanged = !arraysEqual(node.childIds, existing.children);
    const typeChanged = node.type !== existing.type;

    if (propsChanged || childrenChanged || typeChanged) {
      updated.push({
        blockId: node.blockId,
        type: node.type,
        properties: node.properties,
        children: node.childIds,
      });
    }
  }

  for (const [blockId, block] of current) {
    if (block.deleted) continue;
    if (!flat.has(blockId)) {
      deleted.push(blockId);
    }
  }

  return {
    created,
    updated,
    deleted,
    allIncomingBlockIds: new Set(flat.keys()),
  };
}
