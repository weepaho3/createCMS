/**
 * A streaming ZIP writer for already compressed media: entries are STORED
 * (no deflate), so the archive length is known in advance (`predictZipLength`)
 * and progress is exact. Entries use data descriptors and UTF-8 names; ZIP64
 * records are written where a size, an offset or the entry count needs them.
 */

export type ZipInput = {
  /** Path inside the archive, `/` separated (see `sanitizeZipPath`). */
  name: string;
  lastModified?: Date;
  /** The bytes; a function is called when the entry is reached. */
  input:
    | Uint8Array
    | Blob
    | ReadableStream<Uint8Array>
    | (() => Promise<ReadableStream<Uint8Array> | Uint8Array | Blob>);
};

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
  const year = Math.min(Math.max(date.getFullYear(), 1980), 2107);
  return {
    time:
      (date.getHours() << 11) |
      (date.getMinutes() << 5) |
      Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
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

type Written = {
  name: Uint8Array;
  crc: number;
  size: number;
  offset: number;
  time: number;
  date: number;
};

function centralExtra(entry: Written): Uint8Array | null {
  const fields: number[] = [];
  if (entry.size >= MAX_32) fields.push(entry.size, entry.size);
  if (entry.offset >= MAX_32) fields.push(entry.offset);
  if (fields.length === 0) return null;
  const w = new Writer(4 + fields.length * 8);
  w.u16(0x0001);
  w.u16(fields.length * 8);
  for (const value of fields) w.u64(value);
  return w.done();
}

async function* chunksOf(input: ZipInput['input']): AsyncGenerator<Uint8Array> {
  const source = typeof input === 'function' ? await input() : input;
  if (source instanceof Uint8Array) {
    yield source;
    return;
  }
  const stream = source instanceof Blob ? source.stream() : source;
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value) yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

/** Streams a STORE archive of `entries`, read one after another. */
export function makeZip(
  entries: Iterable<ZipInput> | AsyncIterable<ZipInput>,
): ReadableStream<Uint8Array> {
  const written: Written[] = [];
  let offset = 0;
  async function* generate(): AsyncGenerator<Uint8Array> {
    for await (const entry of entries) {
      const name = encoder.encode(entry.name);
      const { time, date } = dosDateTime(entry.lastModified ?? new Date());
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
      const start = offset;
      yield header.done();
      offset += 30 + name.length;
      let crc = 0;
      let size = 0;
      for await (const chunk of chunksOf(entry.input)) {
        crc = crc32(chunk, crc);
        size += chunk.length;
        offset += chunk.length;
        yield chunk;
      }
      const zip64 = size >= MAX_32;
      const descriptor = new Writer(zip64 ? 24 : 16);
      descriptor.u32(0x08074b50);
      descriptor.u32(crc);
      if (zip64) {
        descriptor.u64(size);
        descriptor.u64(size);
      } else {
        descriptor.u32(size);
        descriptor.u32(size);
      }
      yield descriptor.done();
      offset += zip64 ? 24 : 16;
      written.push({ name, crc, size, offset: start, time, date });
    }
    const centralStart = offset;
    for (const entry of written) {
      const extra = centralExtra(entry);
      const w = new Writer(46 + entry.name.length + (extra?.length ?? 0));
      w.u32(0x02014b50);
      w.u16(45);
      w.u16(45);
      w.u16(0x0808);
      w.u16(0);
      w.u16(entry.time);
      w.u16(entry.date);
      w.u32(entry.crc);
      w.u32(Math.min(entry.size, MAX_32));
      w.u32(Math.min(entry.size, MAX_32));
      w.u16(entry.name.length);
      w.u16(extra?.length ?? 0);
      w.u16(0);
      w.u16(0);
      w.u16(0);
      w.u32(0);
      w.u32(Math.min(entry.offset, MAX_32));
      w.raw(entry.name);
      if (extra) w.raw(extra);
      const bytes = w.done();
      offset += bytes.length;
      yield bytes;
    }
    const centralSize = offset - centralStart;
    const count = written.length;
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
      end64.u64(offset);
      end64.u32(1);
      yield end64.done();
    }
    const end = new Writer(22);
    end.u32(0x06054b50);
    end.u16(0);
    end.u16(0);
    end.u16(Math.min(count, MAX_16));
    end.u16(Math.min(count, MAX_16));
    end.u32(Math.min(centralSize, MAX_32));
    end.u32(Math.min(centralStart, MAX_32));
    end.u16(0);
    yield end.done();
  }
  const iterator = generate();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await iterator.next();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    async cancel() {
      await iterator.return(undefined);
    },
  });
}

/** The exact length `makeZip` produces for entries of these names and sizes. */
export function predictZipLength(
  entries: readonly { name: string; size: number }[],
): number {
  let offset = 0;
  let central = 0;
  for (const entry of entries) {
    const nameLength = encoder.encode(entry.name).length;
    const start = offset;
    offset += 30 + nameLength + entry.size + (entry.size >= MAX_32 ? 24 : 16);
    const fields = (entry.size >= MAX_32 ? 2 : 0) + (start >= MAX_32 ? 1 : 0);
    central += 46 + nameLength + (fields > 0 ? 4 + fields * 8 : 0);
  }
  const zip64 =
    entries.length >= MAX_16 || central >= MAX_32 || offset >= MAX_32;
  return offset + central + (zip64 ? 76 : 0) + 22;
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
 * reserved Windows names (`CON`, `NUL`, ...), no trailing dots or spaces.
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
 * ` (3)`, ... before the extension: `a.jpg`, `A.jpg` become `a.jpg`,
 * `A (2).jpg`. Order is kept.
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
