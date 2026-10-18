/**
 * Dependency-free content sniffing of an upload's leading bytes. Covers the
 * raster images createcms accepts (JPEG XL included), the ISO BMFF family (AVIF, HEIC/HEIF,
 * MP4, QuickTime), Matroska/WebM, PDF, ZIP and common audio, and detects
 * markup (HTML, SVG, XML) under any declared type: markup served from the
 * media origin runs script there, so it is never accepted.
 */

/** Leading bytes read for sniffing (the `file-type` sample size). */
export const SNIFF_BYTES = 4100;

const ascii = (bytes: Uint8Array, start: number, end: number) =>
  String.fromCharCode(...bytes.subarray(start, Math.min(end, bytes.length)));

const startsWith = (bytes: Uint8Array, signature: readonly number[], at = 0) =>
  bytes.length >= at + signature.length &&
  signature.every((byte, i) => bytes[at + i] === byte);

const JXL_CONTAINER = [
  0x00, 0x00, 0x00, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a,
] as const;

const HEIF_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx']);
const HEIF_GENERIC = new Set(['mif1', 'msf1']);

/** The type of an ISO BMFF file from its `ftyp` box, or `undefined`. */
function sniffIsoBmff(bytes: Uint8Array): string | undefined {
  if (bytes.length < 12 || ascii(bytes, 4, 8) !== 'ftyp') return undefined;
  const size = Math.min(
    ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0,
    bytes.length,
  );
  const brands = [ascii(bytes, 8, 12)];
  for (let at = 16; at + 4 <= size; at += 4)
    brands.push(ascii(bytes, at, at + 4));
  if (brands.includes('avif') || brands.includes('avis')) return 'image/avif';
  if (brands.some((brand) => HEIF_BRANDS.has(brand))) return 'image/heic';
  if (brands.some((brand) => HEIF_GENERIC.has(brand))) return 'image/heif';
  if (brands[0] === 'qt  ') return 'video/quicktime';
  if (brands[0].startsWith('M4A')) return 'audio/mp4';
  return 'video/mp4';
}

