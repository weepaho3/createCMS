import { useEffect } from 'react';

import type {
  CMSClientPlugin,
  CMSClientStore,
  CMSFetch,
} from '../../client/types';
import type { ConsentState } from './analytics/types';

import {
  CONSENT_WAIT_MS,
  createConsentGate,
  resolveVisitorKey,
  startConsentAutoRead,
} from '../consent';
import {
  createAbTestStoreSink,
  createGtmClientSink,
  dispatchEvent as dispatchToSinks,
  warnAbDrop,
  type ClientCMSEvent,
  type ClientEventSink,
} from './client-sinks';
import { $ERROR_CODES } from './errors';

export type {
  ConsentPurpose,
  ConsentSignal,
  ConsentState,
} from './analytics/types';

const PLUGIN_ID = 'abTest' as const;

const LS_CONTEXT_KEY = 'ab_test_context';
const LS_ASSIGNMENTS_KEY = 'ab_test_assignments';
const SS_IMPRESSIONS_KEY = 'ab_test_impressions';
const COOKIE_VID = 'ab_test_vid';
const ONE_YEAR_SEC = 31_536_000;

type AbTestContext = {
  key: string;
  anonymous?: boolean;
};

/** GA4 stitching ids read from the `_ga` cookies once analytics consent is granted. */
type GaTransport = {
  clientId: string;
  sessionId?: string;
  engagementTimeMsec: number;
};

type CachedAssignment = {
  variantId: string;
  branchId: string;
  assignedAt: number;
};

// Storage and cookie helpers (browser; all no-op under SSR)
// ============================================================================

function safeLocalStorageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeLocalStorageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // localStorage unavailable (SSR, private browsing, etc.)
  }
}

function safeLocalStorageRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // noop
  }
}

function safeSessionStorageGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSessionStorageSet(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // noop
  }
}

function safeSessionStorageRemove(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // noop
  }
}

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(
    new RegExp('(?:^|; )' + name + '=([^;]*)'),
  );
  return match ? decodeURIComponent(match[1]!) : null;
}

/** The GA4 client_id from the `_ga` cookie (`GA1.1.<id>.<ts>` → `<id>.<ts>`). */
function parseGaClientId(): string | undefined {
  const raw = getCookie('_ga');
  const m = raw?.match(/^GA\d\.\d\.(.+)$/);
  return m ? m[1] : undefined;
}

/**
 * GA4 session_id from a `_ga_<stream>` cookie (`GS1.1.<session_id>.…`).
 *
 * Single-stream assumption: this matches the FIRST `_ga_<stream>` cookie it
 * finds. With one GA4 data stream on the page (the common case) that is the
 * right one. If a page runs MULTIPLE GA4 streams, the picked session_id may
 * belong to a different stream than the server-MP `measurementId`, so session
 * stitching could then be off. We don't thread a stream hint because the
 * measurementId is server-only config the client can't see; session_id is
 * optional for the MP hit, so a mismatch degrades stitching, never the forward.
 */
function parseGaSessionId(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const m = document.cookie.match(/_ga_[A-Z0-9]+=GS\d\.\d\.(\d+)/);
  return m ? m[1] : undefined;
}

function setCookie(name: string, value: string, maxAgeSec: number): void {
  if (typeof document === 'undefined') return;
  const secure =
    typeof location !== 'undefined' && location.protocol === 'https:'
      ? '; Secure'
      : '';
  document.cookie = `${name}=${encodeURIComponent(
    value,
  )}; Path=/; Max-Age=${maxAgeSec}; SameSite=Lax${secure}`;
}

function removeCookie(name: string): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
}

