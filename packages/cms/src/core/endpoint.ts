import { createEndpoint, createMiddleware, type Endpoint } from 'better-call';
import { eq, sql } from 'drizzle-orm';

import type { HookRunner } from './hooks';
import type { RevalidationRunner } from './revalidation';
import type {
  CMSMiddleware,
  CMSMiddlewareRequest,
  CMSOperation,
  CMSProcedureCtx,
  MiddlewareResult,
  ResolvedScope,
  RootTableScope,
} from './types';
import type { DrizzleInstance } from './types/drizzle';

import { branches } from './db/schema.generated';
import {
  decodeWithRoot,
  decodeWithUser,
  WITH_ROOT_KEY,
  WITH_USER_KEY,
  type WithUserValue,
} from './with-flags';

export type CMSEndpointMeta = {
  permissionResource?: string;
  operation: CMSOperation;
  scope: 'collection' | 'system';
  collection?: string;
  /**
   * When `true`, this endpoint is intentionally exempt from the auth /
   * permission / scope / hook chain — it handles its own access control
   * (e.g. a public asset redirect). Every other endpoint must carry full
   * `cms` metadata; `toCMSEndpoints` throws on a missing one (fail-closed).
   */
  public?: boolean;
};

export const cmsContext = createMiddleware(async () => {
  return {} as {
    db: DrizzleInstance;
    userId: string | undefined;
    collection: string;
    scope: ResolvedScope;
    withUser?: WithUserValue;
    userConfig?: import('./user/resolve').ResolvedUserConfig;
    withRoot?: boolean;
    revalidationRunner?: RevalidationRunner | null;
    realtime?: import('./realtime/types').RealtimeTransport;
  };
});

export type CMSEndpointCtx = {
  db: DrizzleInstance;
  userId: string | undefined;
  collection: string;
  scope: ResolvedScope;
  withUser?: WithUserValue;
  userConfig?: import('./user/resolve').ResolvedUserConfig;
  withRoot?: boolean;
  revalidationRunner?: RevalidationRunner | null;
  /** Realtime transport (when configured) — lets a handler publish live events
   *  (e.g. the A/B ingest pushing live result deltas). */
  realtime?: import('./realtime/types').RealtimeTransport;
};

export const createCMSEndpoint: ReturnType<
  typeof createEndpoint.create<{ use: [typeof cmsContext] }>
> = createEndpoint.create({
  use: [cmsContext],
});

export function cmsMeta<T extends Record<string, unknown>>(
  base: T,
  cms: CMSEndpointMeta,
): T & { cms: CMSEndpointMeta } {
  return { ...base, cms };
}

/**
 * Merges all scope condition factories registered by plugins.
 * Each factory is called with the middleware result and produces
 * per-table WHERE conditions and INSERT values.
 */
