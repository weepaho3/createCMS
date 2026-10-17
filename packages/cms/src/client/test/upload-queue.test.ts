// @vitest-environment happy-dom
import {
  type MockInstance,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import type { CMSFetch, CMSMediaUploadState } from '../types';

import { CMSClientError } from '../error';
import {
  CONNECTION_BUDGET,
  MAX_ACTIVE_FILES,
  createUploadQueue,
  type UploadQueueOptions,
} from '../upload-queue';
import { STALL_TIMEOUT_MS, uploadWithXHR } from '../upload-transport';

const EXPIRED_BODY =
  '<?xml version="1.0" encoding="UTF-8"?><Error><Code>AccessDenied</Code>' +
  '<Message>Request has expired</Message></Error>';
const SLOW_DOWN_BODY =
  '<?xml version="1.0" encoding="UTF-8"?><Error><Code>SlowDown</Code>' +
  '<Message>Please reduce your request rate.</Message></Error>';

type Listener = (event: unknown) => void;

// Stand-in for `XMLHttpRequest`: records every instance and lets a test fire
// the `upload.progress`, `load`, `error` and `abort` events by hand.
class FakeXHR {
  static instances: FakeXHR[] = [];

  url = '';
  status = 0;
  responseText = '';
  aborted = false;
  /** True once `load`, `error` or `abort` fired. */
  finished = false;
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

  open(_method: string, url: string) {
    this.url = url;
  }
  setRequestHeader() {}
  send() {}
  getResponseHeader() {
    return null;
  }

  addEventListener(type: string, fn: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }

  abort() {
    this.aborted = true;
    this.finished = true;
    this.emit('abort');
  }

  fireProgress(loaded: number, total: number) {
    for (const fn of this.uploadListeners.get('progress') ?? []) {
      fn({ lengthComputable: true, loaded, total });
    }
  }

  fireLoad(status = 200, body = '') {
    this.status = status;
    this.responseText = body;
    this.finished = true;
    this.emit('load');
  }

  fireError() {
    this.finished = true;
    this.emit('error');
  }

  private emit(type: string) {
    for (const fn of this.listeners.get(type) ?? []) fn({ type });
  }
}

/** Lets every pending promise chain run. */
async function settle() {
  for (let i = 0; i < 20; i++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

function makeFile(name: string, size = 10, type = 'image/png'): File {
  return new File([new Uint8Array(size)], name, { type });
}

/** XHRs that are still open, in creation order. */
function openXHRs(): FakeXHR[] {
  return FakeXHR.instances.filter((xhr) => !xhr.finished);
}

type Call = { path: string; body: any };

/**
 * A fake server for the queue's JSON calls. Tokens are `tok:<asset id>:<n>`
 * with a fresh `n` per signature, so a test can tell signatures apart.
 */
function fakeServer(
  overrides: Partial<Record<string, (body: any) => unknown>> = {},
) {
  const calls: Call[] = [];
  let signatures = 0;
  const handlers: Record<string, (body: any) => unknown> = {
    '/media/createSignedUpload': (body) => ({
      uploads: body.files.map((file: { name: string }) => {
        const id = `ast_${file.name}`;
        const n = ++signatures;
        return {
          id,
          objectKey: `pub/${id}/${file.name}`,
          signedUrl: `https://bucket.test/${file.name}?sig=${n}`,
          headers: { 'content-type': 'image/png' },
          token: `tok:${id}:${n}`,
        };
      }),
    }),
    '/media/completeUpload': (body) => ({
      assets: body.uploads.map(({ token }: { token: string }) => {
        const id = token.split(':')[1];
        return { id, slug: id, objectKey: `pub/${id}/x` };
      }),
      errors: [],
    }),
    '/media/createSignedReplace': (body) => {
      const n = ++signatures;
      return {
        assetId: body.assetId,
        signedUrl: `https://bucket.test/replace?sig=${n}`,
        headers: {},
        token: `tok:${body.assetId}:${n}`,
      };
    },
    '/media/commitReplace': (body) => {
      const id = body.token.split(':')[1];
      return { asset: { id, slug: id, objectKey: `pub/${id}/v2` } };
    },
    '/media/abortUpload': () => ({ aborted: true, committed: false }),
    '/media/findDuplicates': () => ({ results: [{ candidates: [] }] }),
    ...overrides,
  };
  const $fetch = (async (path: string, init?: { body?: unknown }) => {
    calls.push({ path, body: init?.body });
    const handler = handlers[path];
    if (!handler) throw new Error(`unexpected call ${path}`);
    return handler(init?.body);
  }) as CMSFetch;
  return {
    $fetch,
    calls,
    paths: () => calls.map((call) => call.path),
  };
}

function makeQueue(
  $fetch: CMSFetch,
  options: UploadQueueOptions = {},
): { state: () => CMSMediaUploadState } {
  const queue = createUploadQueue($fetch, {
    scheduleUpdate: (flush) => queueMicrotask(flush),
    sleep: () => Promise.resolve(),
    random: () => 0,
    browserEvents: false,
    ...options,
  });
  return { state: () => queue.get() };
}

describe('createUploadQueue', () => {
  const RealXHR = globalThis.XMLHttpRequest;
  let warn: MockInstance<typeof console.warn>;

  beforeEach(() => {
    FakeXHR.instances = [];
    globalThis.XMLHttpRequest = FakeXHR as unknown as typeof XMLHttpRequest;
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    globalThis.XMLHttpRequest = RealXHR;
    // Every status change in these flows is one the table allows.
    const ignored = warn.mock.calls.map((call) => String(call[0]));
    warn.mockRestore();
    vi.useRealTimers();
    if (ignored.length > 0) throw new Error(ignored.join('\n'));
  });

  it('signs, uploads and completes a file', async () => {
    const server = fakeServer();
    const { state } = makeQueue(server.$fetch);

    const done = state().upload([makeFile('a.png')], { folderId: 'fld_1' });
    await settle();
    expect(state().files[0]).toMatchObject({
      status: 'uploading',
      kind: 'create',
      folderId: 'fld_1',
    });
    expect(state().isUploading).toBe(true);
    openXHRs()[0].fireLoad();

    const [entry] = await done;
    expect(entry).toMatchObject({
      status: 'success',
      progress: 1,
      result: { id: 'ast_a.png' },
    });
    expect(server.paths()).toEqual([
      '/media/createSignedUpload',
      '/media/completeUpload',
    ]);
    expect(server.calls[0].body.folderId).toBe('fld_1');
    expect(state().isUploading).toBe(false);
  });

  it('holds progress at 0.99 and reports finalizing until the row exists', async () => {
    let finishComplete!: () => void;
    const server = fakeServer({
      '/media/completeUpload': async (body) => {
        await new Promise<void>((resolve) => (finishComplete = resolve));
        const id = body.uploads[0].token.split(':')[1];
        return { assets: [{ id, slug: id, objectKey: 'k' }], errors: [] };
      },
    });
    const { state } = makeQueue(server.$fetch);

    const done = state().upload([makeFile('a.png', 100)]);
    await settle();
    openXHRs()[0].fireProgress(100, 100);
    await settle();
    expect(state().files[0]).toMatchObject({
      progress: 0.99,
      loaded: 99,
      phase: 'finalizing',
    });

    openXHRs()[0].fireLoad();
    await settle();
    expect(state().files[0]).toMatchObject({
      status: 'completing',
      phase: 'processing',
      progress: 0.99,
    });

    finishComplete();
    await done;
    expect(state().files[0].progress).toBe(1);
  });

  it(`runs at most ${MAX_ACTIVE_FILES} files at once`, async () => {
    const server = fakeServer();
    const { state } = makeQueue(server.$fetch);

    const files = Array.from({ length: 6 }, (_, i) => makeFile(`f${i}.png`));
    const done = state().upload(files);
    await settle();
    expect(openXHRs()).toHaveLength(MAX_ACTIVE_FILES);
    expect(state().files.filter((f) => f.status === 'queued')).toHaveLength(2);

    openXHRs()[0].fireLoad();
    await settle();
    expect(FakeXHR.instances).toHaveLength(MAX_ACTIVE_FILES + 1);

    for (;;) {
      const open = openXHRs();
      if (open.length === 0) break;
      for (const xhr of open) xhr.fireLoad();
      await settle();
    }
    const entries = await done;
    expect(entries.every((e) => e.status === 'success')).toBe(true);
  });

  it('shares the limit across separate upload calls', async () => {
    const server = fakeServer();
    const { state } = makeQueue(server.$fetch);

    void state().upload([makeFile('a.png'), makeFile('b.png')]);
    void state().upload([
      makeFile('c.png'),
      makeFile('d.png'),
      makeFile('e.png'),
    ]);
    await settle();
    expect(openXHRs()).toHaveLength(MAX_ACTIVE_FILES);
  });

  it('halves the budget when S3 asks to slow down, then retries', async () => {
    const server = fakeServer();
    const { state } = makeQueue(server.$fetch);
    expect(state().budget).toBe(CONNECTION_BUDGET);

    const done = state().upload([makeFile('a.png')]);
    await settle();
    openXHRs()[0].fireLoad(503, SLOW_DOWN_BODY);
    await settle();
    expect(state().budget).toBe(CONNECTION_BUDGET / 2);

    expect(FakeXHR.instances).toHaveLength(2);
    expect(state().files[0]).toMatchObject({ status: 'uploading', attempt: 1 });
    openXHRs()[0].fireLoad();
    const [entry] = await done;
    expect(entry.status).toBe('success');
  });

  it('shows retrying with the attempt and the next retry time', async () => {
    let wake!: () => void;
    const server = fakeServer();
    const { state } = makeQueue(server.$fetch, {
      now: () => 1_000,
      random: () => 1,
      sleep: () => new Promise<void>((resolve) => (wake = resolve)),
    });

    const done = state().upload([makeFile('a.png')]);
    await settle();
    openXHRs()[0].fireError();
    await settle();
    expect(state().files[0]).toMatchObject({
      status: 'retrying',
      attempt: 1,
      nextRetryAt: 1_500,
    });

    wake();
    await settle();
    expect(state().files[0]).toMatchObject({
      status: 'uploading',
      nextRetryAt: null,
    });
    openXHRs()[0].fireLoad();
    expect((await done)[0].status).toBe('success');
    // The retried PUT reuses the signature.
    expect(server.paths()).toEqual([
      '/media/createSignedUpload',
      '/media/completeUpload',
    ]);
  });

  it('gives up after five attempts with a retryable error', async () => {
    const server = fakeServer();
    const { state } = makeQueue(server.$fetch);

    const done = state().upload([makeFile('a.png')]);
    for (let i = 0; i < 5; i++) {
      await settle();
      openXHRs()[0].fireError();
    }
    const [entry] = await done;
    expect(entry).toMatchObject({
      status: 'error',
      error: { code: 'NETWORK_ERROR', retryable: true },
    });
    expect(FakeXHR.instances).toHaveLength(5);
    expect(state().error).toBeInstanceOf(Error);
  });

  it('renews an expired signature once', async () => {
    const server = fakeServer();
    const { state } = makeQueue(server.$fetch);

    const done = state().upload([makeFile('a.png')]);
    await settle();
    openXHRs()[0].fireLoad(403, EXPIRED_BODY);
    await settle();
    expect(openXHRs()[0].url).toContain('sig=2');
    openXHRs()[0].fireLoad();

    const [entry] = await done;
    expect(entry.status).toBe('success');
    expect(server.paths()).toEqual([
      '/media/createSignedUpload',
      '/media/createSignedUpload',
      '/media/completeUpload',
    ]);
    expect(server.calls[2].body.uploads[0].token).toBe('tok:ast_a.png:2');
  });

  it('fails when the renewed signature expires too', async () => {
    const server = fakeServer();
    const { state } = makeQueue(server.$fetch);

    const done = state().upload([makeFile('a.png')]);
    await settle();
    openXHRs()[0].fireLoad(403, EXPIRED_BODY);
    await settle();
    openXHRs()[0].fireLoad(403, EXPIRED_BODY);

    const [entry] = await done;
    expect(entry).toMatchObject({
      status: 'error',
      error: { code: 'UPLOAD_EXPIRED', retryable: false },
    });
  });

  it('surfaces a rejected signature without retrying', async () => {
    const server = fakeServer({
      '/media/createSignedUpload': () => {
        throw new CMSClientError({
          code: 'MIME_TYPE_NOT_ALLOWED',
          message: 'nope',
          status: 400,
        });
      },
    });
    const { state } = makeQueue(server.$fetch);

    const [entry] = await state().upload([makeFile('a.png')]);
    expect(entry).toMatchObject({
      status: 'error',
      error: { code: 'MIME_TYPE_NOT_ALLOWED', retryable: false },
    });
    expect(server.paths()).toEqual(['/media/createSignedUpload']);
  });

  it('aborts one file, deletes its object and keeps the others going', async () => {
    const server = fakeServer();
    const { state } = makeQueue(server.$fetch);

    const done = state().upload([makeFile('a.png'), makeFile('b.png')]);
    await settle();
    const [a] = state().files;
    state().abort(a.id);
    await settle();

    expect(FakeXHR.instances[0].aborted).toBe(true);
    expect(
      server.calls.find((c) => c.path === '/media/abortUpload')?.body,
    ).toEqual({ token: 'tok:ast_a.png:1' });
    openXHRs()[0].fireLoad();

    const entries = await done;
    expect(entries.map((e) => e.status)).toEqual(['aborted', 'success']);
  });

  it('aborts queued files without calling the server', async () => {
    const server = fakeServer();
    const { state } = makeQueue(server.$fetch);

    const files = Array.from({ length: 5 }, (_, i) => makeFile(`f${i}.png`));
    const done = state().upload(files);
    await settle();
    const queued = state().files.find((f) => f.status === 'queued')!;
    state().abort(queued.id);
    await settle();
    expect(state().files.find((f) => f.id === queued.id)?.status).toBe(
      'aborted',
    );
    expect(server.paths()).not.toContain('/media/abortUpload');

    state().abort();
    const entries = await done;
    expect(entries.every((e) => e.status === 'aborted')).toBe(true);
  });

  it('aborts the entries of an upload call through its signal', async () => {
    const server = fakeServer();
    const { state } = makeQueue(server.$fetch);
    const controller = new AbortController();

    const done = state().upload([makeFile('a.png')], {
      signal: controller.signal,
    });
    await settle();
    controller.abort();
    expect((await done)[0].status).toBe('aborted');
  });

  it('leaves a landed upload to finish when aborted', async () => {
    let finishComplete!: () => void;
    const server = fakeServer({
      '/media/completeUpload': async (body) => {
        await new Promise<void>((resolve) => (finishComplete = resolve));
        const id = body.uploads[0].token.split(':')[1];
        return { assets: [{ id, slug: id, objectKey: 'k' }], errors: [] };
      },
    });
    const { state } = makeQueue(server.$fetch);

    const done = state().upload([makeFile('a.png')]);
    await settle();
    openXHRs()[0].fireLoad();
    await settle();
    state().abort();
    state().pause();
    finishComplete();

    expect((await done)[0].status).toBe('success');
    expect(server.paths()).not.toContain('/media/abortUpload');
  });

  it('retries a failed file with a fresh signature', async () => {
    let failNext = true;
    const server = fakeServer({
      '/media/completeUpload': (body) => {
        if (failNext) {
          failNext = false;
          return {
            assets: [],
            errors: [{ index: 0, code: 'UPLOAD_NOT_FOUND', message: 'gone' }],
          };
        }
        const id = body.uploads[0].token.split(':')[1];
        return { assets: [{ id, slug: id, objectKey: 'k' }], errors: [] };
      },
    });
    const { state } = makeQueue(server.$fetch);

    const done = state().upload([makeFile('a.png')]);
    await settle();
    openXHRs()[0].fireLoad();
    const [failed] = await done;
    expect(failed).toMatchObject({
      status: 'error',
      error: { code: 'UPLOAD_NOT_FOUND' },
    });

    state().retry(failed.id);
    await settle();
    expect(state().files[0]).toMatchObject({ status: 'uploading', attempt: 0 });
    expect(state().files[0].error).toBeUndefined();
    openXHRs()[0].fireLoad();
    await settle();

    expect(state().files[0].status).toBe('success');
    expect(
      server.paths().filter((p) => p === '/media/createSignedUpload'),
    ).toHaveLength(2);
  });

  it('pauses a running upload and restarts it on resume', async () => {
    const server = fakeServer();
    const { state } = makeQueue(server.$fetch);

    const done = state().upload([makeFile('a.png', 100)]);
    await settle();
    openXHRs()[0].fireProgress(50, 100);
    const [entry] = state().files;
    state().pause(entry.id);
    expect((await done)[0]).toMatchObject({
      status: 'paused',
      loaded: 0,
      progress: 0,
    });
    expect(FakeXHR.instances[0].aborted).toBe(true);
    expect(server.paths()).toContain('/media/abortUpload');
    expect(state().isUploading).toBe(false);

    state().resume(entry.id);
    await settle();
    expect(openXHRs()).toHaveLength(1);
    openXHRs()[0].fireLoad();
    await settle();
    expect(state().files[0].status).toBe('success');
  });

  it('replaces the bytes of an asset through the same queue', async () => {
    const server = fakeServer();
    const { state } = makeQueue(server.$fetch);

    const done = state().replace('ast_target', makeFile('new.png'), {
      revisionNote: 'cropped',
    });
    await settle();
    expect(state().files[0]).toMatchObject({
      kind: 'replace',
      targetAssetId: 'ast_target',
    });
    openXHRs()[0].fireLoad();

    const entry = await done;
    expect(entry).toMatchObject({
      status: 'success',
      result: { id: 'ast_target', objectKey: 'pub/ast_target/v2' },
    });
    expect(server.paths()).toEqual([
      '/media/createSignedReplace',
      '/media/commitReplace',
    ]);
    expect(server.calls[1].body).toEqual({
      token: 'tok:ast_target:1',
      revisionNote: 'cropped',
    });
  });

  describe('duplicates', () => {
    const duplicateServer = () =>
      fakeServer({
        '/media/findDuplicates': () => ({
          results: [
            {
              candidates: [
                { assetId: 'ast_same', folderId: 'fld_1', matchedBy: 'sha256' },
                { assetId: 'ast_name', folderId: null, matchedBy: 'name-size' },
              ],
            },
          ],
        }),
      });

    it('pauses on an exact duplicate', async () => {
      const server = duplicateServer();
      const { state } = makeQueue(server.$fetch);

      const [entry] = await state().upload([makeFile('a.png')], {
        dedupe: true,
      });
      expect(entry).toMatchObject({
        status: 'paused',
        duplicateOf: [{ assetId: 'ast_same', folderId: 'fld_1' }],
      });
      expect(entry.sha256).toMatch(/^[A-Za-z0-9+/]{43}=$/);
      expect(server.calls[0].body.files[0]).toMatchObject({
        name: 'a.png',
        size: 10,
        sha256: entry.sha256,
      });
      expect(FakeXHR.instances).toHaveLength(0);

      // A plain resume does not skip the decision.
      state().resume(entry.id);
      expect(state().files[0].status).toBe('paused');
    });

    it('finishes with the existing asset', async () => {
      const server = duplicateServer();
      const { state } = makeQueue(server.$fetch);

      const [entry] = await state().upload([makeFile('a.png')], {
        dedupe: true,
      });
      state().resolveDuplicate(entry.id, {
        action: 'use-existing',
        assetId: 'ast_same',
      });
      await settle();
      expect(state().files[0]).toMatchObject({
        status: 'success',
        result: { id: 'ast_same' },
      });
      expect(server.paths()).toEqual(['/media/findDuplicates']);
    });

    it('uploads a copy with the checksum', async () => {
      const server = duplicateServer();
      const { state } = makeQueue(server.$fetch);

      const [entry] = await state().upload([makeFile('a.png')], {
        dedupe: true,
      });
      state().resolveDuplicate(entry.id, { action: 'upload-copy' });
      await settle();
      openXHRs()[0].fireLoad();
      await settle();

      expect(state().files[0].status).toBe('success');
      const sign = server.calls.find(
        (c) => c.path === '/media/createSignedUpload',
      );
      expect(sign?.body.files[0].sha256).toBe(entry.sha256);
    });

    it('replaces the existing asset instead', async () => {
      const server = duplicateServer();
      const { state } = makeQueue(server.$fetch);

      const [entry] = await state().upload([makeFile('a.png')], {
        dedupe: true,
      });
      state().resolveDuplicate(entry.id, {
        action: 'replace',
        assetId: 'ast_same',
      });
      await settle();
      openXHRs()[0].fireLoad();
      await settle();

      expect(state().files[0]).toMatchObject({
        status: 'success',
        kind: 'replace',
        targetAssetId: 'ast_same',
      });
      expect(server.paths()).toContain('/media/commitReplace');
    });
  });

  describe('renditions', () => {
    const rendition = (variantKey: string) => ({
      variantKey,
      blob: new Blob([new Uint8Array(4)], { type: 'image/webp' }),
      width: 320,
      height: 200,
    });

    function renditionServer(
      existing: Record<string, string> = {},
      failCommit?: string,
    ) {
      return fakeServer({
        '/media/createSignedRendition': (body) =>
          existing[body.variantKey]
            ? {
                existing: {
                  id: existing[body.variantKey],
                  slug: 's',
                  objectKey: 'k',
                },
                upload: null,
              }
            : {
                existing: null,
                upload: {
                  id: `ast_${body.variantKey}`,
                  objectKey: `pub/x/${body.variantKey}`,
                  signedUrl: `https://bucket.test/${body.variantKey}`,
                  headers: {},
                  token: `rtok:${body.variantKey}`,
                },
              },
        '/media/commitRendition': (body) => {
          const key = body.token.split(':')[1];
          if (key === failCommit) {
            throw new CMSClientError({
              code: 'RENDITION_MISMATCH',
              message: 'bad',
              status: 400,
            });
          }
          return { asset: { id: `ast_${key}`, slug: key, objectKey: key } };
        },
      });
    }

    const optimizer = (keys: string[]) => ({
      enabled: true,
      process: async (input: File) => ({
        file: input,
        renditions: keys.map(rendition),
        hints: { metadata: { dominantColor: '#112233' } },
        info: {
          optimized: true,
          bytesBefore: 10,
          bytesAfter: 10,
          warnings: [],
        },
      }),
    });

    async function finishPuts() {
      for (;;) {
        await settle();
        const open = openXHRs();
        if (open.length === 0) return;
        for (const xhr of open) xhr.fireLoad();
      }
    }

    it('uploads renditions as children and finishes the parent after them', async () => {
      const server = renditionServer();
      const { state } = makeQueue(server.$fetch, {
        getOptimizer: () => optimizer(['w320.webp', 'w640.webp']),
      });

      const done = state().upload([makeFile('a.png')]);
      await settle();
      openXHRs()[0].fireLoad();
      await settle();
      const parent = state().files[0];
      expect(parent).toMatchObject({
        status: 'completing',
        phase: 'renditions',
        result: { id: 'ast_a.png' },
      });
      const children = state().files.filter((f) => f.kind === 'rendition');
      expect(
        children.map((c) => [c.variantKey, c.parentId, c.targetAssetId]),
      ).toEqual([
        ['w320.webp', parent.id, 'ast_a.png'],
        ['w640.webp', parent.id, 'ast_a.png'],
      ]);

      await finishPuts();
      const [entry] = await done;
      expect(entry.status).toBe('success');
      expect(server.calls[1]).toMatchObject({
        path: '/media/completeUpload',
        body: {
          uploads: [{ hints: { metadata: { dominantColor: '#112233' } } }],
        },
      });
      expect(
        server.paths().filter((p) => p === '/media/commitRendition'),
      ).toHaveLength(2);
    });

    it('skips an existing rendition and reports a failed one on the parent', async () => {
      const server = renditionServer({ 'w320.webp': 'ast_old' }, 'w640.webp');
      const { state } = makeQueue(server.$fetch, {
        getOptimizer: () => optimizer(['w320.webp', 'w640.webp']),
      });

      const done = state().upload([makeFile('a.png')]);
      await finishPuts();
      const [entry] = await done;

      expect(entry.status).toBe('success');
      expect(entry.optimize?.warnings).toEqual([
        { code: 'rendition_failed', message: 'w640.webp: bad' },
      ]);
      const children = state().files.filter((f) => f.kind === 'rendition');
      expect(children.map((c) => c.status)).toEqual(['success', 'error']);
      expect(children[0].result?.id).toBe('ast_old');
    });

    it('regenerates the renditions of an existing asset', async () => {
      const server = renditionServer();
      server.calls.length = 0;
      const getAssets = fakeServer({
        '/media/getAssets': () => ({
          assets: [
            {
              id: 'ast_x',
              slug: 'x.png',
              originalName: 'x.png',
              mimeType: 'image/png',
              deliveryUrl: '/api/cms/media/asset/ast_x',
              folderId: null,
            },
          ],
        }),
      });
      const $fetch = (async (path: string, init?: { body?: unknown }) =>
        path === '/media/getAssets'
          ? getAssets.$fetch(path, init)
          : server.$fetch(path, init)) as CMSFetch;
      const fetchBlob = vi.fn(async () => new Blob([new Uint8Array(8)]));
      const { state } = makeQueue($fetch, {
        getOptimizer: () => optimizer(['w320.webp']),
        fetchBlob,
      });

      const pending = state().regenerateRenditions('ast_x');
      await finishPuts();
      const entries = await pending;
      expect(fetchBlob).toHaveBeenCalledWith('/api/cms/media/asset/ast_x');
      expect(entries).toMatchObject([
        { kind: 'rendition', status: 'success', targetAssetId: 'ast_x' },
      ]);
    });
  });

  it('withholds the ETA until the transfer warmed up', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    let clock = 0;
    const server = fakeServer();
    const { state } = makeQueue(server.$fetch, { now: () => clock });

    void state().upload([makeFile('a.png', 10_000)]);
    await settle();
    const [xhr] = openXHRs();
    xhr.fireProgress(1_000, 10_000);
    clock = 500;
    vi.advanceTimersByTime(500);
    await settle();
    expect(state().progress.bytesPerSecond).toBe(2_000);
    expect(state().progress.eta).toBeNull();

    xhr.fireProgress(2_000, 10_000);
    clock = 3_000;
    vi.advanceTimersByTime(500);
    await settle();
    expect(state().progress.eta).toBeGreaterThan(0);
  });

  it('writes the store at most once per frame', async () => {
    const frames: (() => void)[] = [];
    const server = fakeServer();
    const queue = createUploadQueue(server.$fetch, {
      scheduleUpdate: (flush) => frames.push(flush),
      sleep: () => Promise.resolve(),
      browserEvents: false,
    });
    const run = () => {
      for (const flush of frames.splice(0)) flush();
    };

    void queue.get().upload([makeFile('a.png', 100)]);
    await settle();
    run();
    const [xhr] = openXHRs();

    let writes = 0;
    const unsubscribe = queue.listen(() => writes++);
    for (let i = 1; i <= 10; i++) xhr.fireProgress(i * 5, 100);
    expect(writes).toBe(0);
    expect(frames).toHaveLength(1);
    run();
    expect(writes).toBe(1);
    expect(queue.get().files[0].loaded).toBe(50);
    unsubscribe();
  });

  it('drops finished entries on reset', async () => {
    const server = fakeServer();
    const { state } = makeQueue(server.$fetch);

    const done = state().upload([makeFile('a.png')]);
    await settle();
    openXHRs()[0].fireLoad();
    await done;
    void state().upload([makeFile('b.png')]);
    await settle();

    state().reset();
    expect(state().files.map((f) => f.name)).toEqual(['b.png']);
  });
});

describe('uploadWithXHR', () => {
  const RealXHR = globalThis.XMLHttpRequest;

  beforeEach(() => {
    FakeXHR.instances = [];
    globalThis.XMLHttpRequest = FakeXHR as unknown as typeof XMLHttpRequest;
    vi.useFakeTimers();
  });

  afterEach(() => {
    globalThis.XMLHttpRequest = RealXHR;
    vi.useRealTimers();
  });

  it('times out a PUT that stalls', async () => {
    // 10 MiB: the size ceiling (320 s) is far beyond the stall timeout.
    const size = 10 * 1024 * 1024;
    const put = uploadWithXHR(
      'https://b.test/a',
      new Blob([new Uint8Array(size)]),
      {},
      () => {},
    );
    const outcome = put.catch((err: unknown) => err);
    vi.advanceTimersByTime(STALL_TIMEOUT_MS - 1);
    FakeXHR.instances[0].fireProgress(5, size);
    vi.advanceTimersByTime(STALL_TIMEOUT_MS - 1);
    expect(FakeXHR.instances[0].aborted).toBe(false);
    vi.advanceTimersByTime(1);

    expect(await outcome).toMatchObject({
      code: 'UPLOAD_TIMEOUT',
      timedOut: true,
      retryable: true,
    });
    expect(FakeXHR.instances[0].aborted).toBe(true);
  });

  it('times out a PUT slower than 32 KiB/s', async () => {
    const size = 10 * 1024 * 1024;
    const put = uploadWithXHR(
      'https://b.test/a',
      new Blob([new Uint8Array(size)]),
      {},
      () => {},
    );
    const outcome = put.catch((err: unknown) => err);
    // Progress keeps arriving, so only the size ceiling (320 s) applies.
    for (let t = 0; t < 320; t += 10) {
      vi.advanceTimersByTime(10_000);
      FakeXHR.instances[0].fireProgress(t, size);
    }
    expect(await outcome).toMatchObject({ code: 'UPLOAD_TIMEOUT' });
  });
});
