import type { AnyPgTable } from 'drizzle-orm/pg-core';

import { createRouter, type Endpoint } from 'better-call';

import type {
  NotificationInput,
  OnNotificationHandler,
} from './notifications/types';
import type {
  AnyBlockDefinition,
  AnyCollectionDefinition,
  CMSDefinition,
  CMSMiddleware,
  CMSProcedureCtx,
  CMSUserConfig,
  CollectionWithName,
} from './types';
import type {
  CMSAfterHook,
  CMSBeforeHook,
  CMSPlugin,
  CMSPluginContext,
  InferCollectionEndpoints,
  InferPluginEndpoints,
  InferPluginErrorCodes,
  InferPluginNamespaces,
  InferPluginNotificationMeta,
} from './types/plugin';

import { DEFAULT_BRANCH_NAME } from './branch-policy';
import { CMS_ERRORS } from './errors-data';
import {
  createCMSContext,
  processCollections,
  resolveAuthMiddleware,
  runPluginInit,
} from './context';
import { toCMSEndpoints } from './endpoint';
import { createHookRunner } from './hooks';
import { makeNotificationPublishHandler } from './notifications/realtime';
import { createNotificationService } from './notifications/service';
import { createRealtimeRouteHandler } from './realtime/sse';
import { createRealtimeRuntime } from './realtime/upstash';
import {
  createRevalidationRunner,
  normalizeRevalidateConfig,
} from './revalidation';
import { flattenEndpoints } from './router';
import { createAdminEndpoints } from './routes/admin';
import { createCollectionEndpoints } from './routes/collection';
import { createMediaEndpoints } from './routes/media';
import { createNotificationEndpoints } from './routes/notifications';
import { createSearchEndpoints } from './routes/search';
import { createTemplateEndpoints } from './routes/templates';
import { createVariableEndpoints } from './routes/variables';
import { createSearchHooks } from './search/hooks';
import { resolveUserConfig } from './user/resolve';

// ---------------------------------------------------------------------------
// Derived union of all endpoint keys — provides autocomplete for hook authors.
// ---------------------------------------------------------------------------

type EndpointKeysOf<T> = T extends (...args: any[]) => infer R
  ? keyof Awaited<R> & string
  : never;

// Literal endpoint keys contributed by the configured plugins. When the plugin
// list is the loose default (`keyof` collapses to `string`), contribute nothing
// so the union stays a narrow literal set (and `CMSEndpointKey` without a plugin
// arg is byte-identical to the core-only union).
type PluginEndpointKey<TPlugins extends CMSPlugin[]> =
  keyof InferPluginEndpoints<TPlugins> extends infer K
    ? string extends K
      ? never
      : K & string
    : never;

/**
 * Union of every endpoint key — core endpoints plus the endpoints contributed by
 * the configured plugins (`TPlugins`). Drives `action` autocomplete for hook
 * authors. Use without a type arg for just the core keys.
 */
// createCollectionEndpoints is generic over the collection definition, so
// `EndpointKeysOf<typeof createCollectionEndpoints>` can't resolve its keys
// (they collapse to never). Instantiate it with a concrete collection — the
// top-level operation keys (createRoot, createBlock, …) don't depend on the
// specific collection — and read keyof the return.
type CollectionEndpointKey = keyof ReturnType<
  typeof createCollectionEndpoints<
    CollectionWithName & { blocks: Record<string, AnyBlockDefinition> }
  >
> &
  string;

export type CMSEndpointKey<TPlugins extends CMSPlugin[] = []> =
  | CollectionEndpointKey
  | EndpointKeysOf<typeof createAdminEndpoints>
  | EndpointKeysOf<typeof createMediaEndpoints>
  | EndpointKeysOf<typeof createVariableEndpoints>
  | EndpointKeysOf<typeof createTemplateEndpoints>
  | EndpointKeysOf<typeof createNotificationEndpoints>
  | EndpointKeysOf<typeof createSearchEndpoints>
  | PluginEndpointKey<TPlugins>;

// Config-hook types whose `action` is the closed union of core + plugin endpoint
// keys (plus `'*'`). Pre-1.0 (ts-09) we dropped the `(string & {})` escape hatch:
// a misspelled action is now a compile error at `createCMS({ hooks })` instead of
// silently never firing. These narrow the loose CMSBeforeHook/CMSAfterHook used
// for standalone plugin authoring.
type CMSConfigBeforeHook<TPlugins extends CMSPlugin[]> = Omit<
  CMSBeforeHook,
  'action'
> & { action: CMSEndpointKey<TPlugins> | '*' };

type CMSConfigAfterHook<TPlugins extends CMSPlugin[]> = Omit<
  CMSAfterHook,
  'action'
