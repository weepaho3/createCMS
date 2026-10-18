import type { JsonValue, NodeData, Op, Origin } from '../document';
import type {
  Change,
  CreateJsonDocStoreOptions,
  DocState,
  DocStore,
  HistoryEntry,
  HistoryStep,
  MarkId,
  Tx,
  TxMeta,
} from './types';

import { applyOp } from './ops';
import { normalize } from './serde';

/** Window in which steps with the same `mergeKey` become one undo step. */
export const MERGE_MS = 400;

/** Default history cap. */
export const MAX_HISTORY = 200;

/** A transaction did not apply; the store is unchanged. */
export class TxRejectedError extends Error {
  /** The op that could not apply, when one failed. */
  readonly op: Op | undefined;

  constructor(message: string, op?: Op, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'TxRejectedError';
    this.op = op;
  }
}

type Touch = {
  /** Nodes created, removed or moved. */
  nodes: Set<string>;
  /** `id:slot` lists whose order changed. */
  slots: Set<string>;
  /** `id\0key` props written. */
  props: Set<string>;
  /** Nodes whose props were written. */
  propNodes: Set<string>;
  /** Touches everything (`replace`). */
  all: boolean;
};

const SEP = '\0';

function emptyTouch(): Touch {
  return {
    nodes: new Set(),
    slots: new Set(),
    props: new Set(),
    propNodes: new Set(),
    all: false,
  };
}

function subtreeIds(node: NodeData, out: Set<string>): void {
  out.add(node.id);
  for (const children of Object.values(node.slots ?? {})) {
    for (const child of children) subtreeIds(child, out);
  }
}

/** What `ops` address, read from the ops and their inverses. */
function touchOf(ops: readonly Op[], into: Touch = emptyTouch()): Touch {
  for (const op of ops) {
    switch (op.op) {
      case 'insert':
        subtreeIds(op.node, into.nodes);
        into.slots.add(op.parent.id + SEP + op.parent.slot);
        break;
      case 'remove':
        into.nodes.add(op.id);
        break;
      case 'move':
        into.nodes.add(op.id);
        into.slots.add(op.parent.id + SEP + op.parent.slot);
        break;
      case 'update':
        into.propNodes.add(op.id);
        for (const key of Object.keys(op.patch)) {
          into.props.add(op.id + SEP + key);
        }
        break;
      case 'replace':
        into.all = true;
        break;
    }
  }
  return into;
}

function intersects(a: Set<string>, b: Set<string>): boolean {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const item of small) if (large.has(item)) return true;
  return false;
}

/**
 * Whether an undo step conflicts with a remote change: both address the
 * same node structurally, the same slot order, the same prop, or one
 * removes or moves a node whose props the other writes. Writes to
 * different props of one node do not conflict.
 */
function conflicts(entry: Touch, remote: Touch): boolean {
  if (entry.all || remote.all) return true;
  return (
    intersects(entry.nodes, remote.nodes) ||
    intersects(entry.slots, remote.slots) ||
    intersects(entry.props, remote.props) ||
    intersects(entry.nodes, remote.propNodes) ||
    intersects(entry.propNodes, remote.nodes)
  );
}

/** Change notifications for `ops`, applied against `before`. */
function changesOf(ops: readonly Op[], rootId: string): Change[] {
  const out: Change[] = [];
  for (const op of ops) {
    switch (op.op) {
      case 'insert':
        out.push({ kind: 'node', id: op.node.id });
        out.push({
          kind: 'placement',
          id: op.parent.id,
          keys: [op.parent.slot],
        });
        break;
      case 'remove':
        out.push({ kind: 'node', id: op.id });
        break;
      case 'move':
        out.push({ kind: 'placement', id: op.id, keys: [] });
        out.push({
          kind: 'placement',
          id: op.parent.id,
          keys: [op.parent.slot],
        });
        break;
      case 'update':
        out.push({ kind: 'props', id: op.id, keys: Object.keys(op.patch) });
        break;
      case 'replace':
        out.push({ kind: 'node', id: rootId });
        break;
    }
  }
  return out;
}

/** `value` with `path` set to `next` (`undefined` deletes); copies along the path. */
function setIn(
  value: JsonValue | undefined,
  path: readonly (string | number)[],
  next: JsonValue | undefined,
): JsonValue | undefined {
  if (path.length === 0) return next;
  const [head, ...rest] = path as [string | number, ...(string | number)[]];
  if (typeof head === 'number') {
    const list = Array.isArray(value) ? [...value] : [];
    const item = setIn(list[head], rest, next);
    if (item === undefined) list.splice(head, 1);
    else list[head] = item;
    return list;
  }
  const record: Record<string, JsonValue> =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? { ...value }
      : {};
  const item = setIn(record[head], rest, next);
  if (item === undefined) delete record[head];
  else record[head] = item;
  return record;
}

