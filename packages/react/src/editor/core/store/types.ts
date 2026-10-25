import type {
  EditorDocument,
  JsonValue,
  NodeData,
  NormalizedDoc,
  Op,
  Origin,
  SlotRef,
} from '../document';
import type { Diagnostic } from '../load';
import type { EditorPlugin } from '../plugin';
import type { RichTextBinding } from '../richtext/adapter';
import type { AnyEditorSchema, ValidationIssue } from '../schema';
import type { EditorNodes } from './serde';

export type { EditorNodes } from './serde';

/** A field on a block: what focus and inline editing point at. */
export type FieldRef = { readonly blockId: string; readonly key: string };

/** The document scope: undoable, persisted. */
export type DocState = NormalizedDoc & {
  readonly nodes: EditorNodes;
  /** Bumps on every applied change (local, history, remote, load). */
  readonly version: number;
  readonly schemaVersion: number;
};

/** Save state as the editor shows it. */
/** `invalid`: a `beforeSave` gate blocked the save (see `SaveState.issues`). */
export type SaveStatus = 'idle' | 'saving' | 'error' | 'conflict' | 'invalid';

/** What started a save: autosave, `save()`, or `save({ phase: 'publish' })`. */
export type SavePhase = 'autosave' | 'save' | 'publish';

/**
 * Runs before every save; returned issues block it (status `invalid`). May
 * be async (`validateDocument` is). On `Editor.Root`, `createEditorStore`
 * and plugins.
 */
export type BeforeSaveGate = (ctx: {
  readonly doc: EditorDocument;
  readonly ops: readonly Op[];
  readonly phase: SavePhase;
  readonly schema: AnyEditorSchema;
}) =>
  | readonly ValidationIssue[]
  | void
  | Promise<readonly ValidationIssue[] | void>;

/** A save the server refused because the document moved on. */
export type SaveConflict = {
  /** The server's document, when the adapter sent it along. */
  readonly serverDoc: EditorDocument | null;
  /** The server's version, when known. */
  readonly serverVersion: string | null;
};

export type SaveState = {
  readonly status: SaveStatus;
  /** Local changes not yet saved (`localRev !== savedRev`). */
  readonly dirty: boolean;
  /** The last failure while `status` is `error` or `conflict`. */
  readonly error: Error | null;
  readonly conflict: SaveConflict | null;
  /** The version the next save builds on (`baseVersion`). */
  readonly version: string | null;
  /** What the `beforeSave` gates reported for the last blocked save. */
  readonly issues: readonly ValidationIssue[];
};

/** The session scope: local to this editor, never undoable or persisted. */
export type SessionState = {
  /** Selected block ids; the first is the primary selection. Stable reference until it changes. */
  readonly selection: readonly string[];
  readonly focusedField: FieldRef | null;
  readonly editing: FieldRef | null;
  readonly mode: EditorMode;
  readonly history: { readonly canUndo: boolean; readonly canRedo: boolean };
  readonly save: SaveState;
  /** `resolveData` results per node id: shown, never saved. */
  readonly computed: Readonly<
    Record<string, Readonly<Record<string, JsonValue>>>
  >;
  /** Nodes whose `resolveData` is loading or failed. */
  readonly nodeStatus: Readonly<Record<string, NodeStatus>>;
  /** Outline rows the user collapsed; selecting a block expands its ancestors. */
  readonly collapsed: readonly string[];
};

/** Load state of one node's `resolveData`. */
export type NodeStatus = {
  readonly loading: boolean;
  readonly error: Error | null;
};

export type EditorMode = 'form' | 'visual';

/** The ephemeral scope: pointer-rate state that never wakes document or session readers. */
export type EphemeralState = {
  readonly hoverId: string | null;
};

/** A change notification of the document scope. */
export type Change =
  | { readonly kind: 'node'; readonly id: string }
  | {
      readonly kind: 'props';
      readonly id: string;
      readonly keys: readonly string[];
    }
  | {
      readonly kind: 'placement';
      readonly id: string;
      readonly keys: readonly string[];
    };

/** Opaque handle of a history mark. */
export type MarkId = number & { readonly __mark: true };

export type TxMeta = {
  origin?: Origin;
  /**
   * `record` (default) adds an undo step; `ignore` applies without one (live
   * writes between `mark` and `squash`); remote and history origins are
   * never recorded.
   */
  history?: 'record' | 'ignore';
  /** Consecutive steps with the same key within the merge window become one. */
  mergeKey?: string;
  label?: string;
  /** Selection before and after, restored by undo and redo. */
  selection?: {
    readonly before: readonly string[];
    readonly after: readonly string[];
  };
};