> & { action: CMSEndpointKey<TPlugins> | '*' };

/** Inline `createCMS({ hooks })` config, plugin-endpoint-aware for autocomplete. */
export type CMSConfigHooks<TPlugins extends CMSPlugin[] = []> = {
  before?: CMSConfigBeforeHook<TPlugins>[];
  after?: CMSConfigAfterHook<TPlugins>[];
};

type RequiredKeys<T> = T extends object
  ? {
      [K in keyof T]-?: {} extends Pick<T, K> ? never : K;
    }[keyof T]
  : never;

type HasRequiredKeys<T> = [NonNullable<T>] extends [never]
  ? false
  : [RequiredKeys<NonNullable<T>>] extends [never]
    ? false
    : true;

type OptionalizeEndpointOptions<Body, Query> = (undefined extends Body
  ? { body?: Body }
  : HasRequiredKeys<Body> extends true
    ? { body: Body }
    : { body?: Body }) &
  (undefined extends Query
    ? { query?: Query }
    : HasRequiredKeys<Query> extends true
      ? { query: Query }
      : { query?: Query });

type AreEndpointOptionsOptional<Body, Query> = undefined extends Body
  ? undefined extends Query
    ? true
    : HasRequiredKeys<Query> extends true
      ? false
      : true
  : HasRequiredKeys<Body> extends true
    ? false
    : undefined extends Query
      ? true
      : HasRequiredKeys<Query> extends true
        ? false
        : true;

// Transport-level options every caller accepts in addition to body/query. The
// wrapper (endpoint.ts) already forwards `headers` (into middleware's reqCtx)
// and `context` (merged into the endpoint ctx). NB: middleware-resolved userId
// wins over `context.userId`; headers is the reliable identity channel.
type EndpointCallerExtras = {
  headers?: HeadersInit;
  context?: { userId?: string } & Record<string, unknown>;
};

type EndpointCaller<E> =
  E extends Endpoint<any, any, infer Body, infer Query, any, infer R, any, any>
    ? AreEndpointOptionsOptional<Body, Query> extends true
      ? (
          opts?: OptionalizeEndpointOptions<Body, Query> & EndpointCallerExtras,
        ) => Promise<Awaited<R>>
      : (
          opts: OptionalizeEndpointOptions<Body, Query> & EndpointCallerExtras,
        ) => Promise<Awaited<R>>
    : never;

type ServerApiCallers<T> = {
  [NS in keyof T]: {
    [K in keyof T[NS]]: EndpointCaller<T[NS][K]>;
  };
};

// ---------------------------------------------------------------------------
// WithUser type augmentation for read endpoints
// ---------------------------------------------------------------------------

type WithUserQuery<TTable extends AnyPgTable> =
  | true
  | Partial<Record<keyof TTable['$inferSelect'], true>>;

type UserEnrichableEndpoints =
  | 'listRoots'
  | 'listBranches'
  | 'getBranch'
  | 'getRootHistory'
  | 'listMergeRequests'
  | 'listCommentThreads'
  | 'getCommentThread'
  | 'listApprovals'
  | 'getApproval'
  | 'listPublications';
// NB: `notifications.list` is intentionally NOT here — its `withUser` input flag
// is added namespace-scoped in `WithActorUserApi` below, because `list` is a
// non-unique key (templates.list / variables.list) and this union matches keys
// across ALL namespaces.

type AddWithUser<TFn, TTable extends AnyPgTable> = TFn extends (
  opts?: infer O,
) => infer R
  ? (
      opts?: (O | undefined) & { query?: { withUser?: WithUserQuery<TTable> } },
    ) => R
  : TFn extends (opts: infer O) => infer R
    ? (opts: O & { query?: { withUser?: WithUserQuery<TTable> } }) => R
    : TFn;

type WithUserApi<T, TTable extends AnyPgTable> = {
  [NS in keyof T]: {
    // For every enrichable endpoint (unique keys), add the `withUser` INPUT flag;
    // the OUTPUT rewrite (InjectUserField) additionally types `createdByUser`/
    // `actorUser` off the user table on the results that DECLARE those fields
    // (the typed list-item shapes) — see InjectUserField.
    [K in keyof T[NS]]: K extends UserEnrichableEndpoints
      ? AddWithUser<T[NS][K], TTable> extends (...args: infer A) => infer R
        ? (
            ...args: A
          ) => R extends Promise<infer RR>
            ? Promise<InjectUserField<RR, TTable>>
            : InjectUserField<R, TTable>
        : AddWithUser<T[NS][K], TTable>
      : T[NS][K];
  };
};

