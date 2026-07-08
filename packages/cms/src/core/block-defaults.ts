import type { AnyBlockDefinition } from './types/definitions';

/**
 * Seeds the initial `properties` for a newly-created block from its definition.
 *
 * Walks the block definition's `properties` map and, for every property spec
 * that declares a `defaultValue`, emits `key -> spec.defaultValue`. Properties
 * without a `defaultValue` (and list properties, which have no `defaultValue`
 * field) are skipped, so the result is a partial seed — not a fully-populated
 * property object.
 *
 * Pure and dependency-free: callers own validation of the seed against the
 * block's schema.
 */
export function defaultPropertiesFor(
  def: AnyBlockDefinition,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(def.properties)) {
    if ('defaultValue' in spec && spec.defaultValue !== undefined) {
      out[key] = spec.defaultValue;
    }
  }
  return out;
}
