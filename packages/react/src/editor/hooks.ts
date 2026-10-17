import * as React from 'react';

import type { EditorSelector } from './binding';
import type { FlatNode, SlotRef } from './core/document';
import type {
  AnyEditorSchema,
  Field,
  MissingRequiredField,
  PaletteItem,
  SchemaField,
} from './core/schema';
import type { EditorStore, UpdateOptions, UserSelection } from './core/store';
import type { EditorScrollToOptions } from './scroll';

import { useStoreSelector } from './binding';
import { useEditorContext } from './context';
import {
  allowedChildTypes,
  DEFAULT_SLOT,
  missingRequired,
  slotsOf,
  paletteItems,
  componentOf,
  createFieldResolver,
  fieldContextFor,
  fieldsOf,
} from './core/schema';

const EMPTY_SELECTION: UserSelection = {
  selected: null,
  hovered: null,
  focus: null,
  editing: null,
};
const NO_SLICE: EditorSelector<null> = () => null;

/** Everything a part needs from the editor: the store's methods plus `schema`, `userId`, `store` and `scrollTo`. */
export type EditorApi = EditorStore & {
  readonly schema: AnyEditorSchema;
  readonly userId: string;
  readonly store: EditorStore;
  scrollTo(blockId: string, opts?: EditorScrollToOptions): boolean;
};

/**
 * `useEditor()` → a stable API object (actions + `schema` + `userId` +
 * `store` + `scrollTo`); `useEditor(selector)` → a reactive slice of the
 * store state.
 */
export function useEditor(): EditorApi;
export function useEditor<T>(
  selector: EditorSelector<T>,
  isEqual?: (a: T, b: T) => boolean,
): T;
export function useEditor<T>(
  selector?: EditorSelector<T>,
  isEqual?: (a: T, b: T) => boolean,
): T | EditorApi {
  const ctx = useEditorContext('useEditor');
  const api = React.useMemo<EditorApi>(
    () => ({
      ...ctx.store,
      schema: ctx.schema,
      userId: ctx.userId,
      store: ctx.store,
      scrollTo: ctx.scrollTo,
    }),
    [ctx],
  );
  const slice = useStoreSelector(
    ctx.store,
    (selector ?? NO_SLICE) as EditorSelector<T | null>,
    isEqual as ((a: T | null, b: T | null) => boolean) | undefined,
  );
  return selector ? (slice as T) : api;
}

/** One property of a block, with its spec and a setter. */
export type AnyFieldHandle = {
  readonly blockId: string;
  readonly key: string;
  /** The property spec from the schema, or `undefined` for an undeclared key. */
  readonly spec: Field | undefined;
  readonly value: unknown;
  /** `null` deletes the key. */
  set(value: unknown, options?: UpdateOptions): void;
};

/** A block with its data, its field definitions and setters. */
export type AnyBlockHandle = {
  readonly id: string;
  readonly type: string;
  readonly props: Readonly<Record<string, unknown>>;
  /** Where the block sits; `null` for the root. */
  readonly parent: SlotRef | null;
  /** Child ids per slot, in order. */
  readonly slots: Readonly<Record<string, readonly string[]>>;
  /** Field definitions of this block's type (`'root'` → the root's). */
  readonly spec: Record<string, Field>;
  set(key: string, value: unknown, options?: UpdateOptions): void;
  setProps(patch: Record<string, unknown>, options?: UpdateOptions): void;
  field(key: string): AnyFieldHandle;
};

/** One child of a block: its id, type and position among its siblings. */
export type ChildRef = {
  readonly id: string;
  readonly type: string;
  readonly index: number;
};

/**
 * The structural actions of one block, gated by the schema's placement
 * rules; every action returns the store's verdict (`false`/`null` when
 * the store rejects it). For the root only `add` applies. For an unknown
 * id `type` is `null` and everything is inert.
 */
export type BlockActions = {
  readonly id: string;
  readonly type: string | null;
  /** Where the block sits; `null` for the root or an unknown id. */
  readonly parent: SlotRef | null;
  /** Position in its slot; `-1` for the root or an unknown id. */
  readonly index: number;
  readonly canMoveUp: boolean;
  readonly canMoveDown: boolean;
  /** Whether the block has a `children` slot. */
  readonly canHaveChildren: boolean;
  /** Types the block's `children` slot accepts right now, in definition order. */
  readonly allowedChildTypes: readonly string[];
  /** Inserts a child of `type` into `slot` (default `children`), appended by default. */
  add(
    type: string,
    options?: {
      slot?: string;
      index?: number;
      props?: Record<string, unknown>;
    },
  ): string | null;
  remove(): boolean;
  duplicate(): string | null;
  moveUp(): boolean;
  moveDown(): boolean;
};

