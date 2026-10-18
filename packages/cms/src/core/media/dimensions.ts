/**
 * Image dimensions from the first bytes of a file (PNG IHDR, JPEG SOF, WebP
 * VP8/VP8L/VP8X, GIF, AVIF/HEIF `ispe`), or `null` when the header is not recognized or lies
 * beyond the bytes given. No DOM or Node APIs.
 */
export function readImageDimensions(
  bytes: Uint8Array,
): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (offset: number, length: number) =>
    String.fromCharCode(...bytes.subarray(offset, offset + length));
  const has = (length: number) => bytes.length >= length;

  // PNG: signature, then the IHDR chunk with big-endian width and height.
  if (has(24) && bytes[0] === 0x89 && ascii(1, 3) === 'PNG') {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }

  // GIF: logical screen size, little-endian.
  if (has(10) && ascii(0, 3) === 'GIF') {
    return {
      width: view.getUint16(6, true),
      height: view.getUint16(8, true),
    };
  }

  // WebP: RIFF container with a VP8X, VP8L or VP8 first chunk.
  if (has(30) && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    const chunk = ascii(12, 4);
    if (chunk === 'VP8X') {
      const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
      const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
      return { width, height };
    }
    if (chunk === 'VP8L' && bytes[20] === 0x2f) {
      const bits = view.getUint32(21, true);
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >> 14) & 0x3fff) + 1,
      };
    }
    if (chunk === 'VP8 ') {
      return {
        width: view.getUint16(26, true) & 0x3fff,
        height: view.getUint16(28, true) & 0x3fff,
      };
    }
    return null;
  }

  // AVIF/HEIF: the first `ispe` (image spatial extents) property box, a
  // full box (version and flags) followed by big-endian width and height.
  if (has(12) && ascii(4, 4) === 'ftyp') {
    for (let i = 4; i + 16 <= bytes.length; i++) {
      if (
        bytes[i] === 0x69 &&
        bytes[i + 1] === 0x73 &&
        bytes[i + 2] === 0x70 &&
        bytes[i + 3] === 0x65
      ) {
        return {
          width: view.getUint32(i + 8),
          height: view.getUint32(i + 12),
        };
      }
    }
    return null;
  }

  // JPEG XL: the SizeHeader right after the codestream signature, bare or
  // inside the container's `jxlc` or first `jxlp` box.
  const jxl = jxlCodestream(bytes);
  if (jxl) return jxlSize(jxl);

  // JPEG: walk the markers to the first start-of-frame segment.
  if (has(4) && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) return null;
      const marker = bytes[offset + 1];
      if (marker === 0xff) {
        offset++;
        continue;
      }
      const isFrame =
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc;
      if (isFrame) {
        return {
          height: view.getUint16(offset + 5),
          width: view.getUint16(offset + 7),
        };
      }
      offset += 2 + view.getUint16(offset + 2);
    }
  }
  return null;
}

const JXL_CONTAINER = [
  0x00, 0x00, 0x00, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a,
];

/** The JPEG XL codestream in `bytes` (from its `FF 0A` signature), or `null`. */
function jxlCodestream(bytes: Uint8Array): Uint8Array | null {
  if (bytes[0] === 0xff && bytes[1] === 0x0a) return bytes;
  if (!JXL_CONTAINER.every((byte, i) => bytes[i] === byte)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = JXL_CONTAINER.length;
  while (at + 8 <= bytes.length) {
    let size = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    let header = 8;
    if (size === 1) {
      if (at + 16 > bytes.length) return null;
      size = Number(view.getBigUint64(at + 8));
      header = 16;
    }
    if (type === 'jxlc') return bytes.subarray(at + header);
    // A partial codestream box starts with its 4-byte index.
    if (type === 'jxlp') return bytes.subarray(at + header + 4);
    if (size === 0) return null;
    at += size;
  }
  return null;
}

/** Width and height from the codestream's SizeHeader (bits read LSB first). */
function jxlSize(code: Uint8Array): { width: number; height: number } | null {
  if (code[0] !== 0xff || code[1] !== 0x0a) return null;
  let position = 16;
  const bits = (count: number): number | null => {
    let value = 0;
    for (let i = 0; i < count; i++, position++) {
      const byte = code[position >> 3];
      if (byte === undefined) return null;
      value += ((byte >> (position & 7)) & 1) * 2 ** i;
    }
    return value;
  };
  const u32 = () => {
    const selector = bits(2);
    if (selector === null) return null;
    const value = bits([9, 13, 18, 30][selector]);
    return value === null ? null : value + 1;
  };
  const small = bits(1);
  if (small === null) return null;
  const divided = () => {
    const value = bits(5);
    return value === null ? null : (value + 1) * 8;
  };
  const height = small ? divided() : u32();
  const ratio = bits(3);
  if (height === null || ratio === null) return null;
  if (ratio > 0) {
    const [num, den] = JXL_RATIOS[ratio - 1];
    return { width: Math.floor((height * num) / den), height };
  }
  const width = small ? divided() : u32();
  return width === null ? null : { width, height };
}

/** `xsize = ysize * num / den` for the ratio codes 1 to 7. */
const JXL_RATIOS: readonly (readonly [number, number])[] = [
  [1, 1],
  [12, 10],
  [4, 3],
  [3, 2],
  [16, 9],
  [5, 4],
  [2, 1],
];
