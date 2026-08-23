import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import type { AbResolveResult } from '../../plugins/ab-test/resolve';

import { abTestMiddleware } from '../middleware';

// A running test with two published variant branches. The variant "code"
// segment of the rewrite path is the branchId, so a reuse cookie must carry a
// real branchId.
const RUNNING_TEST: AbResolveResult = {
  test: {
    testId: 't1',
    rootId: 'r1',
    trafficPercentage: 100,
    variants: [
      { variantId: 'v1', branchId: 'aa', weight: 50, isControl: true },
      { variantId: 'v2', branchId: 'bb', weight: 50, isControl: false },
    ],
  },
};

function makeRequest(cookies?: Record<string, string>): NextRequest {
  const req = new NextRequest('http://localhost/blog/hello');
  if (cookies) {
    for (const [name, value] of Object.entries(cookies)) {
      req.cookies.set(name, value);
    }
  }
  return req;
}

describe('abTestMiddleware', () => {
  it('rewrites to the control sentinel and sets no cookie when no test runs', async () => {
    const mw = abTestMiddleware({
      collection: 'pages',
      resolve: async () => ({ test: null }),
    });
    const res = await mw(makeRequest());

    expect(res.headers.get('x-middleware-rewrite')).toMatch(
      /\/ab\/control\/blog\/hello$/,
    );
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('assigns a variant cookie and rewrites under /ab on a first (cookie-less) visit', async () => {
    const mw = abTestMiddleware({
      collection: 'pages',
      resolve: async () => RUNNING_TEST,
    });
    const res = await mw(makeRequest());

    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toBeTruthy();
    // The assigned variant code is a weighted hash of an ephemeral key, so
    // assert the cookie name + attributes, not the value.
    expect(setCookie!.startsWith('ab_t1=')).toBe(true);
    expect(setCookie!).toContain('Path=/');
    expect(setCookie!).toContain('Max-Age=2592000');
    expect(setCookie!).toContain('Secure');
    expect(setCookie!).toContain('HttpOnly');
    expect(setCookie!).toContain('SameSite=lax');

    expect(res.headers.get('x-middleware-rewrite')).toMatch(
      /\/ab\/[^/]+\/blog\/hello$/,
    );
  });

  it('reuses an existing variant cookie and does not re-assign', async () => {
    const mw = abTestMiddleware({
      collection: 'pages',
      resolve: async () => RUNNING_TEST,
    });
    const res = await mw(makeRequest({ ab_t1: 'bb' }));

    expect(res.headers.get('x-middleware-rewrite')).toMatch(
      /\/ab\/bb\/blog\/hello$/,
    );
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('fails closed to control (no cookie) when resolve throws', async () => {
    const mw = abTestMiddleware({
      collection: 'pages',
      resolve: async () => {
        throw new Error('boom');
      },
    });
    const res = await mw(makeRequest());

    expect(res.headers.get('x-middleware-rewrite')).toMatch(
      /\/ab\/control\/blog\/hello$/,
    );
    expect(res.headers.get('set-cookie')).toBeNull();
  });
});
