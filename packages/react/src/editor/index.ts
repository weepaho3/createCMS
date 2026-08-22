'use client';

// @createcms/react/editor: schema, state, form and preview layer of the
// editor primitive. Parts live on the `Editor` namespace (`Editor.Root`, …);
// helpers and hooks are flat named exports next to it.
import { EditorRoot } from './components';
import {
  EditorField,
  EditorFieldControl,
  EditorFieldDescription,
  EditorFieldError,
  EditorFieldLabel,
  EditorForm,
} from './field';
import { EditorFramePreview, EditorPreview } from './preview';
import { EditorAddBlock, EditorOutlineItem } from './structure';

export type { EditorRootProps } from './components';
export type { EditorContextValue, EditorScrollToOptions } from './types';
export { useEditorContext } from './context';

export const Editor = {
  Root: EditorRoot,
  Field: EditorField,
  FieldLabel: EditorFieldLabel,
  FieldControl: EditorFieldControl,
  FieldDescription: EditorFieldDescription,
  FieldError: EditorFieldError,
  Form: EditorForm,
  Preview: EditorPreview,
  FramePreview: EditorFramePreview,
  OutlineItem: EditorOutlineItem,
  AddBlock: EditorAddBlock,
};

// Field parts: context, built-in controls and their prop types.
export type {
  AnyFieldControlProps,
  EditorFieldControlProps,
  EditorFieldDescriptionProps,
  EditorFieldErrorProps,
  EditorFieldLabelProps,
  EditorFieldProps,
  EditorFormProps,
  FieldContextValue,
  FieldControlProps,
  FieldControls,
  ListElementControlProps,
  ListElementRender,
} from './field';
export {
  defaultFieldControls,
  emptyListElement,
  fromDatetimeLocal,
  toDatetimeLocal,
  useFieldContext,
} from './field';

// Preview: delayed raw-tree render and compiled iframe output.
export type {
  EditorFramePreviewProps,
  EditorPreviewProps,
  FramePreviewAnchor,
  FramePreviewIssue,
  FramePreviewKind,
} from './preview';
export { PREVIEW_DEBOUNCE_MS } from './preview';

// Structure parts: outline row and palette insert button.
export type {
  AddBlockState,
  EditorAddBlockProps,
  EditorOutlineItemProps,
  OutlineItemState,
} from './structure';

// React binding and untyped hooks.
export type { EditorSelector } from './binding';
export { shallowEqual, useEditorSelector, useEditorStore } from './binding';
export type {
  AnyBlockHandle,
  AnyFieldHandle,
  BlockActions,
  ChildRef,
  EditorApi,
  HistoryApi,
  SaveApi,
} from './hooks';
export {
  useAnyBlock,
  useAnyField,
  useBlockActions,
  useChildren,
  useDirty,
  useEditor,
  useFields,
  useHistory,
  useMissingRequired,
  usePalette,
  useSave,
  useSelection,
} from './hooks';
export type { EditorKeyboardOptions } from './keyboard';
export { useEditorKeyboard } from './keyboard';

// Typed factory.
export type {
  BlockHandle,
  BlockHandleOf,
  BlockPropsOf,
  BlocksOf,
  BlockTypeOf,
  ChildRefOf,
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
  TypedBlockActions,
  TypedEditorApi,
  TypedPaletteItems,
} from './factory';
export { createEditor } from './factory';

// Layer 1: schema types and pure helpers (no React, no DOM).
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

// Layer 2: framework-free store (ops, inverse ops, history, applyRemote).
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
