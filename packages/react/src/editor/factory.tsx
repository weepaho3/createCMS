import type {
  AnyBlockDefinition,
  BlockProperty,
  BlockTreeNode,
  InferBlockProperties,
  InferBlockTreeNode,
  InferPartialBlockProperties,
} from '@createcms/schema';

import * as React from 'react';

import type { EditorRootProps } from './components';
import type {
  BlockActions,
  ChildRef,
  EditorApi,
  HistoryApi,
  SaveApi,
} from './hooks';
import type { EditorFramePreviewProps, EditorPreviewProps } from './preview';
import type { AnyEditorSchema, PaletteItem } from './schema';
import type { UpdateOptions, UserSelection } from './store';

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

/** The statically known blocks of `S`: `{}` when `S` declares none or only an index signature. */
export type BlocksOf<S extends AnyEditorSchema> = S extends { blocks?: infer B }
  ? NonNullable<B> extends Record<string, AnyBlockDefinition>
    ? string extends keyof NonNullable<B>
      ? {}
      : NonNullable<B>
    : {}
  : {};

/** Re-asserts the record constraint for generic positions (`T extends U ? T : never` carries `T & U`). */
type AsBlocks<T> = T extends Record<string, AnyBlockDefinition> ? T : never;

/** The block type names of `S`; `never` for block-less or dynamic schemas. */
export type BlockTypeOf<S extends AnyEditorSchema> = keyof BlocksOf<S> & string;

/** The property specs of block `K` (or of the root for `'root'`). */
export type PropsSpecOf<
  S extends AnyEditorSchema,
  K extends BlockTypeOf<S> | 'root',
> = K extends 'root'
  ? S['root']['properties']
  : K extends keyof BlocksOf<S>
    ? BlocksOf<S>[K] extends {
        properties: infer P extends Record<string, BlockProperty>;
      }
      ? P
      : never
    : never;

/** The (raw) property values of block `K` (or the root). */
export type BlockPropsOf<
  S extends AnyEditorSchema,
  K extends BlockTypeOf<S> | 'root',
> = PropsOf<PropsSpecOf<S, K>>;

export type RootPropsOf<S extends AnyEditorSchema> = BlockPropsOf<S, 'root'>;

/** The tree of `S` as `getBlockTree` delivers it (raw mode). */
export type TreeOf<S extends AnyEditorSchema> = InferBlockTreeNode<
  AsBlocks<BlocksOf<S>>,
  S['root']['properties'],
  'raw'
>;

/** The raw property values of a spec record (`NonNullable` because all-optional records infer `… | undefined`). */
export type PropsOf<TSpec extends Record<string, BlockProperty>> = NonNullable<
  InferBlockProperties<TSpec>
>;

/**
 * The value type of property `P` in `TSpec`. `InferBlockProperties` remaps
 * keys through a conditional `as` clause, so a GENERIC `PropsOf<TSpec>[P]`
 * is not indexable (TS2536); the conditional narrows `P` to the record's
 * keys and resolves at instantiation.
 */
export type PropValueOf<
  TSpec extends Record<string, BlockProperty>,
  P extends keyof TSpec,
> = P extends keyof PropsOf<TSpec> ? PropsOf<TSpec>[P] : never;

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
  TSpec extends Record<string, BlockProperty>,
> = {
  readonly id: string;
  readonly type: K;
  readonly properties: PropsOf<TSpec>;
  readonly parentId: string | null;
  readonly childIds: readonly string[];
  readonly spec: TSpec;
  set<P extends keyof TSpec & string>(
    key: P,
    value: PropValueOf<TSpec, P> | null,
    options?: UpdateOptions,
  ): void;
  setProperties(
    patch: InferPartialBlockProperties<TSpec>,
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
  parentId: string;
  index?: number;
  properties?: Partial<BlockPropsOf<S, K>>;
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
    options?: { index?: number; properties?: Partial<BlockPropsOf<S, K>> },
  ): string | null;
};

/** Phantom bag of the derived types (`typeof editor.types.tree`, …). `{}` at runtime. */
export type EditorTypes<S extends AnyEditorSchema> = {
  readonly schema: S;
  readonly tree: TreeOf<S>;
  readonly blockType: BlockTypeOf<S>;
  readonly block: BlockHandleOf<S>;
  readonly rootProps: RootPropsOf<S>;
};

export type CreateEditorOptions<S extends AnyEditorSchema> = {
  schema: S;
};

export type EditorFactory<S extends AnyEditorSchema> = {
  readonly schema: S;
  /** `Editor.Root` with `schema` bound and `defaultValue` typed as `TreeOf<S>`. */
  Root: (
    props: Omit<EditorRootProps, 'schema' | 'defaultValue'> & {
      defaultValue: TreeOf<S>;
    },
  ) => React.JSX.Element;
  Preview: (
    props: Omit<EditorPreviewProps, 'render'> & {
      render: (tree: TreeOf<S>) => React.ReactNode;
    },
  ) => React.JSX.Element;
  FramePreview: (
    props: Omit<EditorFramePreviewProps, 'render'> & {
      render: (
        tree: TreeOf<S>,
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

  function assertSchema(hookName: string): void {
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
      defaultValue: TreeOf<S>;
    },
  ): React.JSX.Element {
    const { defaultValue, ...rest } = props;
    return (
      <EditorRoot
        {...rest}
        schema={schema}
        defaultValue={defaultValue as BlockTreeNode}
      />
    );
  }

  function Preview(
    props: Omit<EditorPreviewProps, 'render'> & {
      render: (tree: TreeOf<S>) => React.ReactNode;
    },
  ): React.JSX.Element {
    assertSchema('Preview');
    const { render, ...rest } = props;
    return (
      <EditorPreview
        {...rest}
        render={render as (tree: BlockTreeNode) => React.ReactNode}
      />
    );
  }

  function FramePreview(
    props: Omit<EditorFramePreviewProps, 'render'> & {
      render: (
        tree: TreeOf<S>,
        ctx: { signal: AbortSignal },
      ) => Promise<string | Blob>;
    },
  ): React.JSX.Element {
    assertSchema('FramePreview');
    const { render, ...rest } = props;
    return (
      <EditorFramePreview
        {...rest}
        render={
          render as (
            tree: BlockTreeNode,
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
      assertSchema('useEditor');
      return useEditor() as TypedEditorApi<S>;
    },
    useBlock(id) {
      assertSchema('useBlock');
      return useAnyBlock(id) as BlockHandleOf<S> | null;
    },
    useField(ref, key) {
      assertSchema('useField');
      return useAnyField(ref.id, key) as unknown as FieldHandleOf<
        S,
        typeof ref.type,
        typeof key
      >;
    },
    useChildren(parentId) {
      assertSchema('useChildren');
      return useChildren(parentId) as readonly ChildRefOf<S>[];
    },
    useBlockActions(id) {
      assertSchema('useBlockActions');
      return useBlockActions(id) as TypedBlockActions<S>;
    },
    useSelection(userId) {
      assertSchema('useSelection');
      return useSelection(userId);
    },
    useHistory() {
      assertSchema('useHistory');
      return useHistory();
    },
    useEditorKeyboard(scopeRef, options) {
      assertSchema('useEditorKeyboard');
      return useEditorKeyboard(scopeRef, options);
    },
    useSave() {
      assertSchema('useSave');
      return useSave();
    },
    useDirty() {
      assertSchema('useDirty');
      return useDirty();
    },
    usePalette() {
      assertSchema('usePalette');
      return usePalette() as TypedPaletteItems<S>;
    },
    types: {} as EditorTypes<S>,
  };
}
