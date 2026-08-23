import { describe, expect, it, vi } from 'vitest';

import {
  DENIED_ALL,
  createConsentGate,
  parseConsentEntries,
  parseConsentEntry,
  resolveVisitorKey,
} from '../gate';

// ============================================================================
// parseConsentEntry / parseConsentEntries
// ============================================================================

describe('parseConsentEntry', () => {
  it('parses an arguments-object `update` and exposes the mode', () => {
    // gtag('consent','update',{...}) lands on the dataLayer as an arguments
    // object: array-like (indexed keys + length), not a real array.
    const argsLike = {
      0: 'consent',
      1: 'update',
      2: { analytics_storage: 'granted', ad_storage: 'denied' },
      length: 3,
    };
    expect(parseConsentEntry(argsLike)).toEqual({
      mode: 'update',
      state: { analytics_storage: 'granted', ad_storage: 'denied' },
    });
  });

  it('parses a real-array `default` and keeps the mode distinct', () => {
    expect(
      parseConsentEntry([
        'consent',
        'default',
        { analytics_storage: 'denied' },
      ]),
    ).toEqual({ mode: 'default', state: { analytics_storage: 'denied' } });
  });

  it('ignores non-consent entries and unknown modes', () => {
    expect(parseConsentEntry({ event: 'page_view' })).toBeNull();
    expect(parseConsentEntry(['config', 'G-XXX'])).toBeNull();
    expect(
      parseConsentEntry(['consent', 'bogus', { analytics_storage: 'granted' }]),
    ).toBeNull();
    expect(parseConsentEntry(['consent', 'update', {}])).toBeNull();
    expect(parseConsentEntry(null)).toBeNull();
    expect(parseConsentEntry('consent')).toBeNull();
  });

  it('drops invalid signal values', () => {
    expect(
      parseConsentEntry(['consent', 'update', { analytics_storage: 'maybe' }]),
    ).toBeNull();
  });
});

describe('parseConsentEntries', () => {
  it('returns parsed consent commands in order, preserving modes', () => {
    const dl = [
      [
        'consent',
        'default',
        { analytics_storage: 'denied', ad_storage: 'denied' },
      ],
      { event: 'gtm.js' },
      ['consent', 'update', { analytics_storage: 'granted' }],
    ];
    expect(parseConsentEntries(dl)).toEqual([
      {
        mode: 'default',
        state: { analytics_storage: 'denied', ad_storage: 'denied' },
      },
      { mode: 'update', state: { analytics_storage: 'granted' } },
    ]);
  });

  it('returns an empty array when no consent commands present', () => {
    expect(parseConsentEntries([{ event: 'x' }, ['config', 'G-1']])).toEqual(
      [],
    );
  });
});

// ============================================================================
// createConsentGate: default-deny + buffer-then-flush
// ============================================================================