type Mark = {
  readonly id: MarkId;
  readonly pastLength: number;
  readonly selectionBefore: readonly string[];
  ops: Op[];
  inverse: Op[];
};

function stepOf(
  ops: readonly Op[],
  selection: readonly string[],
  label: string | undefined,
): HistoryStep {
  return { ops, selection, label };
}

/**
 * Where a `DocStore` keeps its document. The store core validates every
 * write with `applyOp` and keeps history and listeners; the backend stores
 * the result. `write` gets the validated `ops`, the state before and the
 * state they produce, and returns the state to publish (a CRDT backend
 * returns its own view, which may order or repair the tree).
 */
export type DocStoreBackend = {
  write(
    ops: readonly Op[],
    from: DocState,
    to: DocState,
    origin: Origin,
  ): DocState;
};

/** A `DocStore` whose backend can also publish changes made elsewhere. */
export type DocStoreCore = DocStore & {
  /**
   * Publishes `next`, a state the backend received from outside
   * `transact` (a remote peer): drops the undo steps it conflicts with and
   * notifies subscribers with origin `remote`. Returns the dropped steps.
   */
  receive(next: DocState): number;
};

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id, i) => id === b[i]);

/** The changes and the history touch between two states of one document. */
function diffStates(
  prev: DocState,
  next: DocState,
): { changes: Change[]; touch: Touch } {
  const touch = emptyTouch();
  const changes: Change[] = [];
  if (prev.rootId !== next.rootId) {
    touch.all = true;
    return { changes: [{ kind: 'node', id: next.rootId }], touch };
  }
  const ids = new Set([...Object.keys(prev.nodes), ...Object.keys(next.nodes)]);
  for (const id of ids) {
    const a = prev.nodes[id];
    const b = next.nodes[id];
    if (a === b) continue;
    if (!a || !b || a.type !== b.type) {
      touch.nodes.add(id);
      changes.push({ kind: 'node', id });
      continue;
    }
    if (a.parent?.id !== b.parent?.id || a.parent?.slot !== b.parent?.slot) {
      touch.nodes.add(id);
      changes.push({ kind: 'placement', id, keys: [] });
    }
    const slots = new Set([...Object.keys(a.slots), ...Object.keys(b.slots)]);
    const changedSlots = [...slots].filter(
      (slot) => !sameList(a.slots[slot] ?? [], b.slots[slot] ?? []),
    );
    if (changedSlots.length > 0) {
      for (const slot of changedSlots) touch.slots.add(id + SEP + slot);
      changes.push({ kind: 'placement', id, keys: changedSlots });
    }
    const keys = new Set([...Object.keys(a.props), ...Object.keys(b.props)]);
    const changedKeys = [...keys].filter(
      (key) => JSON.stringify(a.props[key]) !== JSON.stringify(b.props[key]),
    );
    if (changedKeys.length > 0) {
      touch.propNodes.add(id);
      for (const key of changedKeys) touch.props.add(id + SEP + key);
      changes.push({ kind: 'props', id, keys: changedKeys });
    }
  }
  return { changes, touch };
}

/**
 * The single-user `DocStore`: a flat node table with an undo history of op
 * inverses. Steps with the same `mergeKey` inside the merge window become
 * one; marks collect live writes for `squash` or `bail`; a remote change
 * drops the undo steps it conflicts with, so an undo never fails silently.
 */
export function createJsonDocStore(
  options: CreateJsonDocStoreOptions,
): DocStore {
  const initial = normalize(options.initialValue);
  return createDocStoreCore(
    {
      ...options,
      initial: {
        rootId: initial.rootId,
        nodes: initial.nodes,
        version: 0,
        schemaVersion: options.initialValue.schemaVersion,
      },
    },
    { write: (_ops, _from, to) => to },
  );
}

/** History options of a store core, with the state it starts from. */
export type DocStoreCoreOptions = Omit<
  CreateJsonDocStoreOptions,
  'initialValue'
> & {
  initial: DocState;
};

/**
 * The history and transaction logic of every `DocStore`, over a `backend`
 * that stores the document. `createJsonDocStore` keeps it in memory; a
 * collaborative store writes through to a CRDT and calls `receive` for
 * changes from other peers.
 */
