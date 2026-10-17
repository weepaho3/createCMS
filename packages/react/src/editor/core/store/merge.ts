import type { EditorDocument, FlatNode } from '../document';
import type { SlotOrder } from './serde';

import { canonicalJson } from '../document';
import { denormalize, normalize } from './serde';

export type MergeResult =
  | { readonly ok: true; readonly doc: EditorDocument }
  | {
      readonly ok: false;
      /** Ids changed on both sides differently, or left inconsistent by the merge. */
      readonly conflicts: readonly string[];
    };

const same = (a: FlatNode | undefined, b: FlatNode | undefined): boolean =>
  a === b ||
  (a !== undefined && b !== undefined && canonicalJson(a) === canonicalJson(b));

/**
 * Three-way merge per node id: a node changed (or added, or removed) on one
 * side only takes that side; a node changed on both sides in the same way
 * takes either; a node changed on both sides differently is a conflict.
 * A node's own record includes its props, its place and its slot lists, so
 * two inserts into the same slot conflict on the parent. The result must
 * form a consistent tree, else every node that breaks it is reported.
 */
export function mergeByNode(
  base: EditorDocument,
  local: EditorDocument,
  server: EditorDocument,
  options: { slotOrder?: SlotOrder } = {},
): MergeResult {
  const b = normalize(base);
  const l = normalize(local);
  const s = normalize(server);
  if (l.rootId !== s.rootId)
    return { ok: false, conflicts: [l.rootId, s.rootId] };
  const ids = new Set([
    ...Object.keys(b.nodes),
    ...Object.keys(l.nodes),
    ...Object.keys(s.nodes),
  ]);
  const conflicts: string[] = [];
  const nodes: Record<string, FlatNode> = {};
  for (const id of ids) {
    const was = b.nodes[id];
    const mine = l.nodes[id];
    const theirs = s.nodes[id];
    let pick: FlatNode | undefined;
    if (same(mine, theirs)) pick = mine;
    else if (same(was, mine)) pick = theirs;
    else if (same(was, theirs)) pick = mine;
    else {
      conflicts.push(id);
      continue;
    }
    if (pick) nodes[id] = pick;
  }
  if (conflicts.length === 0) {
    for (const node of Object.values(nodes)) {
      for (const [slot, children] of Object.entries(node.slots)) {
        for (const child of children) {
          const entry = nodes[child];
          if (
            !entry ||
            entry.parent?.id !== node.id ||
            entry.parent.slot !== slot
          ) {
            conflicts.push(child);
          }
        }
      }
      if (
        node.parent &&
        !nodes[node.parent.id]?.slots[node.parent.slot]?.includes(node.id)
      ) {
        conflicts.push(node.id);
      }
    }
  }
  if (conflicts.length > 0) {
    return { ok: false, conflicts: [...new Set(conflicts)].sort() };
  }
  return {
    ok: true,
    doc: denormalize(
      { rootId: l.rootId, nodes },
      {
        schemaVersion: Math.max(local.schemaVersion, server.schemaVersion),
        slotOrder: options.slotOrder,
      },
    ),
  };
}
