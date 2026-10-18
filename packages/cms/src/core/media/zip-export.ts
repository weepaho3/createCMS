import { and, asc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';

import type { RealtimeRuntime } from '../realtime/types';
import type { DrizzleInstance } from '../types/drizzle';
import type { MediaConfig } from '../types/s3';

import { mediaExports } from '../db/schema.generated';
import { getStorage } from '../storage/get-storage';
import { emitMediaEvents } from './events';
import {
  manifestCsv,
  writeZipRange,
  ZipSourceError,
  type ZipCursor,
  type ZipEntry,
} from './zip-layout';

/** Bytes per stored part (S3 needs at least 5 MiB for all but the last). */
export const EXPORT_PART_SIZE = 8 * 1024 * 1024;
/** How long a finished archive stays downloadable. */
export const EXPORT_TTL_MS = 24 * 60 * 60 * 1000;
/** Exports one actor may have pending or running at once. */
export const MAX_ACTIVE_EXPORTS = 3;
/** Runs that may fail before an export is marked `failed`. */
export const EXPORT_ATTEMPTS = 3;
/** How long a worker owns an export without renewing its lease. */
const LEASE_MS = 2 * 60 * 1000;
const PART_URL_SECONDS = 900;
const PART_PUT_ATTEMPTS = 3;

export type ExportEntry = ZipEntry & {
  /** `null` for the manifest. */
  assetId: string | null;
  objectKey: string | null;
  usage?: number | null;
};

type ExportRow = typeof mediaExports.$inferSelect;
type ExportCursor = ZipCursor & { uploadId: string; partNumber: number };

export type ExportRunResult = 'done' | 'more' | 'failed' | 'busy';

/** The bytes of the manifest entry, derived from the asset entries. */
function manifestBytes(entries: readonly ExportEntry[]): Uint8Array {
  return new TextEncoder().encode(
    manifestCsv(
      entries
        .filter((entry) => entry.assetId !== null)
        .map((entry) => ({
          id: entry.assetId!,
          path: entry.name,
          size: entry.size,
          usage: entry.usage,
        })),
    ),
  );
}

/** Builds the manifest entry for `entries` (sized, not yet written). */
export function manifestEntry(entries: readonly ExportEntry[]): ExportEntry {
  return {
    assetId: null,
    objectKey: null,
    name: 'manifest.csv',
    size: manifestBytes(entries).length,
    crc: null,
  };
}

async function putPart(url: string, body: Uint8Array): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < PART_PUT_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, { method: 'PUT', body: body as BodyInit });
      if (res.ok) return;
      lastError = new Error(`Part upload answered ${res.status}`);
      if (res.status < 500 && res.status !== 429) break;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

async function claim(
  db: DrizzleInstance,
  id: string,
  now: Date,
): Promise<ExportRow | null> {
  const [row] = await db
    .update(mediaExports)
    .set({
      status: 'running',
      lockedUntil: new Date(now.getTime() + LEASE_MS),
    })
    .where(
      and(
        eq(mediaExports.id, id),
        inArray(mediaExports.status, ['pending', 'running']),
        or(isNull(mediaExports.lockedUntil), lt(mediaExports.lockedUntil, now)),
      ),
    )
    .returning();
  return row ?? null;
}

async function fail(
  db: DrizzleInstance,
  config: MediaConfig,
  realtime: RealtimeRuntime | undefined,
  row: ExportRow,
  error: string,
) {
  const cursor = row.cursor as ExportCursor | null;
  if (cursor) {
    try {
      await getStorage(config).multipart?.abort(row.objectKey, cursor.uploadId);
    } catch {
      // The bucket's lifecycle rule removes abandoned parts.
    }
  }
  await db
    .update(mediaExports)
    .set({
      status: 'failed',
      error,
      cursor: null,
      lockedUntil: null,
      completedAt: new Date(),
      expiresAt: new Date(Date.now() + EXPORT_TTL_MS),
    })
    .where(eq(mediaExports.id, row.id));
  await emitMediaEvents(realtime, { channelKey: row.channelKey ?? undefined }, [
    { event: 'media.export.failed', exportId: row.id },
  ]);
}

/**
 * Writes export `id` until it is finished or `deadline` passes, one part
 * at a time. After each stored part the entries and cursor are saved and
 * the lease renewed, so a run that stops (deadline, crash) loses at most
 * one part. Returns `busy` when another worker holds the lease.
 */
