/**
 * Lossless metadata edits on encoded image bytes (JPEG, PNG, WebP): GPS
 * removal that leaves XMP, ICC and C2PA segments byte-identical, and an XMP
 * packet carrying the IPTC Digital Source Type for derivatives whose
 * re-encode dropped it. Pure byte functions, no DOM or Node APIs.
 */
import { hasTiffGps, stripTiffGps } from './tiff';

const encoder = new TextEncoder();
const EXIF_HEADER = 'Exif\0\0';
const XMP_NAMESPACE = 'http://ns.adobe.com/xap/1.0/\0';
const PNG_XMP_KEYWORD = 'XML:com.adobe.xmp';
const IPTC_SOURCE_TYPES = 'http://cv.iptc.org/newscodes/digitalsourcetype/';

export type ContainerType = 'image/jpeg' | 'image/png' | 'image/webp';

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

// --- CRC-32 (PNG chunks) -------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(encoder.encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

// --- segment walkers -------------------------------------------------------

type Segment = { start: number; end: number; marker: number; data: number };

/** JPEG segments up to the start of scan; `data` is the payload offset. */
function jpegSegments(bytes: Uint8Array): Segment[] | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const segments: Segment[] = [];
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    if (marker === 0xda || marker === 0xd9) break;
    const length = view.getUint16(offset + 2);
    segments.push({
      start: offset,
      end: offset + 2 + length,
      marker,
      data: offset + 4,
    });
    offset += 2 + length;
  }
  return segments;
}

type Chunk = { start: number; end: number; type: string; data: number };

/** PNG chunks; `data` is the payload offset, `end` is past the CRC. */
function pngChunks(bytes: Uint8Array): Chunk[] | null {
  if (ascii(bytes, 1, 3) !== 'PNG') return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: Chunk[] = [];
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = ascii(bytes, offset + 4, 4);
    chunks.push({
      start: offset,
      end: offset + 12 + length,
      type,
      data: offset + 8,
    });
    if (type === 'IEND') break;
    offset += 12 + length;
  }
  return chunks;
}

/** WebP chunks after the 12-byte RIFF header; `end` includes padding. */
function webpChunks(bytes: Uint8Array): Chunk[] | null {
  if (ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: Chunk[] = [];
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset + 4, true);
    const end = offset + 8 + length + (length % 2);
    chunks.push({
      start: offset,
      end,
      type: ascii(bytes, offset, 4),
      data: offset + 8,
    });
    offset = end;
  }
  return chunks;
}

/**
 * The TIFF structure of the EXIF block (JPEG Exif APP1, PNG `eXIf`, WebP
 * `EXIF`), or `null` when there is none in `bytes`.
 */
export function findExifTiff(
  bytes: Uint8Array,
  type: ContainerType,
): Uint8Array | null {
  if (type === 'image/jpeg') {
    for (const s of jpegSegments(bytes) ?? []) {
      if (s.marker === 0xe1 && ascii(bytes, s.data, 6) === EXIF_HEADER) {
        return bytes.subarray(s.data + 6, Math.min(s.end, bytes.length));
      }
    }
    return null;
  }
  if (type === 'image/png') {
    const chunk = (pngChunks(bytes) ?? []).find((c) => c.type === 'eXIf');
    return chunk ? bytes.subarray(chunk.data, chunk.end - 4) : null;
  }
  const chunk = (webpChunks(bytes) ?? []).find((c) => c.type === 'EXIF');
  if (!chunk) return null;
  const tiff = bytes.subarray(chunk.data, Math.min(chunk.end, bytes.length));
  return ascii(tiff, 0, 6) === EXIF_HEADER ? tiff.subarray(6) : tiff;
}

// --- GPS removal -------------------------------------------------------------

/**
 * `bytes` without GPS metadata, or the same bytes when there is none. JPEG:
 * the GPS IFD inside the Exif APP1 is removed in place; the XMP APP1, ICC
 * APP2 and C2PA APP11 segments stay byte-identical. PNG: the same inside
 * `eXIf`, and `tEXt`/`iTXt` chunks whose keyword names GPS are dropped. WebP:
 * the same inside the `EXIF` chunk. With `keepCopyright: false`, the TIFF
 * Artist and Copyright entries go too.
 */
