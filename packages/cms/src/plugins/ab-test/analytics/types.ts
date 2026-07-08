import type { TableDefinition } from '../../../core/db/types';
import type { DrizzleInstance } from '../../../core/types';
import type { ConsentState } from '../../consent';

// ============================================================================
// Context
// ============================================================================

export type AbTestContext = {
  key: string;
  anonymous?: boolean;
};

// ============================================================================
// Consent (Google Consent Mode v2) — owned by the consent plugin
// ============================================================================

export type {
  ConsentSignal,
  ConsentState,
  ConsentPurpose,
} from '../../consent';

// ============================================================================
// Events
// ============================================================================

/** Where an event originated — a functional block instance. */
export type CMSEventSource = {
  /** Stable, author-assigned instance handle (the block's `trackingId`). */
  handle?: string;
  /** Block type that emitted the event (e.g. `'signupForm'`). */
  type?: string;
};

/**
 * The decoupled, analytics-agnostic event core. A/B attribution is **optional**
 * (`ab`), so non-A/B events (page views, form submits) are first-class and can
 * flow to non-A/B sinks (GA4, GTM) without inventing a fake test/variant.
 *
 * `AbTestEvent` is the derived view where `ab` is mandatory.
 */
export type AnalyticsEvent = {
  /**
   * Optional id used as the storage row key. When absent, the sink mints one.
   * Dedup behaviour is **sink-specific**: the postgres sink dedups on it via
   * `ON CONFLICT (id) DO NOTHING`; the upstash sink does not. (A tenant-scoped,
   * client-supplied idempotency key — distinct from this row key — arrives with
   * the M3 client legs.)
   */
  id?: string;
  /** Canonical event name, e.g. `'impression' | 'conversion' | 'form_submit'`. */
  name: string;
  /**
   * Optional: the anonymous Pattern A path stores NO identifier (variant comes
   * from the URL/variant-cookie). Only set for the consent-gated unique-visitor /
   * GA4 path. Stored as NULL when absent → excluded from unique-visitor counts.
   */
  visitorId?: string;
  anonymous: boolean;
  /** A/B attribution. Absent for non-A/B analytics events. */
  ab?: { testId: string; variantId: string };
  /** Originating functional block instance, if any. */
  source?: CMSEventSource;
  /**
   * Consent state under which the event was emitted (Consent Mode v2).
   * Forwarded to consent-aware sinks (e.g. the M5 server-MP consent block). NOTE:
   * M1 forwards but does NOT persist this — there is no consent column yet.
   */
  consent?: ConsentState;
  /**
   * Funnel grouping id (M4): a client-minted id shared by the attempt + success
   * legs of ONE interaction (e.g. a <TrackedForm> submit). Lets completion_rate
   * pair them. Distinct from any storage/dedup key — it groups, it doesn't dedup.
   */
  interactionId?: string;
  /**
   * GA4 stitching identifiers (M5 server-MP): the client reads them from the
   * `_ga` / `_ga_<id>` cookies and sends them ONLY when analytics_storage is
   * granted, so the server-side ga4ServerSink can attribute the Measurement
   * Protocol hit to the same user/session (else GA4 shows `(not set)`). Absent on
   * the anonymous consent-free path — its presence is what gates the GA4 forward.
   */
  transport?: {
    clientId?: string;
    sessionId?: string;
    engagementTimeMsec?: number;
  };
  metadata?: Record<string, unknown>;
  timestamp: Date;
};

/** A {@link AnalyticsEvent} that carries mandatory A/B attribution (the A/B view). */
export type AbTestEvent = AnalyticsEvent & {
  ab: { testId: string; variantId: string };
};

// ============================================================================
// Aggregated Results
// ============================================================================

export type AggregatedVariantResult = {
  variantId: string;
  variantName: string;
  impressions: number;
  conversions: number;
  uniqueVisitors: number;
  conversionRate: number;
  /**
   * Funnel (M4): total distinct interaction ids (each <TrackedForm> submit mints
   * one) = the attempts. completionRate = distinct interactions that reached the
   * goal event / attempts (computed by getResults when a goal is set).
   */
  attempts: number;
  completionRate: number;
  eventBreakdown: Record<
    string,
    { count: number; uniqueVisitors: number; distinctInteractions: number }
  >;
};

export type AggregatedResults = {
  testId: string;
  variants: AggregatedVariantResult[];
  totalImpressions: number;
  totalConversions: number;
  /**
   * The test's resolved goal event (wire name), or null for the goal-less
   * default where `conversion` events are the goal. Set by `getResults` so the
   * live dashboard can apply deltas to conversions with the same rule.
   */
  goalEvent?: string | null;
};

// ============================================================================
// Adapter Interface
// ============================================================================

export type AbTestAnalyticsAdapter = {
  /** Adapter-specific Postgres tables to merge into the plugin schema. */
  tables?: Record<string, TableDefinition>;

  /** Called once during plugin init. Receives the Drizzle DB instance. */
  init?(db: DrizzleInstance): Promise<void> | void;

  /**
   * Record a single event. Accepts any {@link AnalyticsEvent}: A/B-attributed events
   * (impression/conversion) carry `ab`, non-A/B analytics events (form_submit,
   * page_view) omit it.
   */
  track(event: AnalyticsEvent): Promise<void>;

  /** Query aggregated results for a test. */
  query(
    testId: string,
    options?: { from?: Date; to?: Date },
  ): Promise<AggregatedResults>;

  /** Optional batch flush (e.g. Upstash -> Postgres). */
  flush?(testId?: string): Promise<{ flushed: number }>;
};

// ============================================================================
// Live Delta (published by Upstash adapter on each track call)
// ============================================================================

export type LiveDelta = {
  variantId: string;
  eventType: string;
  count: 1;
  timestamp: number;
};

// ============================================================================
// Upstash Analytics Options
// ============================================================================

export type UpstashAnalyticsOptions = {
  url: string;
  token: string;
};
