import type {
  EditorDocument,
  FlatNode,
  NodeData,
  NormalizedDoc,
  SlotRef,
} from '../document';

/** Slot names of a node type in the order they should serialise. */
export type SlotOrder = (type: string) => readonly string[];

/** Flat nodes keyed by id. */
export type EditorNodes = Readonly<Record<string, FlatNode>>;

/**
 * Adds a nested node and its subtree to `out`. `parent` is where the node
 * sits (`null` for the root). Every slot of the node, empty ones included,
 * becomes a list of child ids.
 */
function flatten(
  node: NodeData,
  parent: SlotRef | null,
  out: Record<string, FlatNode>,
): void {
  const slots: Record<string, string[]> = {};
  for (const [slot, children] of Object.entries(node.slots ?? {})) {
    slots[slot] = children.map((child) => child.id);
  }
  const flat: FlatNode = {
    id: node.id,
    type: node.type,
    props: node.props,
    parent,
    slots,
  };
  if (node.v !== undefined) flat.v = node.v;
  if (node.meta !== undefined) flat.meta = node.meta;
  out[node.id] = flat;
  for (const [slot, children] of Object.entries(node.slots ?? {})) {
    for (const child of children) flatten(child, { id: node.id, slot }, out);
  }
}

/** A nested subtree as flat nodes; the subtree root gets `parent`. */
export function flattenSubtree(
  node: NodeData,
  parent: SlotRef | null,
): Record<string, FlatNode> {
  const out: Record<string, FlatNode> = {};
  flatten(node, parent, out);
  return out;
}

/** A nested document in flat form: every node keyed by id. */
export function normalize(doc: EditorDocument): NormalizedDoc {
  return { rootId: doc.root.id, nodes: flattenSubtree(doc.root, null) };
}

/**
 * Slot names in a stable order: the type's declared slots first (in
 * `slotOrder`), then every other slot alphabetically.
 */
function orderedSlots(
  node: FlatNode,
  slotOrder: SlotOrder | undefined,
): string[] {
  const names = Object.keys(node.slots);
  const declared = slotOrder ? slotOrder(node.type) : [];
  const known = declared.filter((name) => names.includes(name));
  const rest = names.filter((name) => !known.includes(name)).sort();
  return [...known, ...rest];
}

/**
 * The nested form of the subtree at `id`. Slots keep their child order and
 * appear in `slotOrder` order (declared slots, then the rest
 * alphabetically); a node without slots carries no `slots`. Throws on a
 * dangling child id: the table is corrupt, not the caller.
 */
export function serializeSubtree(
  nodes: EditorNodes,
  id: string,
  slotOrder?: SlotOrder,
): NodeData {
  const build = (nodeId: string): NodeData => {
    const node = nodes[nodeId];
    if (!node) {
      throw new Error(`serializeSubtree: dangling child id "${nodeId}"`);
    }
    const out: NodeData = {
      id: node.id,
      type: node.type,
      props: { ...node.props },
    };
    if (node.v !== undefined) out.v = node.v;
    const names = orderedSlots(node, slotOrder);
    if (names.length > 0) {
      const slots: Record<string, NodeData[]> = {};
      for (const name of names)
        slots[name] = (node.slots[name] ?? []).map(build);
      out.slots = slots;
    }
    if (node.meta !== undefined) out.meta = node.meta;
    return out;
  };
  return build(id);
}

/** A flat document back in nested form, the inverse of {@link normalize}. */
export function denormalize(
  nd: NormalizedDoc,
  options: { schemaVersion?: number; slotOrder?: SlotOrder } = {},
): EditorDocument {
  return {
    schemaVersion: options.schemaVersion ?? 0,
    root: serializeSubtree(nd.nodes, nd.rootId, options.slotOrder),
  };
}
