import type { CMSFetch } from '../../client/types';
import type { ConsentPurpose, ConsentState } from '../consent';

// Dev-only drop observability
// ============================================================================
//
// Analytics events are fire-and-forget: a failed send is swallowed so it never
// breaks the page (fail-silent). That silence hides a misconfigured ingest in
// development, so warn once per process on the first drop in dev. Production
// stays fully silent and the fail-silent guarantee is unchanged.
let abWarned = false;
export function warnAbDrop(err: unknown): void {
  if (process.env.NODE_ENV !== 'production' && !abWarned) {
    abWarned = true;
    console.warn('[cms:ab] analytics event dropped:', err);
  }
}

// Client-side event bus: sinks and dispatch (consent-aware fan-out)
// ============================================================================
//
// One fired CMS event fans out to several client destinations, each with its
// own consent requirement. A sink with no `requires` (the A/B store leg, an
// anonymous aggregate count) fires unconditionally: the count carries no
// identifier, ePrivacy "strictly necessary". A sink that forwards to GA4/GTM
// (`gtmClientSink`) requires `analytics_storage`, so the dispatcher
// buffers-then-flushes it behind the consent gate and drops it on denial.
// Nothing here blocks render or paint, and a sink that throws never breaks the
// page or its sibling sinks.

/**
 * The minimal structural view of the consent gate the dispatcher needs; keeps
 * this module decoupled from the full `ConsentGate` surface (and trivially
 * testable with a tiny fake).
 */
export type SinkConsentGate = {
  isGranted(purpose: ConsentPurpose): boolean;
  /**
   * Queue an analytics-gated effect: runs immediately if resolved+granted,
   * drops (`onDrop`) if resolved+denied, buffers while the consent decision is
   * still pending.
   */
  run(effect: () => void, onDrop?: () => void): void;
};

/**
 * The client-side event a sink receives. Decoupled from the server
 * `AnalyticsEvent` (no `timestamp`/storage `id`; those are minted server-side):
 * this is what the browser knows at fire time.
 */
export type ClientCMSEvent = {
  /** Canonical event name, e.g. `'impression' | 'conversion' | 'form_submit'`. */
  name: string;
  /**
   * A/B attribution by the server-served branch (Pattern A: the variant came
   * from the URL). `branchId` is what the client has; the store leg resolves it
   * to a `variantId` server-side. Absent for non-A/B analytics events.
   */
  ab?: { testId: string; branchId?: string; variantId?: string };
  /** Identity, only on the consent-gated unique-visitor path; never anonymous. */
  visitorId?: string;
  /** True when no identifier is attached (the consent-free aggregate path). */
  anonymous: boolean;
  /** Originating functional block instance (the `trackingId` + block type). */
  source?: { handle?: string; type?: string };
  /** Funnel grouping id: shared by the attempt and success legs of one interaction. */
  interactionId?: string;
  /**
   * GA4 stitching ids: set only when consent is granted; the store leg forwards
   * them so the server-side forward can attribute the hit.
   */
  transport?: {
    clientId?: string;
    sessionId?: string;
    engagementTimeMsec?: number;
  };
  /**
   * Consent Mode v2 state at fire time, stamped alongside `transport` (only
   * when analytics_storage is granted) so the store leg can relay it to the
   * server, where `buildGa4Payload` needs it to authorize the forward. Absent
   * on the consent-free anonymous path; its absence keeps the server's
   * denied-consent guard from dropping the anonymous aggregate count.
   */
  consent?: ConsentState;
  /** Scalar event params (GA4 wire params). */
  params?: Record<string, string | number | boolean>;
  metadata?: Record<string, unknown>;
};

