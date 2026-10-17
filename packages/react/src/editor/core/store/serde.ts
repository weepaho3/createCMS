import type { EditorDocument, JsonValue, NodeData } from '../document';
import type { EditorNode, EditorNodes } from './types';

import { DEFAULT_SLOT } from '../schema/placement';

/**
 * Nested node → flat node table + root id. Every node's `type` is kept
 * verbatim (the root stays `'root'`). The store holds one slot per node, the
 * default `children` slot; a node with another slot name throws.
 */
export function flattenTree(tree: NodeData): {
  nodes: EditorNodes;
  rootId: string;
} {
  const nodes: Record<string, EditorNode> = {};
  const walk = (node: NodeData, parentId: string | null): void => {
    const children = childrenOf(node);
    const flat: {
      -readonly [K in keyof EditorNode]: EditorNode[K];
    } = {
      id: node.id,
      type: node.type,
      properties: node.props,
      parentId,
      childIds: children.map((child) => child.id),
    };
    if (node.v !== undefined) flat.v = node.v;
    if (node.meta !== undefined) flat.meta = node.meta;
    nodes[node.id] = flat;
    for (const child of children) walk(child, node.id);
  };
  walk(tree, null);
  return { nodes, rootId: tree.id };
}

function childrenOf(node: NodeData): NodeData[] {
  if (!node.slots) return [];
  for (const slot of Object.keys(node.slots)) {
    if (slot !== DEFAULT_SLOT) {
      throw new Error(
        `flattenTree: node "${node.id}" uses slot "${slot}"; the store holds the "${DEFAULT_SLOT}" slot only`,
      );
    }
  }
  return node.slots[DEFAULT_SLOT] ?? [];
}

/**
 * Flat node table → nested node, starting at `rootId` (or any subtree root).
 * A node without children carries no `slots`. Throws on a dangling child id:
 * the table is corrupt, not the caller.
 */
export function serializeToTree(nodes: EditorNodes, rootId: string): NodeData {
  const build = (id: string): NodeData => {
    const node = nodes[id];
    if (!node) throw new Error(`serializeToTree: dangling child id "${id}"`);
    const out: NodeData = {
      id: node.id,
      type: node.type,
      props: { ...(node.properties as Record<string, JsonValue>) },
    };
    if (node.v !== undefined) out.v = node.v;
    if (node.childIds.length > 0) {
      out.slots = { [DEFAULT_SLOT]: node.childIds.map(build) };
    }
    if (node.meta !== undefined) out.meta = node.meta;
    return out;
  };
  return build(rootId);
}

/** Flat node table → a whole document. */
export function serializeDocument(
  nodes: EditorNodes,
  rootId: string,
  schemaVersion: number,
): EditorDocument {
  return { schemaVersion, root: serializeToTree(nodes, rootId) };
}
