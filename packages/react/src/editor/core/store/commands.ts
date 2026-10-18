import type {
  EditorDocument,
  JsonValue,
  NodeData,
  Op,
  SlotRef,
} from '../document';
import type { AnyEditorSchema, NodeInput, PlaceErrorCode } from '../schema';
import type {
  CommandHandler,
  DocState,
  HandlerContext,
  Middleware,
  SlotTarget,
} from './types';

import {
  canPlaceIn,
  componentOf,
  DEFAULT_SLOT,
  defaultValuesFor,
  remapIds,
  slotsOf,
} from '../schema';
import { applyOp } from './ops';
import { serializeSubtree } from './serde';

/** A command refused by the placement rules. */
export class PlacementError extends Error {
  readonly code: PlaceErrorCode;
  readonly op: Op;

  constructor(code: PlaceErrorCode, op: Op) {
    super(`placement refused: ${code}`);
    this.name = 'PlacementError';
    this.code = code;
    this.op = op;
  }
}

/** `target` with the slot filled in (`children` when omitted). */
export function slotRef(target: SlotTarget): SlotRef {
  return { id: target.id, slot: target.slot ?? DEFAULT_SLOT };
}

/** `undefined` never enters an op: it means "delete", like `null`. */
export function normalizePatch(
  patch: Record<string, unknown>,
): Record<string, JsonValue | null> {
  const out: Record<string, JsonValue | null> = {};
  for (const [key, value] of Object.entries(patch)) {
    out[key] = value === undefined ? null : (value as JsonValue);
  }
  return out;
}

function definedProps(
  properties: Record<string, unknown>,
): Record<string, JsonValue> {
  const out: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (value !== undefined) out[key] = value as JsonValue;
  }
  return out;
}

/**
 * A new node of `type`: declared defaults under `props`, and every declared
 * slot present (filled from its `defaultValue` with fresh nodes built the
 * same way, else empty), so the document always lists the type's slots.
 */
export function buildNode(
  schema: AnyEditorSchema,
  type: string,
  props: Record<string, unknown>,
  genId: () => string,
): NodeData {
  const def = componentOf(schema, type);
  const node: NodeData = {
    id: genId(),
    type,
    props: definedProps({
      ...defaultValuesFor(def ?? { fields: {} }),
      ...props,
    }),
  };
  const slots: Record<string, NodeData[]> = {};
  for (const [name, spec] of Object.entries(def?.slots ?? {})) {
    slots[name] = (spec.defaultValue ?? []).map((input) =>
      fromInput(schema, input, genId),
    );
  }
  if (Object.keys(slots).length > 0) node.slots = slots;
  return node;
}

function fromInput(
  schema: AnyEditorSchema,
  input: NodeInput,
  genId: () => string,
): NodeData {
  const node = buildNode(schema, input.type, input.props ?? {}, genId);
  if (input.slots) {
    const slots: Record<string, NodeData[]> = { ...node.slots };
    for (const [name, children] of Object.entries(input.slots)) {
      slots[name] = children.map((child) => fromInput(schema, child, genId));
    }
    node.slots = slots;
  }
  return node;
}

const slotOrderOf =
  (schema: AnyEditorSchema) =>
  (type: string): readonly string[] =>
    Object.keys(slotsOf(schema, type));

function requireNode(state: DocState, id: string) {
  const node = state.nodes[id];
  if (!node) throw new Error(`unknown node "${id}"`);
  return node;
}

export type InsertPayload = {
  type: string;
  parent: SlotTarget;
  index?: number;
  props?: Record<string, unknown>;
};
export type InsertNodePayload = {
  parent: SlotTarget;
  index?: number;
  /** A prebuilt subtree; ids are kept. */
  node: NodeData;
};
export type RemovePayload = { id: string };
export type MovePayload = { id: string; parent: SlotTarget; index: number };
export type UpdatePayload = { id: string; patch: Record<string, unknown> };
export type DuplicatePayload = { id: string };
export type WrapPayload = {
  id: string;
  type: string;
  slot?: string;
  props?: Record<string, unknown>;
};
export type ReplacePayload = { doc: EditorDocument };
export type DetachPayload = {
  /** The `$ref` node to replace. */
  id: string;
  /** Its resolved section; every id is replaced. */
  nodes: readonly NodeData[];
};
export type PastePayload = {
  parent: SlotTarget;
  index?: number;
  /** Subtrees from elsewhere; every id is replaced. */
  nodes: readonly NodeData[];
};

