// @createcms/react/editor/core: the React-free editor kernel (document model,
// store, schema helpers, validation). Importable from servers, workers and
// React Server Components: no directive, no runtime dependencies, and no
// import of React, another editor subpath or the media library.

// Document model: nested wire format, flat in-memory form, ops.
export type {
  EditorDocument,
  FlatNode,
  JsonValue,
  NodeData,
  NormalizedDoc,
  Op,
  Origin,
  SlotRef,
} from './document';
export { canonicalJson } from './document';

// Backend adapters.
export type {
  EditorAdapter,
  EditorAdapterErrorKind,
  FieldSources,
  PersistenceAdapter,
} from './adapter';
export { EditorAdapterError } from './adapter';

// Editor anchors handed to components.
export type { EditAttrs, EditProps, EditRef } from './edit';
export { NO_EDIT } from './edit';

// Schema: fields, components, placement, defaults, validation, visibility,
// responsive and localized values, remapping, JSON Schema export.
export type {
  AnyComponentDef,
  AnyEditorSchema,
  BooleanField,
  Breakpoint,
  ColorField,
  ComponentDef,
  ComponentPermission,
  CustomField,
  DateField,
  EditorSchema,
  Field,
  FieldBase,
  FieldContext,
  FieldKind,
  FieldSpecOf,
  FieldValue,
  FieldValueMap,
  FieldValueOf,
  InferProps,
  LinkField,
  LinkKind,
  LinkValue,
  ListField,
  Localized,
  MediaCrop,
  MediaField,
  MediaFocalPoint,
  MediaValue,
  Migration,
  NodeInput,
  NumberField,
  ObjectField,
  PlaceContext,
  ReferenceField,
  ReferenceValue,
  Responsive,
  RichTextField,
  SchemaField,
  SelectField,
  SelectOption,
  SlotSpec,
  TextConstraints,
  TextField,
  TextareaField,
} from './schema/types';
export { defineComponent, defineEditorSchema } from './schema/types';
export type { StandardSchemaV1 } from './schema/standard-schema';
export type {
  PlaceErrorCode,
  PlacementNode,
  PlaceResult,
} from './schema/placement';
export {
  allowedChildTypes,
  canPlaceIn,
  isSelfOrDescendant,
  slotAccepts,
  slotsOf,
} from './schema/placement';
export type { RemapIdsOptions, RewriteRefs } from './schema/remap';
export { remapIds } from './schema/remap';
export type { DefaultValuesOptions } from './schema/defaults';
export { defaultValuesFor } from './schema/defaults';
export type { FieldGroup, PaletteGroup, PaletteItem } from './schema/fields';
export {
  componentOf,
  DEFAULT_SLOT,
  fieldsOf,
  groupFields,
  groupPaletteItems,
  paletteItems,
} from './schema/fields';
export type {
  FieldError,
  FieldErrorCode,
  MissingRequiredField,
  MissingRequiredNode,
  StructureErrorCode,
  ValidateDocumentOptions,
  ValidateNodeOptions,
  ValidationIssue,
  ValidationPhase,
  ValidationSeverity,
} from './schema/validation';
export {
  isEmptyValue,
  missingRequired,
  validateDocument,
  validateField,
  validateNode,
} from './schema/validation';
export type { ContextNode } from './schema/visibility';
export {
  createFieldResolver,
  fieldContextFor,
  isFieldVisible,
  resolveFields,
} from './schema/visibility';
export {
  BREAKPOINTS,
  isLocalizedValue,
  isResponsiveValue,
  resolveLocalized,
  resolveResponsive,
} from './schema/responsive';
export type {
  ExportJsonSchemaOptions,
  JsonSchemaTarget,
} from './schema/json-schema';
export { exportJsonSchema } from './schema/json-schema';

// Store: ops, inverse ops, history, applyRemote, serde.
export type {
  AddOptions,
  ApplyRemoteResult,
  CreateEditorStoreOptions,
  EditorCallbacks,
  EditorChange,
  EditorNodes,
  EditorStore,
  EditorStoreState,
  FieldRef,
  HistoryEntry,
  MoveTarget,
  SlotTarget,
  UpdateOptions,
  UserSelection,
} from './store/types';
export type { ApplyResult } from './store/ops';
export { applyOp } from './store/ops';
export { COALESCE_MS, createEditorStore } from './store/store';
export type { SlotOrder } from './store/serde';
export {
  denormalize,
  flattenSubtree,
  normalize,
  serializeSubtree,
} from './store/serde';
export { stableHash } from './store/hash';
export { createBlockId } from './store/id';