describe('createConsentGate', () => {
  it('defaults to denied + unresolved', () => {
    const gate = createConsentGate();
    expect(gate.getState()).toEqual(DENIED_ALL);
    expect(gate.isResolved()).toBe(false);
    expect(gate.isGranted('analytics_storage')).toBe(false);
  });

  it('a denied `default` does not resolve the gate (keeps the wait window open)', () => {
    const gate = createConsentGate();
    const effect = vi.fn();
    gate.run(effect);

    gate.applyDefault({ analytics_storage: 'denied' });
    expect(gate.isResolved()).toBe(false); // still pending, window not collapsed
    expect(effect).not.toHaveBeenCalled();
  });

  it('default(denied) then buffered impression, then update(granted) flushes', () => {
    const gate = createConsentGate();
    const effect = vi.fn();

    gate.applyDefault({ analytics_storage: 'denied' }); // in-head Consent Mode
    gate.run(effect); // impression buffered (banner not answered yet)
    expect(effect).not.toHaveBeenCalled();

    gate.applyUpdate({ analytics_storage: 'granted' }); // user accepts
    expect(gate.isResolved()).toBe(true);
    expect(effect).toHaveBeenCalledTimes(1); // flushed, not dropped
  });

  it('a partial update without analytics_storage does not resolve (stays buffered)', () => {
    const gate = createConsentGate();
    const effect = vi.fn();
    gate.run(effect);

    gate.applyUpdate({ ad_storage: 'granted' }); // staged category grant
    expect(gate.isResolved()).toBe(false);
    expect(effect).not.toHaveBeenCalled();

    gate.applyUpdate({ analytics_storage: 'granted' }); // analytics decided later
    expect(effect).toHaveBeenCalledTimes(1);
  });

  it('runs effects immediately once resolved+granted', () => {
    const gate = createConsentGate();
    gate.applyUpdate({ analytics_storage: 'granted' });
    const effect = vi.fn();
    gate.run(effect);
    expect(effect).toHaveBeenCalledTimes(1);
  });

  it('drops buffered effects (and calls onDrop) on explicit analytics denial', () => {
    const gate = createConsentGate();
    const effect = vi.fn();
    const onDrop = vi.fn();
    gate.run(effect, onDrop);

    gate.applyUpdate({ analytics_storage: 'denied' });
    expect(gate.isResolved()).toBe(true);
    expect(effect).not.toHaveBeenCalled();
    expect(onDrop).toHaveBeenCalledTimes(1);
  });

  it('drops buffered effects when the wait-window resolves with no decision', () => {
    const gate = createConsentGate();
    const effect = vi.fn();
    const onDrop = vi.fn();
    gate.run(effect, onDrop);

    gate.resolve(); // wait_for_update elapsed, still default-deny
    expect(gate.isResolved()).toBe(true);
    expect(gate.getState().analytics_storage).toBe('denied');
    expect(effect).not.toHaveBeenCalled();
    expect(onDrop).toHaveBeenCalledTimes(1);
  });

  it('drops effects (onDrop) when resolved+denied (no buffering)', () => {
    const gate = createConsentGate();
    gate.resolve();
    const effect = vi.fn();
    const onDrop = vi.fn();
    gate.run(effect, onDrop);
    expect(effect).not.toHaveBeenCalled();
    expect(onDrop).toHaveBeenCalledTimes(1);
  });

  it('reset() revokes consent, drops the buffer (onDrop), and stops fan-out', () => {
    const gate = createConsentGate();
    gate.applyUpdate({ analytics_storage: 'granted' });
    const onDrop = vi.fn();
    gate.run(() => {}, onDrop); // runs immediately (granted), onDrop not called
    expect(onDrop).not.toHaveBeenCalled();

    gate.reset();
    expect(gate.getState()).toEqual(DENIED_ALL);
    const effect = vi.fn();
    gate.run(effect);
    expect(effect).not.toHaveBeenCalled();
  });

  it('notifies onChange listeners and supports unsubscribe', () => {
    const gate = createConsentGate();
    const listener = vi.fn();
    const unsub = gate.onChange(listener);
    gate.applyUpdate({ analytics_storage: 'granted' });
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ analytics_storage: 'granted' }),
      true,
    );
    unsub();
    gate.applyUpdate({ ad_storage: 'granted' });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// resolveVisitorKey: consent-gated persistence
// ============================================================================

describe('resolveVisitorKey', () => {
  const generate = () => 'generated_key';

  it('never persists before consent (in-memory only)', () => {
    const r = resolveVisitorKey({
      granted: false,
      cookieKey: null,
      memKey: null,
      generate,
    });
    expect(r.persist).toBe(false);
    expect(r.key).toBe('generated_key');
    expect(r.memKey).toBe('generated_key');
  });

  it('reuses an existing in-memory key before consent', () => {
    const r = resolveVisitorKey({
      granted: false,
      cookieKey: null,
      memKey: 'mem_abc',
      generate,
    });
    expect(r.persist).toBe(false);
    expect(r.key).toBe('mem_abc');
  });

  it('promotes the in-memory key to a cookie on first grant', () => {
    const r = resolveVisitorKey({
      granted: true,
      cookieKey: null,
      memKey: 'mem_abc',
      generate,
    });
    expect(r.persist).toBe(true);
    expect(r.key).toBe('mem_abc'); // same identity as the buffered impression
  });

  it('generates + persists when granted with neither cookie nor mem key', () => {
    const r = resolveVisitorKey({
      granted: true,
      cookieKey: null,
      memKey: null,
      generate,
    });
    expect(r.persist).toBe(true);
    expect(r.key).toBe('generated_key');
  });

  it('uses an existing cookie when granted (returning visitor, no re-persist)', () => {
    const r = resolveVisitorKey({
      granted: true,
      cookieKey: 'cookie_xyz',
      memKey: 'mem_abc',
      generate,
    });
    expect(r.persist).toBe(false);
    expect(r.key).toBe('cookie_xyz');
    expect(r.memKey).toBe('cookie_xyz');
  });
});