/** `webm` or another Matroska document type from the EBML header. */
function sniffMatroska(bytes: Uint8Array): string | undefined {
  if (!startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return undefined;
  const header = ascii(bytes, 4, 64);
  return header.includes('webm') ? 'video/webm' : 'video/x-matroska';
}

/**
 * Whether the bytes are markup a browser would render as a document: an
 * SVG, HTML or XML root, possibly after a BOM, whitespace, comments or a
 * doctype. Text that merely contains a tag later on is not markup.
 */
export function isMarkup(bytes: Uint8Array): boolean {
  let text = new TextDecoder('utf-8', { fatal: false })
    .decode(bytes.subarray(0, 1024))
    .replace(/^﻿/, '')
    .trimStart()
    .toLowerCase();
  // Skip leading comments, processing instructions and doctypes.
  for (;;) {
    const skipped = text
      .replace(/^<!--[\s\S]*?-->/, '')
      .replace(/^<\?[\s\S]*?\?>/, '')
      .trimStart();
    if (skipped === text) break;
    text = skipped;
  }
  return /^<(!doctype\s+(html|svg)|svg|html|head|body|script|iframe|\?xml|[a-z][\w:-]*\s+xmlns)/.test(
    text,
  );
}

/**
 * The MIME type the leading bytes show, or `undefined` when they match no
 * known signature. Markup is reported as `text/html` or `image/svg+xml`.
 */
export function sniffType(bytes: Uint8Array): string | undefined {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'image/png';
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  // JPEG XL: a bare codestream, or the ISO BMFF style container.
  if (startsWith(bytes, [0xff, 0x0a])) return 'image/jxl';
  if (startsWith(bytes, JXL_CONTAINER)) return 'image/jxl';
  if (ascii(bytes, 0, 4) === 'GIF8') return 'image/gif';
  if (ascii(bytes, 0, 4) === 'RIFF') {
    const form = ascii(bytes, 8, 12);
    if (form === 'WEBP') return 'image/webp';
    if (form === 'WAVE') return 'audio/wav';
    if (form === 'AVI ') return 'video/x-msvideo';
  }
  const iso = sniffIsoBmff(bytes);
  if (iso) return iso;
  const matroska = sniffMatroska(bytes);
  if (matroska) return matroska;
  // Before PDF: a document smuggling `%PDF-` into a comment is still markup.
  if (isMarkup(bytes)) {
    return /<svg[\s>]/i.test(new TextDecoder().decode(bytes.subarray(0, 1024)))
      ? 'image/svg+xml'
      : 'text/html';
  }
  // PDF readers accept the header anywhere in the first 1024 bytes.
  if (ascii(bytes, 0, 1024).includes('%PDF-')) return 'application/pdf';
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return 'application/zip';
  if (ascii(bytes, 0, 4) === 'OggS') return 'audio/ogg';
  if (ascii(bytes, 0, 4) === 'fLaC') return 'audio/flac';
  if (
    ascii(bytes, 0, 3) === 'ID3' ||
    (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
  ) {
    return 'audio/mpeg';
  }
  return undefined;
}

/** Declared types that are the same content as a sniffed type. */
const EQUIVALENT: Readonly<Record<string, readonly string[]>> = {
  'image/jpeg': ['image/jpg', 'image/pjpeg'],
  'image/heic': ['image/heif', 'image/heic-sequence', 'image/heif-sequence'],
  'image/heif': ['image/heic', 'image/heif-sequence'],
  'video/mp4': ['video/x-m4v', 'audio/mp4'],
  'audio/mp4': ['audio/x-m4a', 'audio/aac'],
  'video/webm': ['audio/webm'],
  'video/x-matroska': ['video/webm', 'audio/webm'],
  'audio/wav': ['audio/x-wav', 'audio/wave'],
  'audio/mpeg': ['audio/mp3'],
  'application/zip': [
    'application/x-zip-compressed',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/epub+zip',
  ],
};

/** Plain text types a browser shows as text; markup inside is harmless there. */
const TEXT_TYPES = new Set(['text/plain', 'text/csv', 'text/markdown']);

export type SniffVerdict =
  | { ok: true; sniffed: string | undefined }
  | {
      ok: false;
      sniffed: string | undefined;
      reason: 'markup' | 'mismatch' | 'unknown';
    };

/**
 * Whether the leading bytes fit `declaredType`:
 * - markup (HTML, SVG, XML) fails under every type except plain text;
 * - a recognized signature must match the declared type (or an equivalent);
 * - an image, video, audio or PDF type whose bytes match no signature
 *   fails, so nothing unrecognizable passes as a renderable type;
 * - any other type with unrecognized bytes passes and is left to the
 *   allowlist.
 */
export function checkDeclaredType(
  declaredType: string,
  bytes: Uint8Array,
): SniffVerdict {
  const declared = declaredType.split(';')[0].trim().toLowerCase();
  const sniffed = sniffType(bytes);
  const markup = sniffed === 'text/html' || sniffed === 'image/svg+xml';
  if (markup) {
    return TEXT_TYPES.has(declared)
      ? { ok: true, sniffed }
      : { ok: false, sniffed, reason: 'markup' };
  }
  if (sniffed) {
    const same =
      sniffed === declared || (EQUIVALENT[sniffed] ?? []).includes(declared);
    return same
      ? { ok: true, sniffed }
      : { ok: false, sniffed, reason: 'mismatch' };
  }
  const renderable =
    /^(image|video|audio)\//.test(declared) || declared === 'application/pdf';
  return renderable
    ? { ok: false, sniffed, reason: 'unknown' }
    : { ok: true, sniffed };
}

/** Whether `type` is SVG, which core never accepts. */
export function isSvgType(type: string): boolean {
  return /^image\/svg(\+xml)?$/i.test(type.split(';')[0].trim());
}
