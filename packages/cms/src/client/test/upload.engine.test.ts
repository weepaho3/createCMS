import { describe, expect, inject, it } from 'vitest';

import type { CMSMediaUploadFileState, CMSMediaUploadState } from '../types';

import { createCMSClient } from '../vanilla';

const cmsUrl = inject('cmsUrl');

/** A file name unique to this engine and run; the S3 test hooks key on it. */
const unique = (base: string) =>
  `${base}-${Math.random().toString(36).slice(2, 10)}.png`;

/** A file of `size` bytes that sniffs as PNG. */
function png(name: string, size: number, lastModified?: number): File {
  const bytes = new Uint8Array(size);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return new File([bytes], name, { type: 'image/png', lastModified });
}

type MediaSurface = {
  uploadState: {
    get(): CMSMediaUploadState;
    subscribe(listener: (state: CMSMediaUploadState) => void): () => void;
  };
};

function client() {
  const cms = createCMSClient({ baseURL: `${cmsUrl}/api/cms` }) as unknown as {
    media: MediaSurface;
  };
  const seen: CMSMediaUploadFileState[] = [];
  cms.media.uploadState.subscribe((state) => {
    for (const entry of state.files) seen.push(entry);
  });
  return { queue: cms.media.uploadState, seen };
}

describe('upload engine against an S3-compatible server', () => {
  it('reports byte progress, holds below 100 percent until the row exists, and completes', async () => {
    const { queue, seen } = client();
    const [entry] = await queue
      .get()
      .upload([png('large.png', 2 * 1024 * 1024)]);

    expect(entry).toMatchObject({ status: 'success', progress: 1 });
    expect(entry.result?.id).toMatch(/^ast_/);
    expect(entry.assetId).toBe(entry.result?.id);
    const before = seen.filter((e) => e.status !== 'success');
    expect(before.some((e) => e.loaded > 0)).toBe(true);
    expect(Math.max(...before.map((e) => e.progress))).toBeLessThanOrEqual(
      0.99,
    );
    expect(
      before.some((e) => e.phase === 'finalizing' || e.status === 'completing'),
    ).toBe(true);
  });

  it('retries a PUT the storage answers with 503', async () => {
    const name = unique('retry');
    await fetch(`${cmsUrl}/__test/slow-down?name=${name}&count=1`, {
      method: 'POST',
    });
    const { queue, seen } = client();
    const [entry] = await queue.get().upload([png(name, 64 * 1024)]);

    expect(entry.status).toBe('success');
    expect(seen.some((e) => e.status === 'retrying')).toBe(true);
  });

  it('aborts an upload in flight and leaves no row', async () => {
    const name = unique('abort');
    await fetch(`${cmsUrl}/__test/put-delay?name=${name}&ms=3000`, {
      method: 'POST',
    });
    const { queue } = client();
    const done = queue.get().upload([png(name, 3 * 1024 * 1024)]);
    await new Promise<void>((resolve) => {
      const off = queue.subscribe((state) => {
        if (state.files.some((e) => e.status === 'uploading')) {
          off();
          resolve();
        }
      });
    });
    queue.get().abort();
    const [entry] = await done;
    expect(entry.status).toBe('aborted');
    expect(entry.result).toBeUndefined();
  });
});

describe('multipart uploads against an S3-compatible server', () => {
  const parts = async (name: string): Promise<number[]> =>
    (await fetch(`${cmsUrl}/__test/parts?name=${name}`)).json() as Promise<
      number[]
    >;

  it('uploads a large file in parts', async () => {
    const name = unique('multi');
    const { queue } = client();
    const [entry] = await queue.get().upload([png(name, 5 * 1024 * 1024)]);
    expect(entry.status).toBe('success');
    expect((await parts(name)).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it('resumes after a pause without uploading a stored part again', async () => {
    const name = unique('resume');
    await fetch(`${cmsUrl}/__test/put-delay?name=${name}&ms=800`, {
      method: 'POST',
    });
    const { queue } = client();
    void queue.get().upload([png(name, 6 * 1024 * 1024)]);
    // Wait until the first wave of four parts is stored, then pause.
    for (let i = 0; i < 100 && (await parts(name)).length < 4; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const id = queue.get().files[0].id;
    queue.get().pause(id);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(queue.get().files[0].status).toBe('paused');
    await fetch(`${cmsUrl}/__test/put-delay?name=${name}&ms=0`, {
      method: 'POST',
    });
    // `upload` settles on pause; wait for the resumed upload instead.
    const settled = new Promise<string>((resolve) => {
      const off = queue.subscribe((state) => {
        const status = state.files[0]?.status;
        if (status === 'success' || status === 'error') {
          off();
          resolve(status);
        }
      });
    });
    queue.get().resume(id);

    expect(await settled).toBe('success');
    const stored = await parts(name);
    for (const n of [1, 2, 3, 4]) {
      expect(stored.filter((p) => p === n)).toHaveLength(1);
    }
    expect(new Set(stored)).toEqual(new Set([1, 2, 3, 4, 5, 6]));
  });

  it('resumes after a reload when the same file is picked again', async () => {
    const name = unique('reload');
    const lastModified = 1_700_000_000_000;
    await fetch(`${cmsUrl}/__test/put-delay?name=${name}&ms=800`, {
      method: 'POST',
    });
    const before = client().queue;
    void before.get().upload([png(name, 6 * 1024 * 1024, lastModified)]);
    for (let i = 0; i < 100 && (await parts(name)).length < 4; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    before.get().pause(before.get().files[0].id);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await fetch(`${cmsUrl}/__test/put-delay?name=${name}&ms=0`, {
      method: 'POST',
    });

    // A new queue reads the resume record the first one left in localStorage.
    const after = client().queue;
    const [entry] = await after
      .get()
      .upload([png(name, 6 * 1024 * 1024, lastModified)]);

    expect(entry.status).toBe('success');
    expect(entry.assetId).toBe(before.get().files[0].assetId);
    const stored = await parts(name);
    for (const n of [1, 2, 3, 4]) {
      expect(stored.filter((p) => p === n)).toHaveLength(1);
    }
    expect(new Set(stored)).toEqual(new Set([1, 2, 3, 4, 5, 6]));
  });
});
