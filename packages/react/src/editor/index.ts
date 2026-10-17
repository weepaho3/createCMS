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
import { EditorSlot } from './plugin-slot';
import { EditorFramePreview, EditorPreview } from './preview';
import {
  EditorAddBlock,
  EditorOutlineGroup,
  EditorOutlineItem,
} from './structure';

export type {
  EditorRootOwnStoreProps,
  EditorRootProps,
  EditorRootStoreProps,
} from './components';
export type { EditorContextValue, EditorScrollToOptions } from './types';
export { useEditorContext } from './context';
export type { EditorSlotProps } from './plugin-slot';

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
  OutlineGroup: EditorOutlineGroup,
  AddBlock: EditorAddBlock,
  Slot: EditorSlot,
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
  NestedFieldControlProps,
  NestedFieldRender,
} from './field';
export {
  defaultFieldControls,
  emptyListElement,
  formatFieldError,
  fromDatetimeLocal,
  toDatetimeLocal,
  useFieldContext,
} from './field';

// Preview: delayed raw-document render and compiled iframe output.
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
  EditorOutlineGroupProps,
  EditorOutlineItemProps,
  InsertPoint,
  OutlineGroupState,
  OutlineItemState,
} from './structure';
export { insertPointFor } from './structure';

// React binding and untyped hooks.
export type {
  DocSelector,
  EphemeralSelector,
  SessionSelector,
} from './binding';
export {
  shallowEqual,
  useDocSelector,
  useEditorStore,
  useEphemeralSelector,
  useSessionSelector,
} from './binding';
export type {
  AnyBlockHandle,
  AnyFieldHandle,
  BlockActions,
  ChildRef,
  CommandApi,
  EditorApi,
  HistoryApi,
  SaveApi,
  SaveConflictApi,
  SelectionState,
} from './hooks';
export {
  useAnyBlock,
  useAnyField,
  useBlockActions,
  useChildren,
  useCommand,
  useCommands,
  useDirty,
  useEditor,
  useFields,
  useHistory,
  useHovered,
  useMissingRequired,
  usePalette,
  useSave,
  useSaveConflict,
  useSelection,
  useSlot,
  useSlots,
} from './hooks';
export type { EditorKeyboardOptions } from './keyboard';
export { combosOf, useEditorKeyboard } from './keyboard';

// Typed factory.
export type {
  BlockHandle,
  BlockHandleOf,
  BlockPropsOf,
  BlockTypeOf,
  ChildRefOf,
  ComponentsOf,
  CreateEditorOptions,
  DocumentOf,
  EditorFactory,
  EditorTypes,
  FieldHandle,
  FieldHandleOf,
  NodeOf,
  PropsOf,
  PropsSpecOf,
  PropValueOf,
  RootPropsOf,
  TypedAddOptions,
  TypedBlockActions,
  TypedEditorApi,
  TypedPaletteItems,
} from './factory';
export { createEditor } from './factory';