/** Writes inside one `DocStore.transact`. */
export type Tx = {
  insertNode(parent: SlotRef, index: number, node: NodeData): void;
  removeNode(id: string): void;
  moveNode(id: string, parentId: string, slot: string, index: number): void;
  /** Sets the prop at `path` (`[key, ...nested]`); `undefined` deletes it. */
  setProp(
    id: string,
    path: readonly (string | number)[],
    value: JsonValue | undefined,
  ): void;
  /** Replaces the whole document. */
  replaceDocument(doc: EditorDocument): void;
  /** Applies one serialised op. */
  apply(op: Op): void;
};

export type TxResult = {
  /** The ops applied, in order. */
  readonly ops: readonly Op[];
  /** Their inverses, in the order to apply them. */
  readonly inverse: readonly Op[];
  /** History steps dropped because a remote change touched their nodes. */
  readonly invalidated: number;
};

/** What undo or redo applied. */
export type HistoryStep = {
  readonly ops: readonly Op[];
  readonly label?: string;
  /** The selection to restore. */
  readonly selection: readonly string[];
};

/** One undo step: the ops applied and, in the order to apply them, their inverses. */
export type HistoryEntry = {
  readonly ops: readonly Op[];
  readonly inverse: readonly Op[];
  readonly mergeKey?: string;
  /** Timestamp of the last change merged into this entry. */
  readonly at: number;
  readonly selectionBefore: readonly string[];
  readonly selectionAfter: readonly string[];
  readonly label?: string;
};

/**
 * The document store the editor writes through. `JsonDocStore` is the
 * single-user implementation; a collaborative store implements the same
 * interface over a CRDT.
 */
export type DocStore = {
  getSnapshot(): DocState;
  subscribe(
    listener: (changes: readonly Change[], origin: Origin) => void,
  ): () => void;
  /**
   * Runs `fn` against a draft and applies its writes all or nothing. Throws
   * `TxRejectedError` (state unchanged) when a write is invalid or `fn`
   * throws.
   */
  transact(fn: (tx: Tx) => void, meta?: TxMeta): TxResult;
  undo(): HistoryStep | null;
  redo(): HistoryStep | null;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Starts collecting every local change from here on. */
  mark(): MarkId;
  /** Turns everything since `mark` into one undo step. */
  squash(mark: MarkId, meta?: { label?: string }): void;
  /** Reverts everything since `mark` without an undo step; returns the ops that reverted it. */
  bail(mark: MarkId): readonly Op[];
  /** Ends the merge window (blur, selection change). */
  breakMerge(): void;
  clearHistory(): void;
  getHistory(): {
    readonly past: readonly HistoryEntry[];
    readonly future: readonly HistoryEntry[];
  };
  /**
   * The shared text of a rich text prop, for collaborative stores that keep
   * it as a text type; rich text editors bind to it. `null` (or no method)
   * keeps the prop a plain value.
   */
  getText?(blockId: string, key: string): RichTextBinding | null;
};

export type CreateJsonDocStoreOptions = {
  initialValue: EditorDocument;
  /** Clock for merging. Default `Date.now`. */
  now?: () => number;
  /** Merge window in ms. Default `MERGE_MS` (400). */
  mergeMs?: number;
  /** History cap. Default 200. */
  maxEntries?: number;
};

/** A named write request; built-ins are listed in `BUILTIN_COMMANDS`. */
export type Command<P = unknown> = {
  readonly type: string;
  readonly payload: P;
  readonly meta?: CommandMeta;
};

export type CommandMeta = {
  /** `merge` records with `mergeKey`; default `record`. */
  readonly history?: 'record' | 'ignore' | 'merge';
  readonly mergeKey?: string;
  readonly origin?: Origin;
  readonly label?: string;
};

export type CommandContext = {
  readonly cmd: Command;
  getState(): DocState;
  readonly schema: AnyEditorSchema;
};

/** Wraps command resolution: call `next` to continue, throw to reject. */
export type Middleware = (
  ctx: CommandContext,
  next: (cmd: Command) => readonly Op[],
) => readonly Op[];

/** What a command handler can use to turn its payload into ops. */
export type HandlerContext = {
  getState(): DocState;
  readonly schema: AnyEditorSchema;
  genId(): string;
  /** Requests the selection after the command commits. */
  select(ids: readonly string[]): void;
};

export type CommandHandler<P = never> = (
  payload: P,
  ctx: HandlerContext,
) => readonly Op[];

export type EditorErrorKind =
  | 'command'
  | 'unknown-command'
  | 'placement'
  | 'rejected'
  | 'cancelled'
  | 'render';

