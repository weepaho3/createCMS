import type { FlatNode, JsonValue, NodeData, Op } from '../document';
import type { EditorNodes } from './serde';

import { isSelfOrDescendant } from '../schema/placement';
import {
  denormalize,
  flattenSubtree,
  normalize,
  serializeSubtree,
} from './serde';

export type ApplyResult = {
  readonly nodes: EditorNodes;
  readonly rootId: string;
  /** The op that undoes `op` from the resulting state. */
  readonly inverse: Op;
  /** The document's schema version after the op (changed only by `replace`). */
  readonly schemaVersion: number;
};

const clamp = (index: number, length: number): number =>
  Math.max(0, Math.min(Math.trunc(index), length));

/** Every id in a subtree, parent first, across all slots. */
function subtreeIds(nodes: EditorNodes, id: string): string[] {
  const out: string[] = [];
  const stack = [id];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    out.push(current);
    const node = nodes[current];
    if (!node) continue;
    for (const children of Object.values(node.slots)) stack.push(...children);
  }
  return out;
}

function nodeIds(node: NodeData, out: string[] = []): string[] {
  out.push(node.id);
  for (const children of Object.values(node.slots ?? {})) {
    for (const child of children) nodeIds(child, out);
  }
  return out;
}

/** `node` with `slot` replaced by `ids`. */
function withSlot(node: FlatNode, slot: string, ids: string[]): FlatNode {
  return { ...node, slots: { ...node.slots, [slot]: ids } };
}

/**
 * Applies one op to a node table. Pure: returns a new table (untouched nodes
 * are shared) plus the inverse op, or `null` when the op is rejected:
 * unknown ids, id collisions, moving or removing the root, a `move` into the
 * node's own subtree (in any slot), a missing target parent. A target slot
 * the parent does not hold yet is created. Indexes are clamped; a `move`
 * index is the position after the node left its old place.
 * `schemaVersion` is the document's current version (kept unless `replace`).
 */
export function applyOp(
  nodes: EditorNodes,
  rootId: string,
  op: Op,
  schemaVersion = 0,
): ApplyResult | null {
  switch (op.op) {
    case 'insert': {
      const parent = nodes[op.parent.id];
      if (!parent) return null;
      const ids = nodeIds(op.node);
      if (new Set(ids).size !== ids.length) return null;
      if (ids.some((id) => id in nodes)) return null;
      const added = flattenSubtree(op.node, op.parent);
      const list = [...(parent.slots[op.parent.slot] ?? [])];
      list.splice(clamp(op.index, list.length), 0, op.node.id);
      return {
        nodes: {
          ...nodes,
          ...added,
          [parent.id]: withSlot(parent, op.parent.slot, list),
        },
        rootId,
        inverse: { op: 'remove', id: op.node.id },
        schemaVersion,
      };
    }
    case 'remove': {
      const node = nodes[op.id];
      if (!node || node.parent === null || op.id === rootId) return null;
      const parent = nodes[node.parent.id];
      if (!parent) return null;
      const siblings = parent.slots[node.parent.slot] ?? [];
      const doomed = new Set(subtreeIds(nodes, op.id));
      const next: Record<string, FlatNode> = {};
      for (const [id, n] of Object.entries(nodes)) {
        if (!doomed.has(id)) next[id] = n;
      }
      next[parent.id] = withSlot(
        parent,
        node.parent.slot,
        siblings.filter((id) => id !== op.id),
      );
      return {
        nodes: next,
        rootId,
        inverse: {
          op: 'insert',
          parent: node.parent,
          index: siblings.indexOf(op.id),
          node: serializeSubtree(nodes, op.id),
        },
        schemaVersion,
      };
    }
    case 'move': {
      const node = nodes[op.id];
      if (!node || node.parent === null || op.id === rootId) return null;
      if (!nodes[op.parent.id]) return null;
      if (isSelfOrDescendant(nodes, op.id, op.parent.id)) return null;
      const from = node.parent;
      const oldParent = nodes[from.id];
      if (!oldParent) return null;
      const oldList = oldParent.slots[from.slot] ?? [];
      const oldIndex = oldList.indexOf(op.id);
      const next: Record<string, FlatNode> = { ...nodes };
      next[from.id] = withSlot(
        oldParent,
        from.slot,
        oldList.filter((id) => id !== op.id),
      );
      const target = next[op.parent.id]!;
      const list = [...(target.slots[op.parent.slot] ?? [])];
      list.splice(clamp(op.index, list.length), 0, op.id);
      next[op.parent.id] = withSlot(target, op.parent.slot, list);
      next[op.id] = { ...node, parent: op.parent };
      return {
        nodes: next,
        rootId,
        inverse: { op: 'move', id: op.id, parent: from, index: oldIndex },
        schemaVersion,
      };
    }
    case 'update': {
      const node = nodes[op.id];
      if (!node) return null;
      const props: Record<string, JsonValue> = { ...node.props };
      const inversePatch: Record<string, JsonValue | null> = {};
      for (const [key, value] of Object.entries(op.patch)) {
        inversePatch[key] =
          key in node.props ? (node.props[key] ?? null) : null;
        if (value === null || value === undefined) delete props[key];
        else props[key] = value;
      }
      return {
        nodes: { ...nodes, [op.id]: { ...node, props } },
        rootId,
        inverse: { op: 'update', id: op.id, patch: inversePatch },
        schemaVersion,
      };
    }
    case 'replace': {
      const previous = denormalize({ rootId, nodes }, { schemaVersion });
      const next = normalize(op.doc);
      return {
        nodes: next.nodes,
        rootId: next.rootId,
        inverse: { op: 'replace', doc: previous },
        schemaVersion: op.doc.schemaVersion,
      };
    }
  }
}
