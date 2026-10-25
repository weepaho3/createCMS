import * as React from 'react';

import type { DocSelector } from './binding';
import type {
  EditorDocument,
  FlatNode,
  JsonValue,
  SlotRef,
} from './core/document';
import type {
  AnyEditorSchema,
  Field,
  MissingRequiredField,
  PaletteItem,
  SchemaField,
} from './core/schema';
import type {
  EditorCommand,
  EditorStore,
  FieldRef,
  NodeStatus,
  SaveConflict,
  SaveStatus,
  UpdateOptions,
  SlotTarget,
} from './core/store';
import type { EditorScrollToOptions } from './scroll';

import {
  useStoreDocSelector,
  useStoreEphemeralSelector,
  useStoreSessionSelector,
} from './binding';
import { useEditorContext } from './context';
import { ariaKeyShortcut, formatShortcut } from './core/messages';
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

const NO_SLICE: DocSelector<null> = () => null;

/** Everything a part needs from the editor: the store's methods plus `schema`, `store` and `scrollTo`. */
export type EditorApi = EditorStore & {
  readonly store: EditorStore;
  scrollTo(blockId: string, opts?: EditorScrollToOptions): boolean;
};

/**
 * `useEditor()` → a stable API object (actions + `schema` + `store` +
 * `scrollTo`); `useEditor(selector)` → a reactive slice of the document
 * scope.
 */