function computeScope(
  factories: CMSProcedureCtx['scopeConditions'],
  mwResult: MiddlewareResult,
): ResolvedScope {
  if (!factories || factories.length === 0) return {};

  const merged: ResolvedScope = {};
  for (const factory of factories) {
    const result = factory(mwResult);
    for (const table of [
      'roots',
      'assets',
      'assetFolders',
      'redirects',
      'templates',
      'variables',
    ] as const) {
      const tableScope = result[table];
      if (!tableScope) continue;
      if (!merged[table]) {
        merged[table] = { ...tableScope };
      } else {
        const existing = merged[table]!;
        if (tableScope.where) {
          existing.where = existing.where
            ? sql`(${existing.where}) AND (${tableScope.where})`
            : tableScope.where;
        }
        if (tableScope.insertColumns) {
          existing.insertColumns = {
            ...existing.insertColumns,
            ...tableScope.insertColumns,
          };
        }
        // `roots` may carry a per-new-entry column contributor (Seam D); carry
        // it through the merge too (last-writer-wins) — otherwise a second
        // factory contributing `roots` would silently drop it. The first-writer
        // branch already preserves it via the spread above.
        const newEntry = (tableScope as RootTableScope).newEntryColumns;
        if (newEntry) (existing as RootTableScope).newEntryColumns = newEntry;
        // `roots.crossScopeExclude` (Seam D6) must be UNIONed across factories,
        // NOT last-writer-wins: a factory that declares none (e.g. multi-tenant)
        // must not erase one declared by another (e.g. i18n's ['language']).
        // Order-independent, so cross-scope reads exclude the right columns
        // regardless of plugin registration order.
        const cse = (tableScope as RootTableScope).crossScopeExclude;
        if (cse?.length) {
          const prev = (existing as RootTableScope).crossScopeExclude ?? [];
          (existing as RootTableScope).crossScopeExclude = [
            ...new Set([...prev, ...cse]),
          ];
        }
      }
    }
    // Opaque per-plugin context slots: shallow-merge across factories so
    // multiple plugins coexist; within a slot, last-writer-wins per plugin id.
    if (result.pluginContext) {
      merged.pluginContext = {
        ...merged.pluginContext,
        ...result.pluginContext,
      };
    }
    // The reference resolver is provided by at most one scoping plugin.
    if (result.variableResolver) {
      merged.variableResolver = result.variableResolver;
    }
    if (result.referenceResolver) {
      merged.referenceResolver = result.referenceResolver;
    }
    // The running-A/B-test resolver is provided by at most one plugin (ab-test).
    if (result.abTestResolver) {
      merged.abTestResolver = result.abTestResolver;
    }
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Branch name resolution
// ---------------------------------------------------------------------------

async function resolveBranchName(
  db: DrizzleInstance,
  reqCtx: CMSMiddlewareRequest | undefined,
): Promise<string | undefined> {
  const branchId =
    (reqCtx?.body as Record<string, unknown> | undefined)?.branchId ??
    (reqCtx?.query as Record<string, unknown> | undefined)?.branchId;
  if (typeof branchId !== 'string') return undefined;

  const [row] = await db
    .select({ name: branches.name })
    .from(branches)
    .where(eq(branches.id, branchId))
    .limit(1);
  return row?.name;
}

// ---------------------------------------------------------------------------
// Endpoint wrapping
// ---------------------------------------------------------------------------

export function toCMSEndpoints(
  endpoints: Record<string, Endpoint>,
  cmsCtx: CMSProcedureCtx,
  userMiddleware: CMSMiddleware | undefined,
  hookRunner: HookRunner,
  revalidationRunner?: RevalidationRunner | null,
  ensureInit?: () => Promise<void>,
): Record<string, Endpoint> {
  const wrapped: Record<string, Endpoint> = {};

  for (const [key, endpoint] of Object.entries(endpoints)) {
    const ep = endpoint as unknown as {
      path?: string;
      options?: { metadata?: { cms?: CMSEndpointMeta } };
      (...args: unknown[]): Promise<unknown>;
    };
    const meta: CMSEndpointMeta | undefined = ep.options?.metadata?.cms;

    if (!meta) {
      // Fail closed: a registered endpoint without cms metadata would run with
      // no auth / permission / scope / hooks. That must be a deliberate choice,
      // not a silent omission.
      throw new Error(
        `[cms] Endpoint "${key}" has no cms metadata — it would run unauthenticated and unscoped. ` +
          `Define it with createCMSEndpoint + cmsMeta(...), or, if it is intentionally public, ` +
          `mark it via cmsMeta(base, { public: true, operation, scope }).`,
      );
    }

    if (meta.public) {
      // Intentionally exempt: handles its own access control.
      wrapped[key] = endpoint;
      continue;
    }

    const endpointKey = key.includes(':') ? key.split(':')[1]! : key;

    type EndpointCallContext = {
      body?: Record<string, unknown>;
      query?: Record<string, unknown>;
      params?: Record<string, unknown>;
      headers?: HeadersInit;
      request?: Request;
      context?: Record<string, unknown>;
      [key: string]: unknown;
    };

    const wrappedHandler = async (rawContext: unknown) => {
      if (ensureInit) await ensureInit();
      const requestContext = (rawContext ?? {}) as EndpointCallContext;
      const reqCtx: CMSMiddlewareRequest = {
        body: requestContext.body,
        query: requestContext.query,
        params: requestContext.params,
        headers: requestContext.headers,
        request: requestContext.request,
      };

      const branchName =
        meta.scope === 'collection'
          ? await resolveBranchName(cmsCtx.db, reqCtx)
          : undefined;

      const mwResult = await runUserMiddleware(
        userMiddleware,
        cmsCtx,
        meta,
        reqCtx,
        branchName,
      );

      const scope = computeScope(cmsCtx.scopeConditions, mwResult);

      let body: Record<string, unknown> | undefined = requestContext.body;
      const hookCtx = {
        action: endpointKey,
        collection: meta.collection ?? '',
        db: cmsCtx.db,
        input: (requestContext.body ?? {}) as Record<string, unknown>,
        scope,
      };
      const overrides = await hookRunner.runBefore(
        endpointKey,
        meta.collection ?? '',
        hookCtx,
      );
      if (Object.keys(overrides).length > 0) {
        body = { ...body, ...overrides };
      }

      if (revalidationRunner && revalidationRunner.shouldProcess(endpointKey)) {
        await revalidationRunner.preProcess(
          endpointKey,
          meta.collection ?? '',
          (body ?? {}) as Record<string, unknown>,
        );
      }

      // Decode + strip the user-enrichment flags so they never leak into the
      // endpoint's own validated query. The wire contract lives in with-flags.ts
      // (shared with the client encode side). Strip semantics are deliberately
      // asymmetric: withUser is stripped whenever present (even when malformed
      // JSON decoded to undefined); withRoot is stripped only when enabled.
      let withUser: WithUserValue | undefined;
      const rawWithUser = requestContext.query?.[WITH_USER_KEY];
      if (rawWithUser !== undefined) {
        withUser = decodeWithUser(rawWithUser);
        const { [WITH_USER_KEY]: _, ...cleanQuery } = requestContext.query!;
        requestContext.query = cleanQuery;
      }

      let withRoot = false;
      const rawWithRoot = requestContext.query?.[WITH_ROOT_KEY];
      if (rawWithRoot !== undefined && decodeWithRoot(rawWithRoot)) {
        withRoot = true;
        const { [WITH_ROOT_KEY]: _, ...cleanQuery } = requestContext.query!;
        requestContext.query = cleanQuery;
      }

      const enrichedCtx: EndpointCallContext = {
        ...requestContext,
        body,
        context: {
          ...requestContext.context,
          db: cmsCtx.db,
          userId: mwResult.userId,
          collection: meta.collection ?? '',
          scope,
          revalidationRunner: revalidationRunner ?? null,
          realtime: cmsCtx.realtime,
          ...(withUser && cmsCtx.resolvedUser
            ? { withUser, userConfig: cmsCtx.resolvedUser }
            : {}),
          ...(withRoot ? { withRoot } : {}),
        },
      };

      const result = await ep(enrichedCtx);

      let finalResult = result;
      const afterResult = await hookRunner.runAfter(
        endpointKey,
        meta.collection ?? '',
        {
          action: endpointKey,
          collection: meta.collection ?? '',
          db: cmsCtx.db,
          input: (body ?? {}) as Record<string, unknown>,
          result,
        },
      );
      if (afterResult?.response !== undefined) {
        finalResult = afterResult.response;
      }

      if (revalidationRunner && revalidationRunner.shouldProcess(endpointKey)) {
        await revalidationRunner.postProcess(
          endpointKey,
          meta.collection ?? '',
          (body ?? {}) as Record<string, unknown>,
          result,
        );
      }

      return finalResult;
    };

    Object.assign(wrappedHandler, { path: ep.path, options: ep.options });
    wrapped[key] = wrappedHandler as unknown as Endpoint;
  }

  return wrapped;
}

async function runUserMiddleware(
  userMiddleware: CMSMiddleware | undefined,
  cmsCtx: CMSProcedureCtx,
  meta: CMSEndpointMeta,
  reqCtx?: CMSMiddlewareRequest,
  branchName?: string,
): Promise<MiddlewareResult> {
  if (!userMiddleware) return {};

  const collection = cmsCtx.collections[meta.collection ?? ''];

  const permissionResource = meta.permissionResource ?? 'unknown';

  if (meta.scope === 'collection' && collection) {
    return userMiddleware({
      db: cmsCtx.db,
      collections: cmsCtx.collections,
      dataRetention: cmsCtx.dataRetention,
      scope: 'collection',
      collection,
      permissionResource,
      operation: meta.operation,
      branchName,
      request: reqCtx,
    });
  }

  return userMiddleware({
    db: cmsCtx.db,
    collections: cmsCtx.collections,
    dataRetention: cmsCtx.dataRetention,
    scope: 'system',
    permissionResource,
    operation: meta.operation,
    branchName,
    request: reqCtx,
  });
}