export function createDocStoreCore(
  options: DocStoreCoreOptions,
  backend: DocStoreBackend,
): DocStoreCore {
  const now = options.now ?? Date.now;
  const mergeMs = options.mergeMs ?? MERGE_MS;
  const maxEntries = options.maxEntries ?? MAX_HISTORY;
  let state: DocState = options.initial;
  let past: HistoryEntry[] = [];
  let future: HistoryEntry[] = [];
  let mergeOpen = false;
  let marks: Mark[] = [];
  let nextMark = 1;
  const listeners = new Set<
    (changes: readonly Change[], origin: Origin) => void
  >();

  const notify = (changes: readonly Change[], origin: Origin): void => {
    for (const listener of listeners) listener(changes, origin);
  };

  /** Applies `ops` to `from`; throws `TxRejectedError` on the first invalid op. */
  const applyAll = (
    from: DocState,
    ops: readonly Op[],
  ): { state: DocState; inverse: Op[] } => {
    let nodes = from.nodes;
    let rootId = from.rootId;
    let schemaVersion = from.schemaVersion;
    const inverse: Op[] = [];
    for (const op of ops) {
      const result = applyOp(nodes, rootId, op, schemaVersion);
      if (!result)
        throw new TxRejectedError(`op "${op.op}" does not apply`, op);
      nodes = result.nodes;
      rootId = result.rootId;
      schemaVersion = result.schemaVersion;
      inverse.unshift(result.inverse);
    }
    return {
      state: { nodes, rootId, schemaVersion, version: from.version + 1 },
      inverse,
    };
  };

  const record = (
    ops: readonly Op[],
    inverse: readonly Op[],
    meta: TxMeta,
  ): void => {
    for (const mark of marks) {
      mark.ops.push(...ops);
      mark.inverse.unshift(...inverse);
    }
    if (meta.history === 'ignore') {
      mergeOpen = false;
      return;
    }
    const at = now();
    const before = meta.selection?.before ?? [];
    const after = meta.selection?.after ?? before;
    const last = past[past.length - 1];
    if (
      meta.mergeKey !== undefined &&
      mergeOpen &&
      last &&
      last.mergeKey === meta.mergeKey &&
      at - last.at < mergeMs
    ) {
      past[past.length - 1] = {
        ...last,
        ops: [...last.ops, ...ops],
        inverse: [...inverse, ...last.inverse],
        at,
        selectionAfter: after,
      };
    } else {
      past.push({
        ops: [...ops],
        inverse: [...inverse],
        at,
        selectionBefore: before,
        selectionAfter: after,
        mergeKey: meta.mergeKey,
        label: meta.label,
      });
      if (past.length > maxEntries) past = past.slice(past.length - maxEntries);
    }
    future = [];
    mergeOpen = meta.mergeKey !== undefined;
  };

  /** Drops undo steps that conflict with remote `ops` (their inverses name removed subtrees). */
  const invalidate = (ops: readonly Op[], inverse: readonly Op[]): number => {
    const remote = touchOf(inverse, touchOf(ops));
    const keep = (entry: HistoryEntry): boolean =>
      !conflicts(touchOf(entry.inverse, touchOf(entry.ops)), remote);
    const before = past.length + future.length;
    past = past.filter(keep);
    future = future.filter(keep);
    if (past.length < before) mergeOpen = false;
    return before - past.length - future.length;
  };

  const store: DocStoreCore = {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    transact(fn, meta = {}) {
      const origin = meta.origin ?? 'local';
      const ops: Op[] = [];
      const tx: Tx = {
        apply(op) {
          ops.push(op);
        },
        insertNode(parent, index, node) {
          ops.push({ op: 'insert', parent, index, node });
        },
        removeNode(id) {
          ops.push({ op: 'remove', id });
        },
        moveNode(id, parentId, slot, index) {
          ops.push({ op: 'move', id, parent: { id: parentId, slot }, index });
        },
        setProp(id, path, value) {
          const [key, ...rest] = path;
          if (typeof key !== 'string') {
            throw new TxRejectedError('setProp needs a string key first');
          }
          // Earlier writes of this transaction count: read through them.
          const draft = applyAll(state, ops).state;
          const node = draft.nodes[id];
          if (!node) throw new TxRejectedError(`unknown node "${id}"`);
          const next = setIn(node.props[key], rest, value);
          ops.push({ op: 'update', id, patch: { [key]: next ?? null } });
        },
        replaceDocument(doc) {
          ops.push({ op: 'replace', doc });
        },
      };
      try {
        fn(tx);
      } catch (error) {
        if (error instanceof TxRejectedError) throw error;
        throw new TxRejectedError('transaction threw', undefined, {
          cause: error,
        });
      }
      if (ops.length === 0) return { ops, inverse: [], invalidated: 0 };
      const { state: next, inverse } = applyAll(state, ops);
      state = backend.write(ops, state, next, origin);
      let invalidated = 0;
      if (origin === 'remote') invalidated = invalidate(ops, inverse);
      else if (origin !== 'history') record(ops, inverse, meta);
      notify(changesOf(ops, state.rootId), origin);
      return { ops, inverse, invalidated };
    },

    undo() {
      const entry = past[past.length - 1];
      if (!entry) return null;
      let applied: { state: DocState; inverse: Op[] };
      try {
        applied = applyAll(state, entry.inverse);
      } catch {
        // A step that no longer applies is dropped, never retried.
        past = past.slice(0, -1);
        return null;
      }
      state = backend.write(entry.inverse, state, applied.state, 'history');
      past = past.slice(0, -1);
      future = [entry, ...future];
      mergeOpen = false;
      notify(changesOf(entry.inverse, state.rootId), 'history');
      return stepOf(entry.inverse, entry.selectionBefore, entry.label);
    },

    redo() {
      const entry = future[0];
      if (!entry) return null;
      let applied: { state: DocState; inverse: Op[] };
      try {
        applied = applyAll(state, entry.ops);
      } catch {
        future = future.slice(1);
        return null;
      }
      state = backend.write(entry.ops, state, applied.state, 'history');
      future = future.slice(1);
      past = [...past, entry];
      mergeOpen = false;
      notify(changesOf(entry.ops, state.rootId), 'history');
      return stepOf(entry.ops, entry.selectionAfter, entry.label);
    },

    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,

    mark() {
      const id = nextMark++ as MarkId;
      marks.push({
        id,
        pastLength: past.length,
        selectionBefore: [],
        ops: [],
        inverse: [],
      });
      mergeOpen = false;
      return id;
    },

    squash(markId, meta = {}) {
      const index = marks.findIndex((m) => m.id === markId);
      if (index < 0) return;
      const mark = marks[index]!;
      marks = marks.slice(0, index);
      if (mark.ops.length === 0) return;
      const folded = past.slice(mark.pastLength);
      const entry: HistoryEntry = {
        ops: mark.ops,
        inverse: mark.inverse,
        at: now(),
        selectionBefore: folded[0]?.selectionBefore ?? mark.selectionBefore,
        selectionAfter:
          folded[folded.length - 1]?.selectionAfter ?? mark.selectionBefore,
        label: meta.label,
      };
      past = [...past.slice(0, mark.pastLength), entry];
      if (past.length > maxEntries) past = past.slice(past.length - maxEntries);
      future = [];
      mergeOpen = false;
    },

    bail(markId) {
      const index = marks.findIndex((m) => m.id === markId);
      if (index < 0) return [];
      const mark = marks[index]!;
      marks = marks.slice(0, index);
      const applied: Op[] = [];
      if (mark.ops.length > 0) {
        // Op by op: a step a remote change already undid is skipped.
        let nodes = state.nodes;
        let rootId = state.rootId;
        let schemaVersion = state.schemaVersion;
        const undo: Op[] = [];
        for (const op of mark.inverse) {
          const result = applyOp(nodes, rootId, op, schemaVersion);
          if (!result) continue;
          nodes = result.nodes;
          rootId = result.rootId;
          schemaVersion = result.schemaVersion;
          applied.push(op);
          undo.unshift(result.inverse);
        }
        state = backend.write(
          applied,
          state,
          { nodes, rootId, schemaVersion, version: state.version + 1 },
          'history',
        );
        for (const outer of marks) {
          outer.ops.push(...applied);
          outer.inverse.unshift(...undo);
        }
        notify(changesOf(applied, state.rootId), 'history');
      }
      past = past.slice(0, mark.pastLength);
      mergeOpen = false;
      return applied;
    },

    breakMerge() {
      mergeOpen = false;
    },

    clearHistory() {
      past = [];
      future = [];
      marks = [];
      mergeOpen = false;
    },

    getHistory: () => ({ past, future }),

    receive(next) {
      const { changes, touch } = diffStates(state, next);
      state = { ...next, version: state.version + 1 };
      if (changes.length === 0) return 0;
      const keep = (entry: HistoryEntry): boolean =>
        !conflicts(touchOf(entry.inverse, touchOf(entry.ops)), touch);
      const before = past.length + future.length;
      past = past.filter(keep);
      future = future.filter(keep);
      if (past.length + future.length < before) mergeOpen = false;
      notify(changes, 'remote');
      return before - past.length - future.length;
    },
  };
  return store;
}
