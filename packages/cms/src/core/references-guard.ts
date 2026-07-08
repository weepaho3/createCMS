import type { ResolvedReference } from './types/definitions';

/**
 * Canonical runtime guard for a read-time-resolved reference value.
 *
 * On the `resolved` read path (`getPublishedContent`) a `reference` property is
 * inlined from its stored rootId STRING to a {@link ResolvedReference} object.
 * This narrows an unknown property value to that object shape. It keys on the
 * four fields the renderer relies on (`rootId`/`collection`/`tree`/`properties`);
 * the optional `abTest` field is intentionally NOT part of the check so that a
 * running-A/B reference (which is a plain object, not a discriminated union)
 * still matches.
 *
 * This module is PURE — no React, no side effects — so both the server read
 * path and the client entry (`react/blocks.tsx`, which re-exports from here) can
 * share one definition.
 */
export function isResolvedReference(
  value: unknown,
): value is ResolvedReference {
  return (
    typeof value === 'object' &&
    value !== null &&
    'rootId' in value &&
    'collection' in value &&
    'tree' in value &&
    'properties' in value
  );
}

/**
 * Normalises a reference value back to its STORED form — the target's rootId
 * string. A {@link ResolvedReference} (the inlined read-path object) collapses
 * to its `rootId`; a plain string (the already-stored authored value) passes
 * through unchanged. Use it to round-trip a resolved reference back to write
 * input.
 */
export function toStoredReference(value: ResolvedReference | string): string {
  return isResolvedReference(value) ? value.rootId : value;
}
