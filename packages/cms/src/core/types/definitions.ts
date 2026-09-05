import type { AnyColumn, SQL } from 'drizzle-orm';
import type { AnyPgTable } from 'drizzle-orm/pg-core';

import type { OnNotificationHandler } from '../notifications/types';
import type { ResolvedUserConfig } from '../user/resolve';
import type { DrizzleInstance } from './drizzle';
import type { CMSHookAction, CMSHooks, CMSPlugin } from './plugin';
import type { MediaConfig } from './s3';

// The block/collection/tree/link/reference vocabulary lives in the shared,
// runtime-free @createcms/schema package (inlined into this package's d.ts by
// `bunchee --dts-bundle` — it is a devDependency on purpose, see the `build`
// script and the `paths` comment in tsconfig.json). Re-exported here so every
// internal `../types/definitions` import and every public export path keeps
// working unchanged.
export type {
  PublishedBranchSnapshot,
  ResolvedReference,
  LinkKind,
  LinkValue,
  ResolvedLink,
  RefMode,
  BlockPropertyType,
  SelectOption,
  StringConstraints,
  NumberConstraints,
  ListElementType,
  ListElementSpec,
  ListBlockPropertySpec,
  BlockProperty,
  InferBlockProperties,
  ScalarBlockProperty,
  EventDeclaration,
  InferEventParams,
  BlockEventNames,
  BlockEventFire,
  RequireTrackingId,
  BlockDefinition,
  AnyBlockDefinition,
  InferBlockInput,
  InferCreateBlockInput,
  InferMergeBlockVersionInput,
  InferPartialBlockProperties,
  InferUpdateBlockInput,
  InferBlockTreeNode,
  RootDefinition,
  BlockStructureEntry,
  CollectionStructure,
  SlugConfig,
  ResolvedSlugConfig,
  CollectionDefinition,
  AnyCollectionDefinition,
  CollectionWithName,
  BranchProtectionConfig,
  EditAttrs,
  EditProps,
} from '@createcms/schema';

import type {
  AnyCollectionDefinition,
  BlockProperty,
  BranchProtectionConfig,
  CollectionWithName,
  InferBlockProperties,
} from '@createcms/schema';

// ============================================================================
// Scope Conditions (plugin-injected query/insert scoping)
// ============================================================================

/**
 * Per-request scope produced by a ScopeConditionFactory.
 * `where` — appended to SELECT/UPDATE/DELETE queries.
 * `insertColumns` — snake_case column name → value pairs merged directly
 *   into the raw SQL INSERT via `scopedInsert` / `scopedInsertBatch`.
 */
export type TableScope = {
  where?: SQL;
  insertColumns?: Record<string, unknown>;
};

/**
 * `roots` scope additionally supports a per-NEW-ENTRY column contributor: a
 * plugin can compute fresh insert columns once per newly-created logical entry
 * (e.g. a freshly minted translation-group id), which the static `insertColumns`
 * channel (same value on every row) can't express. Called once per
 * createRoot / root-duplication. Generic — core names no column.
 */
export type RootTableScope = TableScope & {
  newEntryColumns?: () => Record<string, unknown>;
  /**
   * Scope columns to EXCLUDE from cross-scope read filtering — columns the
   * plugin varies INDEPENDENTLY of a query so that cross-scope reads (a
   * reference/host/usage that legitimately spans them) must not filter on them.
   * The i18n plugin declares `['language']` (a host/reference in any sibling
   * language still counts; the read path already resolved a specific sibling).
   * Generic — core names no column; passed to `rootScopeConditions` as its
   * `exclude`. Empty/absent → every scope column filters.
   */
  crossScopeExclude?: readonly string[];
};

/**
 * A plugin-provided resolver for reference values (rootId / group-key strings),
 * carried on the resolved scope and consumed by the read path and the A/B
 * co-render walk. Core ships an IDENTITY default (`coreReferenceResolver`)
 * reproducing the single-language, no-plugin behaviour byte-for-byte; the i18n
 * plugin supplies a real one that understands translation groups + the fallback
 * chain. Core never names any i18n concept — it knows only this interface.
 *
 * `db` AND `scopeColumns` are passed PER CALL (not closed over): `db` so a
 * caller inside a transaction (e.g. the A/B →running guard under FOR UPDATE)
 * resolves against its own tx handle; `scopeColumns` because the MERGED root
 * scope columns (tenant + language) exist only AFTER every scope factory has
 * run — the i18n factory that builds the resolver sees only its OWN column at
 * build time. The resolver therefore closes over just its resolution POLICY
 * (e.g. the i18n active language + fallback chain). `scopeColumns` is the
 * scope predicate; the resolver excludes its own cross-scope columns.
 */
