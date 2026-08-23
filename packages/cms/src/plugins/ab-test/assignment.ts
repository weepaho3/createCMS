/**
 * MurmurHash3 (32-bit) for deterministic variant assignment.
 * Inlined to avoid an external dependency for ~30 lines of code.
 */
function murmur3(key: string, seed = 0): number {
  let h = seed >>> 0;
  const len = key.length;
  let i = 0;

  while (i + 4 <= len) {
    let k =
      (key.charCodeAt(i) & 0xff) |
      ((key.charCodeAt(i + 1) & 0xff) << 8) |
      ((key.charCodeAt(i + 2) & 0xff) << 16) |
      ((key.charCodeAt(i + 3) & 0xff) << 24);
    k = Math.imul(k, 0xcc9e2d51);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, 0x1b873593);
    h ^= k;
    h = (h << 13) | (h >>> 19);
    h = Math.imul(h, 5) + 0xe6546b64;
    i += 4;
  }

  let k = 0;
  switch (len & 3) {
    case 3:
      k ^= (key.charCodeAt(i + 2) & 0xff) << 16;
    // falls through
    case 2:
      k ^= (key.charCodeAt(i + 1) & 0xff) << 8;
    // falls through
    case 1:
      k ^= key.charCodeAt(i) & 0xff;
      k = Math.imul(k, 0xcc9e2d51);
      k = (k << 15) | (k >>> 17);
      k = Math.imul(k, 0x1b873593);
      h ^= k;
  }

  h ^= len;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;

  return h >>> 0;
}

export type VariantInput = {
  id: string;
  weight: number;
  isControl: boolean;
};

export type AssignmentResult = {
  variantId: string;
  inTest: boolean;
};

/**
 * Deterministic variant assignment: the same `contextKey + testId` always
 * produces the same variant. Pure function, no DB writes.
 *
 * @param contextKey  - Visitor identifier (user ID or anonymous key)
 * @param testId      - The A/B test ID
 * @param trafficPercentage - 0-100, how much total traffic enters the test
 * @param variants    - Must be sorted by id for stability
 */
export function resolveVariant(
  contextKey: string,
  testId: string,
  trafficPercentage: number,
  variants: VariantInput[],
): AssignmentResult {
  const hash = murmur3(contextKey + ':' + testId);
  const bucket = hash % 10000;

  const control = variants.find((v) => v.isControl)!;

  if (bucket >= trafficPercentage * 100) {
    return { variantId: control.id, inTest: false };
  }

  const sorted = [...variants].sort((a, b) => a.id.localeCompare(b.id));
  const normalizedBucket = Math.floor(
    (bucket * 100) / (trafficPercentage * 100),
  );

  let cumulative = 0;
  for (const v of sorted) {
    cumulative += v.weight;
    if (normalizedBucket < cumulative) {
      return { variantId: v.id, inTest: true };
    }
  }

  return { variantId: control.id, inTest: true };
}