// The actor-user object on an enriched row: a PARTIAL of the user table's row.
// This is a deliberate SAFE UPPER BOUND (ts-11): `exposeColumns` is a runtime
// allowlist typed only as `string[]`, and narrowing `actorUser` to exactly the
// exposed columns would require capturing `exposeColumns` as a `const` literal
// tuple threaded through `CMSUserConfig` — which is invariant in its table param,
// so the tuple can't flow to this call site without a bespoke helper generic.
// Every non-exposed column is therefore typed as optionally-present (never
// wrongly required); the runtime filter in user/resolve.ts is the source of truth.
type ActorUserShape<TTable extends AnyPgTable> = Partial<TTable['$inferSelect']>;

// Rewrite a `withUser`-enriched RESULT: wherever a `createdByUser` / `actorUser`
// field is DECLARED on a result type, type it off the user table instead of
// leaving it `unknown` (ts-06). Recurses through arrays/objects; a result whose
// type doesn't declare those fields is returned unchanged. NB: this keys on the
// literal field names, so it only fires on endpoints with a STRUCTURED result
// that names them (listRoots/listBranches/listMergeRequests items, and
// notifications.list) — the single-item GETs (getBranch/getApproval) currently
// return a loose `Record<string, unknown>`, so their `createdByUser` stays
// `unknown` until they gain a structured return type. (Enrichable endpoints never
// return a block tree, so this doesn't recurse into recursive content types.)
type InjectUserField<T, TTable extends AnyPgTable> = T extends Date
  ? T
  : // eslint-disable-next-line @typescript-eslint/no-explicit-any
    T extends (...args: any[]) => any
    ? T
    : T extends Array<infer U>
      ? InjectUserField<U, TTable>[]
      : T extends ReadonlyArray<infer U>
        ? ReadonlyArray<InjectUserField<U, TTable>>
        : T extends object
          ? {
              [K in keyof T]: K extends 'createdByUser' | 'actorUser'
                ? ActorUserShape<TTable> | null
                : InjectUserField<T[K], TTable>;
            }
          : T;

// Type the OUTPUT of `notifications.list` (WithUserApi only types
// the input flag). Leaves every other endpoint untouched.
type WithActorUserApi<T, TTable extends AnyPgTable> = T extends {
  notifications: infer NS;
}
  ? Omit<T, 'notifications'> & {
      notifications: {
        // `list` gets BOTH the `withUser` INPUT flag (via AddWithUser) and the
        // `actorUser` OUTPUT rewrite, scoped to the notifications namespace so a
        // same-named `templates.list`/`variables.list` is never touched.
        [K in keyof NS]: K extends 'list'
          ? AddWithUser<NS[K], TTable> extends (...args: infer A) => infer R
            ? (
                ...args: A
              ) => R extends Promise<infer RR>
                ? Promise<InjectUserField<RR, TTable>>
                : R
            : NS[K]
          : NS[K];
      };
    }
  : T;

type CMSDefinitionDataKeys =
  | 'db'
  | 'media'
  | 'collections'
  | 'dataRetention'
  | 'plugins'
  | 'schema'
  | 'basePath'
  | 'user'
  // Picked from TDef so the literal `notifications: false` survives inference
  // (a widened `boolean` would not gate the type) and `realtime` is captured.
  | 'notifications'
  | 'realtime';

type HasRevalidate<T> = T extends { onRevalidate: infer R }
  ? R extends undefined
    ? false
    : true
  : false;

// Default-enabled: only a literal `notifications: false` in TDef disables the
// feature. Drives whether `cms.api.notifications` / `cms.notify` exist in the
// inferred type (mirrors HasRevalidate's value-or-undefined gating, applied to
// member presence instead).
type NotificationsEnabled<T> = T extends { notifications: false } ? false : true;

type InferCollectionApis<
  TCollections extends Record<string, AnyCollectionDefinition>,
  TPlugins extends CMSPlugin[] = [],
> = {
  [K in keyof TCollections]: ReturnType<
    typeof createCollectionEndpoints<
      Omit<TCollections[K], 'blocks'> & {
        name: string;
        blocks: NonNullable<TCollections[K]['blocks']> extends never
          ? Record<string, AnyBlockDefinition>
          : NonNullable<TCollections[K]['blocks']>;
      },
      // Thread the full collections map so getPublishedContent resolves a
      // reference's `properties` to the target collection's typed root (RB6②).
      TCollections
    >
  > &
    // Per-collection endpoints contributed by installed plugins (e.g. the i18n
    // plugin's createTranslation/listTranslations). Empty intersection when no
    // plugin contributes — so a collection's API only gains these with the
    // plugin installed. (Seam A / D1.)
    InferCollectionEndpoints<TPlugins>;
};

