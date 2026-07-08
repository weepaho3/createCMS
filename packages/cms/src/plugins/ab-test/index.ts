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
   * Opt-in server-side GA4 forwarding (M5). When set, each consenting,
   * client_id-bearing event is POSTed to your GA4 Measurement Protocol / sGTM
   * endpoint server-side (ad-blocker-resistant). Omit to use only the
   * client-side dataLayer path. See {@link Ga4ServerConfig}.
   */
  ga4?: Ga4ServerConfig;
  /**
   * Opt-in rate-limit for the anonymous `/abTest/trackEvent` ingest — the one
   * unauthenticated write path. Strongly recommended before production: an open
   * ingest can skew the A/B aggregate, bloat the events table, and (with `ga4`)
   * amplify into outbound GA4 POSTs. Default key = client IP; default counter =
   * in-memory (per instance — inject a distributed `store` for serverless /
   * multi-instance). See {@link AbTestRateLimitOptions}.
   */
  rateLimit?: AbTestRateLimitOptions;
};

export function abTest(options?: AbTestPluginOptions) {
  const adapter = options?.analytics ?? postgresAnalytics();
  const schema = buildSchema(adapter);

  // Created ONCE per plugin instance (never per request) so the rate-limit
  // window survives across requests. In-memory unless a distributed store is
  // injected. Undefined when rate-limiting is not configured.
  const rateLimitStore = options?.rateLimit
    ? (options.rateLimit.store ?? createInMemoryRateLimitStore())
    : undefined;

  // Captured at init() — read by the publishBranch guard (which block types are
  // functional) AND by the listGoalEvents endpoint (the goal-picker reads each
  // block's declared `events`). A getter is threaded into the endpoint factory
  // because the endpoints are built here, before init() populates this.
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
    // The edge-readable resolve seam, per collection (Pattern A).
    collectionEndpoints: (def) => createAbResolveEndpoints(def),
    $ERROR_CODES,

    hooks: {
      before: [
        {
          // Publish-time tracking-id integrity guard (missing/duplicate/drift).
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
          // XOR TOCTOU backstop: reject a publish that would make two running
          // tests co-render.
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

      // Register the read-path running-test resolver (server
      // fan-out). Stateless + request-independent, so a constant scope
      // factory just hands the same instance to every request's resolved scope.
      const abTestResolver = buildAbTestResolver();
      return {
        context: {
          scopeConditions: [() => ({ abTestResolver })],
        },
      };
    },

    async onRequest(request, _ctx) {
      const url = new URL(request.url);

      // Rate-limit the anonymous trackEvent ingest as early as possible —
      // before routing / auth / DB work — when configured. A 429 short-circuits.
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
      // Live A/B results stream over the shared core `/realtime` route
      // (channel `ab:live:<testId>`) — the plugin no longer owns an SSE bridge.
    },
  } satisfies CMSPlugin;
}
