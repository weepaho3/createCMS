import { describe, expect, it } from 'vitest';

import { defaultAuthorizeChannels } from '../src/core/realtime/channels';

/**
 * The channel-authorization policy is the single security primitive guarding
 * private per-user realtime channels. These lock the invariant: a user may
 * subscribe ONLY to their own `notif:<id>`, anonymous callers are rejected for
 * private channels (fail closed), and `ab:live:*` stays world-readable.
 */
describe('defaultAuthorizeChannels', () => {
  function allowed(userId: string | undefined, channels: string[]): boolean {
    return defaultAuthorizeChannels(userId, channels) === undefined;
  }

  it('allows a user to subscribe to their own notif channel', () => {
    expect(allowed('alice', ['notif:alice'])).toBe(true);
  });

  it('rejects subscribing to another user notif channel', () => {
    const res = defaultAuthorizeChannels('alice', ['notif:bob']);
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(403);
  });

  it('fails closed for a private channel when unauthenticated', () => {
    const res = defaultAuthorizeChannels(undefined, ['notif:alice']);
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(403);
  });

  it('fails closed on an empty channel set (no default-open)', () => {
    expect(defaultAuthorizeChannels('alice', [])).toBeInstanceOf(Response);
    expect(defaultAuthorizeChannels(undefined, [])).toBeInstanceOf(Response);
  });

  it('treats ab:live channels as world-readable (any caller, incl. anonymous)', () => {
    expect(allowed('alice', ['ab:live:test-1'])).toBe(true);
    expect(allowed(undefined, ['ab:live:test-1'])).toBe(true);
  });

  it('rejects unknown namespaces', () => {
    const res = defaultAuthorizeChannels('alice', ['secrets:all']);
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(403);
  });

  it('rejects the whole connection if ANY requested channel is unauthorized', () => {
    expect(
      defaultAuthorizeChannels('alice', ['notif:alice', 'notif:bob']),
    ).toBeInstanceOf(Response);
  });

  it('allows a mix of own-private + world-readable channels', () => {
    expect(allowed('alice', ['notif:alice', 'ab:live:t'])).toBe(true);
  });

  it('does not let a crafted prefix widen the match (exact owner id only)', () => {
    // 'notif:alice' owner is the FULL suffix 'alice', compared for equality.
    expect(
      defaultAuthorizeChannels('alice', ['notif:alice-evil']),
    ).toBeInstanceOf(Response);
    expect(allowed('alice-evil', ['notif:alice-evil'])).toBe(true);
  });
});
