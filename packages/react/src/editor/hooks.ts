import type { BlockProperty } from '@createcms/schema';

import * as React from 'react';

import type { EditorSelector } from './binding';
import type {
  AnyEditorSchema,
  MissingRequiredField,
  PaletteItem,
  SchemaField,
} from './schema';
import type {
  EditorNode,
  EditorStore,
  UpdateOptions,
  UserSelection,
} from './store';

import { useStoreSelector } from './binding';
import { useEditorContext } from './context';
import { missingRequired, paletteItems, propertiesOf } from './schema';

const EMPTY_IDS: readonly string[] = [];
const EMPTY_SELECTION: UserSelection = {
  selected: null,
  hovered: null,
  focus: null,
  editing: null,
};
const NO_SLICE: EditorSelector<null> = () => null;

/** Everything a part needs from the editor: the store's methods plus `schema`, `userId` and the store itself. */
export type EditorApi = EditorStore & {
  readonly schema: AnyEditorSchema;
  readonly userId: string;
  readonly store: EditorStore;
};

/**
 * `useEditor()` → a stable API object (actions + `schema` + `userId` + `store`);
 * `useEditor(selector)` → a reactive slice of the store state.
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
  readonly spec: BlockProperty | undefined;
  readonly value: unknown;
  /** `null` deletes the key. */
  set(value: unknown, options?: UpdateOptions): void;
};

/** A block with its data, its property specs and setters. */
export type AnyBlockHandle = {
  readonly id: string;
  readonly type: string;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly parentId: string | null;
  readonly childIds: readonly string[];
  /** Property specs of this block's type (`'root'` → the root's). */
  readonly spec: Record<string, BlockProperty>;
  set(key: string, value: unknown, options?: UpdateOptions): void;
  setProperties(patch: Record<string, unknown>, options?: UpdateOptions): void;
  field(key: string): AnyFieldHandle;
};

function makeBlockHandle(
  store: EditorStore,
  schema: AnyEditorSchema,
  node: EditorNode,
): AnyBlockHandle {
  const spec = propertiesOf(schema, node.type);
  return {
    id: node.id,
    type: node.type,
    properties: node.properties,
    parentId: node.parentId,
    childIds: node.childIds,
    spec,
    set(key, value, options) {
      store.update(node.id, { [key]: value }, options);
    },
    setProperties(patch, options) {
      store.update(node.id, patch, options);
    },
    field(key) {
      return {
        blockId: node.id,
        key,
        spec: spec[key],
        value: node.properties[key],
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
    return { type: node?.type ?? null, value: node?.properties[key] };
  });
  return React.useMemo<AnyFieldHandle>(
    () => ({
      blockId,
      key,
      spec:
        slice.type === null
          ? undefined
          : propertiesOf(ctx.schema, slice.type)[key],
      value: slice.value,
      set(value, options) {
        ctx.store.update(blockId, { [key]: value }, options);
      },
    }),
    [ctx, blockId, key, slice],
  );
}

/** The property specs of block `blockId`'s type, in schema order (`[]` for an unknown block). */
export function useFields(blockId: string): SchemaField[] {
  const ctx = useEditorContext('useFields');
  const type = useStoreSelector(
    ctx.store,
    (state) => state.nodes[blockId]?.type ?? null,
  );
  return React.useMemo(
    () =>
      type === null
        ? []
        : Object.entries(propertiesOf(ctx.schema, type)).map(([key, spec]) => ({
            key,
            spec,
          })),
    [ctx, type],
  );
}

/** The child ids of `parentId` in order — the same array reference until they change. */
export function useChildren(parentId: string): readonly string[] {
  const ctx = useEditorContext('useChildren');
  return useStoreSelector(
    ctx.store,
    (state) => state.nodes[parentId]?.childIds ?? EMPTY_IDS,
  );
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
