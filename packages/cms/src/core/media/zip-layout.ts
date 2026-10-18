/**
 * A STORE (no deflate) ZIP archive described by its entries, written as any
 * byte range of the final file. Entry data is read on demand, so a writer
 * can stop after any range and continue later from the persisted
 * `ZipCursor`. The byte layout matches the browser archive writer of
 * `@createcms/react/media/core`: local headers with data descriptors, UTF-8
 * names, ZIP64 records where a size, an offset or the entry count needs
 * them.
 */

export type ZipEntry = {
  /** Path inside the archive (see `sanitizeZipPath`). */
  name: string;
  size: number;
  /** CRC-32 of the data, set once the data was written. */
  crc: number | null;
  /** Left out of the archive (its object is missing or changed). */
  skipped?: boolean;
};

/** Where a writer stands: the archive offset and the running CRC there. */
export type ZipCursor = { position: number; crc: number };

const MAX_32 = 0xffffffff;
const MAX_16 = 0xffff;
const encoder = new TextEncoder();

let crcTable: Uint32Array | null = null;
function table(): Uint32Array {
  if (crcTable) return crcTable;
  crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  return crcTable;
}

/** Continues a CRC-32 over `bytes` (start with 0). */
export function crc32(bytes: Uint8Array, crc = 0): number {
  const t = table();
  let c = (crc ^ MAX_32) >>> 0;
  for (let i = 0; i < bytes.length; i++)
    c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ MAX_32) >>> 0;
}

function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.min(Math.max(date.getUTCFullYear(), 1980), 2107);
  return {
    time:
      (date.getUTCHours() << 11) |
      (date.getUTCMinutes() << 5) |
      Math.floor(date.getUTCSeconds() / 2),
    date:
      ((year - 1980) << 9) |
      ((date.getUTCMonth() + 1) << 5) |
      date.getUTCDate(),
  };
}

class Writer {
  private bytes: Uint8Array;
  private view: DataView;
  private at = 0;
  constructor(size: number) {
    this.bytes = new Uint8Array(size);
    this.view = new DataView(this.bytes.buffer);
  }
  u16(v: number) {
    this.view.setUint16(this.at, v, true);
    this.at += 2;
  }
  u32(v: number) {
    this.view.setUint32(this.at, v >>> 0, true);
    this.at += 4;
  }
  u64(v: number) {
    this.view.setBigUint64(this.at, BigInt(v), true);
    this.at += 8;
  }
  raw(b: Uint8Array) {
    this.bytes.set(b, this.at);
    this.at += b.length;
  }
  done(): Uint8Array {
    return this.bytes;
  }
}

type Region =
  | { kind: 'header'; entry: number; start: number; length: number }
  | { kind: 'data'; entry: number; start: number; length: number }
  | { kind: 'descriptor'; entry: number; start: number; length: number }
  | { kind: 'directory'; start: number; length: number };

type Layout = {
  regions: Region[];
  /** Local header offset per entry index (skipped entries have none). */
  offsets: Map<number, number>;
  total: number;
};

const descriptorLength = (size: number) => (size >= MAX_32 ? 24 : 16);

function centralLength(nameLength: number, size: number, offset: number) {
  const fields = (size >= MAX_32 ? 2 : 0) + (offset >= MAX_32 ? 1 : 0);
  return 46 + nameLength + (fields > 0 ? 4 + fields * 8 : 0);
}

function layoutOf(entries: readonly ZipEntry[]): Layout {
  const regions: Region[] = [];
  const offsets = new Map<number, number>();
  let at = 0;
  let central = 0;
  let count = 0;
  entries.forEach((entry, i) => {
    if (entry.skipped) return;
    const nameLength = encoder.encode(entry.name).length;
    offsets.set(i, at);
    central += centralLength(nameLength, entry.size, at);
    count++;
    regions.push({
      kind: 'header',
      entry: i,
      start: at,
      length: 30 + nameLength,
    });
    at += 30 + nameLength;
    regions.push({ kind: 'data', entry: i, start: at, length: entry.size });
    at += entry.size;
    const descriptor = descriptorLength(entry.size);
    regions.push({
      kind: 'descriptor',
      entry: i,
      start: at,
      length: descriptor,
    });
    at += descriptor;
  });
  const zip64 = count >= MAX_16 || central >= MAX_32 || at >= MAX_32;
  const directory = central + (zip64 ? 76 : 0) + 22;
  regions.push({ kind: 'directory', start: at, length: directory });
  return { regions, offsets, total: at + directory };
}

/** The exact archive length for these entries. */
export function zipLength(entries: readonly ZipEntry[]): number {
  return layoutOf(entries).total;
}