export type ReferenceResolver = {
  /**
   * Read-time render pick: stored reference value → the ONE rootId it renders
   * as (omit a key to leave it unresolved). Identity default: `value → value`.
   */
  resolveRenderTargets(
    db: DrizzleInstance,
    scopeColumns: Record<string, unknown> | undefined,
    collection: string,
    storedValues: string[],
  ): Promise<Map<string, string>>;

  /**
   * Conflict superset: stored reference keys → ALL rootIds they could render as
   * (a group key expands to its whole group). Used by the A/B co-render walk;
   * collection-agnostic (a reference may target any collection). Identity
   * default: the existing, non-archived roots among `storedKeys` (by id).
   */
  resolveConflictTargets(
    db: DrizzleInstance,
    scopeColumns: Record<string, unknown> | undefined,
    storedKeys: string[],
  ): Promise<string[]>;

  /** rootIds → all their group siblings. Identity default: the input rootIds. */
  expandGroup(
    db: DrizzleInstance,
    scopeColumns: Record<string, unknown> | undefined,
    rootIds: string[],
  ): Promise<string[]>;

  /** rootIds → the group keys a host could embed them by. Default: `[]`. */
  groupKeysFor(
    db: DrizzleInstance,
    scopeColumns: Record<string, unknown> | undefined,
    rootIds: string[],
  ): Promise<string[]>;
};

/**
 * Plugin-provided variable resolution (i18n). Loads the variable map for the
 * active language WITH fallback: for each key, the value from the highest-priority
 * language in `[active, ...fallback]` that has a row. `scopeColumns` carries the
 * cross-scope tenant predicate (language is resolved by the chain, NOT filtered).
 * When absent, core loads variables directly (optionally tenant-filtered). The
 * read paths ride this off the resolved scope.
 */
export type VariableResolver = {
  load(
    db: DrizzleInstance,
    scopeColumns: Record<string, unknown> | undefined,
  ): Promise<Map<string, string>>;
};

/** One variant branch of a running A/B test on a referenced root. */
export type RunningAbTestVariant = {
  branchId: string;
  isControl: boolean;
};

/** A running A/B test on one root: the test plus its variant branches. */
export type RunningAbTest = {
  testId: string;
  trafficPercentage: number;
  variants: RunningAbTestVariant[];
};

/**
 * A plugin-provided resolver that reports which referenced roots currently have
 * a RUNNING A/B test (with that test's variant branches). Carried on the
 * resolved scope and consumed by the read path's reference loader to fan the one
 * XOR-guaranteed varying block's branches out to the client. Core
 * ships NO default — when absent (no ab-test plugin) the read path assumes no
 * running tests and every embed stays on its deterministic single pick.
 * Core never names any A/B concept beyond this interface.
 */
export type AbTestResolver = {
  /**
   * The subset of `rootIds` that have a running test, each mapped to its test +
   * variant branches. `db` AND `scopeColumns` are passed PER CALL (same
   * rationale as {@link ReferenceResolver}). The caller passes already
   * render-resolved (active-language) rootIds, so this needs no group expansion.
   */
  runningTests(
    db: DrizzleInstance,
    scopeColumns: Record<string, unknown> | undefined,
    rootIds: string[],
  ): Promise<Map<string, RunningAbTest>>;
};

export type ResolvedScope = {
  roots?: RootTableScope;
  assets?: TableScope;
  assetFolders?: TableScope;
  redirects?: TableScope;
  templates?: TableScope;
  variables?: TableScope;
  releases?: TableScope;
  /**
   * Plugin-provided reference resolver (i18n translation-group resolution). When
   * absent, callers use core's identity default. Generic — see `ReferenceResolver`.
   */
  referenceResolver?: ReferenceResolver;
  /**
   * Plugin-provided variable resolver (i18n active-language-with-fallback). When
   * absent, core loads variables directly. Generic — see {@link VariableResolver}.
   */
  variableResolver?: VariableResolver;
  /**
   * Plugin-provided running-A/B-test resolver (server fan-out).
   * When absent, the read path assumes no running tests. Generic — see
   * {@link AbTestResolver}.
   */
  abTestResolver?: AbTestResolver;
  /**
   * Opaque per-plugin context slots, keyed by plugin id. Core never reads it;
   * each plugin stashes its own per-request context here from a scope factory
   * and reads it back via its own exported accessor. Merged generically in
   * computeScope (shallow, last-writer-wins per slot).
   */
  pluginContext?: Record<string, unknown>;
};

