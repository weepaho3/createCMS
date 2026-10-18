import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';
import * as Y from 'yjs';

import type {
  DocState,
  DocStoreCore,
  EditorDocument,
  EditorNodes,
  FlatNode,
  JsonValue,
  NodeData,
  Op,
  SlotRef,
  HistoryEntry,
  HistoryStep,
  MarkId,
  Origin,
  TxMeta,
} from '../core';

import { applyOp, createDocStoreCore, DEFAULT_SLOT, MERGE_MS } from '../core';
import { diffOps } from './diff-ops';

/**
 * Where a node sits: one atomic value, so concurrent moves of the same node
 * resolve by last writer wins and a node is never in two places.
 */
export type YjsPlacement = {
  readonly parentId: string;
  readonly slot: string;
  /** Fractional index (`fractional-indexing`); siblings sort by it, then by id. */
  readonly order: string;
  /** Where a move took the node from: the place a cycle repair returns it to. */
  readonly prev?: {
    readonly parentId: string;
    readonly slot: string;
    readonly order: string;
  };
};

export type CreateYjsDocStoreOptions = {
  /** The shared document. One `Y.Doc` per editor document. */
  ydoc: Y.Doc;
  /**
   * Written into `ydoc` when it holds no document yet (a new page). Peers
   * that seed the same document produce the same content, so a race is
   * harmless.
   */
  initialValue?: EditorDocument;
  /** Clock for merging undo steps. Default `Date.now`. */
  now?: () => number;
  /** Merge window in ms (`MERGE_MS`). */
  mergeMs?: number;
  /** History cap (`MAX_HISTORY`). */
  maxEntries?: number;
  /** Random source for order-key jitter. Default `Math.random`. */
  random?: () => number;
};

/** A `DocStore` over a `Y.Doc`, plus the document it writes to. */
export type YjsDocStore = DocStoreCore & {
  readonly ydoc: Y.Doc;
  /** Stops listening to `ydoc`. The `Y.Doc` itself stays open. */
  destroy(): void;
};

const META = 'editor';
const NODES = 'nodes';

type YNode = Y.Map<unknown>;

const placementOf = (node: YNode): YjsPlacement | null =>
  (node.get('placement') as YjsPlacement | null | undefined) ?? null;

/** Sort order of siblings: the fractional key with `<`, then the id. */
const bySiblingOrder =
  (orders: ReadonlyMap<string, string>) =>
  (a: string, b: string): number => {
    const x = orders.get(a) ?? '';
    const y = orders.get(b) ?? '';
    if (x < y) return -1;
    if (x > y) return 1;
    return a < b ? -1 : a > b ? 1 : 0;
  };

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id, i) => id === b[i]);

const sameJson = (a: unknown, b: unknown) =>
  a === b || JSON.stringify(a) === JSON.stringify(b);

/**
 * A `DocStore` over a `Y.Doc` for collaborative editing. Every node is one
 * `Y.Map` in the `nodes` map: `type`, `placement` (parent, slot and a
 * fractional `order`, written as one value), `props` (a `Y.Map`, last
 * writer wins per key), the slot names it holds, `v` and `meta`. Writes are
 * validated like in the JSON store and written in one Yjs transaction;
 * changes from other peers reach subscribers with origin `remote` and drop
 * the local undo steps they conflict with.
 *
 * The published tree is derived from the map: siblings sort by `order`,
 * then id. A node whose parent another peer removed meanwhile is shown at
 * the end of the root's `children`, and a cycle from two concurrent moves is
 * broken by showing the cycle's greatest id there; every peer derives the
 * same tree from the same map. Order keys never leave the store: exported
 * documents keep plain arrays.
 */
