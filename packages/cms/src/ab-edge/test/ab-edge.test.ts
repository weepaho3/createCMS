import { describe, expect, it } from 'vitest';

import type { AbResolveResult } from '../../plugins/ab-test/resolve';

import {
  CONTROL_CODE,
  decideEdgeVariant,
  generateEdgeVisitorId,
  parseConsentCookie,
  pickEdgeVariant,
  variantRewritePath,
} from '../index';

const TEST: AbResolveResult = {
  test: {
    testId: 't1',
    rootId: 'r1',
    trafficPercentage: 100,
    variants: [
      {
        variantId: 'v_control',
        branchId: 'b_control',
        weight: 50,
        isControl: true,
      },
      { variantId: 'v_b', branchId: 'b_variant', weight: 50, isControl: false },
    ],
  },
};

describe('pickEdgeVariant', () => {
  it('serves control (null) with no test, or outside traffic', () => {
    expect(
      pickEdgeVariant({ key: 'k', resolve: { test: null } }).branchId,
    ).toBeNull();
    const zero: AbResolveResult = {
      test: { ...TEST.test!, trafficPercentage: 0 },
    };
    expect(pickEdgeVariant({ key: 'k', resolve: zero }).branchId).toBeNull();
  });

  it('buckets a key into a real branch, deterministically per key', () => {
    const a = pickEdgeVariant({ key: 'visitor-abc', resolve: TEST });
    expect(['b_control', 'b_variant']).toContain(a.branchId);
    const b = pickEdgeVariant({ key: 'visitor-abc', resolve: TEST });
    expect(a.branchId).toBe(b.branchId); // same key → same branch
  });
});

describe('decideEdgeVariant (variant-cookie, consent-free)', () => {
  it('no test → control sentinel, nothing to assign', () => {
    const d = decideEdgeVariant({
      pathname: '/p',
      resolve: { test: null },
      assignedCode: null,
    });
    expect(d.rewritePath).toBe(`/ab/${CONTROL_CODE}/p`);
    expect(d.assignCode).toBeNull();
    expect(d.testId).toBeNull();
  });

  it('first visit (no cookie) → bucket + return the code to persist', () => {
    const d = decideEdgeVariant({
      pathname: '/p',
      resolve: TEST,
      assignedCode: null,
    });
    expect(d.testId).toBe('t1');
    expect(['b_control', 'b_variant']).toContain(d.assignCode); // 100% traffic → a real branch
    expect(d.rewritePath).toMatch(/^\/ab\/(b_control|b_variant)\/p$/);
  });

  it('reuses a valid prior assignment (no re-roll, no new cookie)', () => {
    const d = decideEdgeVariant({
      pathname: '/p',
      resolve: TEST,
      assignedCode: 'b_variant',
    });
    expect(d.rewritePath).toBe('/ab/b_variant/p');
    expect(d.assignCode).toBeNull(); // already persisted
  });

  it('reuses the control sentinel for an out-of-traffic visitor', () => {
    const d = decideEdgeVariant({
      pathname: '/p',
      resolve: TEST,
      assignedCode: CONTROL_CODE,
    });
    expect(d.rewritePath).toBe(`/ab/${CONTROL_CODE}/p`);
    expect(d.assignCode).toBeNull();
  });

  it('re-rolls a stale/invalid cookie value', () => {
    const d = decideEdgeVariant({
      pathname: '/p',
      resolve: TEST,
      assignedCode: 'b_gone',
    });
    expect(['b_control', 'b_variant']).toContain(d.assignCode); // not reused → fresh assignment
  });

  it('out-of-traffic first visit → control sentinel, persisted', () => {
    const zero: AbResolveResult = {
      test: { ...TEST.test!, trafficPercentage: 0 },
    };
    const d = decideEdgeVariant({
      pathname: '/p',
      resolve: zero,
      assignedCode: null,
    });
    expect(d.assignCode).toBe(CONTROL_CODE);
    expect(d.rewritePath).toBe(`/ab/${CONTROL_CODE}/p`);
  });

  it('honors a custom control code + variant prefix', () => {
    const d = decideEdgeVariant({
      pathname: '/p',
      resolve: { test: null },
      assignedCode: null,
      controlCode: 'ctl',
      variantPrefix: '/_x',
    });
    expect(d.rewritePath).toBe('/_x/ctl/p');
  });
});

describe('parseConsentCookie', () => {
  it('grants only when analytics_storage === granted', () => {
    expect(parseConsentCookie(undefined)).toBe(false);
    expect(parseConsentCookie('')).toBe(false);
    expect(parseConsentCookie('not json')).toBe(false);
    expect(
      parseConsentCookie(JSON.stringify({ analytics_storage: 'denied' })),
    ).toBe(false);
    expect(
      parseConsentCookie(JSON.stringify({ analytics_storage: 'granted' })),
    ).toBe(true);
    expect(
      parseConsentCookie(
        encodeURIComponent(JSON.stringify({ analytics_storage: 'granted' })),
      ),
    ).toBe(true);
  });
});

describe('variantRewritePath', () => {
  it('nests the code under the prefix and keeps the pathname', () => {
    expect(variantRewritePath('/ab', 'br_1', '/foo')).toBe('/ab/br_1/foo');
    expect(variantRewritePath('/ab', 'control', '/')).toBe('/ab/control'); // root → no trailing slash
    expect(variantRewritePath('/ab', 'a/b', '/x')).toBe('/ab/a%2Fb/x'); // code URL-encoded
  });
});

describe('generateEdgeVisitorId', () => {
  it('produces a stable-shaped anon key', () => {
    const id = generateEdgeVisitorId();
    expect(id).toMatch(/^anon_[0-9a-f]{32}$/);
    expect(generateEdgeVisitorId()).not.toBe(id); // random
  });
});
