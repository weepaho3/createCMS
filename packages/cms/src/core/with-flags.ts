/**
 * Wire contract for the `withUser` / `withRoot` query flags, shared by the HTTP
 * client (encode side, `client/proxy.ts`) and the server endpoint wrapper
 * (decode side, `core/endpoint.ts`) so the two halves can never drift.
 *
 * Two transports carry these flags and both must round-trip:
 *  - **HTTP** — the proxy encodes values as strings (objects → JSON, booleans →
 *    `String()`); the endpoint decodes the strings back.
 *  - **In-process** (`cms.api.*`) — callers pass raw values (objects / real
 *    booleans) straight through, bypassing the proxy, so decode must accept the
 *    untransformed forms as well.
 *
 * This module is intentionally dependency-free (no drizzle, no better-call) so
 * importing it from the client bundle stays cheap.
 */

export const WITH_USER_KEY = 'withUser' as const;
export const WITH_ROOT_KEY = 'withRoot' as const;

/**
 * Decoded shape of `withUser`: `true` exposes all allowlisted user columns; a
 * map selects a subset of them.
 */
export type WithUserValue = true | Record<string, true>;

/**
 * Encode the flag query for HTTP transport. Pure and copy-on-write: never
 * mutates its input, and returns the *same* reference when nothing needed
 * encoding (so an absent query stays absent, preserving GET-without-query).
 */
export function encodeFlagQuery(
  query: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!query) return query;
  let out = query;
  const rawWithUser = query[WITH_USER_KEY];
  if (rawWithUser && typeof rawWithUser === 'object') {
    out = { ...out, [WITH_USER_KEY]: JSON.stringify(rawWithUser) };
  }
  const rawWithRoot = query[WITH_ROOT_KEY];
  if (rawWithRoot !== undefined) {
    out = { ...out, [WITH_ROOT_KEY]: String(rawWithRoot) };
  }
  return out;
}

/**
 * Decode `withUser` from either transport. Returns `undefined` when absent or
 * malformed — malformed JSON is deliberately swallowed (drop enrichment) rather
 * than thrown or defaulted to the full allowlist. The downstream
 * `resolveUserColumns` allowlist is the second line of defense.
 */
export function decodeWithUser(raw: unknown): WithUserValue | undefined {
  if (raw === undefined) return undefined;
  if (raw === true || raw === 'true') return true;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as WithUserValue;
    } catch {
      return undefined;
    }
  }
  if (typeof raw === 'object' && raw !== null) {
    return raw as Record<string, true>;
  }
  return undefined;
}

/** Decode `withRoot`: only `true` / `'true'` enable it; anything else is false. */
export function decodeWithRoot(raw: unknown): boolean {
  return raw === true || raw === 'true';
}
