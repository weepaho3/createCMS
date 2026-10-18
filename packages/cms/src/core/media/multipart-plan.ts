/** Files above this size upload in parts (when the storage supports it). */
export const MULTIPART_THRESHOLD = 64 * 1024 * 1024;

const MIB = 1024 * 1024;
const DEFAULT_PART_SIZE = 8 * MIB;
const MAX_PART_SIZE = 5 * 1024 * MIB;
/** Below the 10,000 part limit, so a file never needs the last parts. */
const TARGET_MAX_PARTS = 9000;

/** Parts signed per `signUploadParts` call. */
export const MAX_PARTS_PER_SIGN = 50;
/** Lifetime of a signed part URL. */
export const PART_URL_SECONDS = 15 * 60;
/** How long a multipart token can be redeemed (below provider cleanup windows). */
export const MULTIPART_TOKEN_SECONDS = 24 * 60 * 60;

/**
 * Equal parts of `preferred` bytes (8 MiB), raised to whole MiB so a file needs at most 9,000
 * parts, clamped to the storage's minimum and 5 GiB; only the last part is
 * smaller.
 */
export function planParts(
  size: number,
  minPartSize: number,
  preferred: number = DEFAULT_PART_SIZE,
): { partSize: number; partCount: number } {
  const needed =
    size > preferred * TARGET_MAX_PARTS
      ? Math.ceil(size / TARGET_MAX_PARTS / MIB) * MIB
      : 0;
  const partSize = Math.min(
    MAX_PART_SIZE,
    Math.max(minPartSize, preferred, needed),
  );
  return { partSize, partCount: Math.max(1, Math.ceil(size / partSize)) };
}

/** The byte length of part `partNumber` (1-based). */
export function partLength(
  size: number,
  partSize: number,
  partNumber: number,
): number {
  return Math.min(partSize, size - (partNumber - 1) * partSize);
}
