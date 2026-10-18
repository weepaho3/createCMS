import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import type { TestS3 } from '../../../test-utils/s3';

import { setupTestCMS } from '../../../test-utils/cms';
import { mediaExports } from '../../db/schema.generated';
import { getStorage } from '../../storage/get-storage';
import { processZipExports, runZipExport } from '../zip-export';
import {
  crc32,
  writeZipRange,
  zipLength,
  type ZipEntry,
  type ZipRangeSource,
} from '../zip-layout';

/** The entries of a STORE archive, read through its central directory. */
function readZip(bytes: Uint8Array): { name: string; data: Uint8Array }[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const out: { name: string; data: Uint8Array }[] = [];
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const offset = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(
      bytes.subarray(at + 46, at + 46 + nameLength),
    );
    expect(view.getUint32(offset, true)).toBe(0x04034b50);
    const start = offset + 30 + view.getUint16(offset + 26, true);
    const data = bytes.subarray(start, start + size);
    expect(crc32(data)).toBe(crc);
    out.push({ name, data });
    at += 46 + nameLength + extraLength;
  }
  return out;
}

const pattern = (size: number, seed: number) =>
  new Uint8Array(size).map((_, i) => (i * seed) % 251);

describe('writeZipRange', () => {
  const files = [pattern(5000, 3), pattern(0, 1), pattern(12_345, 7)];
  const fresh = (): ZipEntry[] => [
    { name: 'a/one.bin', size: 5000, crc: null },
    { name: 'empty.txt', size: 0, crc: null },
    { name: 'Übersicht.bin', size: 12_345, crc: null },
  ];
  const source: ZipRangeSource = {
    read: async (index, start, end) => files[index].slice(start, end + 1),
  };
  const modified = new Date('2026-01-02T03:04:06Z');

  it('writes the same archive in one range or in many', async () => {
    const whole = await writeZipRange(
      fresh(),
      { position: 0, crc: 0 },
      Infinity,
      source,
      modified,
    );
    expect(whole.bytes.length).toBe(zipLength(fresh()));

    for (const step of [1, 7, 1000, 4096]) {
      const entries = fresh();
      let cursor = { position: 0, crc: 0 };
      const parts: Uint8Array[] = [];
      for (;;) {
        // A persisted checkpoint: entries and cursor survive as JSON.
        const restored = JSON.parse(JSON.stringify(entries)) as ZipEntry[];
        const written = await writeZipRange(
          restored,
          cursor,
          step,
          source,
          modified,
        );
        entries.splice(0, entries.length, ...restored);
        cursor = written.cursor;
        parts.push(written.bytes);
        if (cursor.position >= written.total) break;
      }
      expect(Buffer.concat(parts)).toEqual(Buffer.from(whole.bytes));
    }

    const read = readZip(whole.bytes);
    expect(read.map((e) => e.name)).toEqual([
      'a/one.bin',
      'empty.txt',
      'Übersicht.bin',
    ]);
    expect(read[2].data).toEqual(files[2]);
  });

  it('skips an entry whose check fails and shifts the rest', async () => {
    const entries = fresh();
    const written = await writeZipRange(
      entries,
      { position: 0, crc: 0 },
      Infinity,
      { ...source, check: async (index) => index !== 0 },
      modified,
    );
    expect(entries[0].skipped).toBe(true);
    expect(written.total).toBe(zipLength(entries));
    expect(readZip(written.bytes).map((e) => e.name)).toEqual([
      'empty.txt',
      'Übersicht.bin',
    ]);
  });
});

