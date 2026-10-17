import type { EditorDocument, JsonValue, NodeData } from '../document';
import type {
  CreateEditorStoreOptions,
  EditorCallbacks,
  EditorNodes,
  EditorOp,
  EditorStore,
  EditorStoreState,
  FieldRef,
  UserSelection,
} from './types';

import {
  canPlace,
  componentOf,
  defaultValuesFor,
  getPlacement,
} from '../schema';
import { stableHash } from './hash';
import { createBlockId } from './id';
import { applyOp } from './ops';
import { flattenTree, serializeDocument, serializeToTree } from './serde';

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
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    out[key] = value === undefined ? null : value;
  }
  return out;
}

/** Deep copy of a subtree with fresh ids (props copied shallowly). */
function cloneSubtree(tree: NodeData, genId: () => string): NodeData {
  const copy: NodeData = { ...tree, id: genId(), props: { ...tree.props } };
  if (tree.slots) {
    const slots: Record<string, NodeData[]> = {};
    for (const [slot, children] of Object.entries(tree.slots)) {
      slots[slot] = children.map((child) => cloneSubtree(child, genId));
    }
    copy.slots = slots;
  }
  return copy;
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
  const placement = getPlacement(schema);
  const initial = flattenTree(initialValue.root);
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
        doc: serializeDocument(state.nodes, state.rootId, schemaVersion),
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
    ops: readonly EditorOp[],
  ): {
    nodes: EditorNodes;
    rootId: string;
    inverse: EditorOp[];
    schemaVersion: number;
  } | null => {
    let nodes = state.nodes;
    let rootId = state.rootId;
    let version = schemaVersion;
    const inverse: EditorOp[] = [];
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
    ops: readonly EditorOp[],
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
      const { nodes, rootId } = flattenTree(doc.root);
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

    add(type, { parentId, index, properties = {} }) {
      const parent = state.nodes[parentId];
      if (!parent) return null;
      const parentType = parentId === state.rootId ? 'root' : parent.type;
      if (!canPlace(placement, type, parentType)) return null;
      const id = genId();
      const seeded = {
        ...defaultValuesFor(componentOf(schema, type) ?? { fields: {} }),
        ...properties,
      };
      const node: NodeData = {
        id,
        type,
        props: normalizePatchToProperties(seeded),
      };
      const ok = commit(
        [{ op: 'add', parentId, index: index ?? parent.childIds.length, node }],
        null,
        { selection: withLocal({ selected: id }) },
      );
      return ok ? id : null;
    },

    update(id, patch, options) {
      if (!(id in state.nodes)) return false;
      const normalized = normalizePatch(patch);
      const key = options?.coalesce
        ? `${id}:${Object.keys(normalized).sort().join(',')}`
        : null;
      return commit([{ op: 'update', id, patch: normalized }], key);
    },

    move(id, parentId, index) {
      const node = state.nodes[id];
      const target = state.nodes[parentId];
      if (!node || !target || node.parentId === null) return false;
      const parentType = parentId === state.rootId ? 'root' : target.type;
      if (!canPlace(placement, node.type, parentType)) return false;
      return commit([{ op: 'move', id, parentId, index }], null);
    },

    remove(id) {
      return commit([{ op: 'remove', id }], null);
    },

    duplicate(id) {
      const node = state.nodes[id];
      if (!node || node.parentId === null) return null;
      const parent = state.nodes[node.parentId];
      if (!parent) return null;
      const copy = cloneSubtree(serializeToTree(state.nodes, id), genId);
      const ok = commit(
        [
          {
            op: 'add',
            parentId: parent.id,
            index: parent.childIds.indexOf(id) + 1,
            node: copy,
          },
        ],
        null,
        { selection: withLocal({ selected: copy.id }) },
      );
      return ok ? copy.id : null;
    },

    applyRemote(ops) {
      const applied: EditorOp[] = [];
      const rejected: EditorOp[] = [];
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
