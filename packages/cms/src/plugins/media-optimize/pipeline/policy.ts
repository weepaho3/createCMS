import type { AssetProvenance } from '../../../core/types/asset-metadata';

/**
 * What happens to the uploaded original. `keep`: the original bytes, GPS
 * removed. `master`: a re-encode no longer than `masterLongEdge`. `discard`:
 * the largest re-encode stands in for the original.
 */
export type OriginalPolicy = 'keep' | 'master' | 'discard';

export type OriginalLimits = {
  maxOriginalMegapixels: number;
  maxOriginalBytes: number;
};

export type OriginalDecision = {
  action: OriginalPolicy;
  warning?: { code: 'optimize_discard_blocked'; message: string };
};

const AI: ReadonlySet<AssetProvenance> = new Set(['ai_generated', 'ai_edited']);

/**
 * The policy applied to one original. A `keep` turns into `master` above
 * the megapixel or byte limit, so transforms always get a usable source.
 * `discard` is refused for AI provenance: only the original carries the
 * signed C2PA manifest.
 */
export function decideOriginal(input: {
  policy: OriginalPolicy;
  width: number;
  height: number;
  bytes: number;
  provenance: AssetProvenance;
  limits: OriginalLimits;
}): OriginalDecision {
  const { policy, width, height, bytes, provenance, limits } = input;
  const oversized =
    (width * height) / 1_000_000 > limits.maxOriginalMegapixels ||
    bytes > limits.maxOriginalBytes;

  if (policy === 'discard' && AI.has(provenance)) {
    return {
      action: oversized ? 'master' : 'keep',
      warning: {
        code: 'optimize_discard_blocked',
        message:
          'The original of an AI-marked image is kept: only it carries the signed provenance',
      },
    };
  }
  if (policy === 'keep' && oversized) return { action: 'master' };
  return { action: policy };
}

/**
 * The size of a re-encode whose longer edge is at most `longEdge`; the source
 * size when it already fits (never upscaled).
 */
export function fitLongEdge(
  width: number,
  height: number,
  longEdge: number,
): { width: number; height: number } {
  const scale = Math.min(1, longEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * The rendition widths produced for a source `sourceWidth` pixels wide: the
 * ladder widths below 0.9 of the source, so nothing is upscaled and no
 * rendition is a near-copy of the original.
 */
export function renditionWidthsFor(
  sourceWidth: number,
  ladder: readonly number[],
): number[] {
  return [...new Set(ladder)]
    .filter((w) => w < sourceWidth * 0.9)
    .sort((a, b) => a - b);
}

/** The height of a rendition `width` wide that keeps the aspect ratio. */
export function heightFor(
  width: number,
  sourceWidth: number,
  sourceHeight: number,
): number {
  return Math.max(1, Math.round((sourceHeight * width) / sourceWidth));
}
