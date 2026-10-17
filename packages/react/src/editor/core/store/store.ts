import type { EditorDocument, Op, Origin } from '../document';
import type { Diagnostic } from '../load';
import type { EditorPlugin } from '../plugin';
import type {
  BeforeCommandHandler,
  Command,
  CommandHandler,
  CreateEditorStoreOptions,
  DispatchResult,
  DocState,
  EditorCommand,
  EditorError,
  EditorEventName,
  EditorEvents,
  EditorStore,
  EphemeralState,
  HandlerContext,
  Middleware,
  SaveState,
  SessionState,
  Timers,
} from './types';

import { formatEditorMessage, warnOnce } from '../codes';
import { loadDocument } from '../load';
import {
  applyPlugins,
  pluginCommands,
  pluginShortcuts,
  sortPlugins,
} from '../plugin';
import { slotsOf } from '../schema';
import {
  BUILTIN_COMMANDS,
  checkPlacement,
  PlacementError,
  placementMiddleware,
} from './commands';
import { createJsonDocStore, TxRejectedError } from './doc-store';
import { createBlockId } from './id';
import { applyOp } from './ops';
import { createDataResolver } from './resolve-data';
import { createSaveScheduler, INITIAL_SAVE_STATE } from './save';
import { denormalize } from './serde';

/** Priority of the built-in placement middleware: it runs innermost, right on the handler's ops. */
export const PLACEMENT_PRIORITY = -1000;

const NO_SELECTION: readonly string[] = [];