function makeBlockHandle(
  store: EditorStore,
  schema: AnyEditorSchema,
  node: FlatNode,
): AnyBlockHandle {
  const spec = fieldsOf(schema, node.type);
  return {
    id: node.id,
    type: node.type,
    props: node.props,
    parent: node.parent,
    slots: node.slots,
    spec,
    set(key, value, options) {
      store.update(node.id, { [key]: value }, options);
    },
    setProps(patch, options) {
      store.update(node.id, patch, options);
    },
    field(key) {
      return {
        blockId: node.id,
        key,
        spec: spec[key],
        value: node.props[key],
        set(value, options) {
          store.update(node.id, { [key]: value }, options);
        },
      };
    },
  };
}

/** The block `id` (or `null`), re-rendering only when that node changes. */
export function useAnyBlock(id: string | null): AnyBlockHandle | null {
  const ctx = useEditorContext('useAnyBlock');
  const node = useStoreSelector(ctx.store, (state) =>
    id === null ? null : (state.nodes[id] ?? null),
  );
  return React.useMemo(
    () => (node ? makeBlockHandle(ctx.store, ctx.schema, node) : null),
    [ctx, node],
  );
}

/** One property of block `blockId`, re-rendering only when that value (or the node's type) changes. */
export function useAnyField(blockId: string, key: string): AnyFieldHandle {
  const ctx = useEditorContext('useAnyField');
  const slice = useStoreSelector(ctx.store, (state) => {
    const node = state.nodes[blockId];
    return { type: node?.type ?? null, value: node?.props[key] };
  });
  return React.useMemo<AnyFieldHandle>(
    () => ({
      blockId,
      key,
      spec:
        slice.type === null ? undefined : fieldsOf(ctx.schema, slice.type)[key],
      value: slice.value,
      set(value, options) {
        ctx.store.update(blockId, { [key]: value }, options);
      },
    }),
    [ctx, blockId, key, slice],
  );
}

/**
 * The visible fields of block `blockId`, in schema order, after its
 * component's `resolveFields` overrides. Fields hidden by `hidden` or `when`
 * for the block's current props are left out. `[]` for an unknown block.
 */
export function useFields(blockId: string): SchemaField[] {
  const ctx = useEditorContext('useFields');
  const resolverRef = React.useRef<ReturnType<
    typeof createFieldResolver
  > | null>(null);
  resolverRef.current ??= createFieldResolver();
  const resolver = resolverRef.current;
  const fields = useStoreSelector(ctx.store, (state) => {
    const node = state.nodes[blockId];
    if (!node) return null;
    const def = componentOf(ctx.schema, node.type);
    if (!def) return null;
    const fieldCtx = fieldContextFor(
      ctx.schema,
      (id) => state.nodes[id],
      blockId,
    );
    return resolver(def, node.props, fieldCtx);
  });
  return React.useMemo(
    () =>
      fields === null
        ? []
        : Object.entries(fields).map(([key, spec]) => ({ key, spec })),
    [fields],
  );
}

const EMPTY_CHILDREN: readonly ChildRef[] = [];

function sameChildren(a: readonly ChildRef[], b: readonly ChildRef[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined || y === undefined) return false;
    if (x.id !== y.id || x.type !== y.type) return false;
  }
  return true;
}

/**
 * The children in slot `slot` of `parentId` in order as `{ id, type, index }`;
 * the same array reference until ids or types in that slot change.
 */
export function useSlot(parentId: string, slot: string): readonly ChildRef[] {
  const ctx = useEditorContext('useSlot');
  return useStoreSelector(
    ctx.store,
    (state) => {
      const ids = state.nodes[parentId]?.slots[slot];
      if (!ids || ids.length === 0) return EMPTY_CHILDREN;
      return ids.map((id, index) => ({
        id,
        type: state.nodes[id]?.type ?? '',
        index,
      }));
    },
    sameChildren,
  );
}

/** The children of `parentId`'s default slot (`children`); see {@link useSlot}. */
export function useChildren(parentId: string): readonly ChildRef[] {
  return useSlot(parentId, DEFAULT_SLOT);
}

const EMPTY_NAMES: readonly string[] = [];

function sameNames(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((name, i) => name === b[i]);
}

/**
 * The slot names of block `parentId`: the slots its component declares in
 * declaration order, then any other slot the node holds, alphabetically.
 */
export function useSlots(parentId: string): readonly string[] {
  const ctx = useEditorContext('useSlots');
  return useStoreSelector(
    ctx.store,
    (state) => {
      const node = state.nodes[parentId];
      if (!node) return EMPTY_NAMES;
      const declared = Object.keys(slotsOf(ctx.schema, node.type));
      const extra = Object.keys(node.slots)
        .filter((name) => !declared.includes(name))
        .sort();
      const names = [...declared, ...extra];
      return names.length === 0 ? EMPTY_NAMES : names;
    },
    sameNames,
  );
}

