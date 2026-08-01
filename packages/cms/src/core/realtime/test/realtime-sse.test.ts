import { describe, expect, it } from 'vitest';

import type {
  CMSMiddleware,
  CMSProcedureContext,
} from '../../types/definitions';
import type { RealtimeRuntime } from '../types';

import { createRealtimeRouteHandler } from '../sse';

/**
 * Exercises the shared `/realtime` route end-to-end at the handler level: path
 * filtering, peer-missing fall-through, and — the load-bearing part — that the
 * connection is authenticated via the auth middleware and its channels are
 * authorized against that identity. A fake transport stands in for
 * @upstash/realtime's handle(): it parses `?channel=` (the real param name) and
 * runs the injected authorize gate, exactly like the library middleware.
 */

const cmsCtx = {
  db: {} as never,
  collections: {},
} as unknown as CMSProcedureContext;

/** Resolves userId from an `x-user` header (stand-in for a session cookie). */
const headerAuth: CMSMiddleware = (ctx) => {
  const raw = ctx.request?.headers;
  const userId = raw
    ? (new Headers(raw).get('x-user') ?? undefined)
    : undefined;
  return { userId };
};

/** A transport whose SSE handler mimics @upstash/realtime: parse `?channel=`,
 *  run the authorize gate, reject with its Response or stream a 200. */
function fakeTransport(): RealtimeRuntime {
  return {
    async publish() {},
    async getSseHandler(authorize) {
      return async (request) => {
        // Mirror @upstash/realtime handle(): no ?channel= → defaults to ['default'].
        const requested = new URL(request.url).searchParams.getAll('channel');
        const channels = requested.length > 0 ? requested : ['default'];
        const rejection = await authorize(request, channels);
        if (rejection) return rejection;
        return new Response('stream', {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        });
      };
    },
  };
}

/** A transport with no subscribe peer installed. */
function inertTransport(): RealtimeRuntime {
  return {
    async publish() {},
    async getSseHandler() {
      return null;
    },
  };
}

function req(path: string, channel?: string, user?: string): Request {
  const url = `http://localhost/api/cms${path}${channel ? `?channel=${encodeURIComponent(channel)}` : ''}`;
  return new Request(url, user ? { headers: { 'x-user': user } } : undefined);
}

describe('createRealtimeRouteHandler', () => {
  function handler(opts?: {
    authMiddleware?: CMSMiddleware;
    transport?: RealtimeRuntime;
  }) {
    return createRealtimeRouteHandler({
      transport: opts?.transport ?? fakeTransport(),
      path: '/api/cms/realtime',
      cmsCtx,
      authMiddleware:
        'authMiddleware' in (opts ?? {}) ? opts!.authMiddleware : headerAuth,
    });
  }

  it('ignores non-realtime paths (falls through)', async () => {
    const res = await handler()(req('/pages/listRoots'));
    expect(res).toBeUndefined();
  });

  it('does not swallow a sibling path that merely ends in /realtime', async () => {
    // The A/B plugin's legacy /abTest/realtime must reach the plugin, not us.
    const res = await handler()(req('/abTest/realtime', 'ab:live:t1', 'alice'));
    expect(res).toBeUndefined();
  });

  it('falls through when the subscribe peer is unavailable', async () => {
    const res = await handler({ transport: inertTransport() })(
      req('/realtime', 'notif:alice', 'alice'),
    );
    expect(res).toBeUndefined();
  });

  it('lets an authenticated user open their own notif stream', async () => {
    const res = await handler()(req('/realtime', 'notif:alice', 'alice'));
    expect(res?.status).toBe(200);
    expect(res?.headers.get('content-type')).toBe('text/event-stream');
  });

  it('rejects subscribing to another user notif channel (403)', async () => {
    const res = await handler()(req('/realtime', 'notif:bob', 'alice'));
    expect(res?.status).toBe(403);
  });

  it('fails closed for a private channel when unauthenticated', async () => {
    const res = await handler()(req('/realtime', 'notif:alice'));
    expect(res?.status).toBe(403);
  });

  it('fails closed when no auth middleware is configured', async () => {
    const res = await handler({ authMiddleware: undefined })(
      req('/realtime', 'notif:alice', 'alice'),
    );
    expect(res?.status).toBe(403);
  });

  it('keeps ab:live channels public', async () => {
    const res = await handler()(req('/realtime', 'ab:live:test-1'));
    expect(res?.status).toBe(200);
  });

  it('rejects a channel-less connect (library defaults to "default")', async () => {
    const res = await handler()(req('/realtime', undefined, 'alice'));
    expect(res?.status).toBe(403);
  });
});