/**
 * Factory registered by plugins during `init`.
 * Called once per request with the middleware result to produce
 * table-level WHERE conditions and extra INSERT values.
 */
export type ScopeConditionFactory = (
  mwResult: MiddlewareResult,
) => ResolvedScope;

// ============================================================================
// Utility Types
// ============================================================================

export type CMSOperation = 'read' | 'create' | 'update' | 'delete';

// ============================================================================
// Read Response Types (typed by the collection definition)
// ============================================================================

/** A single row returned by `listRoots`, typed by the root properties. */
/**
 * The identifying metadata of a single commit. Every commit-producing mutation
 * (`updateBlocks`, `moveBlock`, `deleteBlock`, `updateRoot`, `revertBranch`,
 * `executeMerge`, …) returns this as `{ commit }` so the caller has the new
 * head's id, message, author, and timestamp without a follow-up fetch.
 */
export type CommitSummary = {
  id: string;
  message: string | null;
  createdAt: Date;
  createdBy: string | null;
};

export type RootListItem<TRootProps extends Record<string, BlockProperty>> = {
  id: string;
  createdAt: Date;
  createdBy?: string;
  parentRootId?: string;
  slug?: string;
  /**
   * The full, ancestor-resolved URL path (e.g. `/blog/post`), with the
   * collection's slug-config prefix applied. Present for slug-enabled
   * collections; `slug` alone is only the last segment.
   */
  path?: string;
  sortOrder: number;
  properties: NonNullable<InferBlockProperties<TRootProps>>;
  hasPublications: boolean;
  publicationCount: number;
  branchCount: number;
  openMergeRequestCount: number;
  /** Present only when called with `query.withUser`. Shape depends on the
   *  configured user table; left as `unknown` until cross-table inference. */
  createdByUser?: unknown;
};

/** Result of `listRoots`, typed by the collection's root properties. */
export type ListRootsResult<TRootProps extends Record<string, BlockProperty>> =
  {
    roots: RootListItem<TRootProps>[];
    total: number;
    hasMore: boolean;
  };

/** Root summary attached to list responses via the `withRoot` query flag
 *  (e.g. `listMergeRequests`). `properties` is typed from the root definition. */
export type RootSummary<TRootProps extends Record<string, BlockProperty>> = {
  id: string;
  slug: string | null;
  parentRootId: string | null;
  sortOrder: number;
  properties: NonNullable<InferBlockProperties<TRootProps>>;
  hasPublications: boolean;
};

/** A single row from `listMergeRequests`. `root`/`createdByUser` are present
 *  only when requested via the `withRoot`/`withUser` query flags. */
export type MergeRequestListItem<
  TRootProps extends Record<string, BlockProperty>,
> = {
  id: string;
  rootId: string;
  sourceBranchId: string;
  sourceBranchName: string;
  targetBranchId: string;
  targetBranchName: string;
  sourceCommitId: string;
  baseCommitId: string | null;
  mergeCommitId: string | null;
  status: 'open' | 'merged' | 'closed';
  title: string | null;
  description: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  conflictCount: number;
  hasConflicts: boolean;
  commentCount: number;
  createdByUser?: unknown;
  root?: RootSummary<TRootProps> | null;
};

/** Result of `listMergeRequests`, typed by the collection's root properties. */
export type ListMergeRequestsResult<
  TRootProps extends Record<string, BlockProperty>,
> = {
  mergeRequests: MergeRequestListItem<TRootProps>[];
  total: number;
  hasMore: boolean;
};

/** A single row from `listBranches`. Branches carry no block properties.
 *  `createdByUser` is present only when requested via the `withUser` flag. */
