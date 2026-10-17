import type { JsonValue } from './types';

/** Recursively sorts object keys and drops `undefined` members. */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const item = (value as Record<string, unknown>)[key];
      if (item !== undefined) out[key] = canonicalize(item);
    }
    return out;
  }
  return value;
}

/**
 * Canonical JSON text of a value: object keys sorted, `undefined` members
 * dropped, array order kept. Two values that differ only in key order produce
 * the same string.
 */
export function canonicalJson(value: JsonValue): string {
  return JSON.stringify(canonicalize(value));
}
