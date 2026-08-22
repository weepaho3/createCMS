import { describe, expect, it, vi } from 'vitest';

import type { CMSFetch } from '../../../client/types';

import { createConsentGate } from '../../consent';
import {
  createAbTestStoreSink,
  createGtmClientSink,
  dispatchEvent,
  type ClientCMSEvent,
  type ClientEventSink,
} from '../client-sinks';

function recordingSink(
  id: string,
  requires?: ClientEventSink['requires'],
): ClientEventSink & { sent: ClientCMSEvent[] } {
  const sent: ClientCMSEvent[] = [];
  return {
    id,
    requires,
    sent,
    send(event) {
      sent.push(event);
    },
  };
}

const IMPRESSION: ClientCMSEvent = {
  name: 'impression',
  ab: { testId: 't1', branchId: 'b1' },
  anonymous: true,
};

describe('client-side sink dispatch', () => {
  it('fires a consent-free sink immediately, regardless of consent state', () => {
    const store = recordingSink('abTestStore'); // no `requires`
    const gate = createConsentGate(); // default-deny, unresolved

    dispatchEvent(IMPRESSION, [store], gate);

    // Anonymous aggregate count must NOT wait on consent.
    expect(store.sent).toHaveLength(1);
    expect(store.sent[0]).toEqual(IMPRESSION);
  });

  it('buffers a gated sink while consent is pending, then flushes on grant', () => {
    const gtm = recordingSink('gtm', 'analytics_storage');
    const gate = createConsentGate();

    dispatchEvent(IMPRESSION, [gtm], gate);
    expect(gtm.sent).toHaveLength(0); // pending → buffered

    gate.applyUpdate({ analytics_storage: 'granted' });
    expect(gtm.sent).toHaveLength(1); // flushed
  });

  it('drops a gated sink when consent resolves denied', () => {
    const gtm = recordingSink('gtm', 'analytics_storage');
    const gate = createConsentGate();

    dispatchEvent(IMPRESSION, [gtm], gate);
    gate.applyUpdate({ analytics_storage: 'denied' });

    expect(gtm.sent).toHaveLength(0);
  });

  it('fans one event to a consent-free + a gated sink with independent gating', () => {
    const store = recordingSink('abTestStore');
    const gtm = recordingSink('gtm', 'analytics_storage');
    const gate = createConsentGate();

    dispatchEvent(IMPRESSION, [store, gtm], gate);

    // Consent-free leg already fired; gated leg waits.
    expect(store.sent).toHaveLength(1);
    expect(gtm.sent).toHaveLength(0);

    gate.applyUpdate({ analytics_storage: 'granted' });
    expect(gtm.sent).toHaveLength(1);
    expect(store.sent).toHaveLength(1); // not re-sent
  });

  it('a throwing sink never breaks its siblings', () => {
    const boom: ClientEventSink = {
      id: 'boom',
      send() {
        throw new Error('sink exploded');
      },
    };
    const store = recordingSink('abTestStore');
    const gate = createConsentGate();

    expect(() => dispatchEvent(IMPRESSION, [boom, store], gate)).not.toThrow();
    expect(store.sent).toHaveLength(1);
  });

  it('a gated sink that was granted before dispatch fires immediately', () => {
    const gtm = recordingSink('gtm', 'analytics_storage');
    const gate = createConsentGate();
    gate.applyUpdate({ analytics_storage: 'granted' });

    dispatchEvent(IMPRESSION, [gtm], gate);
    expect(gtm.sent).toHaveLength(1);
  });
});

describe('gtmClientSink', () => {
  it('pushes a GA4-shaped entry onto window.dataLayer with the A/B dimensions', () => {
    const dataLayer: Record<string, unknown>[] = [];
    vi.stubGlobal('window', { dataLayer });

    const gtm = createGtmClientSink();
    expect(gtm.requires).toBe('analytics_storage');

    gtm.send({
      name: 'conversion',
      ab: { testId: 't1', branchId: 'b1' },
      anonymous: true,
      source: { handle: 'signup-cta', type: 'ctaButton' },
      params: { value: 1 },
    });

    expect(dataLayer).toHaveLength(1);
    expect(dataLayer[0]).toEqual({
      event: 'conversion',
      ab_test_id: 't1',
      ab_variant: 'b1',
      tracking_id: 'signup-cta',
      block_type: 'ctaButton',
      value: 1,
    });

    vi.unstubAllGlobals();
  });

  it('initializes window.dataLayer if absent', () => {
    vi.stubGlobal('window', {});
    const gtm = createGtmClientSink();
    gtm.send({ name: 'page_view', anonymous: true });
    expect(
      (window as unknown as { dataLayer: unknown[] }).dataLayer,
    ).toHaveLength(1);
    vi.unstubAllGlobals();
  });
});

describe('abTestStoreSink relays the server-MP context', () => {
  function fetchSpy() {
    const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
    const fetch = ((path: string, init: { body: Record<string, unknown> }) => {
      calls.push({ path, body: init.body });
      return Promise.resolve({});
    }) as unknown as CMSFetch;
    return { fetch, calls };
  }

  const GRANTED = {
    analytics_storage: 'granted',
    ad_storage: 'granted',
    ad_user_data: 'granted',
    ad_personalization: 'granted',
  } as const;

  it('relays consent + transport into the POST body when present on the event', () => {
    // This guards the relay only (the sink copies whatever it is handed); the
    // decision of when to stamp consent/transport lives in client.ts and is
    // covered in client.test.ts.
    const { fetch, calls } = fetchSpy();
    createAbTestStoreSink(fetch).send({
      name: 'impression',
      ab: { testId: 't1', branchId: 'b1' },
      anonymous: true,
      transport: { clientId: 'GA-CID', engagementTimeMsec: 1 },
      consent: { ...GRANTED },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toMatchObject({
      eventType: 'impression',
      transport: { clientId: 'GA-CID' },
      consent: { analytics_storage: 'granted' },
    });
  });

  it('omits consent on the consent-free anonymous path', () => {
    // No consent stamped: the server's denied-consent guard cannot drop the
    // anonymous aggregate count.
    const { fetch, calls } = fetchSpy();
    createAbTestStoreSink(fetch).send({
      name: 'impression',
      ab: { testId: 't1', branchId: 'b1' },
      anonymous: true,
    });

    expect(calls[0]!.body).not.toHaveProperty('consent');
    expect(calls[0]!.body).not.toHaveProperty('transport');
  });
});
