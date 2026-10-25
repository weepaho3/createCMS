import { describe, expect, it } from 'vitest';

import { canonicalJson } from './canonical';

describe('canonicalJson', () => {
  it('ignores key order at every depth', () => {
    const a = { b: 1, a: { d: [1, { y: 2, x: 1 }], c: null } };
    const b = { a: { c: null, d: [1, { x: 1, y: 2 }] }, b: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(canonicalJson(a)).toBe(
      '{"a":{"c":null,"d":[1,{"x":1,"y":2}]},"b":1}',
    );
  });

  it('keeps array order', () => {
    expect(canonicalJson([2, 1])).not.toBe(canonicalJson([1, 2]));
  });

  it('drops undefined members', () => {
    const value = { a: 1, b: undefined } as unknown as { a: number };
    expect(canonicalJson(value)).toBe('{"a":1}');
  });

  it('serialises scalars', () => {
    expect(canonicalJson('x')).toBe('"x"');
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson(true)).toBe('true');
  });
});
