// ============================================================================
// Consent (Google Consent Mode v2)
// ============================================================================

export type ConsentSignal = 'granted' | 'denied';

/**
 * The four Google Consent Mode v2 signals. Every major CMP (Cookiebot,
 * Usercentrics, OneTrust) emits these, so a single inbound contract covers all.
 * `analytics_storage` gates the A/B + analytics path; the `ad_*` signals gate
 * any ad-related fan-out.
 */
export type ConsentState = {
  analytics_storage: ConsentSignal;
  ad_storage: ConsentSignal;
  ad_user_data: ConsentSignal;
  ad_personalization: ConsentSignal;
};

export type ConsentPurpose = keyof ConsentState;