const insert: CommandHandler<InsertPayload> = (payload, ctx) => {
  const state = ctx.getState();
  const target = slotRef(payload.parent);
  const parent = requireNode(state, target.id);
  const node = buildNode(ctx.schema, payload.type, payload.props ?? {}, () =>
    ctx.genId(),
  );
  ctx.select([node.id]);
  return [
    {
      op: 'insert',
      parent: target,
      index: payload.index ?? parent.slots[target.slot]?.length ?? 0,
      node,
    },
  ];
};

const insertNode: CommandHandler<InsertNodePayload> = (payload, ctx) => {
  const state = ctx.getState();
  const target = slotRef(payload.parent);
  const parent = requireNode(state, target.id);
  ctx.select([payload.node.id]);
  return [
    {
      op: 'insert',
      parent: target,
      index: payload.index ?? parent.slots[target.slot]?.length ?? 0,
      node: payload.node,
    },
  ];
};

const remove: CommandHandler<RemovePayload> = ({ id }, ctx) => {
  requireNode(ctx.getState(), id);
  return [{ op: 'remove', id }];
};

const move: CommandHandler<MovePayload> = ({ id, parent, index }, ctx) => {
  requireNode(ctx.getState(), id);
  return [{ op: 'move', id, parent: slotRef(parent), index }];
};

const update: CommandHandler<UpdatePayload> = ({ id, patch }, ctx) => {
  requireNode(ctx.getState(), id);
  return [{ op: 'update', id, patch: normalizePatch(patch) }];
};

const duplicate: CommandHandler<DuplicatePayload> = ({ id }, ctx) => {
  const state = ctx.getState();
  const node = requireNode(state, id);
  if (node.parent === null) throw new Error('the root cannot be duplicated');
  const siblings = state.nodes[node.parent.id]?.slots[node.parent.slot] ?? [];
  const { node: copy } = remapIds(
    serializeSubtree(state.nodes, id, slotOrderOf(ctx.schema)),
    () => ctx.genId(),
    { schema: ctx.schema },
  );
  ctx.select([copy.id]);
  return [
    {
      op: 'insert',
      parent: node.parent,
      index: siblings.indexOf(id) + 1,
      node: copy,
    },
  ];
};

const wrap: CommandHandler<WrapPayload> = (payload, ctx) => {
  const state = ctx.getState();
  const node = requireNode(state, payload.id);
  if (node.parent === null) throw new Error('the root cannot be wrapped');
  const siblings = state.nodes[node.parent.id]?.slots[node.parent.slot] ?? [];
  const wrapper = buildNode(ctx.schema, payload.type, payload.props ?? {}, () =>
    ctx.genId(),
  );
  const slot = payload.slot ?? DEFAULT_SLOT;
  ctx.select([wrapper.id]);
  return [
    {
      op: 'insert',
      parent: node.parent,
      index: siblings.indexOf(payload.id),
      node: wrapper,
    },
    { op: 'move', id: payload.id, parent: { id: wrapper.id, slot }, index: 0 },
  ];
};

function requireKnownTypes(schema: AnyEditorSchema, node: NodeData): void {
  if (!(node.type in schema.components)) {
    throw new Error(`unknown block type "${node.type}"`);
  }
  for (const children of Object.values(node.slots ?? {})) {
    for (const child of children) requireKnownTypes(schema, child);
  }
}

