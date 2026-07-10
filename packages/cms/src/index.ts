export { createCMS } from './core/factory';
export type { CMSEndpointKey, CMSConfigHooks } from './core/factory';
// Pruning GC primitive — import directly to drive it from a cron route
// (`waitUntil(runPruningPass(...))`) or a queue worker (re-enqueue while !done),
// instead of the HTTP `admin.runPruning` endpoint.
export { runPruningPass } from './core/admin/pruning';
export type {
  PruningPassOptions,
  PruningPassResult,
  PruningResult,
} from './core/admin/pruning';
export { createCMSClient } from './client/vanilla';
export { createCMSQuery } from './client/query';
export { CMSClientError } from './client/error';
export { newId, registerIdPrefix } from './utils/nanoid';
export type { IdPrefix } from './utils/nanoid';
export type { BlockTreeNode } from './core/blocks/reconstruct-snapshot';
export type {
  ChangeType,
  TextDiffSegment,
  PropertyChange,
  PropertyChangeKind,
  MovedInfo,
  BlockChange,
  DiffSummary,
  BlockDiffAnnotation,
  AnnotatedBlockTreeNode,
  DiffView,
} from './core/diff/types';
export type {
  CMSClientInstance,
  CMSClientOptions,
  CMSClientPlugin,
  CMSClientStore,
  CMSAtomListener,
  CMSFetch,
  CMSQueryState,
  CMSMediaUploadState,
  CMSMediaUploadFileState,
  CMSMediaUploadOptions,
} from './client/types';

export { cmsMeta, cmsContext, createCMSEndpoint } from './core/endpoint';
export type { CMSEndpointMeta } from './core/endpoint';

export {
  CMSError,
  CMS_ERRORS,
  getCMSErrorCode,
  isCMSError,
} from './core/errors';
export type { CMSAPIError, CMSErrorCode } from './core/errors';

export type {
  CMSPlugin,
  CMSPluginContext,
  CMSPluginInitOptions,
  CMSPluginInitResult,
  CMSCoreRootPruningPlan,
  CMSPluginPruning,
  CMSPluginPruningMetrics,
  CMSPluginRootPruningPlan,
  CMSPluginPruningPlanContext,
  CMSPluginPruningExecuteContext,
  CMSPluginPruningExecuteResult,
  CMSHooks,
  CMSHookAction,
  CMSBeforeHook,
  CMSAfterHook,
  CMSBeforeHookContext,
  CMSAfterHookContext,
  CMSEndpointContext,
  InferPluginEndpoints,
  InferPluginErrorCodes,
  InferPluginContext,
} from './core/types/plugin';

export type {
  CMSOperation,
  CMSDefinition,
  CMSSchemaConfig,
  CMSMiddleware,
  CMSMiddlewareContext,
  CMSMiddlewareRequest,
  CMSPermissionResource,
  CMSProcedureContext,
  CMSHandlerContext,
  CMSSystemHandlerContext,
  CollectionDefinition,
  AnyCollectionDefinition,
  CollectionWithName,
  BlockDefinition,
  RootDefinition,
  BlockStructureEntry,
  CollectionStructure,
  BlockProperty,
  BlockPropertyType,
  AnyBlockDefinition,
  ScalarBlockProperty,
  EventDeclaration,
  InferEventParams,
  BlockEventNames,
  BlockEventFire,
  RefMode,
  InferBlockProperties,
  InferPartialBlockProperties,
  InferBlockInput,
  InferCreateBlockInput,
  InferUpdateBlockInput,
  InferBlockTreeNode,
  RootListItem,
  ListRootsResult,
  RootSummary,
  MergeRequestListItem,
  ListMergeRequestsResult,
  BranchListItem,
  ListBranchesResult,
  CMSUserConfig,
  DataRetentionConfig,
  BranchProtectionConfig,
  MergeStrategy,
  MiddlewareResult,
  RevalidateEvent,
  RevalidateHandler,
  RevalidateConfig,
  ResolvedReference,
  LinkKind,
  LinkValue,
  ResolvedLink,
} from './core/types/definitions';

