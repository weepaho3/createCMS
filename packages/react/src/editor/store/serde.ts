import type { BlockTreeNode } from '@createcms/schema';

import type { EditorNode, EditorNodes } from './types';

/**
 * Nested tree (as `getBlockTree` delivers it) → flat node table + root id.
 * Every node's `type` is kept verbatim — the root stays `'root'`.
 */
export function flattenTree(tree: BlockTreeNode): {
  nodes: EditorNodes;
  rootId: string;
} {
  const nodes: Record<string, EditorNode> = {};
  const walk = (node: BlockTreeNode, parentId: string | null): void => {
    nodes[node.blockId] = {
      id: node.blockId,
      type: node.type,
      properties: node.properties,
      parentId,
      childIds: node.children.map((child) => child.blockId),
    };
    for (const child of node.children) walk(child, node.blockId);
  };
  walk(tree, null);
  return { nodes, rootId: tree.blockId };
}

/**
 * Flat node table → nested tree, starting at `rootId` (or any subtree root).
 * Throws on a dangling child id — the table is corrupt, not the caller.
 */
export function serializeToTree(nodes: EditorNodes, rootId: string): BlockTreeNode {
  const build = (id: string): BlockTreeNode => {
    const node = nodes[id];
    if (!node) throw new Error(`serializeToTree: dangling child id "${id}"`);
    return {
      blockId: node.id,
      type: node.type,
      properties: { ...node.properties },
      children: node.childIds.map(build),
    };
  };
  return build(rootId);
}
