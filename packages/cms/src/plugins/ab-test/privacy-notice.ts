import type { ConsentPurpose } from '../consent';

// ============================================================================
// Privacy-notice export
// ============================================================================
//
// A static, build-time list of every id/cookie/storage the A/B measurement
// stack uses, for a consumer's privacy policy. Pure (no I/O); the consent-free
// items (variant cookie, session dedup markers) carry `consentRequired: null`
// (ePrivacy strictly-necessary), the identity/forwarding items name their
// purpose + recipient.

export type PrivacyNoticeItem = {
  name: string;
  type: 'cookie' | 'sessionStorage' | 'localStorage' | 'external-cookie-read';
  purpose: string;
  lifetime: string;
  /** Whether the value can identify/re-identify a visitor. */
  isIdentifier: boolean;
  /** The consent purpose gating it, or null when strictly-necessary (no consent). */
  consentRequired: ConsentPurpose | null;
  recipient: string;
};

/**
 * The A/B measurement privacy-notice items. The `_ga` read is ALWAYS listed: the
 * client reads `_ga` whenever `analytics_storage` is granted (to obtain the GA4
 * client_id), independent of server-MP. Pass `ga4: true` when the server-MP
 * forward is configured; it only changes the `_ga` recipient/purpose to
 * name Google Analytics 4 as the destination of the forwarded hit.
 * `variantCookiePrefix` must match the middleware's `variantCookiePrefix`.
 */
export function getPrivacyNoticeItems(options?: {
  ga4?: boolean;
  variantCookiePrefix?: string;
}): PrivacyNoticeItem[] {
  const prefix = options?.variantCookiePrefix ?? 'ab_';

  const items: PrivacyNoticeItem[] = [
    {
      name: `${prefix}<testId>`,
      type: 'cookie',
      purpose:
        'Keeps the served A/B test variant consistent across requests — stores ONLY the variant code, no identifier.',
      lifetime: '30 days',
      isIdentifier: false,
      // ePrivacy "strictly necessary": first-party, no behavioural data, never
      // sent to a third party, so no consent required.
      consentRequired: null,
      recipient: 'First-party (this site)',
    },
    {
      name: 'ab_test_impressions',
      type: 'sessionStorage',
      purpose:
        'Per-session dedup of anonymous A/B impression/goal beacons (which tests this tab already counted).',
      lifetime: 'Session (cleared when the tab closes)',
      isIdentifier: false,
      consentRequired: null,
      recipient: 'First-party (never transmitted)',
    },
    {
      name: 'ab_test_vid',
      type: 'cookie',
      purpose:
        'A unique visitor id for the consent-gated unique-visitor / GA4 path. Written only after consent.',
      lifetime: '1 year',
      isIdentifier: true,
      consentRequired: 'analytics_storage',
      recipient: 'First-party A/B store',
    },
    {
      name: 'ab_test_assignments, ab_test_context',
      type: 'localStorage',
      purpose:
        "Persists the visitor's variant assignments + context after consent so they stay stable across visits.",
      lifetime: 'Persistent (until cleared, or abTest.reset())',
      isIdentifier: true,
      consentRequired: 'analytics_storage',
      recipient: 'First-party (never transmitted)',
    },
    {
      name: '_ga, _ga_<stream>',
      type: 'external-cookie-read',
      // Always disclosed: the client reads `_ga` whenever analytics_storage is
      // granted to obtain the GA4 client_id/session_id. Whether that id is then
      // forwarded to GA4 depends on the server-MP (`ga4`) config, reflected in
      // the recipient below.
      purpose: options?.ga4
        ? 'READ (never set by the CMS) to obtain the GA4 client_id / session_id, forwarded server-side via the Measurement Protocol.'
        : 'READ (never set by the CMS) to obtain the GA4 client_id / session_id for analytics stitching.',
      lifetime: 'Per your Google Analytics configuration (typically 2 years)',
      isIdentifier: true,
      consentRequired: 'analytics_storage',
      recipient: options?.ga4
        ? 'Google Analytics 4 (via the server-MP forward)'
        : 'First-party A/B store',
    },
  ];

  return items;
}
