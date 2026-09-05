import type { AnalyticsEvent } from './types';

// Opt-in server-side GA4 forwarding (Measurement Protocol / sGTM).
//
// An ad-blocker-resistant second path to GA4: the server POSTs a consenting
// event straight to a user-configured endpoint, bypassing the browser. The
// client-side dataLayer sink stays the default; enable this only for goals
// not also forwarded client-side, or GA4 may double-count (one authoritative
// leg per goal). The endpoint is user config; the CMS never hardcodes
// google-analytics.com.

/**
 * Where the server forwards events. Both variants are server-only (an api_secret
 * must never reach the browser). `endpointUrl` is required; supply the GA4 MP
 * URL (https://www.google-analytics.com/mp/collect) or your sGTM container URL,
 * so a regional/proxy endpoint is a config change, not a code change.
 */
export type Ga4ServerConfig =
  | {
      type: 'measurementProtocol';
      endpointUrl: string;
      measurementId: string;
      apiSecret: string;
    }
  | { type: 'sgtm'; endpointUrl: string };

/**
 * GA4 params the SERVER derives + owns. They are stripped from the untrusted
 * `metadata` (public trackEvent input) before it is merged, so a caller can
 * never fabricate/overwrite them, not even on a non-A/B event where the
 * server-derived value happens to be absent (a conditional spread would
 * otherwise leave the attacker's value in place).
 */
const RESERVED_GA4_PARAMS = new Set([
  'engagement_time_msec',
  'session_id',
  'experiment_id',
  'experiment_variant',
  'tracking_id',
  'interaction_id',
]);

/** A copy of `metadata` with every server-owned GA4 param removed. */
function sanitizeMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!metadata) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!RESERVED_GA4_PARAMS.has(key)) out[key] = value;
  }
  return out;
}

/** The GA4 Measurement Protocol request body (the shape MP/sGTM expects). */
export type Ga4Payload = {
  client_id: string;
  events: Array<{ name: string; params: Record<string, unknown> }>;
  consent?: { ad_user_data: string; ad_personalization: string };
};

/**
 * Builds the MP payload from a {@link AnalyticsEvent}. Pure (no I/O) and
 * exported so the mapping is unit-testable. Returns null when the event cannot
 * be a valid MP hit (analytics_storage not granted, or no client_id) so the
 * caller does not forward. A/B attribution rides as GA4's
 * `experiment_id`/`experiment_variant` convention (event-scoped custom dims).
 */
export function buildGa4Payload(event: AnalyticsEvent): Ga4Payload | null {
  if (event.consent?.analytics_storage !== 'granted') return null;
  const clientId = event.transport?.clientId;
  if (!clientId) return null;

  const params: Record<string, unknown> = {
    // metadata first, but with every server-owned param stripped (see
    // RESERVED_GA4_PARAMS): it is public-ingest input, so a caller can never
    // fabricate or overwrite these params; the server-derived params below
    // are only set when present, so a stripped key never comes back from
    // metadata.
    ...sanitizeMetadata(event.metadata),
    // GA4 needs a non-zero engagement time, else the hit is realtime-invisible.
    engagement_time_msec: event.transport?.engagementTimeMsec ?? 1,
  };
  if (event.transport?.sessionId) {
    params.session_id = event.transport.sessionId;
  }
  if (event.ab) {
    params.experiment_id = event.ab.testId;
    params.experiment_variant = event.ab.variantId;
  }
  if (event.source?.handle) params.tracking_id = event.source.handle;
  if (event.interactionId) params.interaction_id = event.interactionId;

  const payload: Ga4Payload = {
    client_id: clientId,
    events: [{ name: event.name, params }],
  };
  // GA4 Consent Mode block (ad signals). analytics_storage is gated above;
  // the ad_* signals tell GA4 how it may use the data.
  if (event.consent) {
    payload.consent = {
      ad_user_data: event.consent.ad_user_data,
      ad_personalization: event.consent.ad_personalization,
    };
  }
  return payload;
}

/** Resolves the POST URL for a config (MP appends measurement_id + api_secret). */
function resolveUrl(config: Ga4ServerConfig): string {
  if (config.type === 'sgtm') return config.endpointUrl;
  const sep = config.endpointUrl.includes('?') ? '&' : '?';
  return `${config.endpointUrl}${sep}measurement_id=${encodeURIComponent(
    config.measurementId,
  )}&api_secret=${encodeURIComponent(config.apiSecret)}`;
}

/** Max wall-clock the forward may add to the public ingest before it is aborted. */
const FORWARD_TIMEOUT_MS = 2000;

/**
 * Forwards one event to GA4 server-side if it is a valid consenting MP hit.
 * Best-effort and non-fatal: a network or endpoint error never breaks the
 * ingest (the A/B store write already happened). No-ops on missing consent or
 * client_id. The caller awaits this, so the forward is hard-bounded by an
 * {@link AbortSignal.timeout}: a slow or hung endpoint can never stall the
 * public response.
 */
export async function forwardToGa4(
  event: AnalyticsEvent,
  config: Ga4ServerConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const payload = buildGa4Payload(event);
  if (!payload) return; // not a consenting, identified hit, so no forward

  try {
    await fetchImpl(resolveUrl(config), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
    });
  } catch {
    // Non-fatal: the authoritative A/B store write already succeeded. A
    // network error, a non-2xx, or the timeout abort all land here.
  }
}
