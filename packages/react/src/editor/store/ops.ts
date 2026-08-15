import type { BlockTreeNode } from '@createcms/schema';

import { flattenTree, serializeToTree } from './serde';
import type { EditorNode, EditorNodes, EditorOp } from './types';

export type ApplyResult = {
  readonly nodes: EditorNodes;
  readonly rootId: string;
  /** The op that undoes `op` from the resulting state. */
  readonly inverse: EditorOp;
};

const clamp = (index: number, length: number): number =>
  Math.max(0, Math.min(Math.trunc(index), length));

/** Every id in a subtree, parent first. */
function subtreeIds(nodes: EditorNodes, id: string): string[] {
  const out: string[] = [];
  const stack = [id];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    out.push(current);
    const node = nodes[current];
    if (node) stack.push(...node.childIds);
  }
  return out;
}

function treeIds(tree: BlockTreeNode, out: string[] = []): string[] {
  out.push(tree.blockId);
  for (const child of tree.children) treeIds(child, out);
  return out;
}

/** True when `candidate` is `id` itself or lives below it. */
function isSelfOrDescendant(
  nodes: EditorNodes,
  id: string,
  candidate: string,
): boolean {
  for (let p: string | null = candidate; p !== null; p = nodes[p]?.parentId ?? null) {
    if (p === id) return true;
  }
  return false;
}

/**
 * Applies one op to a node table. Pure: returns a new table (untouched nodes
 * are shared) plus the inverse op, or `null` when the op is rejected —
 * unknown ids, id collisions, moving/removing the root, a `move` into the
 * node's own subtree, a missing target parent. Indexes are clamped.
 */
export function applyOp(
  nodes: EditorNodes,
  rootId: string,
  op: EditorOp,
): ApplyResult | null {
  switch (op.op) {
    case 'add': {
      const parent = nodes[op.parentId];
      if (!parent) return null;
      const ids = treeIds(op.node);
      if (new Set(ids).size !== ids.length) return null;
      if (ids.some((id) => id in nodes)) return null;
      const { nodes: added } = flattenTree(op.node);
      const index = clamp(op.index, parent.childIds.length);
      const childIds = [...parent.childIds];
      childIds.splice(index, 0, op.node.blockId);
      const next: Record<string, EditorNode> = {
        ...nodes,
        ...added,
        [op.node.blockId]: { ...added[op.node.blockId]!, parentId: op.parentId },
        [op.parentId]: { ...parent, childIds },
      };
      return { nodes: next, rootId, inverse: { op: 'remove', id: op.node.blockId } };
    }
    case 'remove': {
      const node = nodes[op.id];
      if (!node || node.parentId === null || op.id === rootId) return null;
      const parent = nodes[node.parentId];
      if (!parent) return null;
      const doomed = new Set(subtreeIds(nodes, op.id));
      const next: Record<string, EditorNode> = {};
      for (const [id, n] of Object.entries(nodes)) {
        if (!doomed.has(id)) next[id] = n;
      }
      next[parent.id] = {
        ...parent,
        childIds: parent.childIds.filter((id) => id !== op.id),
      };
      return {
        nodes: next,
        rootId,
        inverse: {
          op: 'add',
          parentId: parent.id,
          index: parent.childIds.indexOf(op.id),
          node: serializeToTree(nodes, op.id),
        },
      };
    }
    case 'move': {
      const node = nodes[op.id];
      if (!node || node.parentId === null || op.id === rootId) return null;
      const target = nodes[op.parentId];
      if (!target) return null;
      if (isSelfOrDescendant(nodes, op.id, op.parentId)) return null;
      const oldParent = nodes[node.parentId];
      if (!oldParent) return null;
      const oldIndex = oldParent.childIds.indexOf(op.id);
      const next: Record<string, EditorNode> = { ...nodes };
      next[oldParent.id] = {
        ...oldParent,
        childIds: oldParent.childIds.filter((id) => id !== op.id),
      };
      const targetAfter = next[op.parentId]!;
      const childIds = [...targetAfter.childIds];
      childIds.splice(clamp(op.index, childIds.length), 0, op.id);
      next[op.parentId] = { ...targetAfter, childIds };
      next[op.id] = { ...node, parentId: op.parentId };
      return {
        nodes: next,
        rootId,
        inverse: { op: 'move', id: op.id, parentId: oldParent.id, index: oldIndex },
      };
    }
    case 'update': {
      const node = nodes[op.id];
      if (!node) return null;
      const properties: Record<string, unknown> = { ...node.properties };
      const inversePatch: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(op.patch)) {
        inversePatch[key] = key in node.properties ? node.properties[key] : null;
        if (value === null || value === undefined) delete properties[key];
        else properties[key] = value;
      }
      return {
        nodes: { ...nodes, [op.id]: { ...node, properties } },
        rootId,
        inverse: { op: 'update', id: op.id, patch: inversePatch },
      };
    }
    case 'load': {
      const previous = serializeToTree(nodes, rootId);
      const { nodes: next, rootId: nextRootId } = flattenTree(op.tree);
      return { nodes: next, rootId: nextRootId, inverse: { op: 'load', tree: previous } };
    }
  }
}