function checkEndpointConflicts(endpoints: Record<string, Endpoint>) {
  // registry: path → list of { source, methods } across the ENTIRE surface
  // (core + collection + plugin), so a plugin path shadowing a core/collection
  // path is caught, not just plugin↔plugin.
  const registry = new Map<string, { source: string; methods: string[] }[]>();

  for (const [source, endpoint] of Object.entries(endpoints)) {
    const ep = endpoint as unknown as {
      path?: unknown;
      options?: { method?: unknown };
    };
    if (typeof ep.path !== 'string') continue;
    const path = ep.path;
    let methods: string[] = [];
    const m = ep.options?.method;
    if (m !== undefined)
      methods = Array.isArray(m) ? (m as string[]) : [m as string];
    if (methods.length === 0) methods = ['*'];

    if (!registry.has(path)) registry.set(path, []);
    registry.get(path)!.push({ source, methods });
  }

  const conflicts: string[] = [];
  for (const [path, entries] of registry) {
    if (entries.length <= 1) continue;
    const methodMap = new Map<string, string[]>();
    for (const entry of entries) {
      for (const method of entry.methods) {
        if (!methodMap.has(method)) methodMap.set(method, []);
        methodMap.get(method)!.push(entry.source);
      }
    }
    for (const [method, sources] of methodMap) {
      // A real conflict is two+ sources on the same method, OR a wildcard
      // sharing the path with ANY other entry (it matches every method).
      const wildcardClash = method === '*' && entries.length > 1;
      if (sources.length > 1 || wildcardClash) {
        conflicts.push(
          `"${path}" [${method}] registered by: ${[...new Set(sources)].join(', ')}`,
        );
      }
    }
  }

  if (conflicts.length > 0) {
    throw new Error(
      `[cms] Endpoint path conflict(s) detected — each path+method must be unique:\n` +
        conflicts.map((c) => `  - ${c}`).join('\n'),
    );
  }
}

// A plugin id is used as an object key AND as the leading URL segment for every
// one of its endpoints, so it must be a valid JS identifier (no dots, slashes,
// spaces, leading digits) to keep `cms.api.<id>.<method>` and `/<id>/<method>`
// well-formed.
const VALID_JS_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function validatePluginPaths(plugins: CMSPlugin[]) {
  for (const plugin of plugins) {
    if (!VALID_JS_IDENTIFIER.test(plugin.id)) {
      throw new Error(
        `[cms] Plugin id "${plugin.id}" is not a valid JS identifier. ` +
          `It is used as an api namespace and URL segment — use letters, digits, ` +
          `_ or $, not starting with a digit.`,
      );
    }
    if (!plugin.endpoints) continue;
    const prefix = `/${plugin.id}/`;
    for (const [key, endpoint] of Object.entries(plugin.endpoints)) {
      const path = (endpoint as { path?: unknown })?.path;
      if (typeof path !== 'string' || !path.startsWith(prefix)) {
        throw new Error(
          `[cms] Plugin "${plugin.id}" endpoint "${key}" has path ` +
            `${JSON.stringify(path)} but must start with "${prefix}" ` +
            `(the /<pluginId>/<method> convention the client proxy and router rely on).`,
        );
      }
    }
  }
}

function validateCollectionNames(
  collections: Record<string, AnyCollectionDefinition>,
  plugins: CMSPlugin[],
) {
  // The six static rawApi keys (factory.ts rawApi literal) + the mounted
  // `${basePath}/realtime` route, PLUS the static client-transport keys that
  // occupy the client proxy target (`$fetch`, `$store`, `$ERROR_CODES`) — a
  // collection with one of those names would be silently shadowed on the client
  // (`client.$fetch.createRoot` is `undefined`), so reject it here at boot.
  const RESERVED_NAMESPACES = new Set([
    'admin',
    'media',
    'variables',
    'templates',
    'search',
    'notifications',
    'realtime',
    '$fetch',
    '$store',
    '$ERROR_CODES',
  ]);
  const pluginIds = new Set(plugins.map((p) => p.id));

  for (const name of Object.keys(collections)) {
    if (RESERVED_NAMESPACES.has(name)) {
      throw new Error(
        `[cms] Collection "${name}" collides with a reserved system namespace ` +
          `(${[...RESERVED_NAMESPACES].join(', ')}). Rename the collection.`,
      );
    }
    if (pluginIds.has(name)) {
      throw new Error(
        `[cms] Collection "${name}" collides with the id of an installed plugin. ` +
          `A plugin namespace and a collection cannot share a name — rename one.`,
      );
    }
    // A collection name is BOTH a URL segment (`/${name}/createRoot`) and a
    // dot-accessed namespace (`cms.api.${name}`, `client.${name}`), so it must
    // be a valid JS identifier: camelCase (`blogPosts`) is fine, but kebab-case
    // (`blog-posts`) is rejected because it would break the dot access.
    if (!VALID_JS_IDENTIFIER.test(name)) {
      throw new Error(
        `[cms] Collection name "${name}" is not a valid identifier. It is used ` +
          `as an api namespace and URL segment — use letters, digits, _ or $, ` +
          `not starting with a digit (e.g. "blogPosts", not "blog-posts").`,
      );
    }
  }
}

