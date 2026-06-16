import type { Endpoint, Middleware } from 'better-call';

import type { SchemaModule } from '../db/types';
import type { OnNotificationHandler } from '../notifications/types';
import type {
  CMSProcedureCtx,
  CollectionWithName,
  DataRetentionConfig,
} from './definitions';
import type { DrizzleInstance } from './drizzle';

type Awaitable<T> = T | Promise<T>;

// ============================================================================
// Hook Actions & Context
// ============================================================================

/**
 * Endpoint key used as a hook action identifier.
 * Accepts any string so internal plumbing doesn't need the full union,
 * but the exported `CMSEndpointKey` (from `index.ts`) provides a narrowed
 * union with autocomplete for hook authors.
 */
export type CMSHookAction = string & {};

export type CMSBeforeHookContext = {
  action: CMSHookAction;
  collection: string;
  db: DrizzleInstance;
  input: Record<string, unknown>;
  /**
   * The resolved per-request scope (tenant/i18n), available to before-hooks so
   * they can tenant-scope any cross-resource reads they perform. Set by the
   * endpoint wrapper before hooks run; may be undefined for hooks invoked
   * outside that path.
   */
  scope?: import('./definitions').ResolvedScope;
};

export type CMSAfterHookContext = CMSBeforeHookContext & {
  result: unknown;
};

export type CMSBeforeHook = {
  action: CMSHookAction | '*';
  collection?: string;
  handler: (
    ctx: CMSBeforeHookContext,
  ) => Promise<void | { override?: Record<string, unknown> }>;
};

export type CMSAfterHook = {
  action: CMSHookAction | '*';
  collection?: string;
  handler: (ctx: CMSAfterHookContext) => Promise<void | { response: unknown }>;
};

// ============================================================================
// Inline Hooks (for createCMS config, without writing a plugin)
// ============================================================================

export type CMSHooks = {
  before?: CMSBeforeHook[];
  after?: CMSAfterHook[];
};

// ============================================================================
// Plugin Definition
// ============================================================================

export type CMSPluginContext = CMSProcedureCtx & {
  collections: Record<string, CollectionWithName>;
};

export type CMSCoreRootPruningPlan = {
  rootId: string;
  deletableCommitIds: string[];
  deletableBlockVersionIds: string[];
  deletableSnapshotCount: number;
  deletableMergeRequestIds: string[];
  deletableApprovalIds: string[];
  initialCommitId: string;
};

export type CMSPluginPruningMetrics = Record<string, number>;

export type CMSPluginRootPruningPlan<TData = unknown> = {
  rootId: string;
  data?: TData;
  metrics?: CMSPluginPruningMetrics;
};

export type CMSPluginPruningPlanContext = Omit<
  CMSPluginContext,
  'dataRetention'
> & {
  db: DrizzleInstance;
  dataRetention: DataRetentionConfig;
  rootPlan: CMSCoreRootPruningPlan;
};

export type CMSPluginPruningExecuteContext<TData = unknown> = Omit<
  CMSPluginContext,
  'db' | 'dataRetention'
> & {
  tx: DrizzleInstance;
  dataRetention: DataRetentionConfig;
  rootPlan: CMSCoreRootPruningPlan;
  pluginPlan: CMSPluginRootPruningPlan<TData>;
};

export type CMSPluginPruningExecuteResult = {
  metrics?: CMSPluginPruningMetrics;
};

export type CMSPluginPruning<TData = unknown> = {
  plan: (
    ctx: CMSPluginPruningPlanContext,
  ) => Promise<CMSPluginRootPruningPlan<TData> | null>;
  execute?: (
    ctx: CMSPluginPruningExecuteContext<TData>,
  ) => Promise<CMSPluginPruningExecuteResult | void>;
};

export type CMSPluginInitOptions = {
  hooks?: CMSHooks;
};

export type CMSPluginInitResult = {
  context?: Record<string, unknown>;
  options?: Partial<CMSPluginInitOptions>;
};

/**
 * A CMS plugin can extend the system with custom endpoints, hooks,
 * middleware, database tables, and data-retention pruning logic.
 *
 * @example
 * ```ts
 * const myPlugin: CMSPlugin = {
 *   id: 'my-plugin',
 *   endpoints: { ... },
 *   hooks: { before: [...], after: [...] },
 *   async init(ctx) { return { context: { myService } }; },
 * };
 * ```
 */