export type { DrizzleInstance } from './core/types/drizzle';

export type {
  ScopeConditionFactory,
  ResolvedScope,
  ResolvedSlugConfig,
  TableScope,
} from './core/types/definitions';

export { normalizeSlug, buildFullPath, splitPath } from './core/slug';
export { rootRevalidateTag } from './core/revalidation';

// Block placement — build a per-collection index once, then query it with the
// non-throwing predicate/enumeration helpers (editor affordances) or the
// throwing `assertPlacementAllowed` gate (write path, not re-exported here).
export {
  buildPlacementIndex,
  isPlacementAllowed,
  allowedChildTypes,
} from './core/blocks/placement';
export type { PlacementIndex } from './core/blocks/placement';

// Pure resolved-reference guard + stored-form normalizer (shared by the server
// read path and the React client entry, which re-exports from here).
export { isResolvedReference, toStoredReference } from './core/references-guard';

// Seeds a created block's initial `properties` from its definition's
// `defaultValue` declarations.
export { defaultPropertiesFor } from './core/block-defaults';

export {
  definePluginSchema,
  defineColumns,
  defineTable,
  defineCoreSchema,
} from './core/db/define';

export {
  defineBlock,
  defineRoot,
  defineCollection,
  defineCollections,
  defineUserConfig,
  definePlugin,
  defineAuthMiddleware,
  allowAnonymous,
  trackingId,
} from './core/define';

export type { AllowAnonymousSentinel } from './core/define';

export type { SchemaModule, TableMap, EnumMap } from './core/db/types';

export type {
  NotificationPayload,
  NotificationType,
  NotificationInput,
  NotificationListItem,
  ListNotificationsResult,
  OnNotificationHandler,
} from './core/notifications/types';
export type { NotificationService } from './core/notifications/service';
export { notificationEventSchema } from './core/notifications/events';
export type { NotificationEvent } from './core/notifications/events';

// Media config — `media` is a required `createCMS` field, so consumers need these
// to type it (rather than reaching for `Parameters<typeof createCMS>[0]['media']`).
export type {
  MediaConfig,
  OptimizationConfig,
  AWSMediaConfig,
  DigitalOceanMediaConfig,
  CloudflareMediaConfig,
  CustomMediaConfig,
} from './core/types/s3';

// Realtime (optional, Upstash-only). Configure with `realtime: { url, token }`
// on createCMS to enable the shared `/realtime` SSE route + per-user push; both
// @upstash/* packages are optional peers. There is no pluggable transport.
export { defaultAuthorizeChannels } from './core/realtime/channels';
export type { RealtimeEventSchema } from './core/realtime/types';

// Inferred row types for the schema tables — the better-auth-style model-type
// surface. The table OBJECTS are intentionally NOT exported: consumers generate
// and import their own schema (`createcms generate`), which always matches their
// actual DB. Only the inferred select/insert types are re-exported here.
export type {
  Approval,
  NewApproval,
  Asset,
  NewAsset,
  AssetFolder,
  NewAssetFolder,
  BlockVersion,
  NewBlockVersion,
  Branch,
  NewBranch,
  CommentMention,
  NewCommentMention,
  CommentMessage,
  NewCommentMessage,
  CommentThread,
  NewCommentThread,
  Commit,
  NewCommit,
  CommitSnapshot,
  NewCommitSnapshot,
  ContentUsage,
  NewContentUsage,
  MergeConflict,
  NewMergeConflict,
  MergeRequest,
  NewMergeRequest,
  Notification,
  NewNotification,
  Publication,
  NewPublication,
  Redirect,
  NewRedirect,
  Root,
  NewRoot,
  SearchIndex,
  NewSearchIndex,
  Template,
  NewTemplate,
  TemplateVariableUsage,
  NewTemplateVariableUsage,
  Variable,
  NewVariable,
} from './core/db/schema.generated';