const GLOBAL_TIMERS: Timers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => {
    globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

/** Default key bindings of the built-in UI commands. */
export const DEFAULT_SHORTCUTS: Readonly<Record<string, string>> = {
  'Mod+z': 'history.undo',
  'Mod+Shift+z': 'history.redo',
  'Ctrl+y': 'history.redo',
};

type Channel<T> = {
  get(): T;
  set(patch: Partial<T>): void;
  subscribe(listener: () => void): () => void;
  clear(): void;
};

/** A tiny observable: `set` notifies only when a field actually changed. */
function createChannel<T extends object>(initial: T): Channel<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(patch) {
      let changed = false;
      for (const key of Object.keys(patch) as (keyof T)[]) {
        if (!Object.is(state[key], patch[key])) {
          changed = true;
          break;
        }
      }
      if (!changed) return;
      state = { ...state, ...patch };
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    clear() {
      listeners.clear();
    },
  };
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

function errorOf(cmd: Command, error: unknown): EditorError {
  if (error instanceof PlacementError) {
    return {
      kind: 'placement',
      message: error.message,
      code: error.code,
      cmd,
      cause: error,
    };
  }
  if (error instanceof TxRejectedError) {
    return { kind: 'rejected', message: error.message, cmd, cause: error };
  }
  return {
    kind: 'command',
    message: error instanceof Error ? error.message : String(error),
    cmd,
    cause: error,
  };
}

/**
 * The editor store. Every document write is a command: `beforeCommand`
 * handlers, then middlewares by descending priority (placement innermost),
 * then the command's handler turns it into ops, which the doc store applies
 * all or nothing. A throwing step leaves the document unchanged and reports
 * an `EditorError`. Document, session and ephemeral state notify on their
 * own channels, so hover never wakes document readers.
 */
export function createEditorStore(
  options: CreateEditorStoreOptions,
): EditorStore {
  const plugins = sortPlugins(options.plugins ?? []);
  const schema = applyPlugins(options.schema, plugins);
  const genId = options.genId ?? createBlockId;
  const remotePlacement = options.remotePlacement ?? 'accept-and-warn';
  const reportDiagnostics = (diagnostics: readonly Diagnostic[]): void => {
    if (diagnostics.length === 0) return;
    if (process.env.NODE_ENV !== 'production') {
      warnOnce(
        'E010',
        `the document needed ${diagnostics.length} migration(s) or repair(s); pass onDiagnostics to see them`,
      );
    }
    options.onDiagnostics?.(diagnostics);
  };
  let docStore = options.docStore;
  if (!docStore) {
    if (!options.initialValue) {
      throw new Error('createEditorStore needs `initialValue` or `docStore`');
    }
    const loaded = loadDocument(options.initialValue, schema, { genId });
    reportDiagnostics(loaded.diagnostics);
    docStore = createJsonDocStore({
      initialValue: loaded.doc,
      now: options.now,
      maxEntries: options.maxHistory,
    });
  }
  const doc = docStore;
  const slotOrder = (type: string): readonly string[] =>
    Object.keys(slotsOf(schema, type));

  const session = createChannel<SessionState>({
    selection: NO_SELECTION,
    focusedField: null,
    editing: null,
    mode: 'visual',
    history: { canUndo: doc.canUndo(), canRedo: doc.canRedo() },
    save: INITIAL_SAVE_STATE,
    computed: {},
    nodeStatus: {},
  });
  const ephemeral = createChannel<EphemeralState>({ hoverId: null });

  const dataResolver = createDataResolver({
    schema,
    getDoc: () => doc.getSnapshot(),
    getComputed: () => session.get().computed,
    getStatus: () => session.get().nodeStatus,
    set: (patch) => session.set(patch),
  });

  const docListeners = new Set<() => void>();
  const unsubscribeDoc = doc.subscribe(() => {
    for (const listener of docListeners) listener();
  });

  const handlers = new Map<string, CommandHandler>(
    Object.entries(BUILTIN_COMMANDS),
  );
  let middlewares: { fn: Middleware; priority: number; order: number }[] = [
    { fn: placementMiddleware, priority: PLACEMENT_PRIORITY, order: 0 },
  ];
  let middlewareOrder = 1;
  const beforeCommand: BeforeCommandHandler[] = [];
  const listeners = new Map<EditorEventName, Set<(payload: never) => void>>();

  const emit = <E extends EditorEventName>(
    event: E,
    payload: EditorEvents[E],
  ): void => {
    const set = listeners.get(event);
    if (!set) return;
    for (const handler of set) {
      (handler as (payload: EditorEvents[E]) => void)(payload);
    }
  };

  let docMemo: { version: number; doc: EditorDocument } | null = null;
  const getDocument = (): EditorDocument => {
    const state = doc.getSnapshot();
    if (!docMemo || docMemo.version !== state.version) {
      docMemo = {
        version: state.version,
        doc: denormalize(state, {
          schemaVersion: state.schemaVersion,
          slotOrder,
        }),
      };
    }
    return docMemo.doc;
  };

  const saveScheduler = createSaveScheduler({
    persistence: options.persistence,
    timers: options.timers ?? GLOBAL_TIMERS,
    getDocument,
    getState: () => session.get().save,
    setState: (patch: Partial<SaveState>) => {
      session.set({ save: { ...session.get().save, ...patch } });
    },
    onBeforeSave: (document, ops) => emit('beforeSave', { doc: document, ops }),
    onAfterSave: (version) => emit('afterSave', { version }),
    onError: (error) => emit('saveError', { error }),
  });

  /** Selection without ids that no longer exist (same reference when unchanged). */
  const pruned = (ids: readonly string[]): readonly string[] => {
    const nodes = doc.getSnapshot().nodes;
    if (ids.every((id) => id in nodes)) return ids;
    const kept = ids.filter((id) => id in nodes);
    return kept.length === 0 ? NO_SELECTION : kept;
  };

  const setSelection = (ids: readonly string[]): void => {
    const current = session.get().selection;
    const next = pruned(ids);
    if (sameIds(current, next)) return;
    doc.breakMerge();
    session.set({ selection: next.length === 0 ? NO_SELECTION : next });
    emit('select', { selection: session.get().selection });
  };

  /** Session and events after the document changed. */
  const afterChange = (
    ops: readonly Op[],
    origin: Origin,
    selection: readonly string[] | null,
  ): void => {
    const state = session.get();
    const nextSelection = pruned(selection ?? state.selection);
    const focusedField =
      state.focusedField &&
      state.focusedField.blockId in doc.getSnapshot().nodes
        ? state.focusedField
        : null;
    const editing =
      state.editing && state.editing.blockId in doc.getSnapshot().nodes
        ? state.editing
        : null;
    const history = { canUndo: doc.canUndo(), canRedo: doc.canRedo() };
    session.set({
      selection: sameIds(state.selection, nextSelection)
        ? state.selection
        : nextSelection,
      focusedField,
      editing,
      history:
        history.canUndo === state.history.canUndo &&
        history.canRedo === state.history.canRedo
          ? state.history
          : history,
    });
    const hoverId = ephemeral.get().hoverId;
    if (hoverId !== null && !(hoverId in doc.getSnapshot().nodes)) {
      ephemeral.set({ hoverId: null });
    }
    dataResolver.afterOps(ops);
    if (origin !== 'remote' && origin !== 'system' && ops.length > 0) {
      saveScheduler.noteChange(ops);
    }
    emit('change', {
      ops,
      origin,
      version: doc.getSnapshot().version,
      getDocument,
    });
  };

  let transactDepth = 0;
  let transactOps: Op[] = [];
  let remoteRejected: Op[] = [];

  handlers.set('doc.applyRemote', ((payload: { ops: readonly Op[] }) => {
    // Op by op against a draft: an op that does not apply is rejected; one
    // that breaks placement follows the remote policy.
    const accepted: Op[] = [];
    let draft: DocState = doc.getSnapshot();
    for (const op of payload.ops) {
      const refused = checkPlacement(schema, draft, [op]);
      if (refused && remotePlacement === 'reject') {
        remoteRejected.push(op);
        emit('opRejected', {
          origin: 'remote',
          op,
          error: {
            kind: 'placement',
            message: `placement refused: ${refused.code}`,
            code: refused.code,
          },
        });
        continue;
      }
      const result = applyOp(
        draft.nodes,
        draft.rootId,
        op,
        draft.schemaVersion,
      );
      if (!result) {
        remoteRejected.push(op);
        emit('opRejected', {
          origin: 'remote',
          op,
          error: { kind: 'rejected', message: `op "${op.op}" does not apply` },
        });
        continue;
      }
      if (refused) {
        emit('diagnostic', { kind: 'placement', op, code: refused.code });
      }
      draft = {
        nodes: result.nodes,
        rootId: result.rootId,
        schemaVersion: result.schemaVersion,
        version: draft.version,
      };
      accepted.push(op);
    }
    return accepted;
  }) as CommandHandler);

  const fail = (error: EditorError, origin: Origin): DispatchResult => {
    emit('opRejected', { origin, error });
    emit('error', error);
    return { ok: false, error };
  };

  const dispatch = (input: Command): DispatchResult => {
    let cmd = input;
    for (const handler of beforeCommand) {
      const result = handler(cmd);
      if (result === false) {
        return fail(
          { kind: 'cancelled', message: `"${cmd.type}" was cancelled`, cmd },
          cmd.meta?.origin ?? 'local',
        );
      }
      if (result) cmd = result;
    }
    const origin = cmd.meta?.origin ?? 'local';
    const handler = handlers.get(cmd.type);
    if (!handler) {
      return fail(
        {
          kind: 'unknown-command',
          message: `no handler for "${cmd.type}"`,
          cmd,
        },
        origin,
      );
    }
    let requested: readonly string[] | null = null;
    const ctx: HandlerContext = {
      getState: () => doc.getSnapshot(),
      schema,
      genId,
      select(ids) {
        requested = ids;
      },
    };
    const sorted = [...middlewares].sort(
      (a, b) => b.priority - a.priority || a.order - b.order,
    );
    const chain = sorted.reduceRight<(c: Command) => readonly Op[]>(
      (next, entry) => (c) =>
        entry.fn({ cmd: c, getState: () => doc.getSnapshot(), schema }, next),
      (c) => (handlers.get(c.type) ?? handler)(c.payload as never, ctx),
    );
    let ops: readonly Op[];
    try {
      ops = chain(cmd);
    } catch (error) {
      return fail(errorOf(cmd, error), origin);
    }
    if (ops.length === 0) return { ok: true, ops };
    const before = session.get().selection;
    const after = requested ?? before;
    const history = cmd.meta?.history;
    let invalidated: number;
    try {
      const result = doc.transact(
        (tx) => {
          for (const op of ops) tx.apply(op);
        },
        {
          origin,
          history: history === 'ignore' ? 'ignore' : 'record',
          mergeKey: cmd.meta?.mergeKey,
          label: cmd.meta?.label,
          selection: { before, after },
        },
      );
      invalidated = result.invalidated;
    } catch (error) {
      return fail(errorOf(cmd, error), origin);
    }
    if (transactDepth > 0) transactOps.push(...ops);
    afterChange(ops, origin, requested);
    if (invalidated > 0) emit('historyInvalidated', { count: invalidated });
    emit('afterCommand', { cmd, ops });
    return { ok: true, ops };
  };

  const builtinCommands = new Map<string, EditorCommand>([
    [
      'history.undo',
      {
        id: 'history.undo',
        label: 'Undo',
        run: (s) => s.undo(),
        canExecute: (s) => s.getSession().history.canUndo,
      },
    ],
    [
      'history.redo',
      {
        id: 'history.redo',
        label: 'Redo',
        run: (s) => s.redo(),
        canExecute: (s) => s.getSession().history.canRedo,
      },
    ],
    [
      'block.remove',
      {
        id: 'block.remove',
        label: 'Delete',
        run: (s) => {
          const [id] = s.getSession().selection;
          return id === undefined ? false : s.remove(id);
        },
        canExecute: (s) => {
          const [id] = s.getSession().selection;
          return id !== undefined && s.getDoc().nodes[id]?.parent != null;
        },
      },
    ],
    [
      'block.duplicate',
      {
        id: 'block.duplicate',
        label: 'Duplicate',
        run: (s) => {
          const [id] = s.getSession().selection;
          return id === undefined ? null : s.duplicate(id);
        },
        canExecute: (s) => {
          const [id] = s.getSession().selection;
          return id !== undefined && s.getDoc().nodes[id]?.parent != null;
        },
      },
    ],
  ]);
  const commandMap = new Map(builtinCommands);
  for (const [id, command] of pluginCommands(plugins)) {
    if (!commandMap.has(id)) commandMap.set(id, command);
  }
  const shortcutMap = pluginShortcuts(
    plugins,
    DEFAULT_SHORTCUTS,
    (combo, kept, dropped) => {
      if (process.env.NODE_ENV !== 'production') {
        warnOnce(
          'E003',
          `shortcut "${combo}" is bound to "${kept}"; "${dropped}" is ignored`,
        );
      }
    },
  );

  const store: EditorStore = {
    schema,
    sourceSchema: options.schema,
    docStore: doc,
    plugins,

    getDoc: () => doc.getSnapshot(),
    subscribeDoc(listener) {
      docListeners.add(listener);
      return () => {
        docListeners.delete(listener);
      };
    },
    getSession: session.get,
    subscribeSession: session.subscribe,
    getEphemeral: ephemeral.get,
    subscribeEphemeral: ephemeral.subscribe,

    getDocument,
    isDirty: () => session.get().save.dirty,

    dispatch,
    transact(fn, txOptions = {}) {
      if (transactDepth > 0) {
        transactDepth += 1;
        try {
          fn();
        } finally {
          transactDepth -= 1;
        }
        return { ok: true, ops: [] };
      }
      transactDepth = 1;
      transactOps = [];
      const mark = doc.mark();
      try {
        fn();
      } catch (error) {
        transactDepth = 0;
        afterChange(doc.bail(mark), 'history', null);
        const err: EditorError = {
          kind: 'command',
          message: error instanceof Error ? error.message : String(error),
          cause: error,
        };
        emit('error', err);
        return { ok: false, error: err };
      }
      transactDepth = 0;
      doc.squash(
        mark,
        txOptions.label === undefined ? {} : { label: txOptions.label },
      );
      session.set({
        history: { canUndo: doc.canUndo(), canRedo: doc.canRedo() },
      });
      return { ok: true, ops: transactOps };
    },
    use(middleware, useOptions = {}) {
      const entry = {
        fn: middleware,
        priority: useOptions.priority ?? 0,
        order: middlewareOrder++,
      };
      middlewares = [...middlewares, entry];
      return () => {
        middlewares = middlewares.filter((m) => m !== entry);
      };
    },
    handle(type, handler) {
      const previous = handlers.get(type);
      handlers.set(type, handler as CommandHandler);
      return () => {
        if (handlers.get(type) !== handler) return;
        if (previous) handlers.set(type, previous);
        else handlers.delete(type);
      };
    },
    on(event, handler) {
      let set = listeners.get(event);
      if (!set) {
        set = new Set();
        listeners.set(event, set);
      }
      const entry = handler as (payload: never) => void;
      set.add(entry);
      return () => {
        set.delete(entry);
      };
    },
    reportError(error) {
      emit('error', error);
    },
    onBeforeCommand(handler) {
      beforeCommand.push(handler);
      return () => {
        const index = beforeCommand.indexOf(handler);
        if (index >= 0) beforeCommand.splice(index, 1);
      };
    },

    load(input, loadOptions = {}) {
      const { doc: next, diagnostics } = loadDocument(input, schema, {
        genId,
      });
      reportDiagnostics(diagnostics);
      if (diagnostics.length > 0) emit('diagnostics', { diagnostics });
      doc.transact((tx) => tx.replaceDocument(next), {
        origin: 'system',
        history: 'ignore',
      });
      doc.clearHistory();
      session.set({
        selection: NO_SELECTION,
        focusedField: null,
        editing: null,
        history: { canUndo: false, canRedo: false },
      });
      saveScheduler.reset(loadOptions.baseVersion ?? null);
      dataResolver.runAll('load');
      emit('change', {
        ops: [{ op: 'replace', doc: next }],
        origin: 'system',
        version: doc.getSnapshot().version,
        getDocument,
      });
    },

    add(type, { parent, index, props }) {
      const result = dispatch({
        type: 'node.insert',
        payload: { type, parent, index, props },
      });
      if (!result.ok) return null;
      const op = result.ops[0];
      return op?.op === 'insert' ? op.node.id : null;
    },
    update(id, patch, updateOptions) {
      const keys = Object.keys(patch).sort().join(',');
      return dispatch({
        type: 'node.update',
        payload: { id, patch },
        meta: updateOptions?.coalesce
          ? { history: 'merge', mergeKey: `prop:${id}:${keys}` }
          : undefined,
      }).ok;
    },
    move(id, { parent, index }) {
      if (doc.getSnapshot().nodes[id]?.parent == null) return false;
      return dispatch({ type: 'node.move', payload: { id, parent, index } }).ok;
    },
    remove(id) {
      if (doc.getSnapshot().nodes[id]?.parent == null) return false;
      return dispatch({ type: 'node.remove', payload: { id } }).ok;
    },
    duplicate(id) {
      const result = dispatch({ type: 'node.duplicate', payload: { id } });
      if (!result.ok) return null;
      const op = result.ops[0];
      return op?.op === 'insert' ? op.node.id : null;
    },
    wrap(id, type, wrapOptions = {}) {
      const result = dispatch({
        type: 'node.wrap',
        payload: { id, type, ...wrapOptions },
      });
      if (!result.ok) return null;
      const op = result.ops[0];
      return op?.op === 'insert' ? op.node.id : null;
    },
    applyRemote(ops) {
      remoteRejected = [];
      const result = dispatch({
        type: 'doc.applyRemote',
        payload: { ops },
        meta: { origin: 'remote' },
      });
      const rejected = remoteRejected;
      remoteRejected = [];
      if (!result.ok) return { applied: [], rejected: [...ops] };
      return { applied: result.ops, rejected };
    },

    undo() {
      const step = doc.undo();
      if (!step) {
        session.set({
          history: { canUndo: doc.canUndo(), canRedo: doc.canRedo() },
        });
        return false;
      }
      afterChange(step.ops, 'history', step.selection);
      return true;
    },
    redo() {
      const step = doc.redo();
      if (!step) {
        session.set({
          history: { canUndo: doc.canUndo(), canRedo: doc.canRedo() },
        });
        return false;
      }
      afterChange(step.ops, 'history', step.selection);
      return true;
    },
    mark: () => doc.mark(),
    squash(mark, meta) {
      doc.squash(mark, meta);
      session.set({
        history: { canUndo: doc.canUndo(), canRedo: doc.canRedo() },
      });
    },
    bail(mark) {
      const reverted = doc.bail(mark);
      if (reverted.length > 0) {
        afterChange(reverted, 'history', null);
      } else {
        session.set({
          history: { canUndo: doc.canUndo(), canRedo: doc.canRedo() },
        });
      }
    },

    select(id) {
      setSelection(id === null ? NO_SELECTION : [id]);
    },
    setSelection,
    hover(id) {
      ephemeral.set({ hoverId: id });
    },
    focus(target) {
      doc.breakMerge();
      session.set({ focusedField: target });
    },
    setEditing(target) {
      doc.breakMerge();
      session.set({ editing: target });
    },
    setMode(mode) {
      session.set({ mode });
    },

    save: (saveOptions) => saveScheduler.save(saveOptions),
    reloadFromServer() {
      const conflict = session.get().save.conflict;
      if (!conflict?.serverDoc) return false;
      store.load(
        conflict.serverDoc,
        conflict.serverVersion === null
          ? {}
          : { baseVersion: conflict.serverVersion },
      );
      return true;
    },

    resolveData(id) {
      dataResolver.run(id, 'force');
    },

    commands: {
      get: (id) => commandMap.get(id),
      list: () => [...commandMap.values()],
      execute(id, args) {
        const command = commandMap.get(id);
        if (!command) {
          throw new Error(
            formatEditorMessage('E004', `unknown command "${id}"`),
          );
        }
        if (command.canExecute && !command.canExecute(store, args))
          return undefined;
        return command.run(store, args);
      },
      canExecute(id, args) {
        const command = commandMap.get(id);
        if (!command) return false;
        return command.canExecute ? command.canExecute(store, args) : true;
      },
      shortcuts: () => shortcutMap,
    },

    destroy() {
      dataResolver.destroy();
      saveScheduler.destroy();
      unsubscribeDoc();
      docListeners.clear();
      session.clear();
      ephemeral.clear();
      listeners.clear();
    },
  };

  for (const plugin of plugins) registerPluginHandlers(store, plugin);
  dataResolver.runAll('load');
  return store;
}

function registerPluginHandlers(
  store: EditorStore,
  plugin: EditorPlugin,
): void {
  for (const [event, handler] of Object.entries(plugin.on ?? {})) {
    if (!handler) continue;
    if (event === 'beforeCommand') {
      store.onBeforeCommand(handler as BeforeCommandHandler);
    } else {
      // The handler map is keyed by event, so each handler matches its event.
      const on = store.on as (
        name: EditorEventName,
        fn: (payload: unknown) => void,
      ) => () => void;
      on(event as EditorEventName, handler as (payload: unknown) => void);
    }
  }
}
