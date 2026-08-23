import type { CollectionWithName } from '../../core/types/definitions';
import type { CMSPlugin } from '../../core/types/plugin';
import type { Ga4ServerConfig } from './analytics/ga4-server';
import type { AbTestAnalyticsAdapter } from './analytics/types';

import { registerIdPrefix } from '../../utils/nanoid';
import { postgresAnalytics } from './analytics/postgres';
import { createAbTestEndpoints } from './endpoints';
import { $ERROR_CODES } from './errors';
import { buildAbTestResolver } from './fanout';
import {
  createInMemoryRateLimitStore,
  enforceTrackEventRateLimit,
  type AbTestRateLimitOptions,
} from './rate-limit';
import { createAbResolveEndpoints } from './resolve';
import { buildSchema } from './schema';
import { assertTrackingIntegrity } from './tracking-guard';
import { assertNoCoRenderConflictOnPublish } from './xor-guard';

export type { AbTestAnalyticsAdapter } from './analytics/types';
export type { Ga4ServerConfig, Ga4Payload } from './analytics/ga4-server';
export { buildGa4Payload, forwardToGa4 } from './analytics/ga4-server';
export type { AbTestRateLimitOptions, RateLimitStore } from './rate-limit';
export {
  createInMemoryRateLimitStore,
  defaultRateLimitKey,
  enforceTrackEventRateLimit,
} from './rate-limit';
export type { PrivacyNoticeItem } from './privacy-notice';
export { getPrivacyNoticeItems } from './privacy-notice';
export type {
  AbTestContext,
  AbTestEvent,
  AggregatedResults,
  AggregatedVariantResult,
  AnalyticsEvent,
  CMSEventSource,
  ConsentPurpose,
  ConsentSignal,
  ConsentState,
  LiveDelta,
} from './analytics/types';
export { $ERROR_CODES } from './errors';

// Default analytics adapter
export { postgresAnalytics };

const PLUGIN_ID = 'abTest' as const;

registerIdPrefix('abTest', 'abt');
registerIdPrefix('abTestVariant', 'abv');
registerIdPrefix('abTestEvent', 'abe');
registerIdPrefix('abTestAgg', 'aba');

export type AbTestPluginOptions = {
  analytics?: AbTestAnalyticsAdapter;
  /**
   * Opt-in server-side GA4 forwarding. When set, each consenting,
   * client_id-bearing event is POSTed server-side to your GA4 Measurement
   * Protocol or sGTM endpoint (resistant to ad blockers). When omitted only
   * the client-side dataLayer path runs. See {@link Ga4ServerConfig}.
   */
  ga4?: Ga4ServerConfig;
  /**
   * Opt-in rate-limit for `/abTest/trackEvent`, the anonymous unauthenticated
   * write path. Recommended before production: an open ingest can skew A/B
   * aggregates, bloat the events table, and amplify into outbound GA4 POSTs.
   * Default key is client IP; the default counter store is in-memory per
   * instance, so inject a distributed `store` for multi-instance deployments.
   * See {@link AbTestRateLimitOptions}.
   */
  rateLimit?: AbTestRateLimitOptions;
};

export function abTest(options?: AbTestPluginOptions) {
  const adapter = options?.analytics ?? postgresAnalytics();
  const schema = buildSchema(adapter);

  // Created once per plugin instance, never per request, so the rate-limit
  // window survives across requests. Undefined when rate-limiting is off.
  const rateLimitStore = options?.rateLimit
    ? (options.rateLimit.store ?? createInMemoryRateLimitStore())
    : undefined;

  // Populated in init(); the publishBranch guard reads which block types are
  // functional, and listGoalEvents reads each block's declared `events`.
  // A getter is threaded into the endpoint factory because endpoints are
  // built here, before init() populates this.
  let pluginCollections: Record<string, CollectionWithName> = {};
  const endpoints = createAbTestEndpoints(
    adapter,
    () => pluginCollections,
    options?.ga4,
  );

  return {
    id: PLUGIN_ID,
    schema,
    endpoints,
    collectionEndpoints: (def) => createAbResolveEndpoints(def),
    $ERROR_CODES,

    hooks: {
      before: [
        {
          action: 'publishBranch',
          handler: async (ctx) => {
            const rootId = ctx.input.rootId as string | undefined;
            const branchId = ctx.input.branchId as string | undefined;
            if (!rootId || !branchId) return;
            await assertTrackingIntegrity({
              db: ctx.db,
              collections: pluginCollections,
              collectionName: ctx.collection,
              rootId,
              branchId,
              scope: ctx.scope,
            });
          },
        },
        {
          // Publish-time backstop for the XOR invariant: reject a publish that
          // would make two running tests co-render.
          action: 'publishBranch',
          handler: async (ctx) => {
            const rootId = ctx.input.rootId as string | undefined;
            if (!rootId) return;
            await assertNoCoRenderConflictOnPublish({
              db: ctx.db,
              collectionName: ctx.collection,
              rootId,
              scope: ctx.scope,
            });
          },
        },
      ],
    },

    async init(ctx) {
      pluginCollections = ctx.collections;
      if (adapter.init) await adapter.init(ctx.db);

      // The resolver is stateless and request-independent, so the constant
      // scope factory hands the same instance to every request's resolved
      // scope.
      const abTestResolver = buildAbTestResolver();
      return {
        context: {
          scopeConditions: [() => ({ abTestResolver })],
        },
      };
    },

    async onRequest(request, _ctx) {
      const url = new URL(request.url);

      // Rate-limit the anonymous trackEvent ingest before routing, auth and
      // DB work when configured; a 429 short-circuits the request.
      if (
        rateLimitStore &&
        options?.rateLimit &&
        request.method === 'POST' &&
        url.pathname.endsWith('/abTest/trackEvent')
      ) {
        const limited = await enforceTrackEventRateLimit(
          request,
          options.rateLimit,
          rateLimitStore,
        );
        if (limited) return { response: limited };
      }
    },
  } satisfies CMSPlugin;
}
