import type { BlockTreeNode } from '@createcms/schema';

import type { AnyEditorSchema } from '../schema';

/** One node of the flat editor tree. `parentId === null` only for the root. */
export type EditorNode = {
  readonly id: string;
  readonly type: string;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly parentId: string | null;
  /** Sibling order — the single source of truth for child ordering. */
  readonly childIds: readonly string[];
};

export type EditorNodes = Readonly<Record<string, EditorNode>>;

/** A field on a block — what focus and inline editing point at. */
export type FieldRef = { readonly blockId: string; readonly key: string };

/** Selection state of ONE user (the store models it per user; today there is one, `'local'`). */
export type UserSelection = {
  readonly selected: string | null;
  readonly hovered: string | null;
  readonly focus: FieldRef | null;
  readonly editing: FieldRef | null;
};

/**
 * One serialisable change to the tree. Every op has an inverse (see `applyOp`);
 * `add` inserts a whole subtree so `remove` and `duplicate` stay single ops.
 * A merge-patch value of `null` deletes the key; `undefined` never appears in
 * an op (the action layer normalises it to `null`).
 */
export type EditorOp =
  | { op: 'add'; parentId: string; index: number; node: BlockTreeNode }
  | { op: 'remove'; id: string }
  | { op: 'move'; id: string; parentId: string; index: number }
  | { op: 'update'; id: string; patch: Record<string, unknown> }
  | { op: 'load'; tree: BlockTreeNode };

/** One undo step: the ops applied and, in the order to apply them, their inverses. */
export type HistoryEntry = {
  readonly ops: readonly EditorOp[];
  readonly inverse: readonly EditorOp[];
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
  readonly ops: readonly EditorOp[];
  readonly version: number;
  /** Serialises the current tree on demand (memoised per version). */
  readonly getTree: () => BlockTreeNode;
};

export type EditorCallbacks = {
  /** After every LOCAL structural change incl. undo/redo (not after `load` or `applyRemote`). */
  onChange?: (change: EditorChange) => void;
  /** Called by `save()` with the full tree; the store marks itself saved when it resolves. */
  onSave?: (
    tree: BlockTreeNode,
    meta: { message?: string },
  ) => void | Promise<void>;
};

export type CreateEditorStoreOptions = {
  schema: AnyEditorSchema;
  /** The tree as `getBlockTree` delivers it (top node `type: 'root'`). */
  initialTree: BlockTreeNode;
  /** The user this store edits as. Default `'local'`. */
  userId?: string;
  /** Id generator for new blocks. Default: `createBlockId` (`blk_` + 20 chars). */
  genId?: () => string;
  /** Clock for coalescing. Default `Date.now`. */
  now?: () => number;
  /** Returns the latest callbacks (a React binding passes a ref getter). */
  getCallbacks?: () => EditorCallbacks;
};

export type AddOptions = {
  parentId: string;
  /** Insert position among the parent's children; default: append. */
  index?: number;
  /** Initial properties on top of the schema's declared `defaultValue`s. */
  properties?: Record<string, unknown>;
};

export type UpdateOptions = {
  /** Merge rapid updates of the same keys into one undo step. */
  coalesce?: boolean;
};

export type ApplyRemoteResult = {
  readonly applied: readonly EditorOp[];
  readonly rejected: readonly EditorOp[];
};

/**
 * The framework-free editor store. Method-shorthand signatures on purpose:
 * they are bivariant, which lets the typed factory (next issue) narrow the
 * argument types without an `any` cast.
 */
export type EditorStore = {
  getState(): EditorStoreState;
  subscribe(listener: () => void): () => void;
  getTree(): BlockTreeNode;
  isDirty(): boolean;

  load(tree: BlockTreeNode): void;
  /** Returns the new block's id, or `null` when the parent is unknown or the placement is not allowed. */
  add(type: string, options: AddOptions): string | null;
  /** Merge-patch a block's properties. Returns `false` for an unknown id. */
  update(
    id: string,
    patch: Record<string, unknown>,
    options?: UpdateOptions,
  ): boolean;
  /** Returns `false` when rejected (root, unknown ids, cycle, placement). */
  move(id: string, parentId: string, index: number): boolean;
  /** Removes a block and its subtree. Returns `false` for the root or an unknown id. */
  remove(id: string): boolean;
  /** Deep-copies a block + subtree with fresh ids right after the original. Returns the copy's id. */
  duplicate(id: string): string | null;
  /** Applies ops from elsewhere without touching the local history. */
  applyRemote(ops: readonly EditorOp[]): ApplyRemoteResult;
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
