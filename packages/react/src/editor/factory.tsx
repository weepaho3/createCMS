import * as React from 'react';

import type { EditorRootProps } from './components';
import type { EditorDocument, JsonValue, SlotRef } from './core/document';
import type {
  AnyComponentDef,
  AnyEditorSchema,
  Field,
  FieldValue,
  InferProps,
  PaletteItem,
} from './core/schema';
import type { SlotTarget, UpdateOptions, UserSelection } from './core/store';
import type {
  BlockActions,
  ChildRef,
  EditorApi,
  HistoryApi,
  SaveApi,
} from './hooks';
import type { EditorFramePreviewProps, EditorPreviewProps } from './preview';

import { EditorRoot } from './components';
import { useEditorContext } from './context';
import {
  useAnyBlock,
  useAnyField,
  useBlockActions,
  useChildren,
  useDirty,
  useEditor,
  useHistory,
  usePalette,
  useSave,
  useSelection,
} from './hooks';
import { useEditorKeyboard } from './keyboard';
import { EditorFramePreview, EditorPreview } from './preview';

// ---------------------------------------------------------------------------
// Type derivations from a schema
// ---------------------------------------------------------------------------

/** The statically known components of `S`: `{}` for an index-signature map. */
export type ComponentsOf<S extends AnyEditorSchema> =
  string extends keyof S['components'] ? {} : S['components'];

/** The component type names of `S`; `never` for component-less or dynamic schemas. */
export type BlockTypeOf<S extends AnyEditorSchema> = keyof ComponentsOf<S> &
  string;

/** The fields of component `K` (or of the root for `'root'`). */
export type PropsSpecOf<
  S extends AnyEditorSchema,
  K extends BlockTypeOf<S> | 'root',
> = K extends 'root'
  ? S['root']['fields']
  : K extends keyof ComponentsOf<S>
    ? ComponentsOf<S>[K] extends AnyComponentDef
      ? ComponentsOf<S>[K]['fields']
      : never
    : never;

/** The props of component `K` (or the root). */
export type BlockPropsOf<
  S extends AnyEditorSchema,
  K extends BlockTypeOf<S> | 'root',
> = PropsOf<PropsSpecOf<S, K>>;

export type RootPropsOf<S extends AnyEditorSchema> = BlockPropsOf<S, 'root'>;

/** One typed node of `S`: a union over its component types. */
export type NodeOf<S extends AnyEditorSchema> = {
  [K in BlockTypeOf<S>]: {
    id: string;
    type: K;
    v?: number;
    props: BlockPropsOf<S, K>;
    slots?: Record<string, NodeOf<S>[]>;
    meta?: Record<string, JsonValue>;
  };
}[BlockTypeOf<S>];

/** A typed document of `S`. */
export type DocumentOf<S extends AnyEditorSchema> = {
  schemaVersion: number;
  root: {
    id: string;
    type: 'root';
    v?: number;
    props: RootPropsOf<S>;
    slots?: Record<string, NodeOf<S>[]>;
    meta?: Record<string, JsonValue>;
  };
};

/** The props of a field record. */
export type PropsOf<TSpec extends Record<string, Field>> = InferProps<TSpec>;

/** The value type of field `P` in `TSpec`. */
export type PropValueOf<
  TSpec extends Record<string, Field>,
  P extends keyof TSpec,
> = FieldValue<TSpec[P]>;

/** A typed field handle: value, spec and setter of one property. */
export type FieldHandle<V, Spec> = {
  readonly blockId: string;
  readonly key: string;
  readonly spec: Spec;
  readonly value: V | undefined;
  /** `null` deletes the key. */
  set(value: V | null, options?: UpdateOptions): void;
};

/** A typed block handle for block type `K` with property specs `TSpec`. */
export type BlockHandle<
  K extends string,
  TSpec extends Record<string, Field>,
> = {
  readonly id: string;
  readonly type: K;
  readonly props: PropsOf<TSpec>;
  readonly parent: SlotRef | null;
  readonly slots: Readonly<Record<string, readonly string[]>>;
  readonly spec: TSpec;
  set<P extends keyof TSpec & string>(
    key: P,
    value: PropValueOf<TSpec, P> | null,
    options?: UpdateOptions,
  ): void;
  setProps(
    patch: { [P in keyof TSpec]?: PropValueOf<TSpec, P> | null },
    options?: UpdateOptions,
  ): void;
  field<P extends keyof TSpec & string>(
    key: P,
  ): FieldHandle<PropValueOf<TSpec, P>, TSpec[P]>;
};

