// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CMSFetch } from '../types';

import { CMSClientError } from '../error';
import { createMediaUploadAtom } from '../media-upload';

type Listener = (event: unknown) => void;

// Stand-in for `XMLHttpRequest`: records every instance and lets a test fire
// the `upload.progress`, `load`, `error` and `abort` events by hand.
class FakeXHR {
  static instances: FakeXHR[] = [];

  status = 0;
  aborted = false;
  private listeners = new Map<string, Listener[]>();
  private uploadListeners = new Map<string, Listener[]>();

  upload = {
    addEventListener: (type: string, fn: Listener) => {
      this.uploadListeners.set(type, [
        ...(this.uploadListeners.get(type) ?? []),
        fn,
      ]);
    },
  };

  constructor() {
    FakeXHR.instances.push(this);
  }

  open() {}
  setRequestHeader() {}
  send() {}

  addEventListener(type: string, fn: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }

  abort() {
    this.aborted = true;
    this.emit('abort');
  }

  fireProgress(loaded: number, total: number) {
    for (const fn of this.uploadListeners.get('progress') ?? []) {
      fn({ lengthComputable: true, loaded, total });
    }
  }

  fireLoad(status = 200) {
    this.status = status;
    this.emit('load');
  }

  fireError() {
    this.emit('error');
  }

