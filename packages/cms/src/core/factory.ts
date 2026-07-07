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

// Config-hook types whose `action` autocompletes core + plugin endpoint keys.
// The `(string & {})` keeps any string assignable (non-breaking) while the
// literal union still surfaces in editor completions. These narrow the loose
// CMSBeforeHook/CMSAfterHook used for standalone plugin authoring.
type CMSConfigBeforeHook<TPlugins extends CMSPlugin[]> = Omit<
  CMSBeforeHook,
  'action'
> & { action: CMSEndpointKey<TPlugins> | '*' | (string & {}) };

type CMSConfigAfterHook<TPlugins extends CMSPlugin[]> = Omit<
  CMSAfterHook,
  'action'
> & { action: CMSEndpointKey<TPlugins> | '*' | (string & {}) };

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

type EndpointCaller<E> =
  E extends Endpoint<any, any, infer Body, infer Query, any, infer R, any, any>
    ? AreEndpointOptionsOptional<Body, Query> extends true
      ? (opts?: OptionalizeEndpointOptions<Body, Query>) => Promise<Awaited<R>>
      : (opts: OptionalizeEndpointOptions<Body, Query>) => Promise<Awaited<R>>
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
  | 'listNotifications'
  | 'listPublications';

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
    [K in keyof T[NS]]: K extends UserEnrichableEndpoints
      ? AddWithUser<T[NS][K], TTable>
      : T[NS][K];
  };
};

// The actor-user object on a notification item. `exposeColumns` is a runtime
// allowlist (typed only as `string[]`), so the tightest static shape we can
// derive is a partial of the user table's row.
type ActorUserShape<TTable extends AnyPgTable> = Partial<TTable['$inferSelect']>;

// Rewrite a `listNotifications` RESULT to type `actorUser` off the user table.
type InjectActorUser<R, TTable extends AnyPgTable> = R extends {
  notifications: Array<infer Item>;
}
  ? Omit<R, 'notifications'> & {
      notifications: Array<
        Omit<Item, 'actorUser'> & { actorUser?: ActorUserShape<TTable> | null }
      >;
    }
  : R;

// Type the OUTPUT of `notifications.listNotifications` (WithUserApi only types
// the input flag). Leaves every other endpoint untouched.
type WithActorUserApi<T, TTable extends AnyPgTable> = T extends {
  notifications: infer NS;
}
  ? Omit<T, 'notifications'> & {
      notifications: {
        [K in keyof NS]: K extends 'listNotifications'
          ? NS[K] extends (...args: infer A) => infer R
            ? (
                ...args: A
              ) => R extends Promise<infer RR>
                ? Promise<InjectActorUser<RR, TTable>>
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

function checkEndpointConflicts(plugins: CMSPlugin[]) {
  const registry = new Map<string, { pluginId: string; methods: string[] }[]>();

  for (const plugin of plugins) {
    if (!plugin.endpoints) continue;
    for (const endpoint of Object.values(plugin.endpoints)) {
      if (
        !endpoint ||
        !('path' in endpoint) ||
        typeof endpoint.path !== 'string'
      )
        continue;
      const path = endpoint.path;
      let methods: string[] = [];
      if (endpoint.options && 'method' in endpoint.options) {
        methods = Array.isArray(endpoint.options.method)
          ? endpoint.options.method
          : [endpoint.options.method as string];
      }
      if (methods.length === 0) methods = ['*'];

      if (!registry.has(path)) registry.set(path, []);
      registry.get(path)!.push({ pluginId: plugin.id, methods });
    }
  }

  for (const [path, entries] of registry) {
    if (entries.length <= 1) continue;
    const methodMap = new Map<string, string[]>();
    for (const entry of entries) {
      for (const method of entry.methods) {
        if (!methodMap.has(method)) methodMap.set(method, []);
        methodMap.get(method)!.push(entry.pluginId);
      }
    }
    for (const [method, pluginIds] of methodMap) {
      if (pluginIds.length > 1 || method === '*') {
        console.warn(
          `[cms] Endpoint conflict: "${path}" [${method}] registered by plugins: ${[...new Set(pluginIds)].join(', ')}`,
        );
      }
    }
  }
}

function mergeErrorCodes<TPlugins extends CMSPlugin[]>(
  plugins: TPlugins,
): InferPluginErrorCodes<TPlugins> {
  return plugins.reduce(
    (acc, plugin) => {
      if (plugin.$ERROR_CODES) Object.assign(acc, plugin.$ERROR_CODES);
      return acc;
    },
    {} as Record<string, { status: number; message: string }>,
  ) as InferPluginErrorCodes<TPlugins>;
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
 *   media: {
 *     provider: 'aws',
 *     region: 'eu-central-1',
 *     bucketName: 'my-cms-assets',
 *     accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
 *     secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
 *     publicUrl: 'https://cdn.example.com/',
 *   },
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

  // Check for endpoint conflicts between plugins
  checkEndpointConflicts(plugins);

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
    onError: (error) => {
      console.error(error);
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
    // Type-only registry read by `createNotificationRouter<typeof cms>`: the
    // plugin-contributed notification `meta` shapes + the actor-user shape from
    // the `user` config. Runtime value is `undefined` (never read at runtime).
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