function mergeErrorCodes<TPlugins extends CMSPlugin[]>(
  plugins: TPlugins,
): typeof CMS_ERRORS & InferPluginErrorCodes<TPlugins> {
  // Seed with the core codes so `cms.$ERROR_CODES` is the COMPLETE registry (not
  // plugin-only) — mirrors the client's `$ERROR_CODES` (err-02). Warn on
  // collisions instead of silently letting the last writer win (err-16).
  const acc: Record<string, { status: number; message: string }> = {
    ...CMS_ERRORS,
  };
  for (const plugin of plugins) {
    if (!plugin.$ERROR_CODES) continue;
    for (const key of Object.keys(plugin.$ERROR_CODES)) {
      if (key in acc) {
        console.warn(
          `[cms] plugin "${plugin.id}" error code "${key}" shadows an existing ` +
            `${key in CMS_ERRORS ? 'core' : 'plugin'} code`,
        );
      }
    }
    Object.assign(acc, plugin.$ERROR_CODES);
  }
  return acc as typeof CMS_ERRORS & InferPluginErrorCodes<TPlugins>;
}

function validateCollectionReferences(
  collections: Record<string, AnyCollectionDefinition>,
) {
  for (const [collName, collDef] of Object.entries(collections)) {
    const allProps: {
      block: string;
      prop: string;
      spec: { type: string; collection?: string };
    }[] = [];

    for (const [key, spec] of Object.entries(collDef.root.properties)) {
      allProps.push({ block: 'root', prop: key, spec });
    }

    if (collDef.blocks) {
      for (const [blockName, blockDef] of Object.entries(collDef.blocks)) {
        for (const [key, spec] of Object.entries(blockDef.properties)) {
          allProps.push({ block: blockName, prop: key, spec });
        }
      }
    }

    for (const { block, prop, spec } of allProps) {
      if (
        spec.type === 'reference' &&
        !(spec as { collection?: string }).collection
      ) {
        throw new Error(
          `[cms] Invalid reference: ${collName}.${block}.${prop} has type 'reference' but no 'collection' specified.`,
        );
      }
      if (
        spec.type === 'reference' &&
        !collections[(spec as { collection: string }).collection]
      ) {
        throw new Error(
          `[cms] Invalid reference: ${collName}.${block}.${prop} references collection '${(spec as { collection: string }).collection}' which does not exist.`,
        );
      }
    }
  }
}

/**
 * Creates a fully configured CMS instance with type-safe collections,
 * plugin support, and an HTTP router.
 *
 * @returns An object with `router` (HTTP handler), `api` (server-side callers),
 *          `collections`, `plugins`, and optional `revalidate` trigger.
 *
 * @example
 * ```ts
 * import { createCMS, defineCollections } from '@createcms/core';
 *
 * export const cms = createCMS({
 *   db,
 *   collections: defineCollections({ pages, posts }),
 *   media: { bucket, baseUrl },
 *   authMiddleware,
 * });
 * ```
 */
type RevalidateFn<TCollectionKeys extends string = string> = (opts: {
  collection: TCollectionKeys;
  rootId: string;
  branchId: string;
}) => Promise<void>;

export const createCMS = <
  const TCollections extends Record<string, AnyCollectionDefinition> = Record<
    string,
    AnyCollectionDefinition
  >,
  const TPlugins extends CMSPlugin[] = CMSPlugin[],
  const TDef extends CMSDefinition<TCollections, TPlugins> = CMSDefinition<
    TCollections,
    TPlugins
  >,
