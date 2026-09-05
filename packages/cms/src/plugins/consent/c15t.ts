import { useEffect } from 'react';

import type { ConsentPurpose, ConsentState } from './types';

// ============================================================================
// c15t adapter: drive the createCMS consent gate from c15t's consent state
// ============================================================================

/**
 * Bridges [c15t](https://c15t.com) (the CMP) and the createCMS consent gate.
 *
 * c15t renders the banner, stores the decision, and exposes the visitor's
 * choice per consent category via `useConsentManager()`. The createCMS gate is
 * the consumer-side layer that buffers the CMS's own A/B and analytics side
 * effects until consent is decided. This adapter maps c15t's categories to
 * Google Consent Mode v2 signals and pushes them into the gate as a real
 * decision.
 *
 * It takes c15t's consent record as input (no `@c15t/*` dependency), and the
 * consumer wires c15t's hook in:
 *
 * ```tsx
 * import { useConsentManager } from '@c15t/react';
 * import { useC15tConsentBridge } from '@createcms/core/plugins/consent/c15t';
 *
 * function ConsentBridge() {
 *   const { consents, hasConsented } = useConsentManager();
 *   useC15tConsentBridge(cmsClient, { consents, hasConsented });
 *   return null;
 * }
 * // render <ConsentBridge /> inside c15t's <ConsentManagerProvider>
 * ```
 *
 * If c15t already pushes Consent Mode commands onto `window.dataLayer` (e.g.
 * via GTM), the gate's auto-read picks them up with no bridge at all. This
 * adapter is for offline or no-dataLayer setups, or for driving the gate
 * explicitly.
 */

/** Maps a c15t consent category to the Consent Mode v2 signals it grants. */
export type C15tCategoryMapping = Partial<
  Record<string, readonly ConsentPurpose[]>
>;

/**
 * Default c15t category to Consent Mode v2 mapping. Only `measurement` and
 * `marketing` map to signals the gate acts on; `necessary`, `functionality`
 * and `experience` are not analytics/ad storage and are ignored. Override for
 * non-standard category setups.
 */
export const DEFAULT_C15T_MAPPING: C15tCategoryMapping = {
  measurement: ['analytics_storage'],
  marketing: ['ad_storage', 'ad_user_data', 'ad_personalization'],
};

/**
 * Pure: map a c15t consents record (`{ measurement: true, marketing: false, … }`)
 * to a partial Consent Mode v2 {@link ConsentState}. A category absent from the
 * record (or the mapping) leaves its signals unset, so a partial decision stays
 * partial. Categories with no signal mapping are ignored.
 */
export function consentModeFromC15t(
  consents: Record<string, boolean | undefined> | null | undefined,
  mapping: C15tCategoryMapping = DEFAULT_C15T_MAPPING,
): Partial<ConsentState> {
  const out: Partial<ConsentState> = {};
  if (!consents) return out;
  for (const [category, signals] of Object.entries(mapping)) {
    const consented = consents[category];
    if (typeof consented !== 'boolean' || !signals) continue;
    const signal = consented ? 'granted' : 'denied';
    for (const s of signals) out[s] = signal;
  }
  return out;
}

/** The minimal createCMS client shape this adapter needs. */
type ConsentClient = {
  consent: { setConsent: (consent: Partial<ConsentState>) => void };
};

/** The bits of c15t's `useConsentManager()` store this adapter reads. */
export type C15tConsentInput = {
  /** c15t's per-category consent record, e.g. `{ measurement: true }`. */
  consents: Record<string, boolean | undefined> | null | undefined;
  /**
   * Whether the visitor has actually made a decision (vs. pre-banner defaults).
   * Derive it from c15t's store (e.g. `!!consentInfo` / `hasConsented`). The
   * gate is pushed only once this is true, so a pending banner never resolves
   * it as a premature deny; the gate's own wait-window covers the meantime.
   */
  hasConsented: boolean | undefined;
};

/**
 * React hook: push c15t's decision into the createCMS consent gate whenever it
 * changes (once the visitor has decided). Call it inside c15t's provider.
 */
export function useC15tConsentBridge(
  client: ConsentClient,
  c15t: C15tConsentInput,
  mapping: C15tCategoryMapping = DEFAULT_C15T_MAPPING,
): void {
  const { consents, hasConsented } = c15t;
  // `key` is the stringified mapped decision: the effect re-pushes only when
  // that changes, not on every render (c15t's `consents` is a fresh ref each
  // render). The decision holds only string signals, so the JSON round trip
  // is lossless.
  const key =
    hasConsented && consents
      ? JSON.stringify(consentModeFromC15t(consents, mapping))
      : '';

  useEffect(() => {
    if (key === '') return;
    client.consent.setConsent(JSON.parse(key) as Partial<ConsentState>);
  }, [client, key]);
}