export type BranchListItem = {
  id: string;
  rootId: string;
  name: string;
  headCommitId: string;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  isDeletable: boolean;
  /** Whether this branch is currently published (has a `publications` row). */
  hasPublications: boolean;
  createdByUser?: unknown;
};

/** Result of `listBranches`. */
export type ListBranchesResult = {
  branches: BranchListItem[];
  total: number;
  hasMore: boolean;
};

// ============================================================================
// CMS
// ============================================================================

export type DataRetentionConfig = {
  keepDays: number;
  keepMinCommits: number;
  /**
   * Grace period (days) before a soft-archived root (`archivedAt`) is physically
   * hard-deleted by pruning. Defaults to `keepDays` when omitted — a trash
   * window after which the root and its whole history are reclaimed.
   */
  archiveKeepDays?: number;
};

// ============================================================================
// User Middleware Types
// ============================================================================

/**
 * Subset of the incoming request forwarded to the authMiddleware.
 *
 * From the HTTP router every field is populated. Direct server-side
 * `cms.api.*` calls forward `body`, `query`, and `headers` (plus an actor via
 * `context: { userId }`) — see the typed `EndpointCaller`; `params` and the raw
 * `request` are HTTP-router-only (there is no Request object for an in-process
 * call), so authMiddleware must not rely on them for the direct-call path.
 */
export type CMSMiddlewareRequest = {
  body?: Record<string, unknown>;
  query?: Record<string, unknown>;
  params?: Record<string, unknown>;
  headers?: HeadersInit;
  request?: Request;
};

type CMSCollectionScopeContext = {
  scope: 'collection';
  collection: CollectionWithName;
};

type CMSSystemScopeContext = {
  scope: 'system';
  collection?: never;
};

/**
 * Every permission-gated resource the CMS guards, as a closed union of the
 * `permissionResource` string an endpoint declares in its `cmsMeta(...)`. This
 * is the single source of truth used to type {@link CMSEndpointMeta.permissionResource}
 * (endpoint.ts), so a mistyped resource (e.g. `'variabl'`) is a compile error at
 * the route-definition site rather than a silently-unmatched permission check.
 * User middleware receives the resolved value as a plain `string` (it may also
 * be the `'unknown'` fallback for endpoints that declare none), so match against
 * these literals when writing a permission matrix.
 */
export type CMSPermissionResource =
  | 'root'
  | 'block'
  | 'branch'
  | 'mergeRequest'
  | 'approval'
  | 'comment'
  | 'publication'
  | 'publishedContent'
  | 'redirect'
  | 'notification'
  | 'media'
  | 'search'
  | 'variable'
  | 'template'
  | 'realtime'
  | 'release'
  | 'admin'
  | 'abTest'
  | 'abTestEvent'
  | 'user';

/** Ctx available to user-defined middleware */
export type CMSMiddlewareContext = CMSProcedureContext &
  (CMSCollectionScopeContext | CMSSystemScopeContext) & {
    permissionResource: string;
    operation: CMSOperation;
    branchName?: string;
    request?: CMSMiddlewareRequest;
  };

/** Result that user middleware can return to extend context */
export type MiddlewareResult = {
  userId?: string;
  [key: string]: unknown;
};

/** User-defined middleware function type */
export type CMSMiddleware = (
  ctx: CMSMiddlewareContext,
) => Promise<MiddlewareResult> | MiddlewareResult;

// ============================================================================
// Revalidation
// ============================================================================

export type RevalidateEvent<
  TCollections extends Record<string, AnyCollectionDefinition> = Record<
    string,
    AnyCollectionDefinition
  >,
> = {
  action: CMSHookAction;
  collection: keyof TCollections & string;
  rootId: string;
  branchId: string;
  /**
   * The root's bare stored slug — a single last-path segment with NO leading
   * slash (e.g. `'blog'`, not `/blog` and not the full nested path). It is NOT
   * a URL and must not be used as a cache key / path: use `paths` for that.
   * Deliberately named `storedSlug` (not `slug`) so it can't be mistaken for a
   * path. `null` when the collection has no slug or none is resolved.
   */
  storedSlug: string | null;
  /**
   * The URL-shaped paths to revalidate. Every entry is a LEADING-SLASH path
   * (e.g. `/blog`, `/docs/a/c`) with the collection's slug-config root prefix
   * applied and, for nested collections, the full ancestor chain — plus any
   * OLD inbound-redirect source paths on a rename / reparent / archive.
   */
  paths: string[];
  /**
   * Next.js cache tags to revalidate alongside `paths`. Always
   * includes the affected root's tag (`rootRevalidateTag(rootId)`); the A/B
   * variant-coded render routes tag their getPublishedContent fetch with it, so
   * one `revalidateTag` invalidates a root's control + every variant cache entry
   * (and, via cascade, its hosts) on a content change. Consumed by
   * `createRevalidateHandler`.
   */
  tags?: string[];
};