>(
  definition: Pick<TDef, CMSDefinitionDataKeys & keyof TDef> &
    Omit<CMSDefinition<TCollections, TPlugins>, 'hooks'> & {
      hooks?: CMSConfigHooks<TPlugins>;
    },
) => {
  const plugins = (definition.plugins ?? []) as TPlugins;
  const authMiddleware = resolveAuthMiddleware(
    definition.authMiddleware,
    definition.middleware,
  );

  validateCollectionReferences(definition.collections);
  validateCollectionNames(definition.collections, plugins);

  const collections = processCollections(definition.collections) as {
    [K in keyof TCollections]: TCollections[K] & { name: string };
  };

  const cmsContext: CMSProcedureCtx = createCMSContext({
    db: definition.db,
    collections: collections as Record<string, CollectionWithName>,
    dataRetention: definition.dataRetention,
    forceCommitMessage: definition.forceCommitMessage,
    defaultBranchName: definition.defaultBranchName,
    branchProtection: definition.branchProtection,
    mergeStrategy: definition.mergeStrategy,
  });

  if (definition.user) {
    cmsContext.resolvedUser = resolveUserConfig(definition.user);
  }

  const pluginContext: CMSPluginContext = {
    ...cmsContext,
    collections: cmsContext.collections,
    scopeConditions: [],
  };

  let initPromise: Promise<void> | null = null;

  /**
   * Runs plugin init exactly once on success. Concurrent callers share the
   * single in-flight promise, so init is serialized — at most one runs at a
   * time. A failed init clears the promise so the next request retries; a
   * transient boot failure therefore never permanently bricks the instance,
   * and because init is serialized a persistently-failing plugin cannot be
   * hammered by concurrent requests.
   */
  function ensureInit(): Promise<void> {
    if (initPromise) return initPromise;
    initPromise = runPluginInit(pluginContext, plugins)
      .then(({ extraBeforeHooks, extraAfterHooks }) => {
        beforeHooks.push(...extraBeforeHooks);
        afterHooks.push(...extraAfterHooks);
      })
      .catch((err) => {
        console.error(
          '[cms] plugin init failed; will retry on the next request:',
          err,
        );
        initPromise = null;
        throw err;
      });
    return initPromise;
  }

  // Validate plugin ids + endpoint path convention before endpoints are built.
  // Whole-surface conflict detection runs later, once flatEndpoints exists.
  validatePluginPaths(plugins);

  // Merge config hooks + plugin hooks + search hooks (config hooks run first)
  const searchHooks = createSearchHooks(
    definition.defaultBranchName ?? DEFAULT_BRANCH_NAME,
  );
  const beforeHooks = [
    ...(definition.hooks?.before ?? []),
    ...plugins.flatMap((p) => p.hooks?.before ?? []),
  ];
  const afterHooks = [
    ...(definition.hooks?.after ?? []),
    ...plugins.flatMap((p) => p.hooks?.after ?? []),
    ...searchHooks,
  ];
  const hookRunner = createHookRunner(beforeHooks, afterHooks);

  // Build raw endpoints (no middleware/hooks — toCMSEndpoints handles that)
  type DefCollections = TDef['collections'];
  type DefPlugins = NonNullable<TDef['plugins']>;

  const collectionApis = Object.fromEntries(
    Object.entries(collections).map(([name, def]) => {
      const endpoints: Record<string, Endpoint> = createCollectionEndpoints(
        def as CollectionWithName,
        cmsContext,
      );
      // Seam A: merge each plugin's per-collection endpoints into THIS
      // collection's record, so they surface at cms.api.<collection>.x only
      // when the plugin is installed (the i18n plugin's createTranslation /
      // listTranslations). Generic — core names no plugin concept.
      for (const plugin of plugins) {
        if (!plugin.collectionEndpoints) continue;
        Object.assign(
          endpoints,
          plugin.collectionEndpoints(def as CollectionWithName, pluginContext),
        );
      }
      return [name, endpoints];
    }),
  ) as unknown as InferCollectionApis<DefCollections, DefPlugins>;

  const adminEndpoints = createAdminEndpoints(
    cmsContext,
    plugins,
    definition.media,
  );

  const mediaEndpoints = createMediaEndpoints(cmsContext, definition.media);

  const revalidateConfig = normalizeRevalidateConfig(definition.onRevalidate);
  const revalidationRunner = revalidateConfig
    ? createRevalidationRunner(
        definition.db,
        revalidateConfig,
        cmsContext.collections,
      )
    : null;

  const variableEndpoints = createVariableEndpoints(
    cmsContext,
    revalidationRunner,
  );
  const templateEndpoints = createTemplateEndpoints(cmsContext);
  const searchEndpoints = createSearchEndpoints(cmsContext);

  // `notifications: false` fully disables the feature (no service, no routes, no
  // types). Default enabled. Independent of `realtime`.
  const notificationsEnabled = definition.notifications !== false;

  // Resolve the Upstash realtime runtime (undefined when not configured). ONE
  // shared runtime backs the /realtime route, notification push, and A/B live.
  const realtime = definition.realtime
    ? createRealtimeRuntime(definition.realtime)
    : undefined;
  cmsContext.realtime = realtime;

  const notificationHandlers: OnNotificationHandler[] = notificationsEnabled
    ? [
        // Push every notification to its recipient's private realtime channel
        // when realtime is configured. First because it is the latency-sensitive,
        // best-effort handler — user/plugin handlers must not delay the live push.
        ...(realtime ? [makeNotificationPublishHandler(realtime)] : []),
        ...(definition.onNotification ? [definition.onNotification] : []),
        ...plugins
          .map((p) => p.onNotification)
          .filter((h): h is OnNotificationHandler => !!h),
      ]
    : [];
  const notificationService = notificationsEnabled
    ? createNotificationService(
        definition.db,
        notificationHandlers,
        cmsContext.resolvedUser,
      )
    : undefined;
  cmsContext.notificationService = notificationService;

  // The shared `/realtime` SSE handler — authenticates each connection and
  // authorizes its channels before any subscription. Gated on `realtime` ALONE
  // (A/B live needs it even when notifications are disabled).
  const realtimeRoute = realtime
    ? createRealtimeRouteHandler({
        transport: realtime,
        path: `${definition.basePath ?? '/api/cms'}/realtime`,
        cmsCtx: cmsContext,
        authMiddleware,
      })
    : null;

  const notificationEndpoints = notificationsEnabled
    ? createNotificationEndpoints(cmsContext)
    : undefined;

  const pluginApis = Object.fromEntries(
    plugins
      .filter(
        (
          plugin,
        ): plugin is typeof plugin & { endpoints: Record<string, Endpoint> } =>
          !!plugin.endpoints,
      )
      .map((plugin) => [plugin.id, plugin.endpoints]),
  ) as InferPluginNamespaces<TPlugins>;

  type RawApi = InferCollectionApis<DefCollections, DefPlugins> & {
    admin: typeof adminEndpoints;
    media: typeof mediaEndpoints;
    variables: typeof variableEndpoints;
    templates: typeof templateEndpoints;
    search: typeof searchEndpoints;
  } & (NotificationsEnabled<TDef> extends true
      ? { notifications: NonNullable<typeof notificationEndpoints> }
      : Record<never, never>) &
    InferPluginNamespaces<DefPlugins & CMSPlugin[]>;

  const rawApi: RawApi = {
    ...collectionApis,
    admin: adminEndpoints,
    media: mediaEndpoints,
    variables: variableEndpoints,
    templates: templateEndpoints,
    search: searchEndpoints,
    // Omitted entirely (not just undefined) when notifications are disabled, so
    // the route never registers and `client.notifications` is absent from types.
    ...(notificationsEnabled ? { notifications: notificationEndpoints } : {}),
    ...pluginApis,
  } as RawApi;

  // Auto-set `permissionResource` from plugin ID for plugin endpoints that don't set one
  for (const plugin of plugins) {
    if (!plugin.endpoints) continue;
    for (const ep of Object.values(plugin.endpoints)) {
      const epAny = ep as unknown as {
        options?: { metadata?: { cms?: { permissionResource?: string } } };
      };
      const meta = epAny.options?.metadata?.cms;
      if (meta && !meta.permissionResource) {
        meta.permissionResource = plugin.id;
      }
    }
  }

  // Wrap all endpoints: middleware + hooks run automatically.
  // Pass pluginContext (not cmsContext) so plugin-injected fields (e.g.
  // scopeConditions from multiTenant) are visible to the wrapper.
  const flatEndpoints = flattenEndpoints(rawApi as any);
  // Throws on duplicate path+method across the ENTIRE surface (core + collection
  // + plugin), keyed by the `ns:key` composite so the message points at the
  // exact offending endpoints.
  checkEndpointConflicts(flatEndpoints);

  // Static path→method map for the client proxy: lets optional-body POST
  // endpoints (e.g. notifications.markNotificationsRead, admin.reindexSearch)
  // dispatch as POST even when called with no body, instead of falling back to
  // body-presence inference. Built from flatEndpoints so it covers collection
  // and plugin namespaces that are only known at cms-definition time. Param
  // routes ({}/:) aren't RPC-proxied, mirroring endpoint-paths.test.ts.
  const pathMethods: Record<string, 'GET' | 'POST'> = {};
  for (const endpoint of Object.values(flatEndpoints)) {
    const ep = endpoint as unknown as {
      path?: string;
      options?: { method?: string | string[] };
    };
    const path = ep.path;
    if (typeof path !== 'string') continue;
    if (path.includes('{') || path.includes(':')) continue;
    const m = ep.options?.method;
    const method = Array.isArray(m) ? (m.find((x) => x !== 'GET') ?? m[0]) : m;
    if (method === 'GET' || method === 'POST') pathMethods[path] = method;
  }

  const wrappedEndpoints = toCMSEndpoints(
    flatEndpoints,
    pluginContext,
    authMiddleware as CMSMiddleware | undefined,
    hookRunner,
    revalidationRunner,
    ensureInit,
  );

  // Rebuild the namespaced api structure using the wrapped endpoints so that
  // direct server-side calls (cms.api.pages.listRoots()) also go through
  // middleware, scope resolution, and hooks.
  type BaseApi = ServerApiCallers<RawApi>;
  type FinalApi = TDef extends {
    user: CMSUserConfig<infer U extends AnyPgTable>;
  }
    ? WithActorUserApi<WithUserApi<BaseApi, U>, U>
    : BaseApi;

  const api = Object.fromEntries(
    Object.entries(rawApi).map(([ns, nsEndpoints]) => [
      ns,
      Object.fromEntries(
        Object.entries(nsEndpoints as Record<string, Endpoint>).map(
          ([key, _raw]) => [key, wrappedEndpoints[`${ns}:${key}`] ?? _raw],
        ),
      ),
    ]),
  ) as unknown as FinalApi;

  // Collect path-bound middlewares from all plugins
  const routerMiddleware = plugins.flatMap((plugin) =>
    (plugin.middlewares ?? []).map((m) => ({
      path: m.path,
      middleware: m.middleware,
    })),
  );

  const router = createRouter(wrappedEndpoints, {
    basePath: definition.basePath ?? '/api/cms',
    routerMiddleware,
    onError: (error, request) => {
      // Fires for errors that reach the router: unexpected (non-APIError)
      // throws, validation failures, and middleware/auth failures. A user
      // `onAPIError` hook takes over (for Sentry/Datadog/etc.); otherwise we log.
      if (definition.onAPIError) {
        definition.onAPIError(error, request);
      } else {
        console.error(error);
      }
    },
    async onRequest(request) {
      await ensureInit();
      // The shared realtime SSE stream short-circuits the pipeline: a long-lived
      // streaming Response must not enter per-request endpoint routing.
      if (realtimeRoute) {
        const realtimeResponse = await realtimeRoute(request);
        if (realtimeResponse) return realtimeResponse;
      }
      let req = request;
      for (const plugin of plugins) {
        if (!plugin.onRequest) continue;
        const result = await plugin.onRequest(req, pluginContext);
        if (result && 'response' in result) return result.response;
        if (result && 'request' in result) req = result.request;
      }
      return req;
    },
    async onResponse(response) {
      for (const plugin of plugins) {
        if (!plugin.onResponse) continue;
        const result = await plugin.onResponse(response, pluginContext);
        if (result) return result.response;
      }
      return response;
    },
  });

  const $ERROR_CODES = mergeErrorCodes(plugins);

  const revalidate = revalidationRunner
    ? (opts: { collection: string; rootId: string; branchId: string }) =>
        revalidationRunner.fireManual(opts)
    : undefined;

  const notify = notificationService
    ? (input: NotificationInput) => notificationService.notify(input)
    : undefined;

  return {
    router,
    api,
    collections,
    // notify / notificationService are present only when notifications are
    // enabled — gated from the TYPE too (parallels `client.notifications`).
    notify: notify as NotificationsEnabled<TDef> extends true
      ? NonNullable<typeof notify>
      : undefined,
    notificationService: notificationService as NotificationsEnabled<TDef> extends true
      ? NonNullable<typeof notificationService>
      : undefined,
    revalidate: revalidate as HasRevalidate<TDef> extends true
      ? RevalidateFn<keyof DefCollections & string>
      : RevalidateFn<keyof DefCollections & string> | undefined,
    $ERROR_CODES,
    // Serializable path→method map (pure JSON) handed to the client factory so
    // the proxy dispatches the correct HTTP method without body-presence
    // inference. See `createCMSClient({ pathMethods: cms.$pathMethods })`.
    $pathMethods: pathMethods,
    // ⚠️ TYPE-LEVEL ONLY — the runtime value is `undefined`. Unlike its sibling
    // `$ERROR_CODES` / `$pathMethods` (real objects), this is a PHANTOM field: it
    // exists purely so `createNotificationRouter<typeof cms>` can read the
    // plugin-contributed notification `meta` shapes + the `user`-config actor-user
    // shape off `typeof cms`. NEVER access `cms.$notifications` as a value — it
    // will throw `TypeError: Cannot read properties of undefined`.
    $notifications: undefined as unknown as {
      meta: InferPluginNotificationMeta<TPlugins>;
      actorUser: TDef extends {
        user: CMSUserConfig<infer U extends AnyPgTable>;
      }
        ? ActorUserShape<U>
        : Record<string, unknown>;
    },
  };
};
