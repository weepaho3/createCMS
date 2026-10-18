import {
  makeZip,
  manifestCsv,
  predictZipLength,
  sanitizeZipPath,
  uniqueZipPaths,
} from './zip';

/**
 * Bulk downloads as a client-side STORE archive. Files are signed in small
 * batches just before they are fetched (`downloadIntent`), fetched a few at
 * a time and written in order into the archive, which streams into a sink:
 * a file on disk where the browser can save streams, else a Blob up to a cap.
 * Progress counts bytes against the stored sizes, so it is exact even when a
 * CDN compresses the transfer.
 */

export type DownloadItemStatus =
  | 'pending'
  | 'downloading'
  | 'success'
  | 'error'
  | 'skipped'
  | 'aborted';

export type DownloadItem = {
  id: string;
  /** Path inside the archive. */
  path: string;
  size: number;
  status: DownloadItemStatus;
  loaded: number;
  error: string | null;
};

export type DownloadJobStatus =
  | 'pending'
  | 'downloading'
  | 'success'
  | 'error'
  | 'aborted';

export type DownloadJob = {
  id: string;
  /** The archive file name. */
  name: string;
  status: DownloadJobStatus;
  items: DownloadItem[];
  loaded: number;
  /** Bytes of the finished archive. */
  total: number;
  /**
   * `file` (saved while streaming), `blob` (assembled in memory) or
   * `server` (written by `createZipExport`, then downloaded).
   */
  sink: DownloadSink['kind'] | 'server' | null;
  error: string | null;
};

export type DownloadState = { jobs: DownloadJob[] };

/** One signed file (`downloadIntent` response item). */
export type SignedDownload = {
  id: string;
  url: string;
  size: number;
  name: string;
};

export type DownloadSink = {
  kind: 'file' | 'blob';
  writable: WritableStream<Uint8Array>;
  /** Called after the archive was written completely. */
  finish(): Promise<void>;
};

/** Signs downloads for assets (the `downloadIntent` endpoint). */
export type DownloadSigner = (
  assetIds: string[],
) => Promise<{ items: SignedDownload[] }>;

export type DownloadAsset = {
  id: string;
  name: string;
  size: number;
  /** Folder path of the asset (`Brand/Logos`), kept unless `flatten`. */
  folderPath?: string;
};

export type DownloadOptions = {
  /** Archive name, `.zip` appended when missing. */
  name: string;
  /** Put every file at the top level. */
  flatten?: boolean;
  /** Add `manifest.csv` (id, path, size, usage). */
  manifest?: boolean;
  /** Usage counts for the manifest. */
  usage?: Record<string, number>;
};

/** A server-written archive (`createZipExport` / `getZipExport`). */
export type ServerExport = {
  id: string;
  status: 'pending' | 'running' | 'ready' | 'failed';
  /** Asset ids left out because their object was missing. */
  skipped: string[];
  loaded: number;
  total: number;
  url: string | null;
  error: string | null;
};

/** Starts, polls and cancels server-written archives. */
export type DownloadExporter = {
  create(
    assetIds: string[],
    options: { name: string; flatten?: boolean; manifest?: boolean },
  ): Promise<ServerExport>;
  get(exportId: string): Promise<ServerExport>;
  delete?(exportId: string): Promise<void>;
};

/** From this many files on, an archive is written on the server. */
export const SERVER_EXPORT_FILES = 500;
/** Interval between `getZipExport` polls. */
export const SERVER_EXPORT_POLL_MS = 2000;

/** Blob archives above these sizes are refused (memory). */
export const BLOB_DOWNLOAD_LIMIT = 2 * 1024 ** 3;
export const BLOB_DOWNLOAD_LIMIT_IOS = 500 * 1024 ** 2;
/** Files fetched ahead of the one being written. */
export const DOWNLOAD_CONCURRENCY = 3;
/** Assets signed per `downloadIntent` call (signatures expire after minutes). */
export const DOWNLOAD_SIGN_BATCH = 20;