/** A client-side analytics destination for a fired event. */
export type ClientEventSink = {
  id: string;
  /**
   * Consent purpose this sink requires. Omit for consent-free sinks (anonymous
   * aggregate counts). When set, the dispatcher routes the send through the
   * gate's buffer-then-flush and drops it if consent is denied. The gate's
   * buffering keys on `analytics_storage` resolution, so other purposes are
   * re-checked at drain time but still wait on the analytics decision.
   */
  requires?: ConsentPurpose;
  /** Best-effort send. MUST NOT throw (never blocks paint, never bubbles). */
  send(event: ClientCMSEvent): void;
};

function safeSend(sink: ClientEventSink, event: ClientCMSEvent): void {
  try {
    sink.send(event);
  } catch (err) {
    // A sink must never break the page or its sibling sinks.
    warnAbDrop(err);
  }
}

/**
 * Fan one event out to every sink, honoring each sink's consent requirement.
 * Consent-free sinks fire immediately; gated sinks go through the gate's
 * buffer-then-flush and only fire once analytics consent resolves to granted.
 */
export function dispatchEvent(
  event: ClientCMSEvent,
  sinks: readonly ClientEventSink[],
  gate: SinkConsentGate,
): void {
  for (const sink of sinks) {
    if (!sink.requires) {
      safeSend(sink, event);
      continue;
    }
    const purpose = sink.requires;
    gate.run(() => {
      if (gate.isGranted(purpose)) safeSend(sink, event);
    });
  }
}

// Built-in sinks
// ============================================================================

/**
 * The A/B store leg: the keepalive POST to the CMS event ingest. Consent-free
 * (no `requires`); it records the anonymous aggregate count that drives the
 * A/B winner. The identity-bearing unique-visitor leg is a separate, gated
 * concern.
 */
export function createAbTestStoreSink($fetch: CMSFetch): ClientEventSink {
  return {
    id: 'abTestStore',
    send(event) {
      $fetch('/abTest/trackEvent', {
        method: 'POST',
        // keepalive: a goal beacon often fires on a CTA click that navigates
        // away. Without it the browser cancels the in-flight POST and the count
        // is lost (and the per-session dedup already marked it sent).
        keepalive: true,
        body: {
          eventType: event.name,
          anonymous: event.anonymous,
          ...(event.ab?.testId ? { testId: event.ab.testId } : {}),
          ...(event.ab?.branchId ? { branchId: event.ab.branchId } : {}),
          ...(event.ab?.variantId ? { variantId: event.ab.variantId } : {}),
          ...(event.visitorId ? { visitorId: event.visitorId } : {}),
          ...(event.source ? { source: event.source } : {}),
          ...(event.interactionId
            ? { interactionId: event.interactionId }
            : {}),
          ...(event.transport ? { transport: event.transport } : {}),
          ...(event.consent ? { consent: event.consent } : {}),
          ...(event.metadata ? { metadata: event.metadata } : {}),
        },
      }).catch(warnAbDrop);
    },
  };
}

type DataLayerWindow = { dataLayer?: Record<string, unknown>[] };

/**
 * The GA4/GTM client sink: a single `window.dataLayer.push`, consent-gated on
 * `analytics_storage`. This is the GA4-forwarding path. GTM's own Consent Mode
 * is a second line of defence; gating here keeps one auditable consent
 * decision on our side too.
 */
export function createGtmClientSink(): ClientEventSink {
  return {
    id: 'gtm',
    requires: 'analytics_storage',
    send(event) {
      if (typeof window === 'undefined') return;
      const w = window as unknown as DataLayerWindow;
      const dataLayer = (w.dataLayer = w.dataLayer ?? []);
      dataLayer.push({
        event: event.name,
        ...(event.ab
          ? {
              ab_test_id: event.ab.testId,
              ab_variant: event.ab.branchId ?? event.ab.variantId,
            }
          : {}),
        ...(event.source?.handle ? { tracking_id: event.source.handle } : {}),
        ...(event.source?.type ? { block_type: event.source.type } : {}),
        ...(event.interactionId ? { interaction_id: event.interactionId } : {}),
        ...event.params,
      });
    },
  };
}