/** Discriminated union over `type` of every block handle of `S`, plus the root handle. */
export type BlockHandleOf<S extends AnyEditorSchema> =
  | {
      [K in BlockTypeOf<S>]: BlockHandle<K, PropsSpecOf<S, K>>;
    }[BlockTypeOf<S>]
  | BlockHandle<'root', PropsSpecOf<S, 'root'>>;

export type FieldHandleOf<
  S extends AnyEditorSchema,
  K extends BlockTypeOf<S> | 'root',
  P extends keyof PropsSpecOf<S, K> & string,
> = FieldHandle<PropValueOf<PropsSpecOf<S, K>, P>, PropsSpecOf<S, K>[P]>;

export type TypedAddOptions<
  S extends AnyEditorSchema,
  K extends BlockTypeOf<S>,
> = {
  parent: SlotTarget;
  index?: number;
  props?: Partial<BlockPropsOf<S, K>>;
};

/** `useEditor()` with `add` restricted to the schema's block types. */
export type TypedEditorApi<S extends AnyEditorSchema> = Omit<
  EditorApi,
  'add'
> & {
  add<K extends BlockTypeOf<S>>(
    type: K,
    options: TypedAddOptions<S, K>,
  ): string | null;
};

/** `PaletteItem` with `type` narrowed; `never` when the schema has no static blocks. */
export type TypedPaletteItems<S extends AnyEditorSchema> = [
  BlockTypeOf<S>,
] extends [never]
  ? never
  : Array<PaletteItem & { type: BlockTypeOf<S> }>;

/** `ChildRef` with `type` narrowed to the schema's block types. */
export type ChildRefOf<S extends AnyEditorSchema> = Omit<ChildRef, 'type'> & {
  readonly type: BlockTypeOf<S>;
};

/**
 * `BlockActions` with `add` and `allowedChildTypes` restricted to the
 * schema's block types.
 */
export type TypedBlockActions<S extends AnyEditorSchema> = Omit<
  BlockActions,
  'add' | 'allowedChildTypes'
> & {
  readonly allowedChildTypes: readonly BlockTypeOf<S>[];
  add<K extends BlockTypeOf<S>>(
    type: K,
    options?: {
      slot?: string;
      index?: number;
      props?: Partial<BlockPropsOf<S, K>>;
    },
  ): string | null;
};

/** Phantom bag of the derived types (`typeof editor.types.document`, …). `{}` at runtime. */
export type EditorTypes<S extends AnyEditorSchema> = {
  readonly schema: S;
  readonly document: DocumentOf<S>;
  readonly node: NodeOf<S>;
  readonly blockType: BlockTypeOf<S>;
  readonly block: BlockHandleOf<S>;
  readonly rootProps: RootPropsOf<S>;
};

export type CreateEditorOptions<S extends AnyEditorSchema> = {
  schema: S;
};

export type EditorFactory<S extends AnyEditorSchema> = {
  readonly schema: S;
  /** `Editor.Root` with `schema` bound and `defaultValue` typed as `DocumentOf<S>`. */
  Root: (
    props: Omit<EditorRootProps, 'schema' | 'defaultValue'> & {
      defaultValue: DocumentOf<S>;
    },
  ) => React.JSX.Element;
  Preview: (
    props: Omit<EditorPreviewProps, 'render'> & {
      render: (doc: DocumentOf<S>) => React.ReactNode;
    },
  ) => React.JSX.Element;
  FramePreview: (
    props: Omit<EditorFramePreviewProps, 'render'> & {
      render: (
        doc: DocumentOf<S>,
        ctx: { signal: AbortSignal },
      ) => Promise<string | Blob>;
    },
  ) => React.JSX.Element;
  useEditor(): TypedEditorApi<S>;
  useBlock(id: string | null): BlockHandleOf<S> | null;
  useField<
    K extends BlockTypeOf<S> | 'root',
    P extends keyof PropsSpecOf<S, K> & string,
  >(
    ref: { id: string; type: K },
    key: P,
  ): FieldHandleOf<S, K, P>;
  useChildren(parentId: string): readonly ChildRefOf<S>[];
  useBlockActions(id: string): TypedBlockActions<S>;
  useSelection(userId?: string): UserSelection;
  useHistory(): HistoryApi;
  useEditorKeyboard: typeof useEditorKeyboard;
  useSave(): SaveApi;
  useDirty(): boolean;
  usePalette(): TypedPaletteItems<S>;
  readonly types: EditorTypes<S>;
};

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

