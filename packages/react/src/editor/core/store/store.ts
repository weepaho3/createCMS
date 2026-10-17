import type {
  EditorDocument,
  JsonValue,
  NodeData,
  Op,
  SlotRef,
} from '../document';
import type { AnyEditorSchema, NodeInput } from '../schema';
import type {
  CreateEditorStoreOptions,
  EditorCallbacks,
  EditorNodes,
  EditorStore,
  EditorStoreState,
  FieldRef,
  SlotTarget,
  UserSelection,
} from './types';

import {
  canPlaceIn,
  componentOf,
  DEFAULT_SLOT,
  defaultValuesFor,
  remapIds,
  slotsOf,
} from '../schema';
import { stableHash } from './hash';
import { createBlockId } from './id';
import { applyOp } from './ops';
import { denormalize, normalize, serializeSubtree } from './serde';

/** Window in which repeated updates of the same keys collapse into one undo step. */
export const COALESCE_MS = 400;

const EMPTY_SELECTION: UserSelection = {
  selected: null,
  hovered: null,
  focus: null,
  editing: null,
};

const NO_CALLBACKS: EditorCallbacks = {};

/** `undefined` never enters an op: it means "delete", like `null`. */
function normalizePatch(
  patch: Record<string, unknown>,
): Record<string, JsonValue | null> {
  const out: Record<string, JsonValue | null> = {};
  for (const [key, value] of Object.entries(patch)) {
    out[key] = value === undefined ? null : (value as JsonValue);
  }
  return out;
}

/** `target` with the slot filled in (`children` when omitted). */
function slotRef(target: SlotTarget): SlotRef {
  return { id: target.id, slot: target.slot ?? DEFAULT_SLOT };
}

/**
 * A new node of `type`: declared defaults under `props`, and every declared
 * slot present (filled from its `defaultValue` with fresh nodes built the
 * same way, else empty), so the document always lists the type's slots.
 */