/** Why a command did not apply, or a block failed to render (`render`). */
export type EditorError = {
  readonly kind: EditorErrorKind;
  readonly message: string;
  /** Placement code (`not-allowed`, `slot-full`, ...) for `placement`. */
  readonly code?: string;
  readonly cmd?: Command;
  readonly cause?: unknown;
  /** The block that failed (`render`). */
  readonly nodeId?: string;
  readonly type?: string;
  readonly componentStack?: string;
};

export type DispatchResult =
  | { readonly ok: true; readonly ops: readonly Op[] }
  | { readonly ok: false; readonly error: EditorError };

export type EditorChange = {
  readonly ops: readonly Op[];
  readonly origin: Origin;
  readonly version: number;
  /** Serialises the current document on demand (memoised per version). */
  readonly getDocument: () => EditorDocument;
};

/** Events of `store.on`. */
export type EditorEvents = {
  /** After every applied change, any origin. */
  change: EditorChange;
  /** After a dispatched command committed. */
  afterCommand: { readonly cmd: Command; readonly ops: readonly Op[] };
  /** A command or remote op that did not apply. */
  opRejected: {
    readonly origin: Origin;
    readonly error: EditorError;
    readonly op?: Op;
  };
  /** Remote changes dropped local undo steps. */
  historyInvalidated: { readonly count: number };
  /** A remote op applied against the placement rules (`accept-and-warn`). */
  diagnostic: {
    readonly kind: 'placement';
    readonly op: Op;
    readonly code: string;
  };
  select: { readonly selection: readonly string[] };
  beforeSave: { readonly doc: EditorDocument; readonly ops: readonly Op[] };
  afterSave: { readonly version: string };
  saveError: { readonly error: Error };
  error: EditorError;
  /** What the load pipeline migrated or repaired on `load`. */
  diagnostics: { readonly diagnostics: readonly Diagnostic[] };
  /** After an undo or redo applied. */
  history: { readonly direction: 'undo' | 'redo'; readonly label?: string };
  /** A `ui.*` command asked the editor chrome to open or focus something. */
  ui: { readonly action: UiAction };
};

/** What the `ui.*` commands ask of the editor chrome. */
export type UiAction =
  | 'commandPalette'
  | 'quickInsert'
  | 'toolbar'
  | 'shortcutHelp';

export type EditorEventName = keyof EditorEvents;

/**
 * Runs before middlewares; returns `false` to cancel, a command to replace
 * it, or nothing to continue.
 */
export type BeforeCommandHandler = (cmd: Command) => Command | false | void;

export type PersistenceOptions = {
  /** Saves the document; `force` skips the version check. */
  save(
    doc: EditorDocument,
    ctx: {
      readonly ops: readonly Op[];
      readonly baseVersion?: string;
      readonly force?: boolean;
      readonly message?: string;
      readonly phase: SavePhase;
    },
  ): Promise<{ version: string }>;
  /** The version the loaded document has on the server. */
  baseVersion?: string;
  /** Saves on its own after edits; `false` saves only on `save()`. Default on. */
  autosave?: false | { debounceMs?: number; maxWaitMs?: number };
};

/** Timer functions, injectable for tests. */
export type Timers = {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
};

export type CreateEditorStoreOptions = {
  schema: AnyEditorSchema;
  /** The document to edit (`root.type === 'root'`), unless `docStore` is given. */
  initialValue?: EditorDocument;
  /** A document store to write through (default: a `JsonDocStore` of `initialValue`). */
  docStore?: DocStore;
  /** Id generator for new blocks. Default: `createBlockId` (`blk_` + 20 chars). */
  genId?: () => string;
  /** Clock for merging. Default `Date.now`. */
  now?: () => number;
  /** History cap of the default doc store. Default 200. */
  maxHistory?: number;
  /** What happens to a remote op that breaks the placement rules. Default `accept-and-warn`. */
  remotePlacement?: 'reject' | 'accept-and-warn';
  persistence?: PersistenceOptions;
  /** Blocks a save with issues; plugin gates run after it. */
  beforeSave?: BeforeSaveGate;
  plugins?: readonly EditorPlugin[];
  timers?: Timers;
  /** What the load pipeline migrated or repaired in `initialValue` and every `load`. */
  onDiagnostics?: (diagnostics: readonly Diagnostic[]) => void;
};

/** A parent node and one of its slots; the slot defaults to `children`. */
export type SlotTarget = { readonly id: string; readonly slot?: string };

export type AddOptions = {
  parent: SlotTarget;
  /** Insert position in the slot; default: append. */
  index?: number;
  /** Initial props on top of the schema's declared `defaultValue`s. */
  props?: Record<string, unknown>;
};

export type MoveTarget = {
  parent: SlotTarget;
  /** Position in the target slot after the node left its old place. */
  index: number;
};

export type UpdateOptions = {
  /** Merge rapid updates of the same keys into one undo step. */
  coalesce?: boolean;
};

