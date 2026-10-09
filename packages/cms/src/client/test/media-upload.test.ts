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

type CompleteCall = { uploads: { token: string }[] };

// Tokens are `tok:<asset id>:<file name>`, so the fake `completeUpload`
// branch can derive the asset from the token alone.
function signingFetch(options?: {
  // Returns the `errors` entry for a completed index, or undefined.
  reject?: (
    index: number,
    name: string,
  ) => { code: string; message: string } | undefined;
  onComplete?: (body: CompleteCall) => void;
  completeError?: Error;
}): CMSFetch {
  return (async (path: string, init?: { body?: unknown }) => {
    if (path === '/media/completeUpload') {
      const body = init?.body as CompleteCall;
      options?.onComplete?.(body);
      if (options?.completeError) throw options.completeError;
      const assets: { id: string; slug: string; objectKey: string }[] = [];
      const errors: { index: number; code: string; message: string }[] = [];
      body.uploads.forEach(({ token }, index) => {
        const [, id, name] = token.split(':');
        const failure = options?.reject?.(index, name);
        if (failure) {
          errors.push({ index, ...failure });
        } else {
          assets.push({ id, slug: name, objectKey: `uploads/${name}` });
        }
      });
      return { assets, errors };
    }
    const body = init?.body as { files: { name: string }[] };
    return {
      uploads: body.files.map((file, index) => {
        const id = `ast_${index}_${file.name}`;
        return {
          id,
          objectKey: `uploads/${file.name}`,
          url: `https://cdn.example.com/${file.name}`,
          signedUrl: `https://bucket.example.com/${file.name}`,
          headers: { 'content-type': 'application/octet-stream' },
          token: `tok:${id}:${file.name}`,
        };
      }),
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

  it('keeps entries aborted when signing fails after an abort', async () => {
    let rejectSign: (err: unknown) => void = () => {};
    const pending = (() =>
      new Promise((_, reject) => {
        rejectSign = reject;
      })) as CMSFetch;
    const store = createMediaUploadAtom(pending);

    const result = store.get().upload([makeFile('a.bin', 10)]);
    await tick();
    store.get().abort();
    rejectSign(
      new CMSClientError({
        code: 'FILE_TOO_LARGE',
        message: 'File exceeds the size limit',
        status: 413,
      }),
    );
    const entries = await result;

    expect(entries[0].status).toBe('aborted');
    expect(store.get().error).toBeNull();
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

  it('marks an entry success only after completeUpload resolves', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const inner = signingFetch();
    const gated = (async (path: string, init?: unknown) => {
      if (path === '/media/completeUpload') await gate;
      return inner(path, init as never);
    }) as CMSFetch;
    const store = createMediaUploadAtom(gated);
    const promise = store.get().upload([makeFile('a.bin', 10)]);
    await tick();

    FakeXHR.instances[0].fireLoad();
    await tick();
    expect(store.get().files[0].status).toBe('uploading');
    expect(store.get().files[0].result).toBeUndefined();

    release();
    const [entry] = await promise;
    expect(entry.status).toBe('success');
    expect(entry.result).toEqual({
      id: 'ast_0_a.bin',
      slug: 'a.bin',
      objectKey: 'uploads/a.bin',
    });
  });

  it('maps a completeUpload error onto the entry at that index', async () => {
    const store = createMediaUploadAtom(
      signingFetch({
        reject: (index) =>
          index === 1
            ? { code: 'UPLOAD_NOT_FOUND', message: 'No object' }
            : undefined,
      }),
    );
    const promise = store
      .get()
      .upload([makeFile('a.bin', 10), makeFile('b.bin', 20)]);
    await tick();
    await completeAll(FakeXHR.instances);
    const result = await promise;

    expect(result[0].status).toBe('success');
    expect(result[0].result?.id).toBe('ast_0_a.bin');
    expect(result[1].status).toBe('error');
    expect(result[1].error).toEqual({
      code: 'UPLOAD_NOT_FOUND',
      message: 'No object',
    });
    expect(store.get().error).toBe('Some files failed to upload');
  });

  it('marks every sent entry error when completeUpload throws', async () => {
    const store = createMediaUploadAtom(
      signingFetch({
        completeError: new CMSClientError({
          code: 'UPLOAD_TOKEN_INVALID',
          message: 'Upload token is invalid',
          status: 403,
        }),
      }),
    );
    const promise = store
      .get()
      .upload([makeFile('a.bin', 10), makeFile('b.bin', 20)]);
    await tick();
    await completeAll(FakeXHR.instances);
    const result = await promise;

    expect(result.map((f) => f.status)).toEqual(['error', 'error']);
    expect(result[0].error?.code).toBe('UPLOAD_TOKEN_INVALID');
  });

  it('completes an entry whose PUT finished before the abort', async () => {
    const calls: CompleteCall[] = [];
    const store = createMediaUploadAtom(
      signingFetch({ onComplete: (body) => calls.push(body) }),
    );
    const promise = store
      .get()
      .upload(
        [makeFile('a.bin', 10), makeFile('b.bin', 20), makeFile('c.bin', 30)],
        { concurrency: 1 },
      );
    await tick();

    FakeXHR.instances[0].fireLoad();
    await tick();
    expect(FakeXHR.instances).toHaveLength(2);
    store.get().abort();
    const result = await promise;

    expect(calls).toHaveLength(1);
    expect(calls[0].uploads).toEqual([{ token: 'tok:ast_0_a.bin:a.bin' }]);
    expect(result.map((f) => f.status)).toEqual([
      'success',
      'aborted',
      'aborted',
    ]);
    expect(result[0].result?.id).toBe('ast_0_a.bin');
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
