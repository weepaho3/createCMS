/**
 * Stable structural hash of a JSON-ish value — object keys sorted (properties
 * are an unordered bag), arrays ordered (`childIds` order matters),
 * `undefined` dropped. Used only for dirty detection, never for security.
 * FNV-1a over the canonical JSON string.
 */
export function stableHash(value: unknown): string {
  const canon = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(canon);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(v).sort()) {
        const item = (v as Record<string, unknown>)[key];
        if (item !== undefined) out[key] = canon(item);
      }
      return out;
    }
    return v;
  };
  const json = JSON.stringify(canon(value)) ?? 'undefined';
  let h = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}