const paste: CommandHandler<PastePayload> = (payload, ctx) => {
  const state = ctx.getState();
  const target = slotRef(payload.parent);
  const parent = requireNode(state, target.id);
  const start = payload.index ?? parent.slots[target.slot]?.length ?? 0;
  const copies = payload.nodes.map((node) => {
    requireKnownTypes(ctx.schema, node);
    return remapIds(node, () => ctx.genId(), { schema: ctx.schema }).node;
  });
  ctx.select(copies.map((copy) => copy.id));
  return copies.map((node, offset) => ({
    op: 'insert' as const,
    parent: target,
    index: start + offset,
    node,
  }));
};

const detach: CommandHandler<DetachPayload> = ({ id, nodes }, ctx) => {
  const state = ctx.getState();
  const parent = requireNode(state, id).parent;
  if (parent === null) throw new Error('the root cannot be detached');
  const siblings = state.nodes[parent.id]?.slots[parent.slot] ?? [];
  const index = siblings.indexOf(id);
  const copies = nodes.map((child) => {
    requireKnownTypes(ctx.schema, child);
    return remapIds(child, () => ctx.genId(), { schema: ctx.schema }).node;
  });
  ctx.select(copies.map((copy) => copy.id));
  return [
    { op: 'remove', id },
    ...copies.map((copy, offset) => ({
      op: 'insert' as const,
      parent,
      index: index + offset,
      node: copy,
    })),
  ];
};

const replace: CommandHandler<ReplacePayload> = ({ doc }) => [
  { op: 'replace', doc },
];

/** The command types every editor store handles. */
export const BUILTIN_COMMANDS = {
  'node.insert': insert,
  'node.insertNode': insertNode,
  'node.remove': remove,
  'node.move': move,
  'node.update': update,
  'node.duplicate': duplicate,
  'node.wrap': wrap,
  'node.paste': paste,
  'node.detach': detach,
  'doc.replace': replace,
} as const satisfies Record<string, CommandHandler>;

/** Payload of each built-in command type. */
export type BuiltinCommandPayloads = {
  'node.insert': InsertPayload;
  'node.insertNode': InsertNodePayload;
  'node.remove': RemovePayload;
  'node.move': MovePayload;
  'node.update': UpdatePayload;
  'node.duplicate': DuplicatePayload;
  'node.wrap': WrapPayload;
  'node.paste': PastePayload;
  'node.detach': DetachPayload;
  'doc.replace': ReplacePayload;
};

/**
 * The placement rule as a check over a list of ops: each `insert` and `move`
 * is tested with `canPlaceIn` against the state the earlier ops produced.
 * Returns the first refusal, or `null`. An op that does not apply at all is
 * left for the store to reject.
 */
export function checkPlacement(
  schema: AnyEditorSchema,
  state: DocState,
  ops: readonly Op[],
): { op: Op; code: PlaceErrorCode } | null {
  let nodes = state.nodes;
  let rootId = state.rootId;
  for (const op of ops) {
    if (op.op === 'insert') {
      const result = canPlaceIn(schema, nodes, op.node.type, op.parent);
      if (!result.ok) return { op, code: result.code };
    } else if (op.op === 'move') {
      const node = nodes[op.id];
      if (node) {
        const result = canPlaceIn(schema, nodes, node.type, op.parent, {
          movingId: op.id,
        });
        if (!result.ok) return { op, code: result.code };
      }
    }
    const applied = applyOp(nodes, rootId, op, state.schemaVersion);
    if (!applied) return null;
    nodes = applied.nodes;
    rootId = applied.rootId;
  }
  return null;
}

/** Refuses local commands whose ops break the placement rules. */
export const placementMiddleware: Middleware = (ctx, next) => {
  const ops = next(ctx.cmd);
  const origin = ctx.cmd.meta?.origin ?? 'local';
  if (origin !== 'local') return ops;
  const refused = checkPlacement(ctx.schema, ctx.getState(), ops);
  if (refused) throw new PlacementError(refused.code, refused.op);
  return ops;
};

export type { HandlerContext };