function generateAnonKey(): string {
  const chars = '0123456789abcdefghijklmnopqrstuvwxyz';
  let result = '';
  for (let i = 0; i < 24; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return `anon_${result}`;
}

function readStoredAssignments(): Record<string, CachedAssignment> {
  const raw = safeLocalStorageGet(LS_ASSIGNMENTS_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function readStoredImpressions(): string[] {
  const raw = safeSessionStorageGet(SS_IMPRESSIONS_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

// Client plugin
// ============================================================================

export type AbTestClientOptions = {
  /**
   * Drop the client-side dataLayer/GTM sink. Enable this when the same goals
   * are forwarded server-side via the plugin's `ga4` config, otherwise GA4
   * double-counts (one hit from the browser push plus one from the server).
   * With it set, the consent-free anonymous A/B store leg still fires; only the
   * `window.dataLayer.push` leg is removed.
   */
  disableDataLayerSink?: boolean;
};

export function abTestClient(options?: AbTestClientOptions) {
  return {
    id: PLUGIN_ID,

    $ERROR_CODES,

    async init(_$fetch: CMSFetch, _$store: CMSClientStore) {
      // Identity and context hydrate lazily after consent is granted; device
      // storage must never be read before then (ePrivacy Art. 5(3) covers
      // reads too).
      return {
        context: {
          [`${PLUGIN_ID}:context`]: null,
        },
      };
    },

    getActions($fetch: CMSFetch, _$store: CMSClientStore, _baseURL: string) {
      const gate = createConsentGate();

      // A fired event fans out to these sinks; each gates on its own consent
      // requirement (see client-sinks.ts). The store leg is consent-free (an
      // anonymous aggregate count); the GA4/GTM leg is gated on
      // analytics_storage.
      const sinks: ClientEventSink[] = [
        createAbTestStoreSink($fetch),
        // The dataLayer leg is dropped when goals are forwarded server-side, to
        // avoid GA4 double-counting (see disableDataLayerSink).
        ...(options?.disableDataLayerSink ? [] : [createGtmClientSink()]),
      ];

      let context: AbTestContext | null = null;
      let memKey: string | null = null;
      // In-memory until consent is granted; hydrated from storage on grant.
      const assignmentCache: Record<string, CachedAssignment> = {};
      const impressionsSent = new Set<string>(); // confirmed emitted
      const impressionsQueued = new Set<string>(); // buffered, not yet decided
      let hydrated = false;

      // Seed the per-session impression dedup from sessionStorage at init
      // (consent-free, see persistImpressions). Without this, the anonymous
      // beacon re-fires on every hard reload (the in-memory Set only survives
      // soft SPA navigations), over-counting exactly the no-consent ad traffic
      // this path measures.
      for (const id of readStoredImpressions()) impressionsSent.add(id);

      const analyticsGranted = () => gate.isGranted('analytics_storage');

      /**
       * GA4 stitching ids for the server-side forward. Read the `_ga` cookie
       * only when analytics_storage is granted (it is an identifier) and a
       * `_ga` cookie exists (gtag loaded). Returns undefined otherwise, so the
       * server never forwards and the consent-free aggregate path stays
       * identifier-less.
       */
      function gaTransport(): GaTransport | undefined {
        if (!analyticsGranted()) return undefined;
        const clientId = parseGaClientId();
        if (!clientId) return undefined;
        const sessionId = parseGaSessionId();
        const transport: GaTransport = { clientId, engagementTimeMsec: 1 };
        if (sessionId) transport.sessionId = sessionId;
        return transport;
      }

      function persistAssignments() {
        if (!analyticsGranted()) return;
        safeLocalStorageSet(
          LS_ASSIGNMENTS_KEY,
          JSON.stringify(assignmentCache),
        );
      }
      function persistImpressions() {
        // Consent-free: the per-session impression markers are test ids (which
        // tests this tab already counted), session-only, client-only, never
        // transmitted, so not an identifier. Persisting them is what makes the
        // anonymous beacon dedup survive a hard reload; it must not be gated
        // on consent, unlike the identity-bearing assignment/context persists.
        safeSessionStorageSet(
          SS_IMPRESSIONS_KEY,
          JSON.stringify([...impressionsSent]),
        );
      }
      function persistContext() {
        if (!analyticsGranted() || !context) return;
        safeLocalStorageSet(LS_CONTEXT_KEY, JSON.stringify(context));
      }

      /** Resolve (and consent-gated persist) the visitor key. */
      function visitorKey(): string {
        const resolved = resolveVisitorKey({
          granted: analyticsGranted(),
          cookieKey: analyticsGranted() ? getCookie(COOKIE_VID) : null,
          memKey,
          generate: generateAnonKey,
        });
        memKey = resolved.memKey;
        if (resolved.persist) setCookie(COOKIE_VID, resolved.key, ONE_YEAR_SEC);
        return resolved.key;
      }

      /** One-time hydrate of prior identity + caches once consent is granted. */
      function hydrateOnGrant() {
        if (!hydrated) {
          hydrated = true;
          const storedAssignments = readStoredAssignments();
          for (const [testId, a] of Object.entries(storedAssignments)) {
            if (!assignmentCache[testId]) assignmentCache[testId] = a;
          }
          for (const id of readStoredImpressions()) impressionsSent.add(id);
          if (!context) {
            const saved = safeLocalStorageGet(LS_CONTEXT_KEY);
            if (saved) {
              try {
                context = JSON.parse(saved);
                if (context) memKey = context.key;
              } catch {
                // corrupted
              }
            }
          }
        }
        // Promote the in-memory key to the cookie so a buffered impression and
        // later events share one identity.
        if (memKey && !getCookie(COOKIE_VID)) {
          setCookie(COOKIE_VID, memKey, ONE_YEAR_SEC);
        }
        persistContext();
        persistAssignments();
        persistImpressions();
      }

      gate.onChange((state, resolved) => {
        if (resolved && state.analytics_storage === 'granted') hydrateOnGrant();
      });

      // Zero-config Consent Mode read + a wait-window fallback. Render never
      // waits on this; only event emission is buffered behind it.
      startConsentAutoRead(gate);
      if (typeof window !== 'undefined') {
        setTimeout(() => gate.resolve(), CONSENT_WAIT_MS);
      }

      function getContext(): AbTestContext {
        if (context) return context;
        throw new Error($ERROR_CODES.AB_TEST_NO_CONTEXT.message);
      }

      /** POST an event, stamping the live consent state at send time. */
      function postEvent(body: {
        testId: string;
        variantId: string;
        visitorId: string;
        anonymous: boolean;
        eventType: string;
        metadata?: Record<string, unknown>;
      }) {
        $fetch('/abTest/trackEvent', {
          method: 'POST',
          // keepalive: conversion beacons frequently fire on a navigating click;
          // survive the unload so the count is not lost.
          keepalive: true,
          body: {
            ...body,
            consent: gate.getState() as ConsentState,
          },
        }).catch(warnAbDrop);
      }

      function fireImpression(testId: string, variantId: string) {
        // Dedup on "queued or sent" to avoid double-buffering. The dedup mark
        // is committed only when the effect actually runs, and released on drop
        // so a later grant can still fire (no permanent suppression).
        if (impressionsSent.has(testId) || impressionsQueued.has(testId))
          return;
        impressionsQueued.add(testId);
        const ctx = getContext();
        const body = {
          testId,
          variantId,
          visitorId: ctx.key,
          anonymous: ctx.anonymous ?? false,
          eventType: 'impression',
        };
        gate.run(
          () => {
            impressionsQueued.delete(testId);
            if (impressionsSent.has(testId)) return;
            impressionsSent.add(testId);
            persistImpressions();
            postEvent(body);
          },
          () => {
            impressionsQueued.delete(testId);
          },
        );
      }

      /**
       * Pattern A impression: report the server-rendered variant by branch (the
       * edge already chose it, so no client re-bucketing). Anonymous and
       * consent-free by design: it sends no visitor id and is not
       * consent-gated, because an aggregate variant impression count carries no
       * identifier (the variant came from the URL). Deduped per session via
       * sessionStorage (client-only, never sent). The consent-gated legs
       * (GA4/dataLayer forwarding, unique-visitor identity) are separate;
       * trackEvent resolves the variant id from the branch.
       */
      function recordImpression(testId: string, branchId: string) {
        if (typeof document === 'undefined') return; // SSR no-op
        if (impressionsSent.has(testId)) return; // per-session dedup
        impressionsSent.add(testId);
        persistImpressions();
        // The on-mount impression is owned by the consent-free A/B store (the
        // experiment's source of truth) and is deliberately not forwarded
        // server-side: it fires before consent resolves, so no `transport` or
        // `consent` is stamped, which also keeps the anonymous aggregate count
        // clear of the server's denied-consent guard. GA4 still receives the
        // impression via the dataLayer leg (buffered, fires on grant) when that
        // sink is enabled; the server-side forward carries the post-consent
        // goal/conversion events. Read impression rates from the dashboard,
        // not GA4.
        dispatchToSinks(
          {
            name: 'impression',
            ab: { testId, branchId },
            anonymous: true,
          },
          sinks,
          gate,
        );
      }

      return {
        abTest: {
          /**
           * Tell the CMS about the visitor's consent (Consent Mode v2): a real
           * decision (treated like a Consent Mode `update`). Optional: the gate
           * also auto-reads Consent Mode commands off the dataLayer. That
           * auto-read is best-effort (a `push`-hook fast path plus a re-scan
           * poll); when running GTM, calling this from the CMP's Consent Mode
           * update callback is the most reliable path.
           */
          setConsent(consent: Partial<ConsentState>) {
            gate.applyUpdate(consent);
          },

          /** Read the current resolved consent state. */
          getConsent(): ConsentState {
            return gate.getState();
          },

          /**
           * Report the impression for a server-rendered variant (Pattern A).
           * Call with the served branch (the `/<branchId>/` URL segment).
           * Anonymous and consent-free: sends no visitor id, not consent-gated,
           * deduped per session via sessionStorage. Reach it from the variant
           * route via {@link useImpression}.
           */
          recordImpression,

          /**
           * React hook: fire the Pattern A impression once per (testId,
           * branchId) on mount. Render a tiny `'use client'` beacon from the
           * variant-coded route:
           * `cmsClient.abTest.useImpression(testId, branchId)`.
           */
          useImpression(testId: string, branchId: string) {
            useEffect(() => {
              recordImpression(testId, branchId);
            }, [testId, branchId]);
          },

          /**
           * Fire a raw client event through the sink pipeline (the same sinks
           * and consent gate as recordImpression, so consent state never
           * diverges). Anonymous aggregate legs are consent-free; the GA4/GTM
           * leg is gated.
           */
          dispatchEvent(event: ClientCMSEvent) {
            // Attach GA4 stitching ids (consent-gated) so a block or funnel
            // event can also forward server-side, unless the caller already set
            // transport. The anonymous store leg ignores them; the forward
            // needs them. Stamp consent alongside transport (both imply
            // analytics granted) so the server can authorize the forward; leave
            // both absent otherwise so the consent-free leg never trips the
            // server's denied-consent guard.
            const transport = event.transport ?? gaTransport();
            dispatchToSinks(
              transport
                ? {
                    ...event,
                    transport,
                    consent: event.consent ?? gate.getState(),
                  }
                : event,
              sinks,
              gate,
            );
          },

          identify(ctx: AbTestContext) {
            if (ctx.anonymous && !ctx.key) {
              context = { key: visitorKey(), anonymous: true };
            } else {
              context = { key: ctx.key, anonymous: ctx.anonymous ?? false };
              memKey = ctx.key;
            }
            persistContext();
          },

          async getVariant(testId: string) {
            const cached = assignmentCache[testId];
            if (cached) {
              fireImpression(testId, cached.variantId);
              return cached;
            }

            // Functional, visitor-independent assignment, allowed pre-consent
            // (renders the right variant; persists no identifier server-side).
            const result = (await $fetch('/abTest/assignVariant', {
              method: 'POST',
              body: {
                testId,
                context: getContext(),
              },
            })) as { variantId: string; branchId: string; inTest: boolean };

            const assignment: CachedAssignment = {
              variantId: result.variantId,
              branchId: result.branchId,
              assignedAt: Date.now(),
            };

            assignmentCache[testId] = assignment;
            persistAssignments();
            fireImpression(testId, result.variantId);

            return assignment;
          },

          reset() {
            context = null;
            memKey = null;
            hydrated = false;
            for (const key of Object.keys(assignmentCache)) {
              delete assignmentCache[key];
            }
            impressionsSent.clear();
            impressionsQueued.clear();

            safeLocalStorageRemove(LS_CONTEXT_KEY);
            safeLocalStorageRemove(LS_ASSIGNMENTS_KEY);
            safeSessionStorageRemove(SS_IMPRESSIONS_KEY);
            removeCookie(COOKIE_VID);

            // Revoke consent in-session; stops any further fan-out.
            gate.reset();
          },
        },
      };
    },

    pathMethods: {
      '/abTest/assignVariant': 'POST' as const,
      '/abTest/trackEvent': 'POST' as const,
      '/abTest/getResults': 'GET' as const,
    },
  } satisfies CMSClientPlugin;
}
