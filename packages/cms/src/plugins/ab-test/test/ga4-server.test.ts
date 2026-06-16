import { describe, expect, it, vi } from 'vitest';

import type { CMSEvent } from '../analytics/types';

import { buildGa4Payload, forwardToGa4 } from '../analytics/ga4-server';

const GRANTED = {
  analytics_storage: 'granted',
  ad_storage: 'granted',
  ad_user_data: 'granted',
  ad_personalization: 'denied',
} as const;

function evt(over: Partial<CMSEvent> = {}): CMSEvent {
  return {
    name: 'cms_cta_click',
    anonymous: false,
    ab: { testId: 't1', variantId: 'v1' },
    source: { handle: 'cta', type: 'ctaSection' },
    consent: { ...GRANTED },
    transport: {
      clientId: 'GA-CID',
      sessionId: 'SESS',
      engagementTimeMsec: 42,
    },
    timestamp: new Date(0),
    ...over,
  };
}

describe('M5 — buildGa4Payload', () => {
  it('builds a consenting MP payload with experiment dims + consent block', () => {
    const p = buildGa4Payload(evt())!;
    expect(p.client_id).toBe('GA-CID');
    expect(p.events[0]!.name).toBe('cms_cta_click');
    expect(p.events[0]!.params).toMatchObject({
      experiment_id: 't1',
      experiment_variant: 'v1',
      tracking_id: 'cta',
      session_id: 'SESS',
      engagement_time_msec: 42,
    });
    // analytics is gated above; the consent block carries the ad signals.
    expect(p.consent).toEqual({
      ad_user_data: 'granted',
      ad_personalization: 'denied',
    });
  });

  it('returns null without analytics consent', () => {
    expect(
      buildGa4Payload(
        evt({ consent: { ...GRANTED, analytics_storage: 'denied' } }),
      ),
    ).toBeNull();
  });

  it('returns null without a client_id', () => {
    expect(buildGa4Payload(evt({ transport: {} }))).toBeNull();
    expect(buildGa4Payload(evt({ transport: undefined }))).toBeNull();
  });

  it('defaults engagement_time_msec to 1', () => {
    const p = buildGa4Payload(evt({ transport: { clientId: 'C' } }))!;
    expect(p.events[0]!.params.engagement_time_msec).toBe(1);
  });

  const HIJACK = {
    experiment_id: 'HIJACK',
    experiment_variant: 'HIJACK',
    session_id: 'HIJACK',
    engagement_time_msec: 999_999,
    tracking_id: 'HIJACK',
    interaction_id: 'HIJACK',
  } as const;

  it('does NOT let metadata overwrite reserved params when the server value IS present', () => {
    // metadata is untrusted trackEvent input — a caller must not be able to
    // poison GA4 attribution by sending reserved keys as metadata.
    const p = buildGa4Payload(
      evt({
        interactionId: 'ix1',
        metadata: { ...HIJACK, placement: 'hero' }, // non-reserved key rides through
      }),
    )!;
    expect(p.events[0]!.params).toMatchObject({
      experiment_id: 't1',
      experiment_variant: 'v1',
      session_id: 'SESS',
      engagement_time_msec: 42,
      tracking_id: 'cta',
      interaction_id: 'ix1',
      placement: 'hero',
    });
  });

  it('STRIPS reserved metadata keys even when the server value is ABSENT (non-A/B event)', () => {
    // The dangerous case: a non-A/B event (no ab, no sessionId, no source,
    // no interactionId) — a conditional spread would leave the attacker's
    // metadata value standing. Reserved keys must be stripped outright.
    const p = buildGa4Payload(
      evt({
        ab: undefined,
        source: undefined,
        interactionId: undefined,
        transport: { clientId: 'C' }, // clientId only → no sessionId
        metadata: { ...HIJACK, placement: 'hero' },
      }),
    )!;
    const params = p.events[0]!.params;
    expect(params).not.toHaveProperty('experiment_id');
    expect(params).not.toHaveProperty('experiment_variant');
    expect(params).not.toHaveProperty('session_id');
    expect(params).not.toHaveProperty('tracking_id');
    expect(params).not.toHaveProperty('interaction_id');
    // engagement_time_msec is server-owned → defaulted, never the metadata value
    expect(params.engagement_time_msec).toBe(1);
    // a genuine custom param still passes through
    expect(params.placement).toBe('hero');
  });
});

describe('M5 — forwardToGa4', () => {
  it('POSTs to the MP endpoint with measurement_id + api_secret', async () => {
    const fetchMock = vi.fn().mockResolvedValue(undefined);
    await forwardToGa4(
      evt(),
      {
        type: 'measurementProtocol',
        endpointUrl: 'https://ga.example/mp/collect',
        measurementId: 'G-X',
        apiSecret: 'SECRET',
      },
      fetchMock as unknown as typeof fetch,
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      'https://ga.example/mp/collect?measurement_id=G-X&api_secret=SECRET',
    );
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body).client_id).toBe('GA-CID');
    // Hard-bounded so a slow endpoint can't stall the public ingest.
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('POSTs to the sGTM endpoint as-is', async () => {
    const fetchMock = vi.fn().mockResolvedValue(undefined);
    await forwardToGa4(
      evt(),
      { type: 'sgtm', endpointUrl: 'https://sgtm.example/collect' },
      fetchMock as unknown as typeof fetch,
    );
    expect(fetchMock.mock.calls[0]![0]).toBe('https://sgtm.example/collect');
  });

  it('does NOT POST without consent / client_id', async () => {
    const fetchMock = vi.fn();
    await forwardToGa4(
      evt({ consent: { ...GRANTED, analytics_storage: 'denied' } }),
      { type: 'sgtm', endpointUrl: 'x' },
      fetchMock as unknown as typeof fetch,
    );
    await forwardToGa4(
      evt({ transport: {} }),
      { type: 'sgtm', endpointUrl: 'x' },
      fetchMock as unknown as typeof fetch,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('swallows fetch errors (best-effort, never breaks ingest)', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network'));
    await expect(
      forwardToGa4(
        evt(),
        { type: 'sgtm', endpointUrl: 'x' },
        fetchMock as unknown as typeof fetch,
      ),
    ).resolves.toBeUndefined();
  });

  it('swallows the timeout abort so a hung endpoint cannot stall the ingest', async () => {
    // The forward is AWAITED in the trackEvent handler, so the AbortSignal.timeout
    // is what bounds it. Simulate the abort firing → it must resolve, not throw.
    const abortErr = new DOMException(
      'The operation timed out.',
      'TimeoutError',
    );
    const fetchMock = vi.fn().mockRejectedValue(abortErr);
    await expect(
      forwardToGa4(
        evt(),
        { type: 'sgtm', endpointUrl: 'x' },
        fetchMock as unknown as typeof fetch,
      ),
    ).resolves.toBeUndefined();
    // and the timeout signal really was attached
    expect(fetchMock.mock.calls[0]![1].signal).toBeInstanceOf(AbortSignal);
  });
});
