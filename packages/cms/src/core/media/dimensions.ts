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
