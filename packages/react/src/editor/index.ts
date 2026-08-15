'use client';

// @createcms/react/editor — schema, state, form and preview layer of the
// editor primitive. Namespace export like @shadcn/react: `Editor.Root`, …
// Behavior parts arrive issue by issue; this file is the stable public entry.
import { EditorRoot } from './components';

export type { EditorRootProps } from './components';
export type { EditorContextValue } from './types';
export { useEditorContext } from './context';

export const Editor = {
  Root: EditorRoot,
};

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