export function createYjsDocStore(
  options: CreateYjsDocStoreOptions,
): YjsDocStore {
  const { ydoc } = options;
  const random = options.random ?? Math.random;
  const meta = ydoc.getMap<unknown>(META);
  const nodesMap = ydoc.getMap<YNode>(NODES);
  /** Marks our own transactions: anything else came from another peer. */
  const local = { store: 'editor' };
  /** Marks a cycle repair this store wrote (published as `system`). */
  const repairing = { store: 'editor-repair' };
  /** Our writes that are not undoable (remote ops, `history: 'ignore'`). */
  const untracked = { store: 'editor-untracked' };
  /** The origin `write` uses for the transaction running now. */
  let writeOrigin: object = local;

  if (meta.get('rootId') === undefined && options.initialValue) {
    const doc = options.initialValue;
    ydoc.transact(() => {
      meta.set('rootId', doc.root.id);
      meta.set('schemaVersion', doc.schemaVersion);
      writeSubtree(doc.root, null, null);
    }, local);
  }

  // Derived nodes are rebuilt only when their Y.Map changed.
  const cache = new Map<string, FlatNode>();
  let dirty: Set<string> | 'all' = 'all';

  /** Nodes whose placement changed: where a cycle can have appeared. */
  const moved = new Set<string>();

  const onDeep = (events: Y.YEvent<Y.AbstractType<unknown>>[]) => {
    for (const event of events) {
      const id = event.path[0];
      if (typeof id === 'string' && event.changes.keys.has('placement')) {
        moved.add(id);
      }
      if (event.target === nodesMap) {
        for (const key of event.changes.keys.keys()) moved.add(key);
      }
    }
    if (dirty === 'all') return;
    for (const event of events) {
      if (event.target === nodesMap) {
        for (const key of event.changes.keys.keys()) dirty.add(key);
      } else {
        const id = event.path[0];
        if (typeof id === 'string') dirty.add(id);
      }
    }
  };
  nodesMap.observeDeep(onDeep);
  // A new root or schema version re-reads every node.
  const onMeta = () => {
    dirty = 'all';
  };
  meta.observe(onMeta);

  /** The fresh (uncached) fields of one node; parent and slots come later. */
  function readNode(id: string, node: YNode) {
    const props = node.get('props') as Y.Map<JsonValue> | undefined;
    return {
      type: node.get('type') as string,
      props: (props?.toJSON() ?? {}) as Record<string, JsonValue>,
      slotNames: (node.get('slots') as string[] | undefined) ?? [],
      v: node.get('v') as number | undefined,
      meta: node.get('meta') as NodeData['meta'] | undefined,
      placement: placementOf(node),
      id,
    };
  }

  type Read = ReturnType<typeof readNode>;
  const reads = new Map<string, Read>();

  /** The tree every peer derives from the same map. */
  function derive(version: number): DocState {
    const rootId = meta.get('rootId') as string;
    if (dirty === 'all') {
      reads.clear();
      nodesMap.forEach((node, id) => reads.set(id, readNode(id, node)));
    } else {
      for (const id of dirty) {
        const node = nodesMap.get(id);
        if (node) reads.set(id, readNode(id, node));
        else reads.delete(id);
      }
    }
    dirty = new Set();

    // Parents as stored, then orphans and cycles resolved onto the root.
    const parentOf = new Map<string, { id: string; slot: string }>();
    const orders = new Map<string, string>();
    for (const [id, read] of reads) {
      if (id === rootId || !read.placement) continue;
      orders.set(id, read.placement.order);
      parentOf.set(id, {
        id: read.placement.parentId,
        slot: read.placement.slot,
      });
    }
    const attachToRoot = (id: string) =>
      parentOf.set(id, { id: rootId, slot: DEFAULT_SLOT });
    for (const [id, parent] of parentOf) {
      if (!reads.has(parent.id)) attachToRoot(id);
    }
    for (;;) {
      const reachable = new Set<string>([rootId]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const [id, parent] of parentOf) {
          if (!reachable.has(id) && reachable.has(parent.id)) {
            reachable.add(id);
            grew = true;
          }
        }
      }
      const stranded = [...parentOf.keys()].filter((id) => !reachable.has(id));
      if (stranded.length === 0) break;
      // Every stranded node hangs off a cycle: break the cycle at its
      // greatest id, found by walking up from the greatest stranded id.
      const start = stranded.sort().at(-1)!;
      const cycle: string[] = [];
      let cur: string | undefined = start;
      while (cur !== undefined && !cycle.includes(cur)) {
        cycle.push(cur);
        cur = parentOf.get(cur)?.id;
      }
      const loop = cur === undefined ? cycle : cycle.slice(cycle.indexOf(cur));
      attachToRoot(loop.sort().at(-1)!);
    }

    const children = new Map<string, Map<string, string[]>>();
    for (const [id, parent] of parentOf) {
      const slots = children.get(parent.id) ?? new Map<string, string[]>();
      const list = slots.get(parent.slot) ?? [];
      list.push(id);
      slots.set(parent.slot, list);
      children.set(parent.id, slots);
    }
    const sort = bySiblingOrder(orders);

    const nodes: Record<string, FlatNode> = {};
    for (const [id, read] of reads) {
      const own = children.get(id) ?? new Map<string, string[]>();
      const names = [...new Set([...read.slotNames, ...own.keys()])];
      const prev = cache.get(id);
      const slots: Record<string, string[]> = {};
      for (const name of names) {
        const list = (own.get(name) ?? []).sort(sort);
        const old = prev?.slots[name];
        slots[name] = old && sameList(old, list) ? old : list;
      }
      const parent: SlotRef | null =
        id === rootId ? null : (parentOf.get(id) ?? null);
      const same =
        prev !== undefined &&
        prev.type === read.type &&
        prev.parent?.id === parent?.id &&
        prev.parent?.slot === parent?.slot &&
        Object.keys(prev.slots).length === names.length &&
        names.every((name) => prev.slots[name] === slots[name]) &&
        sameJson(prev.props, read.props) &&
        prev.v === read.v &&
        sameJson(prev.meta, read.meta);
      let node: FlatNode;
      if (same) {
        node = prev;
      } else {
        node = { id, type: read.type, props: read.props, parent, slots };
        if (read.v !== undefined) node.v = read.v;
        if (read.meta !== undefined) node.meta = read.meta;
      }
      nodes[id] = node;
      cache.set(id, node);
    }
    for (const id of cache.keys()) if (!reads.has(id)) cache.delete(id);

    return {
      rootId,
      nodes,
      version,
      schemaVersion: (meta.get('schemaVersion') as number | undefined) ?? 0,
    };
  }

  /** A key strictly between `before` and `after`, picked at random from a few. */
  function keyBetween(before: string | null, after: string | null): string {
    const keys = generateNKeysBetween(before, after, 4);
    return (
      keys[Math.floor(random() * keys.length)] ??
      generateKeyBetween(before, after)
    );
  }

  function orderOf(id: string): string | null {
    const node = nodesMap.get(id);
    return node ? (placementOf(node)?.order ?? null) : null;
  }

  /**
   * A key for position `at` among `siblings` (in sibling order). Siblings
   * can share a key (two peers picked the same one); the upper bound is the
   * next key greater than the lower one, so such a run is never split.
   */
  function keyAt(siblings: readonly string[], at: number): string {
    const prev = at > 0 ? orderOf(siblings[at - 1]!) : null;
    let next: string | null = null;
    for (const id of siblings.slice(at)) {
      const key = orderOf(id);
      if (key !== null && (prev === null || key > prev)) {
        next = key;
        break;
      }
    }
    return keyBetween(prev, next);
  }

  /** Writes a nested subtree; the top node gets `placement`, children fresh keys. */
  function writeSubtree(
    node: NodeData,
    parent: SlotRef | null,
    order: string | null,
  ): void {
    const ynode = new Y.Map<unknown>();
    nodesMap.set(node.id, ynode);
    ynode.set('type', node.type);
    const props = new Y.Map<JsonValue>();
    for (const [key, value] of Object.entries(node.props))
      props.set(key, value);
    ynode.set('props', props);
    ynode.set(
      'placement',
      parent && order !== null
        ? ({
            parentId: parent.id,
            slot: parent.slot,
            order,
          } satisfies YjsPlacement)
        : null,
    );
    ynode.set('slots', Object.keys(node.slots ?? {}));
    if (node.v !== undefined) ynode.set('v', node.v);
    if (node.meta !== undefined) ynode.set('meta', node.meta);
    for (const [slot, list] of Object.entries(node.slots ?? {})) {
      // Deterministic keys: peers seeding the same document agree.
      const keys = generateNKeysBetween(null, null, list.length);
      list.forEach((child, i) =>
        writeSubtree(child, { id: node.id, slot }, keys[i]!),
      );
    }
  }

  function syncSlotNames(id: string, state: EditorNodes): void {
    const node = nodesMap.get(id);
    const flat = state[id];
    if (!node || !flat) return;
    const names = Object.keys(flat.slots);
    const stored = (node.get('slots') as string[] | undefined) ?? [];
    if (!sameList(stored, names)) node.set('slots', names);
  }

  /** Writes one validated op; `before` is the state it applies to. */
  function writeOp(op: Op, before: DocState, after: DocState): void {
    switch (op.op) {
      case 'insert': {
        const siblings =
          before.nodes[op.parent.id]?.slots[op.parent.slot] ?? [];
        const at = Math.max(0, Math.min(Math.trunc(op.index), siblings.length));
        writeSubtree(op.node, op.parent, keyAt(siblings, at));
        syncSlotNames(op.parent.id, after.nodes);
        return;
      }
      case 'remove': {
        const stack = [op.id];
        while (stack.length > 0) {
          const id = stack.pop()!;
          const flat = before.nodes[id];
          if (flat)
            for (const list of Object.values(flat.slots)) stack.push(...list);
          nodesMap.delete(id);
        }
        return;
      }
      case 'move': {
        const node = nodesMap.get(op.id);
        if (!node) return;
        const siblings = (
          before.nodes[op.parent.id]?.slots[op.parent.slot] ?? []
        ).filter((id) => id !== op.id);
        const at = Math.max(0, Math.min(Math.trunc(op.index), siblings.length));
        const current = placementOf(node);
        const placement: {
          -readonly [K in keyof YjsPlacement]: YjsPlacement[K];
        } = {
          parentId: op.parent.id,
          slot: op.parent.slot,
          order: keyAt(siblings, at),
        };
        if (current) {
          placement.prev = {
            parentId: current.parentId,
            slot: current.slot,
            order: current.order,
          };
        }
        node.set('placement', placement);
        syncSlotNames(op.parent.id, after.nodes);
        return;
      }
      case 'update': {
        const props = nodesMap.get(op.id)?.get('props') as
          | Y.Map<JsonValue>
          | undefined;
        if (!props) return;
        for (const [key, value] of Object.entries(op.patch)) {
          if (value === null) props.delete(key);
          else props.set(key, value);
        }
        return;
      }
      case 'replace': {
        nodesMap.clear();
        meta.set('rootId', op.doc.root.id);
        meta.set('schemaVersion', op.doc.schemaVersion);
        writeSubtree(op.doc.root, null, null);
        return;
      }
    }
  }

  /**
   * Writes the repair of every cycle reachable from `candidates` in the
   * stored placements. In each cycle, the node whose placement was written
   * first (lowest clock, then client id) goes back to its previous place,
   * or to the end of the root's `children` when that place is gone or
   * inside the cycle. Every peer picks the same node; a repair written by
   * two peers resolves like any concurrent move.
   */
  function repairCycles(candidates: Iterable<string>): boolean {
    const rootId = meta.get('rootId') as string | undefined;
    if (rootId === undefined) return false;
    const parentOf = (id: string): string | undefined => {
      const node = nodesMap.get(id);
      const placement = node ? placementOf(node) : null;
      return placement && nodesMap.has(placement.parentId)
        ? placement.parentId
        : undefined;
    };
    const writeRank = (id: string): [number, number] => {
      const item = nodesMap.get(id)?._map.get('placement');
      return item ? [item.id.clock, item.id.client] : [0, 0];
    };
    const reaches = (from: string, target: string): boolean => {
      const seen = new Set<string>();
      for (
        let cur: string | undefined = from;
        cur !== undefined;
        cur = parentOf(cur)
      ) {
        if (cur === target) return true;
        if (seen.has(cur)) return false;
        seen.add(cur);
      }
      return false;
    };
    const fixes = new Map<string, YjsPlacement>();
    for (const start of candidates) {
      const path: string[] = [];
      let cur: string | undefined = start;
      while (cur !== undefined && !path.includes(cur) && cur !== rootId) {
        path.push(cur);
        cur = parentOf(cur);
      }
      if (cur === undefined || cur === rootId) continue;
      const cycle = path.slice(path.indexOf(cur));
      if (cycle.some((id) => fixes.has(id))) continue;
      const pick = [...cycle].sort((a, b) => {
        const [ca, xa] = writeRank(a);
        const [cb, xb] = writeRank(b);
        return ca - cb || xa - xb || (a < b ? -1 : 1);
      })[0]!;
      const prev = placementOf(nodesMap.get(pick)!)?.prev;
      if (
        prev &&
        nodesMap.has(prev.parentId) &&
        !reaches(prev.parentId, pick)
      ) {
        fixes.set(pick, { ...prev });
      } else {
        const rootChildren: string[] = [];
        nodesMap.forEach((node) => {
          const placement = placementOf(node);
          if (
            placement?.parentId === rootId &&
            placement.slot === DEFAULT_SLOT
          ) {
            rootChildren.push(placement.order);
          }
        });
        const last = rootChildren.sort().at(-1) ?? null;
        fixes.set(pick, {
          parentId: rootId,
          slot: DEFAULT_SLOT,
          order: generateKeyBetween(last, null),
        });
      }
    }
    if (fixes.size === 0) return false;
    ydoc.transact(() => {
      for (const [id, placement] of fixes) {
        nodesMap.get(id)?.set('placement', placement);
      }
    }, repairing);
    return true;
  }

  const initial = derive(0);
  const core = createDocStoreCore(
    {
      now: options.now,
      mergeMs: options.mergeMs,
      maxEntries: options.maxEntries,
      initial,
      recordHistory: false,
    },
    {
      write(ops, from, to) {
        ydoc.transact(() => {
          let state = from;
          for (const op of ops) {
            const result = applyOp(
              state.nodes,
              state.rootId,
              op,
              state.schemaVersion,
            );
            if (!result) continue;
            const after: DocState = {
              nodes: result.nodes,
              rootId: result.rootId,
              schemaVersion: result.schemaVersion,
              version: state.version,
            };
            writeOp(op, state, after);
            state = after;
          }
        }, writeOrigin);
        return derive(to.version);
      },
    },
  );

  // Undo runs on Yjs: only our own tracked writes are undone, and an undo
  // reverts just what the step changed (a move only the placement), so
  // other people's changes always stay.
  const undoManager = new Y.UndoManager([nodesMap, meta], {
    trackedOrigins: new Set<unknown>([local]),
    captureTimeout: options.mergeMs ?? MERGE_MS,
  });
  const captureTimeout = undoManager.captureTimeout;
  let replaying = false;
  let lastMergeKey: string | undefined;
  let mergeOpen = false;
  /** Selection and label of the write running now, for its stack item. */
  let pending: {
    before: readonly string[];
    after: readonly string[];
    label: string | undefined;
  } | null = null;

  type Mark = {
    readonly id: MarkId;
    readonly stackLength: number;
    readonly snapshot: DocState;
    wrote: boolean;
  };
  let marks: Mark[] = [];
  let nextMark = 1;

  undoManager.on('stack-item-added', ({ stackItem, type }) => {
    if (replaying || type !== 'undo' || !pending) return;
    stackItem.meta.set('before', pending.before);
    stackItem.meta.set('after', pending.after);
    if (pending.label !== undefined) stackItem.meta.set('label', pending.label);
  });
  undoManager.on('stack-item-updated', ({ stackItem, type }) => {
    if (replaying || type !== 'undo' || !pending) return;
    stackItem.meta.set('after', pending.after);
  });

  const onAfterTransaction = (tr: Y.Transaction) => {
    if (tr.origin === local || tr.origin === untracked) {
      moved.clear();
      return;
    }
    if (tr.changed.size === 0 && tr.changedParentTypes.size === 0) return;
    const origin =
      tr.origin === repairing
        ? 'system'
        : tr.origin === undoManager
          ? 'history'
          : 'remote';
    core.receive(derive(core.getSnapshot().version + 1), origin);
    const candidates = [...moved];
    moved.clear();
    if (origin !== 'system') repairCycles(candidates);
  };
  ydoc.on('afterTransaction', onAfterTransaction);

  /** Runs an undo-manager step and reports what it changed. */
  function replay(
    run: () => { meta: Map<string, unknown> } | null,
    selectionKey: 'before' | 'after',
  ): HistoryStep | null {
    const before = core.getSnapshot();
    replaying = true;
    let item: { meta: Map<string, unknown> } | null;
    try {
      item = run();
    } finally {
      replaying = false;
    }
    mergeOpen = false;
    if (!item) return null;
    const label = item.meta.get('label');
    return {
      ops: diffOps(before, core.getSnapshot()),
      selection:
        (item.meta.get(selectionKey) as readonly string[] | undefined) ?? [],
      label: typeof label === 'string' ? label : undefined,
    };
  }

  const entryOf = (item: { meta: Map<string, unknown> }): HistoryEntry => {
    const label = item.meta.get('label');
    return {
      ops: [],
      inverse: [],
      at: 0,
      selectionBefore:
        (item.meta.get('before') as readonly string[] | undefined) ?? [],
      selectionAfter:
        (item.meta.get('after') as readonly string[] | undefined) ?? [],
      label: typeof label === 'string' ? label : undefined,
    };
  };

  /** Picks the Yjs origin and the capture grouping for one local write. */
  function prepareWrite(meta: TxMeta): void {
    const origin: Origin = meta.origin ?? 'local';
    if (origin !== 'local') {
      writeOrigin = untracked;
      return;
    }
    const mark = marks.at(-1);
    if (!mark && meta.history === 'ignore') {
      writeOrigin = untracked;
      return;
    }
    writeOrigin = local;
    const first = !mark || !mark.wrote;
    if (first) {
      const merges =
        meta.mergeKey !== undefined &&
        mergeOpen &&
        meta.mergeKey === lastMergeKey;
      if (!merges) undoManager.stopCapturing();
      lastMergeKey = meta.mergeKey;
      mergeOpen = meta.mergeKey !== undefined;
    }
    if (mark) {
      mark.wrote = true;
      // Everything until the squash becomes one stack item.
      undoManager.captureTimeout = Number.POSITIVE_INFINITY;
    }
    const before = meta.selection?.before ?? [];
    pending = {
      before,
      after: meta.selection?.after ?? before,
      label: meta.label,
    };
  }

  return {
    ...core,
    ydoc,
    transact(fn, meta = {}) {
      prepareWrite(meta);
      try {
        return core.transact(fn, meta);
      } finally {
        writeOrigin = local;
        pending = null;
      }
    },
    undo: () => replay(() => undoManager.undo(), 'before'),
    redo: () => replay(() => undoManager.redo(), 'after'),
    canUndo: () => undoManager.canUndo(),
    canRedo: () => undoManager.canRedo(),
    mark() {
      const id = nextMark++ as MarkId;
      marks.push({
        id,
        stackLength: undoManager.undoStack.length,
        snapshot: core.getSnapshot(),
        wrote: false,
      });
      return id;
    },
    squash(markId, squashMeta = {}) {
      const index = marks.findIndex((m) => m.id === markId);
      if (index < 0) return;
      const mark = marks[index]!;
      marks = marks.slice(0, index);
      if (marks.length > 0) return;
      undoManager.captureTimeout = captureTimeout;
      const top = undoManager.undoStack.at(-1);
      if (mark.wrote && top && squashMeta.label !== undefined) {
        top.meta.set('label', squashMeta.label);
      }
    },
    bail(markId) {
      const index = marks.findIndex((m) => m.id === markId);
      if (index < 0) return [];
      const mark = marks[index]!;
      marks = marks.slice(0, index);
      if (marks.length === 0) undoManager.captureTimeout = captureTimeout;
      if (!mark.wrote) return [];
      const before = core.getSnapshot();
      if (undoManager.undoStack.length > mark.stackLength) {
        // The writes since the mark are one stack item: undo it, forget it.
        replaying = true;
        try {
          undoManager.undo();
        } finally {
          replaying = false;
        }
        undoManager.redoStack.pop();
      } else {
        // The first write merged into the step before: write the way back.
        const revert = diffOps(before, mark.snapshot);
        writeOrigin = untracked;
        try {
          core.transact(
            (tx) => {
              for (const op of revert) tx.apply(op);
            },
            { origin: 'history' },
          );
        } finally {
          writeOrigin = local;
        }
      }
      mergeOpen = false;
      return diffOps(before, core.getSnapshot());
    },
    breakMerge() {
      undoManager.stopCapturing();
      mergeOpen = false;
    },
    clearHistory() {
      undoManager.clear();
      marks = [];
      mergeOpen = false;
    },
    getHistory: () => ({
      past: undoManager.undoStack.map(entryOf),
      future: undoManager.redoStack.map(entryOf),
    }),
    destroy() {
      ydoc.off('afterTransaction', onAfterTransaction);
      nodesMap.unobserveDeep(onDeep);
      meta.unobserve(onMeta);
      undoManager.destroy();
    },
  };
}

/** The editor document a `Y.Doc` holds, without order keys; `null` when it holds none. */
export function yjsToDocument(ydoc: Y.Doc): EditorDocument | null {
  if (ydoc.getMap<unknown>(META).get('rootId') === undefined) return null;
  const store = createYjsDocStore({ ydoc });
  const state = store.getSnapshot();
  store.destroy();
  const build = (id: string): NodeData => {
    const node = state.nodes[id]!;
    const out: NodeData = { id, type: node.type, props: { ...node.props } };
    if (node.v !== undefined) out.v = node.v;
    const names = Object.keys(node.slots);
    if (names.length > 0) {
      out.slots = Object.fromEntries(
        names.map((name) => [name, node.slots[name]!.map(build)]),
      );
    }
    if (node.meta !== undefined) out.meta = node.meta;
    return out;
  };
  return { schemaVersion: state.schemaVersion, root: build(state.rootId) };
}
