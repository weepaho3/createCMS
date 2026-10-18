'use client';

import { EditorLiveAnnouncer } from './announcer';
// @createcms/react/editor: schema, state, form and preview layer of the
// editor primitive. Parts live on the `Editor` namespace (`Editor.Root`, …);
// helpers and hooks are flat named exports next to it.
import { EditorRoot } from './components';
import { EditorErrorSummary } from './error-summary';
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
import { EditorShortcutHelp } from './shortcut-help';
import {
  EditorAddBlock,
  EditorMoveToDialog,
  EditorOutline,
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
export type { EditorLiveAnnouncerProps } from './announcer';
export { describeBlock, useAnnounce } from './announcer';
export { useMessages, useShortcutLabel } from './messages';
export type { EditorShortcutHelpProps, ShortcutEntry } from './shortcut-help';
export { useShortcutList } from './shortcut-help';
export type {
  EditorErrorSummaryProps,
  ErrorSummaryEntry,
} from './error-summary';
export { useSaveIssues } from './error-summary';
export type { SectionOverrideEntry } from './sections';
export { useSection, useSectionOverrides } from './sections';
export type { RovingFocus, RovingFocusOptions } from './roving';
export { useRovingFocus } from './roving';

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
  Outline: EditorOutline,
  OutlineItem: EditorOutlineItem,
  OutlineGroup: EditorOutlineGroup,
  AddBlock: EditorAddBlock,
  Slot: EditorSlot,
  LiveAnnouncer: EditorLiveAnnouncer,
  ShortcutHelp: EditorShortcutHelp,
  ErrorSummary: EditorErrorSummary,
  MoveToDialog: EditorMoveToDialog,
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
  EditorOutlineProps,
  InsertPoint,
  OutlineGroupState,
  OutlineItemState,
} from './structure';
export { insertPointFor, useMoveTargets } from './structure';
export type { EditorMoveToDialogProps, MoveToTarget } from './structure';

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
  useComputed,
  useDirty,
  useEditor,
  useFields,
  useHistory,
  useHovered,
  useMissingRequired,
  useNodeStatus,
  usePalette,
  useSave,
  useSaveConflict,
  useSelection,
  useSlot,
  useSlots,
} from './hooks';
export {
  bindEditorClipboard,
  bindEditorKeyboard,
  combosOf,
  handleEditorKey,
  useEditorKeyboard,
} from './keyboard';

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