export function stripGps(
  input: Uint8Array,
  type: ContainerType,
  options: { keepCopyright?: boolean } = {},
): { bytes: Uint8Array; stripped: boolean } {
  const bytes = input.slice();
  let stripped = false;

  if (type === 'image/jpeg') {
    for (const segment of jpegSegments(bytes) ?? []) {
      if (
        segment.marker === 0xe1 &&
        ascii(bytes, segment.data, 6) === EXIF_HEADER
      ) {
        const tiff = bytes.subarray(segment.data + 6, segment.end);
        stripped = stripTiffGps(tiff, options) || stripped;
      }
    }
    return { bytes: stripped ? bytes : input, stripped };
  }

  if (type === 'image/png') {
    const chunks = pngChunks(bytes);
    if (!chunks) return { bytes: input, stripped: false };
    const parts: Uint8Array[] = [bytes.subarray(0, 8)];
    for (const chunk of chunks) {
      const data = bytes.subarray(chunk.data, chunk.end - 4);
      if (chunk.type === 'eXIf' && stripTiffGps(data, options)) {
        stripped = true;
        parts.push(pngChunk('eXIf', data));
        continue;
      }
      if (
        (chunk.type === 'tEXt' || chunk.type === 'iTXt') &&
        /^(exif:)?GPS/i.test(ascii(data, 0, Math.min(data.length, 40)))
      ) {
        stripped = true;
        continue;
      }
      parts.push(bytes.subarray(chunk.start, chunk.end));
    }
    return stripped
      ? { bytes: concat(parts), stripped }
      : { bytes: input, stripped };
  }

  for (const chunk of webpChunks(bytes) ?? []) {
    if (chunk.type !== 'EXIF') continue;
    let tiff = bytes.subarray(chunk.data, chunk.end);
    if (ascii(tiff, 0, 6) === EXIF_HEADER) tiff = tiff.subarray(6);
    stripped = stripTiffGps(tiff, options) || stripped;
  }
  return { bytes: stripped ? bytes : input, stripped };
}

/** True when `bytes` carry an EXIF GPS IFD or a PNG GPS text chunk. */
export function hasGps(bytes: Uint8Array, type: ContainerType): boolean {
  if (type === 'image/jpeg') {
    return (jpegSegments(bytes) ?? []).some(
      (s) =>
        s.marker === 0xe1 &&
        ascii(bytes, s.data, 6) === EXIF_HEADER &&
        hasTiffGps(bytes.subarray(s.data + 6, s.end)),
    );
  }
  if (type === 'image/png') {
    return (pngChunks(bytes) ?? []).some((c) => {
      const data = bytes.subarray(c.data, c.end - 4);
      if (c.type === 'eXIf') return hasTiffGps(data);
      return (
        (c.type === 'tEXt' || c.type === 'iTXt') &&
        /^(exif:)?GPS/i.test(ascii(data, 0, Math.min(data.length, 40)))
      );
    });
  }
  return (webpChunks(bytes) ?? []).some((c) => {
    if (c.type !== 'EXIF') return false;
    let tiff = bytes.subarray(c.data, c.end);
    if (ascii(tiff, 0, 6) === EXIF_HEADER) tiff = tiff.subarray(6);
    return hasTiffGps(tiff);
  });
}

// --- XMP write-back ------------------------------------------------------------

function escapeXml(value: string): string {
  return value.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** A minimal XMP packet with `Iptc4xmpExt:DigitalSourceType`. */
export function provenanceXmp(digitalSourceType: string): string {
  const uri = digitalSourceType.includes('/')
    ? digitalSourceType
    : `${IPTC_SOURCE_TYPES}${digitalSourceType}`;
  return (
    '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>' +
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">' +
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
    '<rdf:Description rdf:about="" ' +
    'xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/" ' +
    `Iptc4xmpExt:DigitalSourceType="${escapeXml(uri)}"/>` +
    '</rdf:RDF></x:xmpmeta><?xpacket end="w"?>'
  );
}

/** Canvas size of a simple (VP8 or VP8L) WebP, for a new VP8X header. */
function webpCanvas(
  bytes: Uint8Array,
  chunk: Chunk,
): { width: number; height: number; alpha: boolean } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (chunk.type === 'VP8 ' && chunk.data + 10 <= bytes.length) {
    return {
      width: view.getUint16(chunk.data + 6, true) & 0x3fff,
      height: view.getUint16(chunk.data + 8, true) & 0x3fff,
      alpha: false,
    };
  }
  if (chunk.type === 'VP8L' && chunk.data + 5 <= bytes.length) {
    const bits = view.getUint32(chunk.data + 1, true);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
      alpha: ((bits >> 28) & 1) === 1,
    };
  }
  return null;
}

