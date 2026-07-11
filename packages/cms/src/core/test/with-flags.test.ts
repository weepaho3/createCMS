import { describe, expect, it } from 'vitest';

import {
  decodeWithRoot,
  decodeWithUser,
  encodeFlagQuery,
  WITH_ROOT_KEY,
  WITH_USER_KEY,
} from '../with-flags';

describe('encodeFlagQuery', () => {
  it('returns undefined for an absent query (preserves query-less requests)', () => {
    expect(encodeFlagQuery(undefined)).toBeUndefined();
  });

  it('JSON-stringifies an object withUser', () => {
    const out = encodeFlagQuery({ [WITH_USER_KEY]: { name: true } });
    expect(out).toEqual({ [WITH_USER_KEY]: '{"name":true}' });
  });

  it('leaves a withUser of true untouched (only objects are stringified)', () => {
    const out = encodeFlagQuery({ [WITH_USER_KEY]: true });
    expect(out).toEqual({ [WITH_USER_KEY]: true });
  });

  it('stringifies withRoot (including explicit false)', () => {
    expect(encodeFlagQuery({ [WITH_ROOT_KEY]: true })).toEqual({
      [WITH_ROOT_KEY]: 'true',
    });
    expect(encodeFlagQuery({ [WITH_ROOT_KEY]: false })).toEqual({
      [WITH_ROOT_KEY]: 'false',
    });
  });

  it('passes through unrelated keys and does not mutate the input', () => {
    const input = { branchId: 'b1', [WITH_USER_KEY]: { name: true } };
    const out = encodeFlagQuery(input);
    expect(out).toEqual({ branchId: 'b1', [WITH_USER_KEY]: '{"name":true}' });
    // input untouched (copy-on-write)
    expect(input).toEqual({ branchId: 'b1', [WITH_USER_KEY]: { name: true } });
  });

  it('returns the same reference when nothing needs encoding', () => {
    const input = { branchId: 'b1' };
    expect(encodeFlagQuery(input)).toBe(input);
  });
});

describe('decodeWithUser', () => {
  it('decodes the boolean transport (true and "true")', () => {
    expect(decodeWithUser(true)).toBe(true);
    expect(decodeWithUser('true')).toBe(true);
  });

  it('decodes a JSON-string map (HTTP transport)', () => {
    expect(decodeWithUser('{"name":true}')).toEqual({ name: true });
  });

  it('accepts a raw object map (in-process transport)', () => {
    expect(decodeWithUser({ name: true })).toEqual({ name: true });
  });

  it('swallows malformed JSON and returns undefined (drops enrichment)', () => {
    expect(decodeWithUser('{bad json')).toBeUndefined();
  });

  it('returns undefined when absent', () => {
    expect(decodeWithUser(undefined)).toBeUndefined();
  });
});

describe('decodeWithRoot', () => {
  it('enables only on true / "true"', () => {
    expect(decodeWithRoot(true)).toBe(true);
    expect(decodeWithRoot('true')).toBe(true);
  });

  it('is false for everything else', () => {
    expect(decodeWithRoot('false')).toBe(false);
    expect(decodeWithRoot(false)).toBe(false);
    expect(decodeWithRoot(undefined)).toBe(false);
  });
});

describe('encode → decode round-trip', () => {
  it('object withUser survives the HTTP transport', () => {
    const encoded = encodeFlagQuery({ [WITH_USER_KEY]: { name: true } });
    expect(decodeWithUser(encoded![WITH_USER_KEY])).toEqual({ name: true });
  });

  it('withRoot=true survives the HTTP transport', () => {
    const encoded = encodeFlagQuery({ [WITH_ROOT_KEY]: true });
    expect(decodeWithRoot(encoded![WITH_ROOT_KEY])).toBe(true);
  });

  it('withRoot=false survives the HTTP transport as false', () => {
    const encoded = encodeFlagQuery({ [WITH_ROOT_KEY]: false });
    expect(decodeWithRoot(encoded![WITH_ROOT_KEY])).toBe(false);
  });
});
