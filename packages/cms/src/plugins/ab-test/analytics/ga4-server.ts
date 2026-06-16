import type { CMSEvent } from './types';

// ============================================================================
// M5 — ga4ServerSink: opt-in server-side GA4 forwarding (Measurement Protocol /
// sGTM)
// ============================================================================
//
// An ad-blocker-resistant SECOND path to GA4: the server POSTs a consenting
// event straight to a USER-CONFIGURED endpoint (GA4 Measurement Protocol, or an
// sGTM container), bypassing the browser. The client-side gtmClientSink
// (dataLayer) stays the default; enable this ONLY for goals you do NOT also
// forward client-side, or GA4 may double-count (single authoritative leg per
// goal). The CMS never hardcodes google-analytics.com — the endpoint is yours.

/**
 * Where the server forwards events. Both variants are server-only (an api_secret
 * must never reach the browser). `endpointUrl` is required — supply the GA4 MP
 * URL (https://www.google-analytics.com/mp/collect) or your sGTM container URL,
 * so a regional/proxy endpoint is a config change, not a code change.
 */
export type GA4ServerConfig =
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
 * never fabricate/overwrite them — not even on a non-A/B event where the
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
export type GA4Payload = {
  client_id: string;
  events: Array<{ name: string; params: Record<string, unknown> }>;
  consent?: { ad_user_data: string; ad_personalization: string };
};

/**
 * Builds the MP payload from a {@link CMSEvent}. Pure (no I/O) + exported so the
 * mapping is unit-testable. Returns null when the event cannot be a valid MP hit
 * — no consent (analytics_storage not granted) or no client_id — so the caller
 * simply does not forward. The A/B attribution rides as GA4's
 * `experiment_id`/`experiment_variant` convention (event-scoped custom dims).
 */
export function buildGa4Payload(event: CMSEvent): GA4Payload | null {
  if (event.consent?.analytics_storage !== 'granted') return null;
  const clientId = event.transport?.clientId;
  if (!clientId) return null;

  const params: Record<string, unknown> = {
    // metadata FIRST, but with every server-owned param stripped: it is
    // public-ingest input (trackEvent body), so a caller can never fabricate or
    // overwrite experiment_id / experiment_variant / session_id /
    // engagement_time_msec / tracking_id / interaction_id — not even on a
    // non-A/B event where the server-derived value is absent (a plain
    // conditional spread would leave the attacker's value standing).
    ...sanitizeMetadata(event.metadata),
    // GA4 needs a non-zero engagement time, else the hit is realtime-invisible.
    engagement_time_msec: event.transport?.engagementTimeMsec ?? 1,
    ...(event.transport?.sessionId
      ? { session_id: event.transport.sessionId }
      : {}),
    ...(event.ab
      ? {
          experiment_id: event.ab.testId,
          experiment_variant: event.ab.variantId,
        }
      : {}),
    ...(event.source?.handle ? { tracking_id: event.source.handle } : {}),
    ...(event.interactionId ? { interaction_id: event.interactionId } : {}),
  };

  return {
    client_id: clientId,
    events: [{ name: event.name, params }],
    // GA4 Consent Mode block (ad signals). analytics_storage is already gated
    // above; the ad_* signals tell GA4 how it may use the data.
    ...(event.consent
      ? {
          consent: {
            ad_user_data: event.consent.ad_user_data,
            ad_personalization: event.consent.ad_personalization,
          },
        }
      : {}),
  };
}

/** Resolves the POST URL for a config (MP appends measurement_id + api_secret). */
function resolveUrl(config: GA4ServerConfig): string {
  if (config.type === 'sgtm') return config.endpointUrl;
  const sep = config.endpointUrl.includes('?') ? '&' : '?';
  return `${config.endpointUrl}${sep}measurement_id=${encodeURIComponent(
    config.measurementId,
  )}&api_secret=${encodeURIComponent(config.apiSecret)}`;
}

/** Max wall-clock the forward may add to the public ingest before it is aborted. */
const FORWARD_TIMEOUT_MS = 2000;

/**
 * Forwards one event to GA4 server-side, IF it is a valid consenting MP hit.
 * Best-effort + non-fatal: a network/endpoint error never breaks the ingest
 * (the A/B store write already happened). No-ops on missing consent/client_id.
 *
 * The trackEvent handler awaits this, so it is hard-bounded by an
 * {@link AbortSignal.timeout}: a slow/hung GA4/sGTM endpoint can never stall the
 * public response — the abort surfaces as a caught error and the ingest returns.
 */
export async function forwardToGa4(
  event: CMSEvent,
  config: GA4ServerConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const payload = buildGa4Payload(event);
  if (!payload) return; // not a consenting, identified hit → do not forward

  try {
    await fetchImpl(resolveUrl(config), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
    });
  } catch {
    // Non-fatal: the authoritative A/B store write already succeeded (a
    // network error, a non-2xx, or the timeout abort all land here).
  }
}
