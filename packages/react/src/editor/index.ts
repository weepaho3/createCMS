'use client';

// @createcms/react/editor — schema, state, form and preview layer of the
// editor primitive. Parts live on the `Editor` namespace (`Editor.Root`, …);
// helpers and hooks are flat named exports next to it.
import { EditorRoot } from './components';

export type { EditorRootProps } from './components';
export type { EditorContextValue } from './types';
export { useEditorContext } from './context';

export const Editor = {
  Root: EditorRoot,
};

// React binding and untyped hooks.
export type { EditorSelector } from './binding';
export { shallowEqual, useEditorSelector, useEditorStore } from './binding';
export type {
  AnyBlockHandle,
  AnyFieldHandle,
  EditorApi,
  HistoryApi,
  SaveApi,
} from './hooks';
export {
  useAnyBlock,
  useAnyField,
  useChildren,
  useDirty,
  useEditor,
  useFields,
  useHistory,
  usePalette,
  useSave,
  useSelection,
} from './hooks';

// Typed factory.
export type {
  BlockHandle,
  BlockHandleOf,
  BlockPropsOf,
  BlocksOf,
  BlockTypeOf,
  CreateEditorOptions,
  EditorFactory,
  EditorTypes,
  FieldHandle,
  FieldHandleOf,
  PropsOf,
  PropsSpecOf,
  PropValueOf,
  RootPropsOf,
  TreeOf,
  TypedAddOptions,
  TypedEditorApi,
  TypedPaletteItems,
} from './factory';
export { createEditor } from './factory';

// Layer 1 — schema types and pure helpers (no React, no DOM).
export type {
  AnyEditorSchema,
  DefaultValuesOptions,
  EditorSchema,
  FieldError,
  FieldErrorCode,
  FieldGroup,
  FieldKind,
  FieldSpecOf,
  FieldValueMap,
  FieldValueOf,
  MissingRequiredField,
  MissingRequiredNode,
  PaletteGroup,
  PaletteItem,
  PlacementIndex,
  PlacementRule,
  SchemaField,
} from './schema';
export {
  allowedChildTypes,
  canPlace,
  defaultValuesFor,
  getPlacement,
  groupFields,
  groupPaletteItems,
  isEmptyValue,
  missingRequired,
  paletteItems,
  propertiesOf,
  validateField,
} from './schema';

// Layer 2 — framework-free store (ops, inverse ops, history, applyRemote).
export type {
  AddOptions,
  ApplyRemoteResult,
  ApplyResult,
  CreateEditorStoreOptions,
  EditorCallbacks,
  EditorChange,
  EditorNode,
  EditorNodes,
  EditorOp,
  EditorStore,
  EditorStoreState,
  FieldRef,
  HistoryEntry,
  UpdateOptions,
  UserSelection,
} from './store';
export {
  COALESCE_MS,
  applyOp,
  createBlockId,
  createEditorStore,
  flattenTree,
  serializeToTree,
  stableHash,
} from './store';
