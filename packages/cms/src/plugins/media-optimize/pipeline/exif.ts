import type { AssetMetadata } from '../../../core/types/asset-metadata';
import type { ContainerType } from '../container';

import { findExifTiff } from '../container';

/** EXIF values the pipeline keeps, plus the orientation it decodes with. */
export type ExifFacts = {
  exif: NonNullable<AssetMetadata['exif']>;
  /** EXIF orientation 1 to 8; 1 when absent. */
  orientation: number;
};

const TAG = {
  make: 0x010f,
  model: 0x0110,
  orientation: 0x0112,
  artist: 0x013b,
  copyright: 0x8298,
  exifIfd: 0x8769,
  dateTimeOriginal: 0x9003,
  offsetTimeOriginal: 0x9011,
  colorSpace: 0xa001,
} as const;

type Entry = { type: number; count: number; valueAt: number };

function readIfd(
  view: DataView,
  little: boolean,
  offset: number,
): Map<number, Entry> {
  const entries = new Map<number, Entry>();
  if (offset + 2 > view.byteLength) return entries;
  const count = view.getUint16(offset, little);
  for (let i = 0; i < count; i++) {
    const at = offset + 2 + i * 12;
    if (at + 12 > view.byteLength) break;
    const type = view.getUint16(at + 2, little);
    const n = view.getUint32(at + 4, little);
    const size = (type === 3 ? 2 : type === 4 ? 4 : 1) * n;
    entries.set(view.getUint16(at, little), {
      type,
      count: n,
      valueAt: size > 4 ? view.getUint32(at + 8, little) : at + 8,
    });
  }
  return entries;
}

function text(
  view: DataView,
  entry: Entry | undefined,
  max = 500,
): string | undefined {
  if (!entry || entry.type !== 2) return undefined;
  let out = '';
  for (let i = 0; i < entry.count && entry.valueAt + i < view.byteLength; i++) {
    const code = view.getUint8(entry.valueAt + i);
    if (code === 0) break;
    out += String.fromCharCode(code);
  }
  const value = out.trim().slice(0, max);
  return value || undefined;
}

function short(
  view: DataView,
  little: boolean,
  entry: Entry | undefined,
): number | undefined {
  if (!entry || entry.valueAt + 2 > view.byteLength) return undefined;
  return entry.type === 4
    ? view.getUint32(entry.valueAt, little)
    : view.getUint16(entry.valueAt, little);
}

/** `YYYY:MM:DD HH:MM:SS` (+ optional offset) as ISO 8601, or undefined. */
function isoDate(value: string | undefined, offset: string | undefined) {
  const match = value
    ? /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value)
    : null;
  if (!match) return undefined;
  const [, y, mo, d, h, mi, s] = match;
  const zone = offset && /^[+-]\d{2}:\d{2}$/.test(offset) ? offset : '';
  return `${y}-${mo}-${d}T${h}:${mi}:${s}${zone}`;
}

function latin1(bytes: Uint8Array, max: number): string {
  let out = '';
  for (let i = 0; i < Math.min(bytes.length, max); i++) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
}

/**
 * The allowlisted EXIF facts of an image: capture time, camera make and
 * model, artist (as `creator`), copyright and colour space, plus the
 * orientation. GPS is never read.
 */
export function readExif(bytes: Uint8Array, type: ContainerType): ExifFacts {
  const facts: ExifFacts = { exif: {}, orientation: 1 };
  const tiff = findExifTiff(bytes, type);
  if (tiff && tiff.length >= 8) {
    const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
    const little = view.getUint16(0) === 0x4949;
    const ifd0 = readIfd(view, little, view.getUint32(4, little));
    const make = text(view, ifd0.get(TAG.make));
    const model = text(view, ifd0.get(TAG.model));
    if (make || model) {
      facts.exif.camera = {};
      if (make) facts.exif.camera.make = make;
      if (model) facts.exif.camera.model = model;
    }
    const creator = text(view, ifd0.get(TAG.artist));
    if (creator) facts.exif.creator = creator;
    const copyright = text(view, ifd0.get(TAG.copyright));
    if (copyright) facts.exif.copyright = copyright;
    const orientation = short(view, little, ifd0.get(TAG.orientation));
    if (orientation && orientation >= 1 && orientation <= 8) {
      facts.orientation = orientation;
    }
    const exifIfdAt = short(view, little, ifd0.get(TAG.exifIfd));
    if (exifIfdAt !== undefined) {
      const exifIfd = readIfd(view, little, exifIfdAt);
      const takenAt = isoDate(
        text(view, exifIfd.get(TAG.dateTimeOriginal)),
        text(view, exifIfd.get(TAG.offsetTimeOriginal)),
      );
      if (takenAt) facts.exif.takenAt = takenAt;
      const space = short(view, little, exifIfd.get(TAG.colorSpace));
      if (space === 1) facts.exif.colorSpace = 'srgb';
    }
  }
  // An embedded ICC profile names a wide gamut in its description.
  const head = latin1(bytes, 256 * 1024);
  if (/Display P3|P3 D65|DCI-P3/.test(head)) {
    facts.exif.colorSpace = 'display-p3';
  } else if (!facts.exif.colorSpace && /Adobe RGB|ProPhoto/.test(head)) {
    facts.exif.colorSpace = 'other';
  }
  return facts;
}
