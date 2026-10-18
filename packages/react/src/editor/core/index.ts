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
export type { MemoryAdapter, MemoryAdapterOptions } from './memory-adapter';
export { createMemoryAdapter } from './memory-adapter';
export type { DocStoreConformanceOptions } from './testing/docstore-conformance';
export {
  conformanceDocument,
  DocStoreConformanceError,
  runDocStoreConformance,
} from './testing/docstore-conformance';

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
  ResolveDataContext,
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

// Interop: Puck's `Data` in and out (tree-shaken when unused).
export type {
  PuckComponentData,
  PuckData,
  PuckInteropOptions,
} from './interop/puck';
export { fromPuckData, toPuckData } from './interop/puck';

// Rich text: ProseMirror (Tiptap) JSON values, validation, conversions.
export type {
  HtmlToRichTextOptions,
  LazyRichTextAdapter,
  ParsedHtmlDocument,
  ParsedHtmlNode,
  RichTextAdapter,
  RichTextCommands,
  RichTextDoc,
  RichTextHandle,
  RichTextIssue,
  RichTextIssueCode,
  RichTextLossReport,
  RichTextMark,
  RichTextMountOptions,
  RichTextNode,
  RichTextSchema,
  RichTextSuggestion,
  RichTextSuggestionItem,
  RichTextSuggestionState,
  RichTextToHtmlOptions,
} from './richtext';
export {
  EMPTY_RICH_TEXT,
  escapeHtml,
  htmlToRichText,
  isLossless,
  isRichTextDoc,
  isSafeUrl,
  lazyRichTextAdapter,
  LINK_PROTOCOLS,
  linkMarkHref,
  linkMarkValue,
  plainTextToRichText,
  RICH_TEXT_MARKS,
  RICH_TEXT_NODES,
  richTextSchemaOf,
  richTextToHtml,
  richTextToPlainText,
  validateRichText,
  walkText,
} from './richtext';

// Store: document store, commands, history, session, saving, serde.
export type {
  AddOptions,
  ApplyRemoteResult,
  BeforeCommandHandler,
  BeforeSaveGate,
  Change,
  Command,
  CommandContext,
  CommandHandler,
  CommandMeta,
  CreateEditorStoreOptions,
  CreateJsonDocStoreOptions,
  DispatchResult,
  DocState,
  DocStore,
  EditorChange,
  EditorCommand,
  EditorError,
  EditorErrorKind,
  EditorEventName,
  EditorEvents,
  EditorMode,
  EditorNodes,
  EditorStore,
  EphemeralState,
  FieldRef,
  HandlerContext,
  HistoryEntry,
  HistoryStep,
  MarkId,
  Middleware,
  MoveTarget,
  NodeStatus,
  PersistenceOptions,
  SaveConflict,
  SavePhase,
  SaveState,
  SaveStatus,
  SessionState,
  SlotTarget,
  Timers,
  Tx,
  TxMeta,
  TxResult,
  UiAction,
  UpdateOptions,
} from './store/types';
export type { ApplyResult } from './store/ops';
export { applyOp } from './store/ops';
export type {
  BuiltinCommandPayloads,
  DetachPayload,
  DuplicatePayload,
  InsertNodePayload,
  InsertPayload,
  MovePayload,
  PastePayload,
  RemovePayload,
  ReplacePayload,
  UpdatePayload,
  WrapPayload,
} from './store/commands';
export {
  BUILTIN_COMMANDS,
  checkPlacement,
  PlacementError,
  placementMiddleware,
} from './store/commands';
export type {
  DocStoreBackend,
  DocStoreCore,
  DocStoreCoreOptions,
} from './store/doc-store';
export {
  createDocStoreCore,
  createJsonDocStore,
  MAX_HISTORY,
  MERGE_MS,
  TxRejectedError,
} from './store/doc-store';
export type { MergeResult } from './store/merge';
export { mergeByNode } from './store/merge';
export {
  SAVE_DEBOUNCE_MS,
  SAVE_MAX_WAIT_MS,
  SAVE_RETRY_BASE_MS,
  requireValidDocument,
  SAVE_RETRY_MAX_MS,
} from './store/save';
export { createEditorStore, PLACEMENT_PRIORITY } from './store/store';
export { DEFAULT_SHORTCUTS } from './store/builtin-commands';
export type { SlotOrder } from './store/serde';
export {
  denormalize,
  flattenSubtree,
  normalize,
  serializeSubtree,
} from './store/serde';
export { createBlockId } from './store/id';

// Plugins.
export type {
  EditorPlugin,
  PluginCommand,
  PluginEventHandlers,
  PluginFieldKind,
} from './plugin';
export {
  applyPlugins,
  defineEditorPlugin,
  normalizeCombo,
  pluginCommands,
  pluginShortcuts,
  sortPlugins,
} from './plugin';

// Codes of editor warnings and errors.
export type { EditorCode } from './codes';
export {
  EDITOR_CODES,
  EDITOR_CODES_URL,
  formatEditorMessage,
  resetWarnings,
  warnOnce,
} from './codes';

// Load pipeline: migrations, repairs, diagnostics.
export type { Diagnostic, DiagnosticCode, LoadResult } from './load';
export { DocumentLoadError, loadDocument } from './load';

// Whole-document tasks off the main thread.
export type { WorkerPort, WorkerTasks } from './worker';
export {
  createWorkerTasks,
  serveWorkerTasks,
  WORKER_THRESHOLD,
} from './worker';

// Messages: the text catalog, issue and shortcut formatting.
export type {
  AnnouncedBlock,
  KeyNames,
  Messages,
  MessagesInput,
  Platform,
} from './messages';
export {
  ariaKeyShortcut,
  detectPlatform,
  EN_MESSAGES,
  formatIssue,
  formatShortcut,
  mergeMessages,
} from './messages';
export type { ClipboardPayload } from './clipboard';
export {
  CLIPBOARD_APP,
  CLIPBOARD_ATTRIBUTE,
  CLIPBOARD_MIME,
  CLIPBOARD_VERSION,
  copyBlocks,
  copyProps,
  decodeClipboard,
  encodeClipboardHtml,
  parseClipboardPayload,
  pasteBlocks,
  pasteProps,
  pasteTarget,
  plainTextOf,
  readClipboard,
  removeSelected,
  writeClipboard,
} from './clipboard';
export type {
  ResolvedSection,
  SectionOverrides,
  SectionRef,
  SectionResolver,
} from './sections';
export {
  applyOverrides,
  createSectionResolver,
  detachSection,
  REF_MAX_DEPTH,
  REF_TYPE,
  sectionBlock,
  sectionOverridesOf,
  sectionRefOf,
  sectionsPlugin,
} from './sections';
export type { InsertionPoint } from './insertion';
export { insertionPoints } from './insertion';
