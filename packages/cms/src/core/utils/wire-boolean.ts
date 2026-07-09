import * as z from 'zod';

/**
 * Strict wire boolean for GET query flags. `z.coerce.boolean()` is a trap on
 * GET endpoints: the HTTP client stringifies booleans, and the string
 * `'false'` coerces to TRUE (`Boolean('false') === true`). Accept only real
 * booleans (in-process callers) or the `'true'`/`'false'` strings (HTTP), and
 * decode with {@link wireBooleanIsTrue}.
 */
export const wireBooleanSchema = z.union([
  z.boolean(),
  z.enum(['true', 'false']),
]);

/**
 * Decodes a wire boolean with the same strict rule as `decodeWithRoot`
 * (core/with-flags.ts): only `true` / `'true'` enable the flag — a decoded
 * false or absent value means "flag not set".
 */
export function wireBooleanIsTrue(raw: unknown): boolean {
  return raw === true || raw === 'true';
}