export class DownloadError extends Error {
  constructor(
    readonly code:
      | 'DOWNLOAD_TOO_LARGE'
      | 'DOWNLOAD_UNSUPPORTED'
      | 'DOWNLOAD_FAILED',
    message: string,
  ) {
    super(message);
    this.name = 'DownloadError';
  }
}

type SaveFilePicker = (options: {
  suggestedName?: string;
  types?: { description?: string; accept: Record<string, string[]> }[];
}) => Promise<{ createWritable(): Promise<WritableStream<Uint8Array>> }>;

function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints ?? 0) > 1)
  );
}

/** Saves to a file the user picks (`showSaveFilePicker`), streaming. */
export async function fileSink(name: string): Promise<DownloadSink | null> {
  const picker = (globalThis as { showSaveFilePicker?: SaveFilePicker })
    .showSaveFilePicker;
  if (typeof picker !== 'function') return null;
  const handle = await picker({
    suggestedName: name,
    types: [{ description: 'ZIP', accept: { 'application/zip': ['.zip'] } }],
  });
  const writable = await handle.createWritable();
  return { kind: 'file', writable, finish: async () => {} };
}

/** Collects the archive in memory and saves it through a link; capped. */
export function blobSink(
  name: string,
  size: number,
  limit = isIos() ? BLOB_DOWNLOAD_LIMIT_IOS : BLOB_DOWNLOAD_LIMIT,
): DownloadSink {
  if (size > limit) {
    throw new DownloadError(
      'DOWNLOAD_TOO_LARGE',
      `The archive (${size} bytes) is larger than ${limit} bytes`,
    );
  }
  const chunks: Uint8Array[] = [];
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      chunks.push(chunk);
    },
  });
  return {
    kind: 'blob',
    writable,
    async finish() {
      if (typeof document === 'undefined') return;
      const url = URL.createObjectURL(
        new Blob(chunks as BlobPart[], { type: 'application/zip' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      link.rel = 'noopener';
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
  };
}

/** The first sink that works: a streamed file, else a Blob within its cap. */
export async function chooseSink(
  name: string,
  size: number,
): Promise<DownloadSink> {
  const file = await fileSink(name);
  return file ?? blobSink(name, size);
}

/** Starts the browser download of a signed archive URL. */
function openUrl(url: string) {
  if (typeof document === 'undefined') return;
  const link = document.createElement('a');
  link.href = url;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

let jobCounter = 0;

export type DownloadQueue = {
  getState(): DownloadState;
  subscribe(listener: () => void): () => void;
  /** Downloads `assets` as one archive; resolves with the finished job. */
  download(
    assets: readonly DownloadAsset[],
    options: DownloadOptions,
  ): Promise<DownloadJob>;
  cancel(jobId?: string): void;
  /** Removes finished, failed and aborted jobs. */
  clear(): void;
};

export function createDownloadQueue(options: {
  sign: DownloadSigner;
  /**
   * Writes archives on the server instead: used from `SERVER_EXPORT_FILES`
   * files on, on iOS, and when the browser can neither stream to a file nor
   * hold the archive in memory.
   */
  exporter?: DownloadExporter;
  /** Waits between export polls (tests). */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  fetch?: typeof fetch;
  sink?: (name: string, size: number) => Promise<DownloadSink>;
  concurrency?: number;
}): DownloadQueue {
  const doFetch = options.fetch ?? ((input, init) => fetch(input, init));
  const pickSink = options.sink ?? chooseSink;
  const concurrency = Math.max(1, options.concurrency ?? DOWNLOAD_CONCURRENCY);
  const sleep = options.sleep ?? abortableSleep;
  let state: DownloadState = { jobs: [] };
  const listeners = new Set<() => void>();
  const controllers = new Map<string, AbortController>();

  const setJob = (id: string, patch: (job: DownloadJob) => DownloadJob) => {
    state = {
      jobs: state.jobs.map((job) => (job.id === id ? patch(job) : job)),
    };
    for (const listener of listeners) listener();
  };
  const setItem = (
    jobId: string,
    itemId: string,
    patch: Partial<DownloadItem>,
    loadedDelta = 0,
  ) =>
    setJob(jobId, (job) => ({
      ...job,
      loaded: job.loaded + loadedDelta,
      items: job.items.map((item) =>
        item.id === itemId
          ? { ...item, ...patch, loaded: item.loaded + loadedDelta }
          : item,
      ),
    }));

  const download = async (
    assets: readonly DownloadAsset[],
    opts: DownloadOptions,
  ): Promise<DownloadJob> => {
    const id = `dl_${++jobCounter}`;
    const name = sanitizeZipPath(
      opts.name.endsWith('.zip') ? opts.name : `${opts.name}.zip`,
    ).replace(/\//g, '_');
    const paths = uniqueZipPaths(
      assets.map((asset) =>
        sanitizeZipPath(
          opts.flatten || !asset.folderPath
            ? asset.name
            : `${asset.folderPath}/${asset.name}`,
        ),
      ),
    );
    const items: DownloadItem[] = assets.map((asset, i) => ({
      id: asset.id,
      path: paths[i],
      size: asset.size,
      status: 'pending',
      loaded: 0,
      error: null,
    }));
    const manifest = opts.manifest
      ? new TextEncoder().encode(
          manifestCsv(
            items.map((item) => ({
              id: item.id,
              path: item.path,
              size: item.size,
              usage: opts.usage?.[item.id],
            })),
          ),
        )
      : null;
    const entries = [
      ...items.map((item) => ({ name: item.path, size: item.size })),
      ...(manifest ? [{ name: 'manifest.csv', size: manifest.length }] : []),
    ];
    const total = predictZipLength(entries);
    const controller = new AbortController();
    controllers.set(id, controller);
    state = {
      jobs: [
        ...state.jobs,
        {
          id,
          name,
          status: 'pending',
          items,
          loaded: 0,
          total,
          sink: null,
          error: null,
        },
      ],
    };
    for (const listener of listeners) listener();

    const signed = new Map<string, Promise<SignedDownload | undefined>>();
    const signFrom = (index: number) => {
      if (signed.has(items[index].id)) return;
      const batch = items
        .slice(index, index + DOWNLOAD_SIGN_BATCH)
        .filter((item) => !signed.has(item.id));
      const request = options.sign(batch.map((item) => item.id));
      for (const item of batch) {
        signed.set(
          item.id,
          request.then((res) => res.items.find((s) => s.id === item.id)),
        );
      }
    };
    const responses = new Map<string, Promise<Response | null>>();
    const start = (index: number) => {
      const item = items[index];
      if (!item || responses.has(item.id)) return;
      signFrom(index);
      responses.set(
        item.id,
        signed.get(item.id)!.then(async (s) => {
          if (!s) return null;
          return doFetch(s.url, {
            signal: controller.signal,
            credentials: 'omit',
          });
        }),
      );
    };

    async function* inputs() {
      for (let i = 0; i < items.length; i++) {
        for (let j = i; j < Math.min(items.length, i + concurrency); j++)
          start(j);
        const item = items[i];
        setItem(id, item.id, { status: 'downloading' });
        let response: Response | null;
        try {
          response = await responses.get(item.id)!;
        } catch (error) {
          if (controller.signal.aborted) throw error;
          response = null;
        }
        if (!response || !response.ok || !response.body) {
          // A missing or unreadable file is skipped; the archive is still useful.
          setItem(id, item.id, {
            status: response ? 'error' : 'skipped',
            error: response ? `HTTP ${response.status}` : 'NOT_SIGNED',
          });
          setJob(id, (job) => ({
            ...job,
            total:
              job.total -
              (30 +
                new TextEncoder().encode(item.path).length +
                item.size +
                16) -
              (46 + new TextEncoder().encode(item.path).length),
          }));
          continue;
        }
        const itemId = item.id;
        const counted = response.body.pipeThrough(
          new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, ctrl) {
              setItem(id, itemId, {}, chunk.length);
              ctrl.enqueue(chunk);
            },
            flush() {
              setItem(id, itemId, { status: 'success' });
            },
          }),
        );
        yield { name: item.path, input: counted };
      }
      if (manifest) yield { name: 'manifest.csv', input: manifest };
    }

    const hasFilePicker =
      typeof (globalThis as { showSaveFilePicker?: unknown })
        .showSaveFilePicker === 'function';
    if (
      options.exporter &&
      (items.length >= SERVER_EXPORT_FILES ||
        isIos() ||
        (!hasFilePicker && total > BLOB_DOWNLOAD_LIMIT))
    ) {
      await exportOnServer(id, name, opts, controller.signal);
      controllers.delete(id);
      return state.jobs.find((job) => job.id === id)!;
    }

    try {
      const sink = await pickSink(name, total);
      setJob(id, (job) => ({ ...job, status: 'downloading', sink: sink.kind }));
      const archive = makeZip(inputs());
      await archive.pipeTo(sink.writable, { signal: controller.signal });
      await sink.finish();
      setJob(id, (job) => ({ ...job, status: 'success', loaded: job.total }));
    } catch (error) {
      const aborted = controller.signal.aborted;
      setJob(id, (job) => ({
        ...job,
        status: aborted ? 'aborted' : 'error',
        error: aborted
          ? null
          : error instanceof DownloadError
            ? error.code
            : 'DOWNLOAD_FAILED',
        items: job.items.map((item) =>
          item.status === 'pending' || item.status === 'downloading'
            ? { ...item, status: aborted ? 'aborted' : 'error' }
            : item,
        ),
      }));
    } finally {
      controllers.delete(id);
    }
    return state.jobs.find((job) => job.id === id)!;
  };

  async function exportOnServer(
    id: string,
    name: string,
    opts: DownloadOptions,
    signal: AbortSignal,
  ) {
    const exporter = options.exporter!;
    const ids = state.jobs.find((job) => job.id === id)!.items.map((i) => i.id);
    let exportId: string | null = null;
    try {
      setJob(id, (job) => ({ ...job, status: 'downloading', sink: 'server' }));
      let current = await exporter.create(ids, {
        name,
        flatten: opts.flatten,
        manifest: opts.manifest,
      });
      exportId = current.id;
      while (current.status === 'pending' || current.status === 'running') {
        const progress = current;
        setJob(id, (job) => ({
          ...job,
          loaded: progress.loaded,
          total: progress.total,
        }));
        await sleep(SERVER_EXPORT_POLL_MS, signal);
        current = await exporter.get(current.id);
      }
      if (current.status === 'failed' || !current.url) {
        throw new DownloadError('DOWNLOAD_FAILED', current.error ?? 'failed');
      }
      const skipped = new Set(current.skipped);
      const done = current;
      setJob(id, (job) => ({
        ...job,
        status: 'success',
        loaded: done.total,
        total: done.total,
        items: job.items.map((item) => ({
          ...item,
          status: skipped.has(item.id) ? 'skipped' : 'success',
          loaded: skipped.has(item.id) ? 0 : item.size,
          error: skipped.has(item.id) ? 'NOT_FOUND' : null,
        })),
      }));
      openUrl(done.url!);
    } catch (error) {
      const aborted = signal.aborted;
      if (aborted && exportId) void exporter.delete?.(exportId).catch(() => {});
      setJob(id, (job) => ({
        ...job,
        status: aborted ? 'aborted' : 'error',
        error: aborted
          ? null
          : error instanceof DownloadError
            ? error.code
            : 'DOWNLOAD_FAILED',
        items: job.items.map((item) =>
          item.status === 'pending' || item.status === 'downloading'
            ? { ...item, status: aborted ? 'aborted' : 'error' }
            : item,
        ),
      }));
    }
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    download,
    cancel(jobId) {
      for (const [id, controller] of controllers) {
        if (!jobId || id === jobId) controller.abort();
      }
    },
    clear() {
      state = {
        jobs: state.jobs.filter(
          (job) => job.status === 'pending' || job.status === 'downloading',
        ),
      };
      for (const listener of listeners) listener();
    },
  };
}
