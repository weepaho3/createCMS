import type { Endpoint } from 'better-call';

/**
 * Flattens a nested endpoint map `{ pages: { createRoot }, admin: { ... } }`
 * into a flat `Record<string, Endpoint>` for `createRouter`.
 *
 * Uses `ns:key` composite keys to avoid collisions when multiple namespaces
 * share the same endpoint names (e.g. `pages:createRoot` vs `authors:createRoot`).
 */
export function flattenEndpoints(
  api: Record<string, Record<string, Endpoint>>,
): Record<string, Endpoint> {
  const flat: Record<string, Endpoint> = {};
  for (const [ns, endpoints] of Object.entries(api)) {
    for (const [key, endpoint] of Object.entries(endpoints)) {
      const compositeKey = `${ns}:${key}`;
      flat[compositeKey] = endpoint;
    }
  }
  return flat;
}