  private emit(type: string) {
    for (const fn of this.listeners.get(type) ?? []) fn({ type });
  }
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function makeFile(name: string, size: number): File {
  return new File([new Uint8Array(size)], name, {
    type: 'application/octet-stream',
  });
}

function signingFetch(): CMSFetch {
  return (async (_path: string, options?: { body?: unknown }) => {
    const body = options?.body as { files: { name: string }[] };
    return {
      assets: body.files.map((file, index) => ({
        id: `ast_${index}_${file.name}`,
        slug: file.name,
        objectKey: `uploads/${file.name}`,
        url: `https://cdn.example.com/${file.name}`,
        signedUrl: `https://bucket.example.com/${file.name}`,
        headers: { 'content-type': 'application/octet-stream' },
      })),
      expiresAt: new Date(),
    };
  }) as CMSFetch;
}

async function completeAll(xhrs: FakeXHR[]) {
  for (const xhr of xhrs) xhr.fireLoad();
  await tick();
}

describe('createMediaUploadAtom', () => {
  const RealXHR = globalThis.XMLHttpRequest;

  beforeEach(() => {
    FakeXHR.instances = [];
    globalThis.XMLHttpRequest = FakeXHR as unknown as typeof XMLHttpRequest;
  });

  afterEach(() => {
    globalThis.XMLHttpRequest = RealXHR;
    vi.restoreAllMocks();
  });

  it('sums progress by bytes, not by file count', async () => {
    const store = createMediaUploadAtom(signingFetch());
    const promise = store
      .get()
      .upload([makeFile('big.bin', 1000), makeFile('small.bin', 10)]);
    await tick();

    expect(store.get().progress).toEqual({
      loaded: 0,
      total: 1010,
      fraction: 0,
    });

    FakeXHR.instances[0].fireProgress(500, 1000);
    expect(store.get().progress.fraction).toBeCloseTo(500 / 1010, 10);
    expect(store.get().progress.fraction).not.toBeCloseTo(0.25, 2);

    await completeAll(FakeXHR.instances);
    await promise;
    expect(store.get().progress).toEqual({
      loaded: 1010,
      total: 1010,
      fraction: 1,
    });
  });

  it('accumulates entries across upload calls', async () => {
    const store = createMediaUploadAtom(signingFetch());
    const first = store.get().upload([makeFile('a.bin', 10)]);
    await tick();
    await completeAll(FakeXHR.instances);
    await first;

    const second = store.get().upload([makeFile('b.bin', 20)]);
    await tick();
    await completeAll(FakeXHR.instances.slice(1));
    await second;

    const files = store.get().files;
    expect(files).toHaveLength(2);
    expect(files.map((f) => f.name)).toEqual(['a.bin', 'b.bin']);
    expect(files[0].status).toBe('success');
    expect(files[1].status).toBe('success');
    expect(files[0].id).not.toBe(files[1].id);
    expect(store.get().isUploading).toBe(false);
  });

  it('reset drops finished entries and keeps in-flight ones', async () => {
    const store = createMediaUploadAtom(signingFetch());
    const first = store.get().upload([makeFile('a.bin', 10)]);
    const second = store.get().upload([makeFile('b.bin', 20)]);
    await tick();

    FakeXHR.instances[0].fireLoad();
    await first;
    expect(store.get().files.map((f) => f.status)).toEqual([
      'success',
      'uploading',
    ]);

    store.get().reset();
    const files = store.get().files;
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe('b.bin');
    expect(files[0].status).toBe('uploading');
    expect(store.get().isUploading).toBe(true);
    expect(store.get().error).toBeNull();

    FakeXHR.instances[1].fireLoad();
    await second;
    expect(store.get().files[0].status).toBe('success');
  });

  it('abort marks in-flight and pending entries aborted, not error', async () => {
    const store = createMediaUploadAtom(signingFetch());
    const promise = store
      .get()
      .upload([makeFile('a.bin', 10), makeFile('b.bin', 20)], {
        concurrency: 1,
      });
    await tick();

    expect(FakeXHR.instances).toHaveLength(1);
    store.get().abort();
    const result = await promise;

    expect(FakeXHR.instances).toHaveLength(1);
    expect(FakeXHR.instances[0].aborted).toBe(true);
    expect(result.map((f) => f.status)).toEqual(['aborted', 'aborted']);
    expect(result.every((f) => f.error === undefined)).toBe(true);
    expect(store.get().isUploading).toBe(false);
    expect(store.get().progress).toEqual({ loaded: 0, total: 0, fraction: 0 });

    const next = store.get().upload([makeFile('c.bin', 5)]);
    await tick();
    expect(FakeXHR.instances).toHaveLength(2);
    await completeAll(FakeXHR.instances.slice(1));
    const [entry] = await next;
    expect(entry.status).toBe('success');
  });

  it('opens at most `concurrency` requests at once', async () => {
    const store = createMediaUploadAtom(signingFetch());
    const files = Array.from({ length: 5 }, (_, i) =>
      makeFile(`f${i}.bin`, 10),
    );
    const promise = store.get().upload(files, { concurrency: 2 });
    await tick();

    expect(FakeXHR.instances).toHaveLength(2);
    expect(store.get().files.map((f) => f.status)).toEqual([
      'uploading',
      'uploading',
      'pending',
      'pending',
      'pending',
    ]);

    FakeXHR.instances[0].fireLoad();
    await tick();
    expect(FakeXHR.instances).toHaveLength(3);

    await completeAll(FakeXHR.instances.slice(1));
    await completeAll(FakeXHR.instances.slice(3));
    const result = await promise;
    expect(FakeXHR.instances).toHaveLength(5);
    expect(result.every((f) => f.status === 'success')).toBe(true);
  });

  it('marks every entry error when signing fails', async () => {
    const failing = (async () => {
      throw new CMSClientError({
        code: 'FILE_TOO_LARGE',
        message: 'File exceeds the size limit',
        status: 413,
      });
    }) as CMSFetch;
    const store = createMediaUploadAtom(failing);

    const result = await store
      .get()
      .upload([makeFile('a.bin', 10), makeFile('b.bin', 20)]);

    expect(result).toHaveLength(2);
    for (const entry of result) {
      expect(entry.status).toBe('error');
      expect(entry.error).toEqual({
        code: 'FILE_TOO_LARGE',
        message: 'File exceeds the size limit',
      });
    }
    expect(store.get().error).toBeInstanceOf(CMSClientError);
    expect(store.get().isUploading).toBe(false);
    expect(FakeXHR.instances).toHaveLength(0);
  });

  it('resolves with the entries of that call only', async () => {
    const store = createMediaUploadAtom(signingFetch());
    const first = store.get().upload([makeFile('a.bin', 10)]);
    await tick();
    await completeAll(FakeXHR.instances);
    await first;

    const second = store
      .get()
      .upload([makeFile('b.bin', 20), makeFile('c.bin', 30)]);
    await tick();
    await completeAll(FakeXHR.instances.slice(1));
    const result = await second;

    expect(result.map((f) => f.name)).toEqual(['b.bin', 'c.bin']);
    expect(result.map((f) => f.result?.id)).toEqual([
      'ast_0_b.bin',
      'ast_1_c.bin',
    ]);
    expect(result[0].result).toEqual({
      id: 'ast_0_b.bin',
      slug: 'b.bin',
      objectKey: 'uploads/b.bin',
    });
    expect(store.get().files).toHaveLength(3);
  });

  it('excludes failed entries from the aggregate', async () => {
    const store = createMediaUploadAtom(signingFetch());
    const promise = store
      .get()
      .upload([makeFile('a.bin', 100), makeFile('b.bin', 200)]);
    await tick();

    FakeXHR.instances[0].fireError();
    FakeXHR.instances[1].fireProgress(200, 200);
    FakeXHR.instances[1].fireLoad();
    const result = await promise;

    expect(result[0].status).toBe('error');
    expect(result[0].error?.code).toBe('NETWORK_ERROR');
    expect(result[1].status).toBe('success');
    expect(store.get().progress).toEqual({
      loaded: 200,
      total: 200,
      fraction: 1,
    });
    expect(store.get().error).toBe('Some files failed to upload');
  });

  it('reports non-2xx responses as UPLOAD_FAILED', async () => {
    const store = createMediaUploadAtom(signingFetch());
    const promise = store.get().upload([makeFile('a.bin', 100)]);
    await tick();

    FakeXHR.instances[0].fireLoad(403);
    const [entry] = await promise;

    expect(entry.status).toBe('error');
    expect(entry.error).toEqual({
      code: 'UPLOAD_FAILED',
      message: 'Upload failed with status 403',
    });
  });

  it('keeps entries uploading until the call finalizes', async () => {
    const store = createMediaUploadAtom(signingFetch());
    const promise = store
      .get()
      .upload([makeFile('a.bin', 100), makeFile('b.bin', 200)]);
    await tick();

    FakeXHR.instances[0].fireProgress(100, 100);
    FakeXHR.instances[0].fireLoad();
    FakeXHR.instances[1].fireProgress(200, 200);
    FakeXHR.instances[1].fireLoad();

    const before = store.get().files;
    expect(before.map((f) => f.status)).toEqual(['uploading', 'uploading']);
    expect(before.every((f) => f.loaded === f.total)).toBe(true);
    expect(store.get().isUploading).toBe(true);

    const result = await promise;
    expect(result.map((f) => f.status)).toEqual(['success', 'success']);
    expect(store.get().isUploading).toBe(false);
  });

  it('removes abort listeners once each request settles', async () => {
    const counts = new Map<AbortSignal, number>();
    let maxSeen = 0;
    const proto = AbortSignal.prototype;
    const add = vi
      .spyOn(proto, 'addEventListener')
      .mockImplementation(function (this: AbortSignal, type, ...rest) {
        if (type === 'abort') {
          const next = (counts.get(this) ?? 0) + 1;
          counts.set(this, next);
          maxSeen = Math.max(maxSeen, next);
        }
        return EventTarget.prototype.addEventListener.call(this, type, ...rest);
      });
    const remove = vi
      .spyOn(proto, 'removeEventListener')
      .mockImplementation(function (this: AbortSignal, type, ...rest) {
        if (type === 'abort') counts.set(this, (counts.get(this) ?? 0) - 1);
        return EventTarget.prototype.removeEventListener.call(
          this,
          type,
          ...rest,
        );
      });

    const store = createMediaUploadAtom(signingFetch());
    for (let round = 0; round < 3; round++) {
      const opened = FakeXHR.instances.length;
      const promise = store
        .get()
        .upload([makeFile(`a${round}.bin`, 10), makeFile(`b${round}.bin`, 10)]);
      await tick();
      await completeAll(FakeXHR.instances.slice(opened));
      await promise;
    }

    expect(add).toHaveBeenCalled();
    expect(remove).toHaveBeenCalled();
    expect(maxSeen).toBeGreaterThan(0);
    expect([...counts.values()].every((count) => count === 0)).toBe(true);
  });
});
