/**
 * In-place edits of a TIFF structure (the payload of a JPEG Exif APP1, a PNG
 * `eXIf` chunk or a WebP `EXIF` chunk). Offsets inside TIFF are relative to
 * its header, so entries are removed without moving any other data: the IFD
 * shrinks in place and the freed bytes are zeroed.
 */

const GPS_IFD_POINTER = 0x8825;
const TAG_ARTIST = 0x013b;
const TAG_COPYRIGHT = 0x8298;

/** Byte size of one value of each TIFF field type. */
const TYPE_SIZE: Readonly<Record<number, number>> = {
  1: 1,
  2: 1,
  3: 2,
  4: 4,
  5: 8,
  6: 1,
  7: 1,
  8: 2,
  9: 4,
  10: 8,
  11: 4,
  12: 8,
};

type Tiff = { view: DataView; little: boolean; ifd0: number };

function openTiff(bytes: Uint8Array): Tiff | null {
  if (bytes.length < 8) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const order = view.getUint16(0);
  if (order !== 0x4949 && order !== 0x4d4d) return null;
  const little = order === 0x4949;
  if (view.getUint16(2, little) !== 42) return null;
  const ifd0 = view.getUint32(4, little);
  if (ifd0 + 2 > bytes.length) return null;
  return { view, little, ifd0 };
}

/** Zeroes an IFD and the out-of-line values its entries point at. */
function wipeIfd(tiff: Tiff, bytes: Uint8Array, offset: number): void {
  const { view, little } = tiff;
  if (offset + 2 > bytes.length) return;
  const count = view.getUint16(offset, little);
  const end = offset + 2 + count * 12 + 4;
  if (end > bytes.length) return;
  for (let i = 0; i < count; i++) {
    const entry = offset + 2 + i * 12;
    const type = view.getUint16(entry + 2, little);
    const size = (TYPE_SIZE[type] ?? 1) * view.getUint32(entry + 4, little);
    if (size > 4) {
      const at = view.getUint32(entry + 8, little);
      if (at + size <= bytes.length) bytes.fill(0, at, at + size);
    }
  }
  bytes.fill(0, offset, end);
}

/**
 * Removes the entries with `tags` from IFD0, shifting the later entries and
 * the next-IFD offset up. Returns the removed entries' value fields.
 */
function removeIfd0Entries(
  tiff: Tiff,
  bytes: Uint8Array,
  tags: ReadonlySet<number>,
): { tag: number; value: number }[] {
  const { view, little, ifd0 } = tiff;
  let count = view.getUint16(ifd0, little);
  const removed: { tag: number; value: number }[] = [];
  let i = 0;
  while (i < count) {
    const entry = ifd0 + 2 + i * 12;
    const tag = view.getUint16(entry, little);
    if (!tags.has(tag)) {
      i++;
      continue;
    }
    removed.push({ tag, value: view.getUint32(entry + 8, little) });
    const tail = ifd0 + 2 + count * 12 + 4;
    bytes.copyWithin(entry, entry + 12, tail);
    bytes.fill(0, tail - 12, tail);
    count--;
    view.setUint16(ifd0, count, little);
  }
  return removed;
}

/**
 * Removes GPS data from a TIFF structure in place: the GPS IFD pointer leaves
 * IFD0 and the GPS IFD is zeroed. With `keepCopyright: false`, Artist and
 * Copyright are removed too. Returns whether anything changed.
 */
export function stripTiffGps(
  bytes: Uint8Array,
  options: { keepCopyright?: boolean } = {},
): boolean {
  const tiff = openTiff(bytes);
  if (!tiff) return false;
  const tags = new Set([GPS_IFD_POINTER]);
  if (options.keepCopyright === false) {
    tags.add(TAG_ARTIST);
    tags.add(TAG_COPYRIGHT);
  }
  const removed = removeIfd0Entries(tiff, bytes, tags);
  for (const { tag, value } of removed) {
    if (tag === GPS_IFD_POINTER) wipeIfd(tiff, bytes, value);
  }
  return removed.length > 0;
}

/** True when IFD0 of the TIFF structure points at a GPS IFD. */
export function hasTiffGps(bytes: Uint8Array): boolean {
  const tiff = openTiff(bytes);
  if (!tiff) return false;
  const { view, little, ifd0 } = tiff;
  const count = view.getUint16(ifd0, little);
  for (let i = 0; i < count; i++) {
    const entry = ifd0 + 2 + i * 12;
    if (entry + 12 > bytes.length) return false;
    if (view.getUint16(entry, little) === GPS_IFD_POINTER) return true;
  }
  return false;
}