export type ApplyRemoteResult = {
  readonly applied: readonly Op[];
  readonly rejected: readonly Op[];
};

/** A UI command: what toolbars, palettes and shortcuts run. */
export type EditorCommand = {
  readonly id: string;
  readonly label?: string;
  /**
   * Its shortcuts also fire while focus is in an input or editable text
   * (undo and redo do, so form edits undo through the store).
   */
  readonly editable?: boolean;
  /**
   * The browser's own event runs it from the keyboard (copy, cut, paste):
   * its shortcut is listed but never routed.
   */
  readonly native?: boolean;
  run(store: EditorStore, args?: unknown): unknown;
  canExecute?(store: EditorStore, args?: unknown): boolean;
};

/**
 * The editor store: a document store plus the command pipeline, the session
 * and ephemeral scopes, events, saving and UI commands. Method-shorthand
 * signatures are bivariant, so a typed wrapper can narrow argument types.
 */
export type EditorStore = {
  /** The schema with plugin blocks and field kinds applied. */
  readonly schema: AnyEditorSchema;
  /** The schema as passed to `createEditorStore`. */
  readonly sourceSchema: AnyEditorSchema;
  readonly docStore: DocStore;

  getDoc(): DocState;
  /** The document store's shared text of a rich text prop (`DocStore.getText`), or `null`. */
  getTextBinding(blockId: string, key: string): RichTextBinding | null;
  subscribeDoc(listener: () => void): () => void;
  getSession(): SessionState;
  subscribeSession(listener: () => void): () => void;
  getEphemeral(): EphemeralState;
  subscribeEphemeral(listener: () => void): () => void;

  getDocument(): EditorDocument;
  isDirty(): boolean;

  dispatch(cmd: Command): DispatchResult;
  /** Groups every command `fn` dispatches into one undo step; a throw reverts them all. */
  transact(fn: () => void, options?: { label?: string }): DispatchResult;
  use(middleware: Middleware, options?: { priority?: number }): () => void;
  /** Registers a handler for a command type; returns an unregister function. */
  handle<P>(type: string, handler: CommandHandler<P>): () => void;
  on<E extends EditorEventName>(
    event: E,
    handler: (payload: EditorEvents[E]) => void,
  ): () => void;
  onBeforeCommand(handler: BeforeCommandHandler): () => void;
  /** Reports an error that happened outside a command (a block that threw while rendering). */
  reportError(error: EditorError): void;

  /** Replaces the document; clears history and selection, marks it saved. */
  load(doc: EditorDocument, options?: { baseVersion?: string }): void;
  add(type: string, options: AddOptions): string | null;
  update(
    id: string,
    patch: Record<string, unknown>,
    options?: UpdateOptions,
  ): boolean;
  move(id: string, target: MoveTarget): boolean;
  remove(id: string): boolean;
  duplicate(id: string): string | null;
  /** Wraps a node in a new `type` node (in its `slot`, default `children`). */
  wrap(
    id: string,
    type: string,
    options?: { slot?: string; props?: Record<string, unknown> },
  ): string | null;
  /** Applies ops from elsewhere: no history, no autosave. */
  applyRemote(ops: readonly Op[]): ApplyRemoteResult;

  undo(): boolean;
  redo(): boolean;
  mark(): MarkId;
  squash(mark: MarkId, meta?: { label?: string }): void;
  bail(mark: MarkId): void;

  select(id: string | null): void;
  setSelection(ids: readonly string[]): void;
  hover(id: string | null): void;
  focus(target: FieldRef | null): void;
  setEditing(target: FieldRef | null): void;
  setMode(mode: EditorMode): void;
  /** Collapses or expands a block's outline row. */
  setCollapsed(id: string, collapsed: boolean): void;

  /**
   * Saves now (when dirty or forced); resolves when this save settled.
   * `phase` (default `save`) reaches the gates and `persistence.save`.
   */
  save(options?: {
    message?: string;
    force?: boolean;
    phase?: 'save' | 'publish';
  }): Promise<void>;
  /** Loads the server's document from the current conflict. */
  reloadFromServer(): boolean;
  /** Runs the node's `resolveData` again (`trigger: 'force'`). */
  resolveData(id: string): void;

  readonly commands: {
    get(id: string): EditorCommand | undefined;
    list(): readonly EditorCommand[];
    execute(id: string, args?: unknown): unknown;
    canExecute(id: string, args?: unknown): boolean;
    /** Combo (`Mod+Shift+z`) to command id. */
    shortcuts(): Readonly<Record<string, string>>;
  };
  readonly plugins: readonly EditorPlugin[];

  /** Stops timers and listeners; the store is unusable afterwards. */
  destroy(): void;
};
