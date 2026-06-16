import { describe, expect, it } from 'vitest';

import { getPrivacyNoticeItems } from '../privacy-notice';

describe('M5 — getPrivacyNoticeItems', () => {
  it('lists the consent-free items as strictly-necessary (no consent)', () => {
    const items = getPrivacyNoticeItems();
    const variant = items.find((i) => i.name.startsWith('ab_'))!;
    expect(variant.type).toBe('cookie');
    expect(variant.consentRequired).toBeNull(); // strictly-necessary
    expect(variant.isIdentifier).toBe(false);

    const dedup = items.find((i) => i.name === 'ab_test_impressions')!;
    expect(dedup.consentRequired).toBeNull();
    expect(dedup.isIdentifier).toBe(false);
  });

  it('marks the identity items as analytics_storage-gated identifiers', () => {
    const items = getPrivacyNoticeItems();
    const vid = items.find((i) => i.name === 'ab_test_vid')!;
    expect(vid.isIdentifier).toBe(true);
    expect(vid.consentRequired).toBe('analytics_storage');
  });

  it('always discloses the _ga read (it happens whenever analytics is granted)', () => {
    // The client reads `_ga` whenever analytics_storage is granted, independent
    // of server-MP — so it must always be disclosed, not gated on ga4.
    const ga = getPrivacyNoticeItems().find((i) => i.name.startsWith('_ga'))!;
    expect(ga.type).toBe('external-cookie-read');
    expect(ga.consentRequired).toBe('analytics_storage');
    // Without server-MP, the id is not forwarded to GA4.
    expect(ga.recipient).not.toContain('Google Analytics 4');
  });

  it('names GA4 as the _ga recipient once server-MP is enabled', () => {
    const ga = getPrivacyNoticeItems({ ga4: true }).find((i) =>
      i.name.startsWith('_ga'),
    )!;
    expect(ga.recipient).toContain('Google Analytics 4');
    expect(ga.consentRequired).toBe('analytics_storage');
  });

  it('honors the variant cookie prefix', () => {
    const items = getPrivacyNoticeItems({ variantCookiePrefix: 'xp_' });
    expect(items.some((i) => i.name === 'xp_<testId>')).toBe(true);
  });
});