/**
 * Binds the untyped hooks to one schema: `Root` has `schema` pre-set, every
 * hook is typed from `S`, and every hook throws when rendered under an
 * `Editor.Root` whose `schema` is a different object (nested editors, generic
 * routes): the types would lie otherwise.
 */
export function createEditor<const S extends AnyEditorSchema>(
  options: CreateEditorOptions<S>,
): EditorFactory<S> {
  const { schema } = options;

  function useSchemaGuard(hookName: string): void {
    const ctx = useEditorContext(hookName);
    if (ctx.schema !== schema) {
      throw new Error(
        `${hookName}: the enclosing Editor.Root uses a different schema than ` +
          "this createEditor() instance: render it under the factory's Root " +
          'or pass the same schema object.',
      );
    }
  }

  function Root(
    props: Omit<EditorRootProps, 'schema' | 'defaultValue'> & {
      defaultValue: DocumentOf<S>;
    },
  ): React.JSX.Element {
    const { defaultValue, ...rest } = props;
    return (
      <EditorRoot
        {...rest}
        schema={schema}
        defaultValue={defaultValue as EditorDocument}
      />
    );
  }

  function Preview(
    props: Omit<EditorPreviewProps, 'render'> & {
      render: (doc: DocumentOf<S>) => React.ReactNode;
    },
  ): React.JSX.Element {
    useSchemaGuard('Preview');
    const { render, ...rest } = props;
    return (
      <EditorPreview
        {...rest}
        render={render as (doc: EditorDocument) => React.ReactNode}
      />
    );
  }

  function FramePreview(
    props: Omit<EditorFramePreviewProps, 'render'> & {
      render: (
        doc: DocumentOf<S>,
        ctx: { signal: AbortSignal },
      ) => Promise<string | Blob>;
    },
  ): React.JSX.Element {
    useSchemaGuard('FramePreview');
    const { render, ...rest } = props;
    return (
      <EditorFramePreview
        {...rest}
        render={
          render as (
            doc: EditorDocument,
            ctx: { signal: AbortSignal },
          ) => Promise<string | Blob>
        }
      />
    );
  }

  return {
    schema,
    Root,
    Preview,
    FramePreview,
    useEditor() {
      useSchemaGuard('useEditor');
      return useEditor() as TypedEditorApi<S>;
    },
    useBlock(id) {
      useSchemaGuard('useBlock');
      return useAnyBlock(id) as BlockHandleOf<S> | null;
    },
    useField(ref, key) {
      useSchemaGuard('useField');
      return useAnyField(ref.id, key) as FieldHandleOf<
        S,
        typeof ref.type,
        typeof key
      >;
    },
    useChildren(parentId) {
      useSchemaGuard('useChildren');
      return useChildren(parentId) as readonly ChildRefOf<S>[];
    },
    useBlockActions(id) {
      useSchemaGuard('useBlockActions');
      return useBlockActions(id) as TypedBlockActions<S>;
    },
    useSelection(userId) {
      useSchemaGuard('useSelection');
      return useSelection(userId);
    },
    useHistory() {
      useSchemaGuard('useHistory');
      return useHistory();
    },
    useEditorKeyboard(scopeRef, options) {
      useSchemaGuard('useEditorKeyboard');
      return useEditorKeyboard(scopeRef, options);
    },
    useSave() {
      useSchemaGuard('useSave');
      return useSave();
    },
    useDirty() {
      useSchemaGuard('useDirty');
      return useDirty();
    },
    usePalette() {
      useSchemaGuard('usePalette');
      return usePalette() as TypedPaletteItems<S>;
    },
    types: {} as EditorTypes<S>,
  };
}