export type CMSPlugin<TPruningData = unknown> = {
  id: string;

  endpoints?: Record<string, Endpoint>;

  /**
   * Per-COLLECTION endpoints contributed by the plugin: called once per
   * collection during API assembly, returning routes merged into THAT
   * collection's endpoint record (so they surface at `cms.api.<collection>.x`,
   * not the flat `cms.api.<pluginId>.x`). The per-collection analogue of the
   * flat `endpoints` above. Generic — any plugin can attach a route to every
   * collection (the i18n plugin uses it for createTranslation / listTranslations).
   * (Seam A.)
   */
  collectionEndpoints?: (
    def: CollectionWithName,
    ctx: CMSPluginContext,
  ) => Record<string, Endpoint>;

  hooks?: {
    before?: CMSBeforeHook[];
    after?: CMSAfterHook[];
  };

  middlewares?: {
    path: string;
    middleware: Middleware;
  }[];

  schema?: SchemaModule;
  pruning?: CMSPluginPruning<TPruningData>;

  init?: (ctx: CMSPluginContext) => Awaitable<CMSPluginInitResult | void>;

  onRequest?: (
    request: Request,
    ctx: CMSPluginContext,
  ) => Promise<{ response: Response } | { request: Request } | void>;

  onResponse?: (
    response: Response,
    ctx: CMSPluginContext,
  ) => Promise<{ response: Response } | void>;

  onNotification?: OnNotificationHandler;

  $ERROR_CODES?: Record<string, { status: number; message: string }>;
};

// ============================================================================
// Endpoint Context (injected by toCMSEndpoints wrapper)
// ============================================================================

export type CMSEndpointContext = {
  db: import('./drizzle').DrizzleInstance;
  userId?: string;
  collection: string;
  scope: import('./definitions').ResolvedScope;
  withUser?: true | Record<string, true>;
  userConfig?: import('../user/resolve').ResolvedUserConfig;
};

// ============================================================================
// Type Inference Utilities
// ============================================================================

type UnionToIntersection<U> = (
  U extends unknown ? (k: U) => void : never
) extends (k: infer I) => void
  ? I
  : never;

export type InferPluginEndpoints<P extends CMSPlugin[]> = UnionToIntersection<
  P[number]['endpoints'] extends infer E
    ? E extends Record<string, Endpoint>
      ? E
      : Record<string, never>
    : Record<string, never>
>;

/**
 * The per-collection endpoints plugins contribute to EVERY collection — the
 * RETURN type of each plugin's `collectionEndpoints`, intersected across all
 * plugins. A plugin without `collectionEndpoints` contributes `{}`, so the
 * no-plugin case is IDENTITY under intersection (a collection's API is
 * unchanged). `cms.api.<collection>` gains these keys (e.g. createTranslation)
 * only when a contributing plugin (the i18n plugin) is installed. (Seam A / D1.)
 */
export type InferCollectionEndpoints<P extends CMSPlugin[]> =
  UnionToIntersection<
    P[number] extends infer Plug
      ? Plug extends { collectionEndpoints: (...args: any[]) => infer R }
        ? R extends Record<string, Endpoint>
          ? R
          : {}
        : {}
      : {}
  >;

export type InferPluginNamespaces<P extends CMSPlugin[]> = {
  [K in P[number] as K extends {
    id: infer I extends string;
    endpoints: Record<string, Endpoint>;
  }
    ? I
    : never]: K extends { endpoints: infer E extends Record<string, Endpoint> }
    ? E
    : never;
};

export type InferPluginErrorCodes<P extends CMSPlugin[]> = UnionToIntersection<
  P[number] extends infer Plug
    ? Plug extends CMSPlugin
      ? Plug['$ERROR_CODES'] extends Record<string, any>
        ? Plug['$ERROR_CODES']
        : {}
      : {}
    : {}
>;

export type InferPluginContext<P extends CMSPlugin[]> = UnionToIntersection<
  P[number] extends infer Plug
    ? Plug extends CMSPlugin
      ? Plug['init'] extends (...args: any[]) => infer R
        ? Awaited<R> extends { context?: infer C }
          ? C extends Record<string, unknown>
            ? Omit<C, keyof CMSPluginContext>
            : {}
          : {}
        : {}
      : {}
    : {}
>;