export type RevalidateHandler<
  TCollections extends Record<string, AnyCollectionDefinition> = Record<
    string,
    AnyCollectionDefinition
  >,
> = (event: RevalidateEvent<TCollections>) => Promise<void> | void;

export type RevalidateConfig<
  TCollections extends Record<string, AnyCollectionDefinition> = Record<
    string,
    AnyCollectionDefinition
  >,
> = {
  handler: RevalidateHandler<TCollections>;
  pathPatterns?: {
    [K in keyof TCollections & string]?: (slug: string) => string[];
  };
  debug?: boolean;
};

// ============================================================================
// CMS Definition
// ============================================================================

export type CMSSchemaConfig = {
  output?: string;
};

// ============================================================================
// User Relation Config
// ============================================================================

export type CMSUserConfig<TTable extends AnyPgTable = AnyPgTable> = {
  table: TTable;
  idColumn: AnyColumn;
  /**
   * Allowlist of user-table columns that may ever be returned via the
   * `withUser` query flag. This is a hard security boundary: any column not
   * listed here is never exposed — not even when explicitly requested.
   * Required so that adding a sensitive column to the user table (password
   * hashes, tokens, internal flags) can never leak by default.
   */
  exposeColumns: (keyof TTable['$inferSelect'] & string)[];
};

/**
 * How `executeMerge` integrates a source branch when a fast-forward IS possible
 * (the target has not diverged from the common ancestor):
 * - `'fast-forward'` (default) — move the target head to the source head; no
 *   merge commit. The leanest history.
 * - `'merge-commit'` — always record an explicit merge commit (git's `--no-ff`),
 *   so every integration is visible in history.
 *
 * When the target HAS diverged a merge commit is always created regardless.
 */
export type MergeStrategy = 'fast-forward' | 'merge-commit';

export type CMSDefinition<
  TCollections extends Record<string, AnyCollectionDefinition> = Record<
    string,
    AnyCollectionDefinition
  >,
  TPlugins extends CMSPlugin[] = CMSPlugin[],
> = {
  db: DrizzleInstance;
  media: MediaConfig;
  collections: TCollections;
  dataRetention?: DataRetentionConfig;
  /**
   * When `true`, every content-mutating operation (createRoot / createBlock /
   * updateBlock / deleteBlock / moveBlock / duplicateBlock / updateBlocks /
   * updateRoot) requires a non-empty `message` — an empty or whitespace-only
   * message is rejected with `COMMIT_MESSAGE_REQUIRED` instead of falling back
   * to an auto-generated default. Off by default.
   */
  forceCommitMessage?: boolean;
  /** Name of the default branch every root is seeded with. Default `'main'`. */
  defaultBranchName?: string;
  /** Branch-protection and approval gates — see {@link BranchProtectionConfig}. */
  branchProtection?: BranchProtectionConfig;
  /**
   * Default integration strategy for `executeMerge` when a fast-forward is
   * possible. `'fast-forward'` (default) or `'merge-commit'` (always record a
   * merge commit). Override per call with `executeMerge({ noFastForward })`.
   * See {@link MergeStrategy}.
   */
  mergeStrategy?: MergeStrategy;
  /**
   * REQUIRED. Resolves the request identity for every API call — return at
   * least `{ userId }`. There is no implicit "no auth" default: pass a real
   * middleware, or pass `allowAnonymous()` to opt out explicitly (public /
   * read-only / local-dev only). See {@link CMSMiddleware}.
   */
  authMiddleware: CMSMiddleware;
  basePath?: string;
  hooks?: CMSHooks;
  plugins?: TPlugins;
  schema?: CMSSchemaConfig;
  user?: CMSUserConfig;
  onRevalidate?:
    | RevalidateHandler<TCollections>
    | RevalidateConfig<TCollections>;
  onNotification?: OnNotificationHandler;
  /**
   * Called for errors that reach the router: unexpected (non-`APIError`) throws,
   * schema-validation failures, and middleware/auth failures. Attach your own
   * logging/monitoring (Sentry, Datadog, …) here. Note: handler-thrown 4xx
   * `CMSError`s are converted to HTTP responses by better-call and do NOT reach
   * this hook. When set, it replaces the default `console.error`.
   */
  onAPIError?: (error: unknown, request: Request) => void;
  /**
   * Set `false` to fully disable the notifications feature: the tables are not
   * generated, the routes do not register or execute, and `client.notifications`
   * (plus `cms.notify`) are absent from the inferred types. Default: enabled.
   *
   * IMPORTANT: pass a LITERAL `false`. The type gate keys on the literal — a
   * widened `boolean` value keeps the types ENABLED even when it is `false` at
   * runtime, so `cms.notify(...)` / `client.notifications.*` would type-check but
   * throw or 404. Use `as const` (or a literal) if the value comes from a
   * variable.
   */
  notifications?: boolean;
  /**
   * Upstash realtime credentials. Optional; enables the shared `/realtime` SSE
   * route, per-user notification push, and A/B live results. Without it,
   * notifications fall back to the durable `list` poll.
   */
  realtime?: { url: string; token: string };
};

