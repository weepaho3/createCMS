import { describe, expect, it } from 'vitest';

import { stableHash } from './hash';

describe('stableHash', () => {
  it('is key-order-insensitive (flat and nested)', () => {
    expect(stableHash({ a: 1, b: 2 })).toBe(stableHash({ b: 2, a: 1 }));
    expect(stableHash({ a: { x: 1, y: 2 }, b: 3 })).toBe(
      stableHash({ b: 3, a: { y: 2, x: 1 } }),
    );
  });

  it('is array-order-sensitive', () => {
    expect(stableHash([1, 2, 3])).not.toBe(stableHash([3, 2, 1]));
  });

  it('drops undefined', () => {
    expect(stableHash({ a: 1, b: undefined })).toBe(stableHash({ a: 1 }));
  });

  it('distinguishes different values', () => {
    expect(stableHash({ a: 1 })).not.toBe(stableHash({ a: 2 }));
  });

  it('does NOT drop null', () => {
    expect(stableHash({ a: null })).not.toBe(stableHash({}));
  });
});