function buildNode(
  schema: AnyEditorSchema,
  type: string,
  props: Record<string, unknown>,
  genId: () => string,
): NodeData {
  const def = componentOf(schema, type);
  const node: NodeData = {
    id: genId(),
    type,
    props: normalizePatchToProperties({
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

/** Drops selection references to ids that no longer exist. */
function pruneSelection(
  selection: Readonly<Record<string, UserSelection>>,
  nodes: EditorNodes,
): Readonly<Record<string, UserSelection>> {
  const has = (id: string | null): boolean => id !== null && id in nodes;
  const ref = (target: FieldRef | null): FieldRef | null =>
    target && has(target.blockId) ? target : null;
  const out: Record<string, UserSelection> = {};
  for (const [userId, sel] of Object.entries(selection)) {
    out[userId] = {
      selected: has(sel.selected) ? sel.selected : null,
      hovered: has(sel.hovered) ? sel.hovered : null,
      focus: ref(sel.focus),
      editing: ref(sel.editing),
    };
  }
  return out;
}

export function createEditorStore(
  options: CreateEditorStoreOptions,
): EditorStore {
  const {
    schema,
    initialValue,
    userId = 'local',
    genId = createBlockId,
    now = Date.now,
    getCallbacks = () => NO_CALLBACKS,
  } = options;
  const slotOrder = (type: string): readonly string[] =>
    Object.keys(slotsOf(schema, type));
  const initial = normalize(initialValue);
  let schemaVersion = initialValue.schemaVersion;

  let state: EditorStoreState = {
    rootId: initial.rootId,
    nodes: initial.nodes,
    selection: { [userId]: EMPTY_SELECTION },
    history: { past: [], future: [] },
    version: 0,
    savedVersion: 0,
    saving: false,
  };
  let docMemo: { version: number; doc: EditorDocument } | null = null;
  let hashMemo: { version: number; hash: string } | null = null;
  /** Whether the last past entry may still absorb same-key updates. */
  let coalesceOpen = false;
  const listeners = new Set<() => void>();

  const setState = (patch: Partial<EditorStoreState>): void => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };

  const getDocument = (): EditorDocument => {
    if (!docMemo || docMemo.version !== state.version) {
      docMemo = {
        version: state.version,
        doc: denormalize(
          { rootId: state.rootId, nodes: state.nodes },
          { schemaVersion, slotOrder },
        ),
      };
    }
    return docMemo.doc;
  };

  const currentHash = (): string => {
    if (!hashMemo || hashMemo.version !== state.version) {
      hashMemo = { version: state.version, hash: stableHash(getDocument()) };
    }
    return hashMemo.hash;
  };
  // Hash of the serialised form, so a loaded document that differs from it
  // only in representation (empty slots, key order) starts clean.
  let savedHash = currentHash();

  /** Applies ops all-or-nothing; returns the new table + inverses in undo order, or null. */
  const run = (
    ops: readonly Op[],
  ): {
    nodes: EditorNodes;
    rootId: string;
    inverse: Op[];
    schemaVersion: number;
  } | null => {
    let nodes = state.nodes;
    let rootId = state.rootId;
    let version = schemaVersion;
    const inverse: Op[] = [];
    for (const op of ops) {
      const result = applyOp(nodes, rootId, op, version);
      if (!result) return null;
      nodes = result.nodes;
      rootId = result.rootId;
      version = result.schemaVersion;
      inverse.unshift(result.inverse);
    }
    return { nodes, rootId, inverse, schemaVersion: version };
  };

  /** Applies LOCAL ops: history (with coalescing), version, listeners, onChange. */
  const commit = (
    ops: readonly Op[],
    key: string | null,
    extra: Partial<EditorStoreState> = {},
  ): boolean => {
    const result = run(ops);
    if (!result) return false;
    schemaVersion = result.schemaVersion;
    const at = now();
    const past = [...state.history.past];
    const last = past[past.length - 1];
    if (
      key !== null &&
      coalesceOpen &&
      last &&
      last.key === key &&
      at - last.at < COALESCE_MS
    ) {
      past[past.length - 1] = {
        ...last,
        ops: [...last.ops, ...ops],
        inverse: [...result.inverse, ...last.inverse],
        at,
      };
    } else {
      past.push({ ops: [...ops], inverse: result.inverse, key, at });
    }
    coalesceOpen = key !== null;
    const version = state.version + 1;
    setState({
      ...extra,
      nodes: result.nodes,
      rootId: result.rootId,
      selection: pruneSelection(
        extra.selection ?? state.selection,
        result.nodes,
      ),
      history: { past, future: [] },
      version,
    });
    getCallbacks().onChange?.({ ops, version, getDocument });
    return true;
  };

  const setLocalSelection = (patch: Partial<UserSelection>): void => {
    store.setUserSelection(userId, patch);
  };

  const store: EditorStore = {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getDocument,
    isDirty: () => currentHash() !== savedHash,

    load(doc) {
      const { nodes, rootId } = normalize(doc);
      schemaVersion = doc.schemaVersion;
      coalesceOpen = false;
      const version = state.version + 1;
      const selection: Record<string, UserSelection> = {};
      for (const id of Object.keys(state.selection))
        selection[id] = EMPTY_SELECTION;
      setState({
        nodes,
        rootId,
        selection,
        history: { past: [], future: [] },
        version,
        savedVersion: version,
        saving: false,
      });
      savedHash = currentHash();
    },

    add(type, { parent, index, props = {} }) {
      const target = slotRef(parent);
      const parentNode = state.nodes[target.id];
      if (!parentNode) return null;
      if (!canPlaceIn(schema, state.nodes, type, target).ok) return null;
      const node = buildNode(schema, type, props, genId);
      const length = parentNode.slots[target.slot]?.length ?? 0;
      const ok = commit(
        [{ op: 'insert', parent: target, index: index ?? length, node }],
        null,
        { selection: withLocal({ selected: node.id }) },
      );
      return ok ? node.id : null;
    },

    update(id, patch, options) {
      if (!(id in state.nodes)) return false;
      const normalized = normalizePatch(patch);
      const key = options?.coalesce
        ? `${id}:${Object.keys(normalized).sort().join(',')}`
        : null;
      return commit([{ op: 'update', id, patch: normalized }], key);
    },

    move(id, { parent, index }) {
      const node = state.nodes[id];
      if (!node || node.parent === null) return false;
      const target = slotRef(parent);
      if (
        !canPlaceIn(schema, state.nodes, node.type, target, { movingId: id }).ok
      ) {
        return false;
      }
      return commit([{ op: 'move', id, parent: target, index }], null);
    },

    remove(id) {
      return commit([{ op: 'remove', id }], null);
    },

    duplicate(id) {
      const node = state.nodes[id];
      if (!node || node.parent === null) return null;
      const parentNode = state.nodes[node.parent.id];
      if (!parentNode) return null;
      if (!canPlaceIn(schema, state.nodes, node.type, node.parent).ok) {
        return null;
      }
      const { node: copy } = remapIds(
        serializeSubtree(state.nodes, id, slotOrder),
        genId,
        { schema },
      );
      const siblings = parentNode.slots[node.parent.slot] ?? [];
      const ok = commit(
        [
          {
            op: 'insert',
            parent: node.parent,
            index: siblings.indexOf(id) + 1,
            node: copy,
          },
        ],
        null,
        { selection: withLocal({ selected: copy.id }) },
      );
      return ok ? copy.id : null;
    },

    applyRemote(ops) {
      const applied: Op[] = [];
      const rejected: Op[] = [];
      let nodes = state.nodes;
      let rootId = state.rootId;
      for (const op of ops) {
        const result = applyOp(nodes, rootId, op, schemaVersion);
        if (result) {
          nodes = result.nodes;
          rootId = result.rootId;
          schemaVersion = result.schemaVersion;
          applied.push(op);
        } else {
          rejected.push(op);
        }
      }
      if (applied.length > 0) {
        setState({
          nodes,
          rootId,
          selection: pruneSelection(state.selection, nodes),
          version: state.version + 1,
        });
      }
      return { applied, rejected };
    },

    undo() {
      const entry = state.history.past[state.history.past.length - 1];
      if (!entry) return false;
      const result = run(entry.inverse);
      if (!result) return false;
      schemaVersion = result.schemaVersion;
      coalesceOpen = false;
      const version = state.version + 1;
      setState({
        nodes: result.nodes,
        rootId: result.rootId,
        selection: pruneSelection(state.selection, result.nodes),
        history: {
          past: state.history.past.slice(0, -1),
          future: [entry, ...state.history.future],
        },
        version,
      });
      getCallbacks().onChange?.({
        ops: entry.inverse,
        version,
        getDocument,
      });
      return true;
    },

    redo() {
      const entry = state.history.future[0];
      if (!entry) return false;
      const result = run(entry.ops);
      if (!result) return false;
      schemaVersion = result.schemaVersion;
      coalesceOpen = false;
      const version = state.version + 1;
      setState({
        nodes: result.nodes,
        rootId: result.rootId,
        selection: pruneSelection(state.selection, result.nodes),
        history: {
          past: [...state.history.past, entry],
          future: state.history.future.slice(1),
        },
        version,
      });
      getCallbacks().onChange?.({ ops: entry.ops, version, getDocument });
      return true;
    },

    select(id) {
      coalesceOpen = false;
      setLocalSelection({ selected: id });
    },
    hover(id) {
      setLocalSelection({ hovered: id });
    },
    focus(target) {
      coalesceOpen = false;
      setLocalSelection({ focus: target });
    },
    setEditing(target) {
      coalesceOpen = false;
      setLocalSelection({ editing: target });
    },
    setUserSelection(user, patch) {
      const current = state.selection[user] ?? EMPTY_SELECTION;
      setState({
        selection: { ...state.selection, [user]: { ...current, ...patch } },
      });
    },

    markSaved() {
      savedHash = currentHash();
      setState({ savedVersion: state.version });
    },

    async save(meta = {}) {
      if (!store.isDirty()) return;
      const onSave = getCallbacks().onSave;
      if (!onSave) return;
      setState({ saving: true });
      try {
        await onSave(getDocument(), meta);
        store.markSaved();
      } finally {
        setState({ saving: false });
      }
    },
  };

  /** Local user's selection with `patch` applied, for `commit`'s `extra`. */
  function withLocal(
    patch: Partial<UserSelection>,
  ): Record<string, UserSelection> {
    const current = state.selection[userId] ?? EMPTY_SELECTION;
    return { ...state.selection, [userId]: { ...current, ...patch } };
  }

  return store;
}

/** Initial props never carry `undefined` (an op must stay JSON). */
function normalizePatchToProperties(
  properties: Record<string, unknown>,
): Record<string, JsonValue> {
  const out: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (value !== undefined) out[key] = value as JsonValue;
  }
  return out;
}