// CMSInstance is not explicitly typed -- createCMS return type is inferred by TypeScript.
// Use `typeof cms` or `ReturnType<typeof createCMS<...>>` for the instance type.

// ============================================================================
// Procedure Context Types
// ============================================================================

/** Base ctx injected by withCMSContext middleware. */
export type CMSProcedureContext = {
  db: DrizzleInstance;
  collections: Record<string, CollectionWithName>;
  dataRetention?: DataRetentionConfig;
  /** When `true`, commit-producing routes reject an empty `message`. */
  forceCommitMessage?: boolean;
  /** Name of the default branch (resolved; see {@link CMSDefinition.defaultBranchName}). */
  defaultBranchName?: string;
  /** Branch-protection and approval gates — see {@link BranchProtectionConfig}. */
  branchProtection?: BranchProtectionConfig;
  /** Default merge integration strategy — see {@link CMSDefinition.mergeStrategy}. */
  mergeStrategy?: MergeStrategy;
  scopeConditions?: ScopeConditionFactory[];
  notificationService?: import('../notifications/service').NotificationService;
  realtime?: import('../realtime/types').RealtimeRuntime;
  resolvedUser?: ResolvedUserConfig;
};

/**
 * Full ctx available in collection-scoped route handlers.
 * Built up through the middleware chain:
 *   withCMSContext → withCollection → withAction → withUserMiddleware
 */
export type CMSHandlerContext<
  TExtensions extends Record<string, unknown> = Record<string, unknown>,
> = CMSProcedureContext & {
  scope: 'collection';
  collection: CollectionWithName;
  permissionResource: string;
  operation: CMSOperation;
} & TExtensions;

export type CMSSystemHandlerContext<
  TExtensions extends Record<string, unknown> = Record<string, unknown>,
> = CMSProcedureContext & {
  scope: 'system';
  permissionResource: string;
  operation: CMSOperation;
} & TExtensions;

// ============================================================================
// Client visibility brand (type-only)
// ============================================================================

/**
 * Type-only phantom brand. `factory.ts`'s `EndpointCaller` intersects the
 * caller type of any endpoint whose better-call metadata carries
 * `scope: 'server'` with this type; `client/types.ts`'s `SerializeApi` then
 * omits keys assignable to it from the client's type surface, while the
 * server-side `cms.api` caller keeps the key (its callable signature is
 * untouched — this only adds an optional, never-set property to the type).
 *
 * Deliberately a plain literal-keyed object, NOT a `declare const ... unique
 * symbol` brand: a `unique symbol` computed key leaks into `createCMS`'s
 * inferred return type, and any consumer that re-exports a value derived from
 * it without an explicit return-type annotation (several `setup*TestCMS`
 * plugin test helpers do exactly this) fails to compile with TS4023
 * ("... has or is using name 'X' ... but cannot be named") because the symbol
 * can't be named across that module boundary. A literal string key has no
 * such restriction — it is structurally printable anywhere.
 */
export type ServerOnlyEndpoint = { readonly __cmsServerOnly__?: true };