export async function runZipExport(
  db: DrizzleInstance,
  config: MediaConfig,
  realtime: RealtimeRuntime | undefined,
  id: string,
  deadline: number,
  /** Test seams: a smaller part size and a cap on parts per run. */
  opts: { partSize?: number; maxParts?: number } = {},
): Promise<ExportRunResult> {
  let row = await claim(db, id, new Date());
  if (!row) return 'busy';
  const storage = getStorage(config);
  const multipart = storage.multipart;
  if (!multipart || !storage.capabilities.multipart.supported) {
    await fail(db, config, realtime, row, 'STORAGE_UNSUPPORTED');
    return 'failed';
  }
  const partSize =
    opts.partSize ??
    Math.max(EXPORT_PART_SIZE, storage.capabilities.multipart.minPartSize);
  let partsLeft = opts.maxParts ?? Infinity;
  const entries = row.entries as ExportEntry[];
  const modified = row.createdAt;
  const manifest = row.manifest ? manifestBytes(entries) : null;

  try {
    let cursor = row.cursor as ExportCursor | null;
    if (!cursor) {
      const uploadId = await multipart.create(row.objectKey, {
        contentType: 'application/zip',
      });
      cursor = { position: 0, crc: 0, uploadId, partNumber: 1 };
      await db
        .update(mediaExports)
        .set({ cursor })
        .where(eq(mediaExports.id, row.id));
    }

    const source = {
      async read(index: number, start: number, end: number) {
        const entry = entries[index];
        if (entry.objectKey === null) return manifest!.subarray(start, end + 1);
        return storage.getRange(entry.objectKey, start, end);
      },
      async check(index: number) {
        const entry = entries[index];
        if (entry.objectKey === null) return true;
        const head = await storage.head(entry.objectKey);
        return head !== null && head.contentLength === entry.size;
      },
    };

    let total = row.totalBytes;
    while (cursor.position < total) {
      if (Date.now() >= deadline || partsLeft-- <= 0) {
        await db
          .update(mediaExports)
          .set({ lockedUntil: null })
          .where(eq(mediaExports.id, row.id));
        return 'more';
      }
      const written = await writeZipRange(
        entries,
        cursor,
        partSize,
        source,
        modified,
      );
      total = written.total;
      const url = await multipart.signPart(row.objectKey, cursor.uploadId, {
        partNumber: cursor.partNumber,
        contentLength: written.bytes.length,
        expiresIn: PART_URL_SECONDS,
      });
      await putPart(url, written.bytes);
      cursor = {
        ...written.cursor,
        uploadId: cursor.uploadId,
        partNumber: cursor.partNumber + 1,
      };
      const saved = await db
        .update(mediaExports)
        .set({
          entries,
          cursor,
          totalBytes: total,
          writtenBytes: cursor.position,
          lockedUntil: new Date(Date.now() + LEASE_MS),
        })
        .where(eq(mediaExports.id, row.id))
        .returning({ id: mediaExports.id });
      if (saved.length === 0) {
        // Deleted while running (`deleteZipExport`): drop the parts.
        await multipart.abort(row.objectKey, cursor.uploadId);
        return 'failed';
      }
    }

    const parts: { partNumber: number; etag: string }[] = [];
    let marker: number | null = null;
    do {
      const page = await multipart.listParts(row.objectKey, cursor.uploadId, {
        marker,
      });
      for (const part of page.parts) {
        parts.push({ partNumber: part.partNumber, etag: part.etag });
      }
      marker = page.marker;
    } while (marker !== null);
    await multipart.complete(
      row.objectKey,
      cursor.uploadId,
      parts.sort((a, b) => a.partNumber - b.partNumber),
    );
    const finished = await db
      .update(mediaExports)
      .set({
        status: 'ready',
        cursor: null,
        lockedUntil: null,
        completedAt: new Date(),
        expiresAt: new Date(Date.now() + EXPORT_TTL_MS),
      })
      .where(eq(mediaExports.id, row.id))
      .returning({ id: mediaExports.id });
    if (finished.length === 0) {
      await storage.delete(row.objectKey);
      return 'failed';
    }
    await emitMediaEvents(
      realtime,
      { channelKey: row.channelKey ?? undefined },
      [{ event: 'media.export.ready', exportId: row.id }],
    );
    return 'done';
  } catch (err) {
    [row] = await db
      .update(mediaExports)
      .set({
        attempts: sql`${mediaExports.attempts} + 1`,
        lockedUntil: null,
      })
      .where(eq(mediaExports.id, row.id))
      .returning();
    // An entry that vanished mid-write cannot be skipped any more: its
    // header is already stored.
    if (err instanceof ZipSourceError || row.attempts >= EXPORT_ATTEMPTS) {
      await fail(
        db,
        config,
        realtime,
        row,
        err instanceof ZipSourceError ? 'ASSET_NOT_FOUND' : 'EXPORT_FAILED',
      );
      return 'failed';
    }
    console.error(`[cms] media export ${row.id} failed, will retry:`, err);
    return 'more';
  }
}

/**
 * The export step of the pruning pass: deletes expired archives and their
 * rows, then continues unfinished exports oldest first until `deadline`.
 */
export async function processZipExports(
  db: DrizzleInstance,
  config: MediaConfig,
  realtime: RealtimeRuntime | undefined,
  opts: { deadline: number; dryRun?: boolean },
): Promise<{ finished: string[]; expired: string[]; more: boolean }> {
  const result = {
    finished: [] as string[],
    expired: [] as string[],
    more: false,
  };
  const now = new Date();
  const expired = await db
    .select({ id: mediaExports.id, objectKey: mediaExports.objectKey })
    .from(mediaExports)
    .where(
      and(
        inArray(mediaExports.status, ['ready', 'failed']),
        lt(mediaExports.expiresAt, now),
      ),
    )
    .limit(100);
  for (const row of expired) {
    if (Date.now() >= opts.deadline) return { ...result, more: true };
    if (!opts.dryRun) {
      try {
        await getStorage(config).delete(row.objectKey);
      } catch {
        // Keep the row; the next pass deletes the archive again.
        continue;
      }
      await db.delete(mediaExports).where(eq(mediaExports.id, row.id));
    }
    result.expired.push(row.id);
  }
  if (opts.dryRun) return result;

  const open = await db
    .select({ id: mediaExports.id })
    .from(mediaExports)
    .where(
      and(
        inArray(mediaExports.status, ['pending', 'running']),
        or(isNull(mediaExports.lockedUntil), lt(mediaExports.lockedUntil, now)),
      ),
    )
    .orderBy(asc(mediaExports.createdAt))
    .limit(10);
  for (const { id } of open) {
    if (Date.now() >= opts.deadline) return { ...result, more: true };
    const outcome = await runZipExport(db, config, realtime, id, opts.deadline);
    if (outcome === 'done') result.finished.push(id);
    if (outcome === 'more') result.more = true;
  }
  return result;
}
