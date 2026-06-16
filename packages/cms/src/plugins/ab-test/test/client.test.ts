import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CMSClientStore, CMSFetch } from '../../../client/types';

import { abTestClient } from '../client';

// ============================================================================
// M5 — client-side stamping logic (consent/transport) + sink composition.
// These exercise abTestClient().getActions(...) directly — the layer the M5
// fix lives in — instead of the dumb store-sink relay, so a regression in the
// "stamp consent ALONGSIDE transport, never on the on-mount impression" rule
// is actually caught (the earlier store-sink tests would pass either way).
// ============================================================================

const GRANTED = {
  analytics_storage: 'granted',
  ad_storage: 'granted',
  ad_user_data: 'granted',
  ad_personalization: 'granted',
} as const;

type TrackBody = {
  eventType: string;
  consent?: { analytics_storage: string };
  transport?: { clientId?: string };
};

function setup(options?: { disableDataLayerSink?: boolean }) {
  const calls: Array<{ path: string; body: TrackBody }> = [];
  const $fetch = ((path: string, init?: { body?: unknown }) => {
    calls.push({ path, body: init?.body as TrackBody });
    return Promise.resolve({});
  }) as unknown as CMSFetch;
  const $store: CMSClientStore = {
    notify() {},
    listen() {},
    atoms: {},
  };
  const actions = abTestClient(options).getActions!(
    $fetch,
    $store,
    'http://localhost',
  ) as { abTest: Record<string, (...args: unknown[]) => unknown> };
  return { abTest: actions.abTest, calls };
}

describe('M5 — client stamps consent only alongside transport', () => {
  beforeEach(() => {
    // No window ⇒ the dataLayer sink no-ops and no consent-wait timer/interval
    // is scheduled; we only inspect the store-leg POST body here.
    vi.stubGlobal('document', { cookie: '_ga=GA1.1.CID.1' });
    vi.stubGlobal('sessionStorage', {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    });
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('dispatchEvent stamps transport + consent once analytics is granted', () => {
    const { abTest, calls } = setup();
    abTest.setConsent({ ...GRANTED });

    abTest.dispatchEvent({
      name: 'conversion',
      ab: { testId: 't1', branchId: 'b1' },
      anonymous: false,
    });

    const post = calls.find((c) => c.path === '/abTest/trackEvent')!;
    expect(post.body.transport?.clientId).toBe('CID.1'); // read from _ga
    expect(post.body.consent?.analytics_storage).toBe('granted');
  });

  it('dispatchEvent omits transport + consent while analytics is NOT granted', () => {
    const { abTest, calls } = setup();
    // no setConsent → gate denied/pending → gaTransport() returns undefined

    abTest.dispatchEvent({
      name: 'conversion',
      ab: { testId: 't1', branchId: 'b1' },
      anonymous: false,
    });

    const post = calls.find((c) => c.path === '/abTest/trackEvent')!;
    expect(post.body).not.toHaveProperty('transport');
    // critical: no denied/pending consent stamp ⇒ the server's denied-consent
    // guard can never drop this consent-free aggregate count.
    expect(post.body).not.toHaveProperty('consent');
  });

  it('recordImpression NEVER stamps transport/consent, even when granted (Design B)', () => {
    const { abTest, calls } = setup();
    abTest.setConsent({ ...GRANTED }); // granted AND _ga present…

    abTest.recordImpression('t1', 'b1');

    const post = calls.find((c) => c.path === '/abTest/trackEvent')!;
    expect(post.body.eventType).toBe('impression');
    // …yet the on-mount impression is owned by the consent-free A/B store and is
    // never server-MP-forwarded, so it must carry neither field.
    expect(post.body).not.toHaveProperty('transport');
    expect(post.body).not.toHaveProperty('consent');
  });
});

describe('M5 — disableDataLayerSink drops only the dataLayer leg', () => {
  beforeEach(() => {
    vi.useFakeTimers(); // neutralize the consent-wait timer + auto-read poll
    vi.stubGlobal('window', { dataLayer: [] as Record<string, unknown>[] });
    vi.stubGlobal('document', { cookie: '_ga=GA1.1.CID.1' });
    vi.stubGlobal('sessionStorage', {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    });
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function dataLayer() {
    return (window as unknown as { dataLayer: unknown[] }).dataLayer;
  }

  it('default: the dataLayer leg fires alongside the consent-free store leg', () => {
    const { abTest, calls } = setup();
    abTest.setConsent({ ...GRANTED });

    abTest.dispatchEvent({
      name: 'conversion',
      ab: { testId: 't1', branchId: 'b1' },
      anonymous: false,
    });

    expect(calls.some((c) => c.path === '/abTest/trackEvent')).toBe(true);
    expect(
      dataLayer().some((e) => (e as { event: string }).event === 'conversion'),
    ).toBe(true);
  });

  it('disabled: the store leg still fires, the dataLayer leg does not', () => {
    const { abTest, calls } = setup({ disableDataLayerSink: true });
    abTest.setConsent({ ...GRANTED });

    abTest.dispatchEvent({
      name: 'conversion',
      ab: { testId: 't1', branchId: 'b1' },
      anonymous: false,
    });

    expect(calls.some((c) => c.path === '/abTest/trackEvent')).toBe(true);
    expect(dataLayer()).toHaveLength(0); // no GA4 double-count
  });
});
