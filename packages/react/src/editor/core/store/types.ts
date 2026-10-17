import type { EditorDocument, Op } from '../document';
import type { AnyEditorSchema } from '../schema';
import type { EditorNodes } from './serde';

export type { EditorNodes } from './serde';

/** A field on a block: what focus and inline editing point at. */
export type FieldRef = { readonly blockId: string; readonly key: string };

/** Selection state of one user (`'local'` in this editor). */
export type UserSelection = {
  readonly selected: string | null;
  readonly hovered: string | null;
  readonly focus: FieldRef | null;
  readonly editing: FieldRef | null;
};

/** One undo step: the ops applied and, in the order to apply them, their inverses. */
export type HistoryEntry = {
  readonly ops: readonly Op[];
  readonly inverse: readonly Op[];
  /** Coalescing key (`null` = never coalesces). */
  readonly key: string | null;
  /** Timestamp of the last op merged into this entry (`options.now`). */
  readonly at: number;
};

export type EditorStoreState = {
  readonly rootId: string;
  readonly nodes: EditorNodes;
  readonly selection: Readonly<Record<string, UserSelection>>;
  readonly history: {
    readonly past: readonly HistoryEntry[];
    readonly future: readonly HistoryEntry[];
  };
  /** Bumps on every structural change (local, undo/redo, remote, load). */
  readonly version: number;
  /** The `version` at the last `load`/`markSaved`. */
  readonly savedVersion: number;
  /** True while `save()` awaits `onSave`. */
  readonly saving: boolean;
};

export type EditorChange = {
  readonly ops: readonly Op[];
  readonly version: number;
  /** Serialises the current document on demand (memoised per version). */
  readonly getDocument: () => EditorDocument;
};

export type EditorCallbacks = {
  /** After every LOCAL structural change incl. undo/redo (not after `load` or `applyRemote`). */
  onChange?: (change: EditorChange) => void;
  /** Called by `save()` with the full document; the store marks itself saved when it resolves. */
  onSave?: (
    doc: EditorDocument,
    meta: { message?: string },
  ) => void | Promise<void>;
};

export type CreateEditorStoreOptions = {
  schema: AnyEditorSchema;
  /** The document to edit (`root.type === 'root'`). */
  initialValue: EditorDocument;
  /** The user this store edits as. Default `'local'`. */
  userId?: string;
  /** Id generator for new blocks. Default: `createBlockId` (`blk_` + 20 chars). */
  genId?: () => string;
  /** Clock for coalescing. Default `Date.now`. */
  now?: () => number;
  /** Returns the latest callbacks (a React binding passes a ref getter). */
  getCallbacks?: () => EditorCallbacks;
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

/**
 * The framework-free editor store. Method-shorthand signatures: they are
 * bivariant, so a typed wrapper can narrow the argument types without an
 * `any` cast.
 */
export type EditorStore = {
  getState(): EditorStoreState;
  subscribe(listener: () => void): () => void;
  getDocument(): EditorDocument;
  isDirty(): boolean;

  load(doc: EditorDocument): void;
  /**
   * Inserts a new node with its declared defaults and slot defaults. Returns
   * its id, or `null` when the parent or slot is unknown or the placement is
   * not allowed.
   */
  add(type: string, options: AddOptions): string | null;
  /** Merge-patch a node's props. Returns `false` for an unknown id. */
  update(
    id: string,
    patch: Record<string, unknown>,
    options?: UpdateOptions,
  ): boolean;
  /** Returns `false` when rejected (root, unknown ids, unknown slot, cycle, placement). */
  move(id: string, target: MoveTarget): boolean;
  /** Removes a node and its subtree. Returns `false` for the root or an unknown id. */
  remove(id: string): boolean;
  /**
   * Copies a node and its subtree with fresh ids right after the original;
   * references inside the copy point at the copies. Returns the copy's id.
   */
  duplicate(id: string): string | null;
  /** Applies ops from elsewhere without touching the local history. */
  applyRemote(ops: readonly Op[]): ApplyRemoteResult;
  undo(): boolean;
  redo(): boolean;

  select(id: string | null): void;
  hover(id: string | null): void;
  focus(target: FieldRef | null): void;
  setEditing(target: FieldRef | null): void;
  setUserSelection(userId: string, patch: Partial<UserSelection>): void;

  markSaved(): void;
  save(meta?: { message?: string }): Promise<void>;
};
