// ============================================================================
// Consent (Google Consent Mode v2)
// ============================================================================

export type ConsentSignal = 'granted' | 'denied';

/**
 * The four Google Consent Mode v2 signals, as emitted by major CMPs
 * (Cookiebot, Usercentrics, OneTrust). `analytics_storage` gates the A/B and
 * analytics path; the `ad_*` signals gate any ad-related fan-out.
 */
export type ConsentState = {
  analytics_storage: ConsentSignal;
  ad_storage: ConsentSignal;
  ad_user_data: ConsentSignal;
  ad_personalization: ConsentSignal;
};

export type ConsentPurpose = keyof ConsentState;
