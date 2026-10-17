import {
  rgbaToThumbHash,
  thumbHashToAverageRGBA,
  thumbHashToDataURL,
} from 'thumbhash';

/** Longest edge of the bitmap a ThumbHash is computed from. */
export const THUMBHASH_MAX_EDGE = 100;

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

/**
 * The base64 ThumbHash of an RGBA bitmap at most `THUMBHASH_MAX_EDGE` pixels
 * on its longest edge (as `metadata.placeholder.thumbhash` stores it).
 */
export function encodeThumbHash(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): string {
  return toBase64(rgbaToThumbHash(width, height, rgba));
}

/**
 * A PNG data URL that renders the placeholder of a base64 ThumbHash. Pure,
 * so it runs in server components and during SSR.
 */
export function placeholderDataUrl(thumbhash: string): string {
  return thumbHashToDataURL(fromBase64(thumbhash));
}

/** The average colour of a base64 ThumbHash as `#rrggbb`. */
export function dominantColorOf(thumbhash: string): string {
  const { r, g, b } = thumbHashToAverageRGBA(fromBase64(thumbhash));
  const hex = (v: number) =>
    Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}
