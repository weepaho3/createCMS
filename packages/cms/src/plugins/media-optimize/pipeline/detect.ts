/**
 * The type of a file from its leading bytes, independent of the declared
 * type. `undefined` when no signature matches.
 */
export function detectType(bytes: Uint8Array): string | undefined {
  const ascii = (offset: number, length: number) =>
    String.fromCharCode(...bytes.subarray(offset, offset + length));
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes[0] === 0x89 && ascii(1, 3) === 'PNG') return 'image/png';
  if (ascii(0, 4) === 'GIF8') return 'image/gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'image/webp';
  if (ascii(0, 2) === 'BM') return 'image/bmp';
  if (ascii(0, 4) === 'II*\0' || ascii(0, 4) === 'MM\0*') return 'image/tiff';
  if (ascii(0, 5) === '%PDF-') return 'application/pdf';
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf) {
    return 'video/webm';
  }
  if (ascii(4, 4) === 'ftyp') {
    const brand = ascii(8, 4);
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
    if (
      ['heic', 'heix', 'hevc', 'heim', 'heis', 'mif1', 'msf1'].includes(brand)
    ) {
      return 'image/heic';
    }
    if (brand.startsWith('qt')) return 'video/quicktime';
    return 'video/mp4';
  }
  const text = ascii(0, 256).trimStart();
  if (
    text.startsWith('<svg') ||
    (text.startsWith('<?xml') && text.includes('<svg'))
  ) {
    return 'image/svg+xml';
  }
  return undefined;
}

/** Types the raster pipeline decodes and re-encodes. */
export const RASTER_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/tiff',
  'image/heic',
]);

/** Types whose metadata containers the lossless edits understand. */
export const CONTAINER_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);
