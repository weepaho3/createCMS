import { describe, expect, it } from 'vitest';

import { consentModeFromC15t } from '../c15t';
import { createConsentGate } from '../gate';

describe('consentModeFromC15t', () => {
  it('maps measurement → analytics_storage and marketing → the three ad_* signals', () => {
    expect(
      consentModeFromC15t({ measurement: true, marketing: false }),
    ).toEqual({
      analytics_storage: 'granted',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
    });
  });

  it('ignores categories with no Consent Mode mapping (necessary/functionality/experience)', () => {
    expect(
      consentModeFromC15t({
        necessary: true,
        functionality: true,
        experience: false,
      }),
    ).toEqual({});
  });

  it('leaves an absent category unset — a partial decision stays partial', () => {
    expect(consentModeFromC15t({ measurement: true })).toEqual({
      analytics_storage: 'granted',
    });
  });

  it('returns {} for null/undefined consents', () => {
    expect(consentModeFromC15t(null)).toEqual({});
    expect(consentModeFromC15t(undefined)).toEqual({});
  });

  it('honours a custom category mapping', () => {
    expect(
      consentModeFromC15t(
        { analytics: true },
        { analytics: ['analytics_storage'] },
      ),
    ).toEqual({ analytics_storage: 'granted' });
  });
});

describe('c15t → consent gate integration', () => {
  it('grants and flushes buffered effects when measurement is consented', () => {
    const gate = createConsentGate();
    let ran = 0;
    gate.run(() => {
      ran++;
    });
    expect(ran).toBe(0); // buffered while pending

    gate.applyUpdate(
      consentModeFromC15t({ measurement: true, marketing: false }),
    );

    expect(gate.isResolved()).toBe(true);
    expect(gate.isGranted('analytics_storage')).toBe(true);
    expect(gate.isGranted('ad_storage')).toBe(false);
    expect(ran).toBe(1); // buffered effect flushed
  });

  it('drops buffered effects when measurement is denied', () => {
    const gate = createConsentGate();
    let ran = 0;
    let dropped = 0;
    gate.run(
      () => {
        ran++;
      },
      () => {
        dropped++;
      },
    );

    gate.applyUpdate(consentModeFromC15t({ measurement: false }));

    expect(gate.isResolved()).toBe(true);
    expect(ran).toBe(0);
    expect(dropped).toBe(1);
  });
});