/**
 * The structural actions of block `id` (see {@link BlockActions});
 * re-renders when its type, parent, position or allowed child types change.
 */
export function useBlockActions(id: string): BlockActions {
  const ctx = useEditorContext('useBlockActions');
  const slice = useStoreSelector(
    ctx.store,
    (state) => {
      const node = state.nodes[id];
      if (!node) {
        return {
          type: null,
          parent: null,
          index: -1,
          siblings: 0,
          allowed: EMPTY_NAMES,
        };
      }
      const parent = node.parent;
      const siblings = parent
        ? (state.nodes[parent.id]?.slots[parent.slot] ?? [])
        : [];
      return {
        type: node.type,
        parent,
        index: parent ? siblings.indexOf(id) : -1,
        siblings: siblings.length,
        allowed: allowedChildTypes(ctx.schema, state.nodes, {
          id,
          slot: DEFAULT_SLOT,
        }),
      };
    },
    (a, b) =>
      a.type === b.type &&
      a.parent === b.parent &&
      a.index === b.index &&
      a.siblings === b.siblings &&
      sameNames(a.allowed, b.allowed),
  );
  return React.useMemo<BlockActions>(() => {
    const { type, parent, index, siblings, allowed } = slice;
    const store = ctx.store;
    const isRoot = type !== null && parent === null;
    return {
      id,
      type,
      parent,
      index,
      canMoveUp: type !== null && !isRoot && index > 0,
      canMoveDown:
        type !== null && !isRoot && index >= 0 && index < siblings - 1,
      canHaveChildren:
        type !== null && DEFAULT_SLOT in slotsOf(ctx.schema, type),
      allowedChildTypes: allowed,
      add(childType, options) {
        if (type === null) return null;
        return store.add(childType, {
          parent: { id, slot: options?.slot },
          index: options?.index,
          props: options?.props,
        });
      },
      remove() {
        return type === null || isRoot ? false : store.remove(id);
      },
      duplicate() {
        return type === null || isRoot ? null : store.duplicate(id);
      },
      moveUp() {
        if (type === null || parent === null || index <= 0) return false;
        return store.move(id, { parent, index: index - 1 });
      },
      moveDown() {
        if (type === null || parent === null || index < 0) return false;
        if (index >= siblings - 1) return false;
        return store.move(id, { parent, index: index + 1 });
      },
    };
  }, [ctx.store, ctx.schema, id, slice]);
}

/** The selection of `userId` (default: this editor's user). */
export function useSelection(userId?: string): UserSelection {
  const ctx = useEditorContext('useSelection');
  const user = userId ?? ctx.userId;
  return useStoreSelector(
    ctx.store,
    (state) => state.selection[user] ?? EMPTY_SELECTION,
  );
}

export type HistoryApi = {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  undo(): boolean;
  redo(): boolean;
};

export function useHistory(): HistoryApi {
  const ctx = useEditorContext('useHistory');
  const flags = useStoreSelector(ctx.store, (state) => ({
    canUndo: state.history.past.length > 0,
    canRedo: state.history.future.length > 0,
  }));
  return React.useMemo(
    () => ({ ...flags, undo: ctx.store.undo, redo: ctx.store.redo }),
    [ctx, flags],
  );
}

export type SaveApi = {
  readonly dirty: boolean;
  readonly saving: boolean;
  save(meta?: { message?: string }): Promise<void>;
  markSaved(): void;
};

export function useSave(): SaveApi {
  const ctx = useEditorContext('useSave');
  const flags = useStoreSelector(ctx.store, (state, store) => ({
    dirty: store.isDirty(),
    saving: state.saving,
  }));
  return React.useMemo(
    () => ({ ...flags, save: ctx.store.save, markSaved: ctx.store.markSaved }),
    [ctx, flags],
  );
}

/** Whether the tree differs from the last saved/loaded tree. */
export function useDirty(): boolean {
  const ctx = useEditorContext('useDirty');
  return useStoreSelector(ctx.store, (_state, store) => store.isDirty());
}

/** Every insertable block type of the schema, in definition order (memoised per schema). */
export function usePalette(): PaletteItem[] {
  const ctx = useEditorContext('usePalette');
  return React.useMemo(() => paletteItems(ctx.schema), [ctx.schema]);
}

/** Every `required` property left empty across the whole document (blocks and root), for the Save/Publish gate. */
export function useMissingRequired(): MissingRequiredField[] {
  const ctx = useEditorContext('useMissingRequired');
  const nodes = useStoreSelector(ctx.store, (state) => state.nodes);
  return React.useMemo(
    () => missingRequired(ctx.schema, Object.values(nodes)),
    [ctx.schema, nodes],
  );
}
