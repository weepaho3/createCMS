import type { JsonValue, NodeData, Op } from '../document';
import type { AnyEditorSchema } from '../schema';
import type { DocState, NodeStatus } from './types';

import { componentOf } from '../schema';

type Trigger = 'load' | 'insert' | 'change' | 'force';

export type DataResolver = {
  /** Every node with `resolveData` (initial load, `load`). */
  runAll(trigger: 'load'): void;
  /** The nodes the ops touched: inserts and prop edits. */
  afterOps(ops: readonly Op[]): void;
  run(id: string, trigger: Trigger, changed?: readonly string[]): void;
  destroy(): void;
};

function insertedIds(node: NodeData, out: string[]): void {
  out.push(node.id);
  for (const children of Object.values(node.slots ?? {})) {
    for (const child of children) insertedIds(child, out);
  }
}

/**
 * Runs each component's `resolveData` and keeps the results and the
 * per-node loading/error state in the session, never in the document. Per
 * node, a newer run aborts the older one and only the newest result lands.
 */
export function createDataResolver(options: {
  schema: AnyEditorSchema;
  getDoc: () => DocState;
  getComputed: () => Readonly<
    Record<string, Readonly<Record<string, JsonValue>>>
  >;
  getStatus: () => Readonly<Record<string, NodeStatus>>;
  set: (patch: {
    computed?: Readonly<Record<string, Readonly<Record<string, JsonValue>>>>;
    nodeStatus?: Readonly<Record<string, NodeStatus>>;
  }) => void;
}): DataResolver {
  const { schema } = options;
  const runs = new Map<string, { seq: number; controller: AbortController }>();
  let seq = 0;

  const setStatus = (id: string, status: NodeStatus | null): void => {
    const current = options.getStatus();
    const next = { ...current };
    if (status) next[id] = status;
    else delete next[id];
    options.set({ nodeStatus: next });
  };
  const setComputed = (
    id: string,
    values: Record<string, JsonValue> | null,
  ): void => {
    const next = { ...options.getComputed() };
    if (values) next[id] = values;
    else delete next[id];
    options.set({ computed: next });
  };

  const run = (
    id: string,
    trigger: Trigger,
    changed: readonly string[] = [],
  ): void => {
    const node = options.getDoc().nodes[id];
    const resolve = node
      ? componentOf(schema, node.type)?.resolveData
      : undefined;
    if (!node || !resolve) return;
    runs.get(id)?.controller.abort();
    const controller = new AbortController();
    const mine = ++seq;
    runs.set(id, { seq: mine, controller });
    const isCurrent = () => runs.get(id)?.seq === mine;
    const finish = (
      values: Record<string, JsonValue> | null,
      error: Error | null,
    ) => {
      if (!isCurrent()) return;
      runs.delete(id);
      if (values) setComputed(id, values);
      setStatus(id, error ? { loading: false, error } : null);
    };
    let result: Record<string, JsonValue> | Promise<Record<string, JsonValue>>;
    try {
      result = resolve(
        // The schema types props per component; here they are the stored ones.
        { id, props: node.props as Parameters<typeof resolve>[0]['props'] },
        {
          trigger,
          changed: Object.fromEntries(
            changed.map((key) => [key, true as const]),
          ),
          signal: controller.signal,
          metadata: schema.metadata ?? {},
        },
      );
    } catch (raw) {
      finish(null, raw instanceof Error ? raw : new Error(String(raw)));
      return;
    }
    if (!(result instanceof Promise)) {
      finish(result, null);
      return;
    }
    setStatus(id, { loading: true, error: null });
    result.then(
      (values) => finish(values, null),
      (raw: unknown) => {
        if (controller.signal.aborted) return;
        finish(null, raw instanceof Error ? raw : new Error(String(raw)));
      },
    );
  };

  const forget = (ids: readonly string[]): void => {
    const computed = options.getComputed();
    const status = options.getStatus();
    const drop = ids.filter(
      (id) => id in computed || id in status || runs.has(id),
    );
    if (drop.length === 0) return;
    for (const id of drop) {
      runs.get(id)?.controller.abort();
      runs.delete(id);
    }
    const nextComputed = { ...computed };
    const nextStatus = { ...status };
    for (const id of drop) {
      delete nextComputed[id];
      delete nextStatus[id];
    }
    options.set({ computed: nextComputed, nodeStatus: nextStatus });
  };

  return {
    runAll(trigger) {
      const nodes = options.getDoc().nodes;
      forget(
        [
          ...new Set([...Object.keys(options.getComputed()), ...runs.keys()]),
        ].filter((id) => !(id in nodes)),
      );
      for (const id of Object.keys(nodes)) run(id, trigger);
    },
    afterOps(ops) {
      const nodes = options.getDoc().nodes;
      for (const op of ops) {
        if (op.op === 'insert') {
          const ids: string[] = [];
          insertedIds(op.node, ids);
          for (const id of ids) run(id, 'insert');
        } else if (op.op === 'update') {
          run(op.id, 'change', Object.keys(op.patch));
        } else if (op.op === 'replace') {
          this.runAll('load');
          return;
        }
      }
      const gone = [
        ...new Set([
          ...Object.keys(options.getComputed()),
          ...Object.keys(options.getStatus()),
          ...runs.keys(),
        ]),
      ].filter((id) => !(id in nodes));
      forget(gone);
    },
    run,
    destroy() {
      for (const { controller } of runs.values()) controller.abort();
      runs.clear();
    },
  };
}