export function useEditor(): EditorApi;
export function useEditor<T>(
  selector: DocSelector<T>,
  isEqual?: (a: T, b: T) => boolean,
): T;
export function useEditor<T>(
  selector?: DocSelector<T>,
  isEqual?: (a: T, b: T) => boolean,
): T | EditorApi {
  const ctx = useEditorContext('useEditor');
  const api = React.useMemo<EditorApi>(
    () => ({
      ...ctx.store,
      store: ctx.store,
      scrollTo: ctx.scrollTo,
    }),
    [ctx],
  );
  const slice = useStoreDocSelector(
    ctx.store,
    (selector ?? NO_SLICE) as DocSelector<T | null>,
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
  /**
   * Moves the block to `index` of `parent` (any slot that takes it), the
   * index counting that slot without the block: the non-drag way to move.
   */
  moveTo(parent: SlotTarget, index: number): boolean;
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
  const node = useStoreDocSelector(ctx.store, (state) =>
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
  const slice = useStoreDocSelector(ctx.store, (state) => {
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
  const fields = useStoreDocSelector(ctx.store, (state) => {
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
  return useStoreDocSelector(
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
  return useStoreDocSelector(
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
  const slice = useStoreDocSelector(
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
      moveTo(target, at) {
        if (type === null || parent === null) return false;
        return store.move(id, { parent: target, index: at });
      },
    };
  }, [ctx.store, ctx.schema, id, slice]);
}

/** The local selection and field focus. */
export type SelectionState = {
  /** The primary selected block (the first of `selection`), or `null`. */
  readonly selected: string | null;
  readonly selection: readonly string[];
  readonly focus: FieldRef | null;
  readonly editing: FieldRef | null;
};

/** The local selection; re-renders only on selection, focus or editing changes. */
export function useSelection(): SelectionState {
  const ctx = useEditorContext('useSelection');
  return useStoreSessionSelector(ctx.store, (state) => ({
    selected: state.selection[0] ?? null,
    selection: state.selection,
    focus: state.focusedField,
    editing: state.editing,
  }));
}

/** The hovered block; re-renders only on hover changes. */
export function useHovered(): string | null {
  const ctx = useEditorContext('useHovered');
  return useStoreEphemeralSelector(ctx.store, (state) => state.hoverId);
}

export type HistoryApi = {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  undo(): boolean;
  redo(): boolean;
};

export function useHistory(): HistoryApi {
  const ctx = useEditorContext('useHistory');
  const flags = useStoreSessionSelector(ctx.store, (state) => state.history);
  return React.useMemo(
    () => ({ ...flags, undo: ctx.store.undo, redo: ctx.store.redo }),
    [ctx, flags],
  );
}

export type SaveApi = {
  readonly status: SaveStatus;
  readonly dirty: boolean;
  /** `status === 'saving'`. */
  readonly saving: boolean;
  readonly error: Error | null;
  readonly conflict: SaveConflict | null;
  save(options?: { message?: string; force?: boolean }): Promise<void>;
};

/** Save state and the save action; re-renders when the save state changes. */
export function useSave(): SaveApi {
  const ctx = useEditorContext('useSave');
  const save = useStoreSessionSelector(ctx.store, (state) => state.save);
  return React.useMemo(
    () => ({
      status: save.status,
      dirty: save.dirty,
      saving: save.status === 'saving',
      error: save.error,
      conflict: save.conflict,
      save: ctx.store.save,
    }),
    [ctx, save],
  );
}

/** Whether there are local changes the last save did not include. */
export function useDirty(): boolean {
  const ctx = useEditorContext('useDirty');
  return useStoreSessionSelector(ctx.store, (state) => state.save.dirty);
}

export type SaveConflictApi = {
  /** The server's document, when the adapter sent it. */
  readonly serverDoc: EditorDocument | null;
  /** The local document. */
  readonly localDoc: EditorDocument;
  /** Loads the server's document; local changes are dropped. */
  reload(): boolean;
  /** Saves the local document over the server's. */
  overwrite(): Promise<void>;
  /** Writes the local document as JSON to the clipboard. */
  copyMine(): Promise<void>;
};

/** The current save conflict with its three ways out, or `null` without a conflict. */
export function useSaveConflict(): SaveConflictApi | null {
  const ctx = useEditorContext('useSaveConflict');
  const conflict = useStoreSessionSelector(
    ctx.store,
    (state) => state.save.conflict,
  );
  return React.useMemo(() => {
    if (!conflict) return null;
    const store = ctx.store;
    return {
      serverDoc: conflict.serverDoc,
      localDoc: store.getDocument(),
      reload: () => store.reloadFromServer(),
      overwrite: () => store.save({ force: true }),
      async copyMine() {
        const json = JSON.stringify(store.getDocument(), null, 2);
        await globalThis.navigator.clipboard.writeText(json);
      },
    };
  }, [ctx, conflict]);
}

/** A UI command with its availability; re-renders when the session or document changes. */
export type CommandApi = {
  readonly id: string;
  /** From the catalog's `commands`, else the command's own label. */
  readonly label: string | undefined;
  readonly canExecute: boolean;
  /** The bound key combo, if any (`mod+shift+z`). */
  readonly shortcut: string | undefined;
  /** The combo as shown on this platform (`⌘⇧Z`, `Ctrl+Shift+Z`). */
  readonly shortcutLabel: string | undefined;
  /** The combo as an `aria-keyshortcuts` value. */
  readonly ariaKeyShortcuts: string | undefined;
  run(args?: unknown): unknown;
};

function shortcutFor(store: EditorStore, id: string): string | undefined {
  for (const [combo, target] of Object.entries(store.commands.shortcuts())) {
    if (target === id) return combo;
  }
  return undefined;
}

/** The UI command `id` (built-in or from a plugin), or `null` when unknown. */
export function useCommand(id: string): CommandApi | null {
  const ctx = useEditorContext('useCommand');
  const store = ctx.store;
  const command = store.commands.get(id);
  // Availability can depend on the selection and on the document: re-render
  // on both, then recompute it.
  useStoreSessionSelector(store, (state) => state);
  useStoreDocSelector(store, (state) => state.version);
  const canExecute = command ? store.commands.canExecute(id) : false;
  return React.useMemo(() => {
    if (!command) return null;
    const shortcut = shortcutFor(store, id);
    return {
      id,
      label: ctx.messages.commands[id] ?? command.label,
      canExecute,
      shortcut,
      shortcutLabel:
        shortcut === undefined
          ? undefined
          : formatShortcut(shortcut, {
              platform: ctx.platform,
              messages: ctx.messages,
            }),
      ariaKeyShortcuts:
        shortcut === undefined
          ? undefined
          : ariaKeyShortcut(shortcut, ctx.platform),
      run: (args?: unknown) => store.commands.execute(id, args),
    };
  }, [ctx, store, id, command, canExecute]);
}

/** Every UI command of the editor (built-ins, then plugins). */
export function useCommands(): readonly EditorCommand[] {
  const ctx = useEditorContext('useCommands');
  return React.useMemo(() => ctx.store.commands.list(), [ctx]);
}

const NO_COMPUTED: Readonly<Record<string, JsonValue>> = Object.freeze({});
const IDLE_STATUS: NodeStatus = Object.freeze({ loading: false, error: null });

/** The block's `resolveData` state: `{ loading, error }` (both off when idle). */
export function useNodeStatus(id: string): NodeStatus {
  const ctx = useEditorContext('useNodeStatus');
  return useStoreSessionSelector(
    ctx.store,
    (state) => state.nodeStatus[id] ?? IDLE_STATUS,
  );
}

/** The block's `resolveData` result (`{}` before the first one). */
export function useComputed(id: string): Readonly<Record<string, JsonValue>> {
  const ctx = useEditorContext('useComputed');
  return useStoreSessionSelector(
    ctx.store,
    (state) => state.computed[id] ?? NO_COMPUTED,
  );
}

/** Every insertable block type of the schema, in definition order (memoised per schema). */
export function usePalette(): PaletteItem[] {
  const ctx = useEditorContext('usePalette');
  return React.useMemo(() => paletteItems(ctx.schema), [ctx.schema]);
}

/** Every `required` property left empty across the whole document (blocks and root), for the Save/Publish gate. */
export function useMissingRequired(): MissingRequiredField[] {
  const ctx = useEditorContext('useMissingRequired');
  const nodes = useStoreDocSelector(ctx.store, (state) => state.nodes);
  // Per node, keyed by node identity: an edit recomputes only the edited
  // node (unchanged nodes keep their object in the store).
  const cacheRef = React.useRef(
    new WeakMap<object, readonly MissingRequiredField[]>(),
  );
  const schemaRef = React.useRef(ctx.schema);
  if (schemaRef.current !== ctx.schema) {
    schemaRef.current = ctx.schema;
    cacheRef.current = new WeakMap();
  }
  return React.useMemo(() => {
    const cache = cacheRef.current;
    const out: MissingRequiredField[] = [];
    for (const node of Object.values(nodes)) {
      let found = cache.get(node);
      if (!found) {
        found = missingRequired(ctx.schema, [node]);
        cache.set(node, found);
      }
      out.push(...found);
    }
    return out;
  }, [ctx.schema, nodes]);
}