function localHeader(entry: ZipEntry, modified: Date): Uint8Array {
  const name = encoder.encode(entry.name);
  const { time, date } = dosDateTime(modified);
  const header = new Writer(30 + name.length);
  header.u32(0x04034b50);
  header.u16(45);
  header.u16(0x0808);
  header.u16(0);
  header.u16(time);
  header.u16(date);
  header.u32(0);
  header.u32(0);
  header.u32(0);
  header.u16(name.length);
  header.u16(0);
  header.raw(name);
  return header.done();
}

function dataDescriptor(entry: ZipEntry): Uint8Array {
  const zip64 = entry.size >= MAX_32;
  const descriptor = new Writer(zip64 ? 24 : 16);
  descriptor.u32(0x08074b50);
  descriptor.u32(entry.crc ?? 0);
  if (zip64) {
    descriptor.u64(entry.size);
    descriptor.u64(entry.size);
  } else {
    descriptor.u32(entry.size);
    descriptor.u32(entry.size);
  }
  return descriptor.done();
}

function centralDirectory(
  entries: readonly ZipEntry[],
  layout: Layout,
  modified: Date,
  centralStart: number,
): Uint8Array {
  const { time, date } = dosDateTime(modified);
  const parts: Uint8Array[] = [];
  let centralSize = 0;
  let count = 0;
  entries.forEach((entry, i) => {
    if (entry.skipped) return;
    const offset = layout.offsets.get(i)!;
    const name = encoder.encode(entry.name);
    const fields: number[] = [];
    if (entry.size >= MAX_32) fields.push(entry.size, entry.size);
    if (offset >= MAX_32) fields.push(offset);
    const extraLength = fields.length > 0 ? 4 + fields.length * 8 : 0;
    const w = new Writer(46 + name.length + extraLength);
    w.u32(0x02014b50);
    w.u16(45);
    w.u16(45);
    w.u16(0x0808);
    w.u16(0);
    w.u16(time);
    w.u16(date);
    w.u32(entry.crc ?? 0);
    w.u32(Math.min(entry.size, MAX_32));
    w.u32(Math.min(entry.size, MAX_32));
    w.u16(name.length);
    w.u16(extraLength);
    w.u16(0);
    w.u16(0);
    w.u16(0);
    w.u32(0);
    w.u32(Math.min(offset, MAX_32));
    w.raw(name);
    if (fields.length > 0) {
      w.u16(0x0001);
      w.u16(fields.length * 8);
      for (const value of fields) w.u64(value);
    }
    const bytes = w.done();
    parts.push(bytes);
    centralSize += bytes.length;
    count++;
  });
  const end = centralStart + centralSize;
  if (count >= MAX_16 || centralSize >= MAX_32 || centralStart >= MAX_32) {
    const end64 = new Writer(56 + 20);
    end64.u32(0x06064b50);
    end64.u64(44);
    end64.u16(45);
    end64.u16(45);
    end64.u32(0);
    end64.u32(0);
    end64.u64(count);
    end64.u64(count);
    end64.u64(centralSize);
    end64.u64(centralStart);
    end64.u32(0x07064b50);
    end64.u32(0);
    end64.u64(end);
    end64.u32(1);
    parts.push(end64.done());
  }
  const record = new Writer(22);
  record.u32(0x06054b50);
  record.u16(0);
  record.u16(0);
  record.u16(Math.min(count, MAX_16));
  record.u16(Math.min(count, MAX_16));
  record.u32(Math.min(centralSize, MAX_32));
  record.u32(Math.min(centralStart, MAX_32));
  record.u16(0);
  parts.push(record.done());
  return concat(parts);
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  let length = 0;
  for (const part of parts) length += part.length;
  const out = new Uint8Array(length);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

export type ZipRangeSource = {
  /**
   * Bytes `start..end` (inclusive) of entry `index`'s data, or `null` when
   * the data is gone.
   */
  read(index: number, start: number, end: number): Promise<Uint8Array | null>;
  /**
   * Called before an entry's header is written; `false` skips the entry
   * (its object is missing or has another length). The layout after it
   * shifts, which is safe because nothing after the cursor was written.
   */
  check?(index: number): Promise<boolean>;
};

export class ZipSourceError extends Error {
  constructor(readonly entry: number) {
    super(`Entry ${entry} could not be read`);
    this.name = 'ZipSourceError';
  }
}

/** Largest slice of entry data read at once. */
const READ_CHUNK = 8 * 1024 * 1024;

/**
 * Writes the next `length` bytes of the archive from `cursor` (fewer at the
 * end). Updates `entries` (CRCs, skips) in place; persist them together
 * with the returned cursor to continue later. `modified` is the timestamp
 * of every entry; pass the same one each call.
 */
export async function writeZipRange(
  entries: ZipEntry[],
  cursor: ZipCursor,
  length: number,
  source: ZipRangeSource,
  modified: Date,
): Promise<{ bytes: Uint8Array; cursor: ZipCursor; total: number }> {
  const out: Uint8Array[] = [];
  let position = cursor.position;
  let crc = cursor.crc;
  let layout = layoutOf(entries);
  const end = () => Math.min(cursor.position + length, layout.total);

  while (position < end()) {
    const region = layout.regions.find(
      (r) => position >= r.start && position < r.start + r.length,
    )!;
    const offset = position - region.start;
    if (region.kind === 'header') {
      if (offset === 0 && source.check && !(await source.check(region.entry))) {
        entries[region.entry].skipped = true;
        layout = layoutOf(entries);
        continue;
      }
      const bytes = localHeader(entries[region.entry], modified);
      const take = Math.min(bytes.length - offset, end() - position);
      out.push(bytes.subarray(offset, offset + take));
      position += take;
      if (offset + take === bytes.length) crc = 0;
    } else if (region.kind === 'data') {
      const take = Math.min(
        region.length - offset,
        end() - position,
        READ_CHUNK,
      );
      const bytes = await source.read(region.entry, offset, offset + take - 1);
      if (!bytes || bytes.length !== take)
        throw new ZipSourceError(region.entry);
      crc = crc32(bytes, crc);
      out.push(bytes);
      position += take;
      if (offset + take === region.length) entries[region.entry].crc = crc;
    } else if (region.kind === 'descriptor') {
      const entry = entries[region.entry];
      // An empty entry has no data region bytes to finish its CRC.
      if (entry.crc === null) entry.crc = crc;
      const bytes = dataDescriptor(entry);
      const take = Math.min(bytes.length - offset, end() - position);
      out.push(bytes.subarray(offset, offset + take));
      position += take;
    } else {
      const bytes = centralDirectory(entries, layout, modified, region.start);
      const take = Math.min(bytes.length - offset, end() - position);
      out.push(bytes.subarray(offset, offset + take));
      position += take;
    }
  }
  return { bytes: concat(out), cursor: { position, crc }, total: layout.total };
}

// --- names ---------------------------------------------------------------------

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

function cleanSegment(segment: string): string {
  let out = Array.from(segment)
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code >= 0x20 && code !== 0x7f;
    })
    .join('')
    .replace(/[\\:*?"<>|]/g, '_')
    .replace(/[. ]+$/, '')
    .trim();
  if (RESERVED.test(out)) out = `_${out}`;
  return out;
}

/**
 * A path safe to extract anywhere: no `..` or `.` segments, no leading `/`,
 * no backslashes, control characters or characters Windows rejects, no
 * reserved Windows names, no trailing dots or spaces. Same rules as the
 * browser archive writer.
 */
export function sanitizeZipPath(path: string): string {
  const segments = path
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.' && segment !== '..')
    .map(cleanSegment)
    .filter(Boolean);
  return segments.length > 0 ? segments.join('/') : '_';
}

/**
 * Makes paths unique per folder, case-insensitively, by inserting ` (2)`,
 * ` (3)`, ... before the extension. Order is kept.
 */
export function uniqueZipPaths(paths: readonly string[]): string[] {
  const taken = new Set<string>();
  return paths.map((path) => {
    let candidate = path;
    const slash = path.lastIndexOf('/');
    const dir = path.slice(0, slash + 1);
    const file = path.slice(slash + 1);
    const dot = file.lastIndexOf('.');
    const base = dot > 0 ? file.slice(0, dot) : file;
    const ext = dot > 0 ? file.slice(dot) : '';
    for (let n = 2; taken.has(candidate.toLowerCase()); n++) {
      candidate = `${dir}${base} (${n})${ext}`;
    }
    taken.add(candidate.toLowerCase());
    return candidate;
  });
}

function csvCell(value: string | number): string {
  let text = String(value);
  // Keep spreadsheet apps from evaluating a name as a formula.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** A `manifest.csv` of the archive: id, path, size and usage count. */
export function manifestCsv(
  rows: readonly {
    id: string;
    path: string;
    size: number;
    usage?: number | null;
  }[],
): string {
  const lines = ['id,path,size,usage'];
  for (const row of rows) {
    lines.push(
      [row.id, row.path, row.size, row.usage ?? ''].map(csvCell).join(','),
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}
