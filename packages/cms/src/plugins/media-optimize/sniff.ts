/**
 * Animation detection on the leading bytes of a file. Animated images skip
 * the raster pipeline (a re-encode keeps only the first frame). No DOM.
 */

const encoder = new TextEncoder();

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let out = '';
  for (let i = offset; i < offset + length && i < bytes.length; i++) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
}

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
  const last = haystack.length - needle.length;
  outer: for (let i = 0; i <= last; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/**
 * True for an animated WebP: a `VP8X` header with the animation flag (bit 1)
 * set, or an `ANIM` chunk within the scanned prefix.
 */
export function isAnimatedWebp(bytes: Uint8Array): boolean {
  if (ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') {
    return false;
  }
  if (ascii(bytes, 12, 4) === 'VP8X' && (bytes[20] & 0x02) !== 0) return true;
  return indexOfBytes(bytes, encoder.encode('ANIM')) !== -1;
}

/**
 * True for an APNG: an `acTL` chunk before the first `IDAT`. Walks the PNG
 * chunk list inside the scanned prefix.
 */
export function isAnimatedPng(bytes: Uint8Array): boolean {
  if (ascii(bytes, 1, 3) !== 'PNG') return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = ascii(bytes, offset + 4, 4);
    if (type === 'acTL') return true;
    if (type === 'IDAT' || type === 'IEND') return false;
    offset += 12 + length;
  }
  return false;
}

/**
 * True for a GIF with more than one frame: a second graphic control
 * extension (`21 F9`), which precedes every frame of an animation.
 */
export function isAnimatedGif(bytes: Uint8Array): boolean {
  if (ascii(bytes, 0, 4) !== 'GIF8') return false;
  let frames = 0;
  for (let i = 13; i < bytes.length - 1; i++) {
    if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9 && ++frames > 1) {
      return true;
    }
  }
  return false;
}

/** True when the bytes of `type` hold more than one frame. */
export function isAnimated(type: string, bytes: Uint8Array): boolean {
  if (type === 'image/webp') return isAnimatedWebp(bytes);
  if (type === 'image/png') return isAnimatedPng(bytes);
  if (type === 'image/gif') return isAnimatedGif(bytes);
  return false;
}