/**
 * `bytes` with `xmp` embedded, replacing any XMP already there. JPEG: an XMP
 * APP1 after the leading APP0/APP1 segments. PNG: an `iTXt` chunk with the
 * keyword `XML:com.adobe.xmp` before the first `IDAT`. WebP: an `XMP ` chunk
 * at the end with the VP8X XMP flag set (a simple WebP gains a VP8X header).
 * Returns `null` when the container is not recognized.
 */
export function writeXmp(
  bytes: Uint8Array,
  type: ContainerType,
  xmp: string,
): Uint8Array | null {
  const packet = encoder.encode(xmp);

  if (type === 'image/jpeg') {
    const segments = jpegSegments(bytes);
    if (!segments) return null;
    const isXmp = (s: Segment) =>
      s.marker === 0xe1 &&
      ascii(bytes, s.data, XMP_NAMESPACE.length) === XMP_NAMESPACE;
    const payload = concat([encoder.encode(XMP_NAMESPACE), packet]);
    if (payload.length + 2 > 0xffff) return null;
    const segment = new Uint8Array(4 + payload.length);
    segment.set([
      0xff,
      0xe1,
      (payload.length + 2) >> 8,
      (payload.length + 2) & 0xff,
    ]);
    segment.set(payload, 4);

    const parts: Uint8Array[] = [];
    let cursor = 0;
    for (const s of segments.filter(isXmp)) {
      parts.push(bytes.subarray(cursor, s.start));
      cursor = s.end;
    }
    const without = concat([...parts, bytes.subarray(cursor)]);
    let insertAt = 2;
    for (const s of jpegSegments(without) ?? []) {
      if (s.marker !== 0xe0 && s.marker !== 0xe1) break;
      insertAt = s.end;
    }
    return concat([
      without.subarray(0, insertAt),
      segment,
      without.subarray(insertAt),
    ]);
  }

  if (type === 'image/png') {
    const chunks = pngChunks(bytes);
    if (!chunks) return null;
    const data = concat([
      encoder.encode(PNG_XMP_KEYWORD),
      new Uint8Array([0, 0, 0, 0, 0]),
      packet,
    ]);
    const parts: Uint8Array[] = [bytes.subarray(0, 8)];
    let inserted = false;
    for (const chunk of chunks) {
      if (
        chunk.type === 'iTXt' &&
        ascii(bytes, chunk.data, PNG_XMP_KEYWORD.length) === PNG_XMP_KEYWORD
      ) {
        continue;
      }
      if (!inserted && chunk.type === 'IDAT') {
        parts.push(pngChunk('iTXt', data));
        inserted = true;
      }
      parts.push(bytes.subarray(chunk.start, chunk.end));
    }
    return inserted ? concat(parts) : null;
  }

  const chunks = webpChunks(bytes);
  if (!chunks || chunks.length === 0) return null;
  const xmpChunk = new Uint8Array(8 + packet.length + (packet.length % 2));
  xmpChunk.set(encoder.encode('XMP '), 0);
  new DataView(xmpChunk.buffer).setUint32(4, packet.length, true);
  xmpChunk.set(packet, 8);

  const body: Uint8Array[] = [];
  const first = chunks[0];
  if (first.type === 'VP8X') {
    const header = bytes.slice(first.start, first.end);
    header[8] |= 0x04;
    body.push(header);
  } else {
    const canvas = webpCanvas(bytes, first);
    if (!canvas) return null;
    const vp8x = new Uint8Array(18);
    vp8x.set(encoder.encode('VP8X'), 0);
    vp8x[4] = 10;
    vp8x[8] = 0x04 | (canvas.alpha ? 0x10 : 0);
    const w = canvas.width - 1;
    const h = canvas.height - 1;
    vp8x.set([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff], 12);
    vp8x.set([h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff], 15);
    body.push(vp8x, bytes.subarray(first.start, first.end));
  }
  for (const chunk of chunks.slice(1)) {
    if (chunk.type !== 'XMP ')
      body.push(bytes.subarray(chunk.start, chunk.end));
  }
  body.push(xmpChunk);
  const riff = concat([
    encoder.encode('RIFF'),
    new Uint8Array(4),
    encoder.encode('WEBP'),
    ...body,
  ]);
  new DataView(riff.buffer).setUint32(4, riff.length - 8, true);
  return riff;
}