describe('zip exports', () => {
  let cleanup: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await cleanup?.();
    cleanup = undefined;
  });

  async function setup() {
    const tasks: (() => Promise<void>)[] = [];
    const ctx = await setupTestCMS({
      withS3: true,
      media: {
        capabilities: { multipart: { minPartSize: 1 } },
        runExport: (task) => tasks.push(task),
      },
    });
    cleanup = ctx.s3.cleanup;
    const { cms } = ctx;
    const { folder } = await cms.api.media.createFolder({
      body: { name: 'Brand' },
    });
    const png = (seed: number) => {
      const bytes = pattern(100_000, seed);
      bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      return bytes;
    };
    const bodies = [png(3), png(5), png(7)];
    const upload = async (name: string, body: Uint8Array, folderId?: string) =>
      (
        await cms.api.media.uploadAssets({
          body: {
            files: [
              {
                name,
                size: body.length,
                type: 'image/png',
                buffer: new Blob([body as BlobPart]),
              },
            ],
            folderId,
          },
        })
      ).assets[0];
    const uploaded = [
      await upload('logo.png', bodies[0], folder.id),
      await upload('logo.png', bodies[1]),
      await upload('LOGO.png', bodies[2]),
    ];
    return {
      ...ctx,
      s3: ctx.s3 as TestS3,
      tasks,
      bodies,
      ids: uploaded.map((a) => a.id),
      objectKeys: uploaded.map((a) => a.objectKey),
    };
  }

  it('writes the archive in parts across runs and signs it once ready', async () => {
    const { cms, db, s3, tasks, bodies, ids } = await setup();
    const { export: created } = await cms.api.media.createZipExport({
      body: { assetIds: ids, name: 'campaign', manifest: true },
    });
    expect(created).toMatchObject({
      name: 'campaign.zip',
      status: 'pending',
      files: 3,
      url: null,
    });
    expect(tasks).toHaveLength(1);

    // Two 64 KiB parts, then the run stops as if its function was cut off.
    const first = await runZipExport(
      db,
      s3.config,
      undefined,
      created.id,
      Date.now() + 60_000,
      { partSize: 64 * 1024, maxParts: 2 },
    );
    expect(first).toBe('more');
    const { export: running } = await cms.api.media.getZipExport({
      body: { exportId: created.id },
    });
    expect(running).toMatchObject({ status: 'running', loaded: 128 * 1024 });

    const second = await runZipExport(
      db,
      s3.config,
      undefined,
      created.id,
      Date.now() + 60_000,
      { partSize: 64 * 1024 },
    );
    expect(second).toBe('done');
    expect(s3.pendingUploads()).toEqual([]);

    const { export: ready } = await cms.api.media.getZipExport({
      body: { exportId: created.id },
    });
    expect(ready.status).toBe('ready');
    expect(ready.loaded).toBe(ready.total);
    const res = await fetch(ready.url!);
    expect(decodeURIComponent(ready.url!)).toContain('campaign.zip');
    const read = readZip(new Uint8Array(await res.arrayBuffer()));
    expect(read.map((e) => e.name)).toEqual([
      'Brand/logo.png',
      'logo.png',
      'LOGO (2).png',
      'manifest.csv',
    ]);
    expect(read[2].data).toEqual(bodies[2]);
    const manifest = new TextDecoder().decode(read[3].data);
    expect(manifest.split('\r\n')[0]).toBe('id,path,size,usage');
    expect(manifest).toContain(`${ids[0]},Brand/logo.png,100000,0`);
  });

  it('leaves out an asset whose object is gone and reports it', async () => {
    const { cms, db, s3, ids, objectKeys } = await setup();
    await getStorage(s3.config).delete(objectKeys[1]);
    const { export: created } = await cms.api.media.createZipExport({
      body: { assetIds: ids, flatten: true },
    });
    await runZipExport(
      db,
      s3.config,
      undefined,
      created.id,
      Date.now() + 60_000,
    );
    const { export: ready } = await cms.api.media.getZipExport({
      body: { exportId: created.id },
    });
    expect(ready).toMatchObject({
      status: 'ready',
      files: 2,
      skipped: [ids[1]],
    });
    const read = readZip(
      new Uint8Array(await (await fetch(ready.url!)).arrayBuffer()),
    );
    // Names are fixed when the export is created.
    expect(read.map((e) => e.name)).toEqual(['logo.png', 'LOGO (3).png']);
  });

  it('allows three unfinished exports per actor', async () => {
    const { cms, ids } = await setup();
    for (let i = 0; i < 3; i++) {
      await cms.api.media.createZipExport({ body: { assetIds: ids } });
    }
    await expect(
      cms.api.media.createZipExport({ body: { assetIds: ids } }),
    ).rejects.toMatchObject({ body: { code: 'RATE_LIMITED' } });
  });

  it('deletes expired archives in the pruning step and on request', async () => {
    const { cms, db, s3, ids } = await setup();
    const { export: a } = await cms.api.media.createZipExport({
      body: { assetIds: ids },
    });
    const { export: b } = await cms.api.media.createZipExport({
      body: { assetIds: ids },
    });
    const pass = await processZipExports(db, s3.config, undefined, {
      deadline: Date.now() + 60_000,
    });
    expect(pass.finished.sort()).toEqual([a.id, b.id].sort());
    const keyOf = async (id: string) =>
      (
        await db
          .select({ objectKey: mediaExports.objectKey })
          .from(mediaExports)
          .where(eq(mediaExports.id, id))
      )[0].objectKey;
    const keyA = await keyOf(a.id);
    const keyB = await keyOf(b.id);
    expect(s3.keys()).toContain(keyA);

    await db
      .update(mediaExports)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(mediaExports.id, a.id));
    const later = await processZipExports(db, s3.config, undefined, {
      deadline: Date.now() + 60_000,
    });
    expect(later.expired).toEqual([a.id]);
    expect(s3.keys()).not.toContain(keyA);
    await expect(
      cms.api.media.getZipExport({ body: { exportId: a.id } }),
    ).rejects.toMatchObject({ body: { code: 'EXPORT_NOT_FOUND' } });

    await cms.api.media.deleteZipExport({ body: { exportId: b.id } });
    expect(s3.keys()).not.toContain(keyB);
    const { exports } = await cms.api.media.listZipExports({ body: {} });
    expect(exports).toEqual([]);
  });
});
