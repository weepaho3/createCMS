/**
 * Byte-level checks that decide whether a file may be re-encoded. All of them
 * read a prefix of the file and need no DOM.
 */

/**
 * Input types the canvas pipeline re-encodes. Everything else (SVG, GIF,
 * ICO, BMP, HEIC/HEIF, AVIF, TIFF, ...) is uploaded byte-identical: canvas
 * cannot encode most of them, `toBlob` silently falls back to PNG for
 * unsupported targets, and rasterizing SVG or GIF loses vector data or
 * animation frames.
 */
export const ENCODABLE_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

/** File extension written for each encodable output type. */
export const OUTPUT_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** Prefix length scanned for animation chunks. */
export const ANIMATION_SCAN_BYTES = 4096;

/** Prefix length scanned for provenance markers (XMP, C2PA JUMBF). */
export const PROVENANCE_SCAN_BYTES = 256 * 1024;

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

/** True when the bytes of `type` hold more than one frame. */
export function isAnimated(type: string, bytes: Uint8Array): boolean {
  if (type === 'image/webp') return isAnimatedWebp(bytes);
  if (type === 'image/png') return isAnimatedPng(bytes);
  return false;
}

const DIGITAL_SOURCE_TYPE = encoder.encode('DigitalSourceType');
const JUMBF_BOX = encoder.encode('jumb');
const C2PA_LABEL = encoder.encode('c2pa');

/**
 * True when the prefix carries machine-readable provenance: an XMP
 * `Iptc4xmpExt:DigitalSourceType` property or a C2PA manifest (a JUMBF `jumb`
 * box labelled `c2pa`). Any canvas re-encode drops both, so such files must
 * reach the bucket unchanged.
 */
export function hasProvenanceMarker(bytes: Uint8Array): boolean {
  if (indexOfBytes(bytes, DIGITAL_SOURCE_TYPE) !== -1) return true;
  return (
    indexOfBytes(bytes, JUMBF_BOX) !== -1 &&
    indexOfBytes(bytes, C2PA_LABEL) !== -1
  );
}

/** `name` with its extension replaced by the one for `type`. */
export function outputName(name: string, type: string): string {
  const ext = OUTPUT_EXTENSIONS[type];
  if (!ext) return name;
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  return `${base}.${ext}`;
}
