import type { EditorDocument, JsonValue, Op } from '../document';
import type { DocState } from './types';

import { canonicalJson } from '../document';
import { applyOp } from './ops';
import { serializeSubtree } from './serde';

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id, i) => id === b[i]);

/** Whether two node tables hold the same tree. */
function sameTree(
  a: Pick<DocState, 'nodes' | 'rootId'>,
  b: Pick<DocState, 'nodes' | 'rootId'>,
): boolean {
  if (a.rootId !== b.rootId) return false;
  const ids = Object.keys(a.nodes);
  if (ids.length !== Object.keys(b.nodes).length) return false;
  return ids.every((id) => {
    const x = a.nodes[id];
    const y = b.nodes[id];
    if (!x || !y) return false;
    if (x === y) return true;
    const slots = Object.keys(x.slots);
    return (
      x.type === y.type &&
      x.parent?.id === y.parent?.id &&
      x.parent?.slot === y.parent?.slot &&
      slots.length === Object.keys(y.slots).length &&
      slots.every((slot) =>
        sameList(x.slots[slot] ?? [], y.slots[slot] ?? []),
      ) &&
      canonicalJson(x.props) === canonicalJson(y.props)
    );
  });
}

/** The ops that turn `prev` into `next`, or `null` when no op list does. */
function structuralOps(prev: DocState, next: DocState): Op[] | null {
  if (prev.rootId !== next.rootId) return null;
  const ops: Op[] = [];
  // Removed subtrees, from their top node.
  for (const id of Object.keys(prev.nodes)) {
    if (next.nodes[id]) continue;
    const parent = prev.nodes[id]!.parent;
    if (parent && !next.nodes[parent.id]) continue;
    ops.push({ op: 'remove', id });
  }
  // Every slot of `next`, front to back: insert new nodes, move the others
  // to their place. Moves of nodes already in place are skipped below.
  let draft = prev;
  const apply = (op: Op): boolean => {
    const result = applyOp(draft.nodes, draft.rootId, op, draft.schemaVersion);
    if (!result) return false;
    draft = { ...draft, nodes: result.nodes, rootId: result.rootId };
    return true;
  };
  for (const op of ops) if (!apply(op)) return null;
  const visit = (id: string): boolean => {
    const node = next.nodes[id]!;
    for (const [slot, children] of Object.entries(node.slots)) {
      for (const [index, child] of children.entries()) {
        const current = draft.nodes[child];
        let op: Op | null = null;
        if (!current) {
          op = {
            op: 'insert',
            parent: { id, slot },
            index,
            node: serializeSubtree(next.nodes, child),
          };
        } else {
          const list = draft.nodes[id]?.slots[slot] ?? [];
          if (
            current.parent?.id !== id ||
            current.parent.slot !== slot ||
            list[index] !== child
          ) {
            op = { op: 'move', id: child, parent: { id, slot }, index };
          }
        }
        if (op) {
          if (!apply(op)) return false;
          ops.push(op);
        }
        if (op?.op !== 'insert' && !visit(child)) return false;
      }
    }
    return true;
  };
  if (!visit(next.rootId)) return null;
  // Props of nodes that existed before.
  for (const [id, node] of Object.entries(next.nodes)) {
    const before = draft.nodes[id];
    if (!before || before === node) continue;
    const patch: Record<string, JsonValue | null> = {};
    const keys = new Set([
      ...Object.keys(before.props),
      ...Object.keys(node.props),
    ]);
    for (const key of keys) {
      const value = node.props[key];
      if (JSON.stringify(before.props[key]) !== JSON.stringify(value)) {
        patch[key] = value ?? null;
      }
    }
    if (Object.keys(patch).length > 0) {
      const op: Op = { op: 'update', id, patch };
      if (!apply(op)) return null;
      ops.push(op);
    }
  }
  return sameTree(draft, next) ? ops : null;
}

/**
 * The ops that turn `prev` into `next`: removals, inserts, moves and prop
 * updates, checked by applying them. A difference no op list reproduces
 * (another root) becomes one `replace` of the whole document.
 */
export function diffOps(prev: DocState, next: DocState): Op[] {
  const ops = structuralOps(prev, next);
  if (ops) return ops;
  const doc: EditorDocument = {
    schemaVersion: next.schemaVersion,
    root: serializeSubtree(next.nodes, next.rootId),
  };
  return [{ op: 'replace', doc }];
}
