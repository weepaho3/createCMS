import type { WritableAtom } from 'nanostores';

import { atom } from 'nanostores';

import type {
  CMSFetch,
  CMSMediaUploadFileState,
  CMSMediaUploadOptions,
  CMSMediaUploadProgress,
  CMSMediaUploadState,
} from './types';

import { CMSClientError } from './error';

const FORBIDDEN_XHR_HEADERS = new Set([
  'content-length',
  'host',
  'connection',
  'user-agent',
  'referer',
  'origin',
]);

// One `createSignedUpload` entry (routes/media.ts).
type SignedUpload = {
  id: string;
  objectKey: string;
  signedUrl: string;
  headers: Record<string, string>;
  token: string;
};

// The `completeUpload` response shape (routes/media.ts), trimmed to what the
// ledger surfaces.
type CompleteUploadResult = {
  assets: { id: string; slug: string; objectKey: string }[];
  errors: { index: number; code: string; message: string }[];
};

// The `createSignedReplace` response shape (routes/media.ts).
type SignedReplace = {
  assetId: string;
  slug: string;
  objectKey: string;
  signedUrl: string;
  headers: Record<string, string>;
  token: string;
};

// The `commitReplace` response shape (routes/media.ts), trimmed to what the
// replace atom's `result` surfaces.
type CommitReplaceResult = {
  asset: { id: string; slug: string; objectKey: string };
};

/**
 * State for the browser-callable "replace an asset's bytes" flow
 * (`createSignedReplace` -> PUT to S3 -> `commitReplace`): the client half of
 * `replaceAsset`, which is server-only because a `File`/`Blob` cannot survive
 * the JSON request body (see `replaceAsset` in routes/media.ts).
 */
export type CMSMediaReplaceState = {
  isReplacing: boolean;
  isAborted: boolean;
  progress: number;
  error: unknown;
  result: { id: string; slug: string; objectKey: string } | null;
  replace: (assetId: string, file: File) => Promise<void>;
  abort: () => void;
  reset: () => void;
};

/**
 * Thrown by `uploadWithXHR` for a failed PUT. `code` is `NETWORK_ERROR` for
 * the XHR `error` event and `UPLOAD_FAILED` for a non-2xx response.
 */
class UploadRequestError extends Error {
  readonly code: 'NETWORK_ERROR' | 'UPLOAD_FAILED';

  constructor(code: 'NETWORK_ERROR' | 'UPLOAD_FAILED', message: string) {
    super(message);
    this.name = 'UploadRequestError';
    this.code = code;
  }
}

function abortError(): DOMException {
  return new DOMException('Upload aborted', 'AbortError');
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

function uploadWithXHR(
  url: string,
  file: File | Blob,
  headers: Record<string, string>,
  onProgress: (loaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }

    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url, true);

    for (const [key, value] of Object.entries(headers)) {
      if (!FORBIDDEN_XHR_HEADERS.has(key.toLowerCase())) {
        xhr.setRequestHeader(key, value);
      }
    }

    // `settle` removes the abort listener before resolving or rejecting.
    const onAbort = () => {
      xhr.abort();
      settle(reject, abortError());
    };
    const settle = <T>(fn: (value: T) => void, value: T) => {
      signal?.removeEventListener('abort', onAbort);
      fn(value);
    };

    signal?.addEventListener('abort', onAbort);

    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) {
        onProgress(event.loaded, event.total);
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        settle(resolve, undefined);
      } else {
        settle(
          reject,
          new UploadRequestError(
            'UPLOAD_FAILED',
            `Upload failed with status ${xhr.status}`,
          ),
        );
      }
    });

    xhr.addEventListener('error', () =>
      settle(
        reject,
        new UploadRequestError('NETWORK_ERROR', 'Network error during upload'),
      ),
    );
    xhr.addEventListener('abort', () => settle(reject, abortError()));

    xhr.send(file);
  });
}

let entrySequence = 0;

function isActive(entry: CMSMediaUploadFileState): boolean {
  return entry.status === 'pending' || entry.status === 'uploading';
}

/**
 * Byte-summed progress over `pending`, `uploading` and `success` entries.
 * `error` and `aborted` entries are excluded.
 */
function aggregate(files: CMSMediaUploadFileState[]): CMSMediaUploadProgress {
  let loaded = 0;
  let total = 0;
  for (const entry of files) {
    if (entry.status === 'error' || entry.status === 'aborted') continue;
    loaded += entry.loaded;
    total += entry.total;
  }
  return { loaded, total, fraction: total === 0 ? 0 : loaded / total };
}

function toUploadError(err: unknown): { code: string; message: string } {
  if (err instanceof CMSClientError) {
    return { code: err.code ?? 'UPLOAD_FAILED', message: err.message };
  }
  if (err instanceof UploadRequestError) {
    return { code: err.code, message: err.message };
  }
  if (err instanceof TypeError) {
    return { code: 'NETWORK_ERROR', message: err.message };
  }
  return {
    code: 'UPLOAD_FAILED',
    message: err instanceof Error ? err.message : 'Upload failed',
  };
}

/**
 * One signal that aborts when either input aborts. `release` detaches the
 * fallback listeners; `AbortSignal.any` holds its sources weakly and needs
 * no cleanup.
 */
function mergeSignals(
  root: AbortSignal,
  extra: AbortSignal | undefined,
): { signal: AbortSignal; release: () => void } {
  if (!extra) return { signal: root, release: () => {} };
  if (typeof AbortSignal.any === 'function') {
    return { signal: AbortSignal.any([root, extra]), release: () => {} };
  }
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  const release = () => {
    root.removeEventListener('abort', onAbort);
    extra.removeEventListener('abort', onAbort);
  };
  if (root.aborted || extra.aborted) {
    controller.abort();
  } else {
    root.addEventListener('abort', onAbort);
    extra.addEventListener('abort', onAbort);
  }
  return { signal: controller.signal, release };
}

const INITIAL_STATE: CMSMediaUploadState = {
  isUploading: false,
  files: [],
  progress: { loaded: 0, total: 0, fraction: 0 },
  error: null,
  upload: () => Promise.resolve([]),
  abort: () => {},
  reset: () => {},
};

const DEFAULT_CONCURRENCY = 4;

/**
 * Nanostores atom holding the upload ledger. Entries accumulate across
 * `upload()` calls until `reset()` drops the finished ones. Each call signs
 * (`createSignedUpload`), PUTs with a bounded worker pool, then completes
 * (`completeUpload`); an entry is `success` only once its row exists.
 * Validation of file size, count, and MIME types lives server-side.
 */
export function createMediaUploadAtom(
  $fetch: CMSFetch,
): WritableAtom<CMSMediaUploadState> {
  const store = atom<CMSMediaUploadState>({ ...INITIAL_STATE });

  let root = new AbortController();

  function commit(
    files: CMSMediaUploadFileState[],
    extra: Partial<Pick<CMSMediaUploadState, 'error'>> = {},
  ) {
    store.set({
      ...store.get(),
      ...extra,
      files,
      progress: aggregate(files),
      isUploading: files.some(isActive),
    });
  }

  function patch(
    ids: Iterable<string>,
    update: (entry: CMSMediaUploadFileState) => CMSMediaUploadFileState,
    extra?: Partial<Pick<CMSMediaUploadState, 'error'>>,
  ) {
    const set = new Set(ids);
    commit(
      store
        .get()
        .files.map((entry) => (set.has(entry.id) ? update(entry) : entry)),
      extra,
    );
  }

  function snapshot(ids: string[]): CMSMediaUploadFileState[] {
    const byId = new Map(store.get().files.map((entry) => [entry.id, entry]));
    return ids.flatMap((id) => {
      const entry = byId.get(id);
      return entry ? [entry] : [];
    });
  }

  function abortPending(ids: Iterable<string>) {
    patch(ids, (entry) =>
      entry.status === 'pending' ? { ...entry, status: 'aborted' } : entry,
    );
  }

  /**
   * Completes every entry whose PUT finished: one `completeUpload` call for
   * the batch, then `success` with the asset (matched by the token's asset
   * id) or `error` with the entry's reported code. A rejected call marks all
   * of them `error`. Runs after an abort as well, since the objects already
   * exist in the bucket.
   */
  async function finalize(
    sent: { id: string; assetId: string; token: string }[],
  ) {
    if (sent.length === 0) return;

    let result: CompleteUploadResult;
    try {
      result = (await $fetch('/media/completeUpload', {
        method: 'POST',
        body: { uploads: sent.map(({ token }) => ({ token })) },
      })) as CompleteUploadResult;
    } catch (err) {
      const error = toUploadError(err);
      patch(
        sent.map(({ id }) => id),
        (entry) => ({ ...entry, status: 'error', error }),
      );
      return;
    }

    const assetsById = new Map(result.assets.map((a) => [a.id, a]));
    const errorsByIndex = new Map(result.errors.map((e) => [e.index, e]));
    const updates = new Map(
      sent.map(({ id, assetId }, index) => {
        const asset = assetsById.get(assetId);
        const failure = errorsByIndex.get(index);
        return [
          id,
          asset
            ? {
                status: 'success' as const,
                result: {
                  id: asset.id,
                  slug: asset.slug,
                  objectKey: asset.objectKey,
                },
              }
            : {
                status: 'error' as const,
                error: {
                  code: failure?.code ?? 'UPLOAD_FAILED',
                  message: failure?.message ?? 'Upload was not completed',
                },
              },
        ];
      }),
    );
    patch(updates.keys(), (entry) => {
      const update = updates.get(entry.id)!;
      return update.status === 'success'
        ? {
            ...entry,
            status: 'success',
            loaded: entry.total,
            progress: 1,
            result: update.result,
          }
        : { ...entry, status: 'error', error: update.error };
    });
  }

  function abort() {
    root.abort();
    root = new AbortController();
    abortPending(store.get().files.map((entry) => entry.id));
  }

  function reset() {
    if (root.signal.aborted) root = new AbortController();
    commit(store.get().files.filter(isActive), { error: null });
  }

  async function upload(
    files: File[],
    options?: CMSMediaUploadOptions,
  ): Promise<CMSMediaUploadFileState[]> {
    if (files.length === 0) return [];

    const entries: CMSMediaUploadFileState[] = files.map((file) => ({
      id: `upl_${++entrySequence}`,
      file,
      name: file.name,
      size: file.size,
      type: file.type,
      status: 'pending',
      loaded: 0,
      total: file.size,
      progress: 0,
    }));
    const ids = entries.map((entry) => entry.id);
    commit([...store.get().files, ...entries], { error: null });

    const { signal, release } = mergeSignals(root.signal, options?.signal);

    try {
      if (signal.aborted) {
        abortPending(ids);
        return snapshot(ids);
      }

      let signResponse: { uploads: SignedUpload[]; expiresAt: Date };
      try {
        signResponse = (await $fetch('/media/createSignedUpload', {
          method: 'POST',
          body: {
            files: files.map((f) => ({
              name: f.name,
              size: f.size,
              type: f.type,
            })),
            folderId: options?.folderId,
          },
        })) as { uploads: SignedUpload[]; expiresAt: Date };
      } catch (err) {
        const error = toUploadError(err);
        patch(ids, (entry) => ({ ...entry, status: 'error', error }), {
          error: err,
        });
        return snapshot(ids);
      }

      if (signal.aborted) {
        abortPending(ids);
        return snapshot(ids);
      }

      const uploads = signResponse.uploads;
      const landed: { id: string; assetId: string; token: string }[] = [];
      let cursor = 0;

      async function worker() {
        while (cursor < entries.length) {
          const index = cursor++;
          const id = ids[index];
          const upload = uploads[index];
          if (signal.aborted) {
            abortPending([id]);
            continue;
          }
          if (snapshot([id])[0]?.status !== 'pending') continue;

          patch([id], (entry) => ({ ...entry, status: 'uploading' }));

          try {
            await uploadWithXHR(
              upload.signedUrl,
              files[index],
              upload.headers,
              (loaded, total) => {
                patch([id], (entry) => ({
                  ...entry,
                  loaded,
                  total,
                  progress: total === 0 ? 0 : loaded / total,
                }));
              },
              signal,
            );

            landed.push({ id, assetId: upload.id, token: upload.token });
            patch([id], (entry) => ({
              ...entry,
              loaded: entry.total,
              progress: 1,
            }));
          } catch (err) {
            if (isAbortError(err)) {
              patch([id], (entry) => ({ ...entry, status: 'aborted' }));
            } else {
              const error = toUploadError(err);
              patch([id], (entry) => ({ ...entry, status: 'error', error }));
            }
          }
        }
      }

      const size = Math.max(
        1,
        Math.min(options?.concurrency ?? DEFAULT_CONCURRENCY, entries.length),
      );
      await Promise.all(Array.from({ length: size }, worker));

      await finalize(landed);

      const failed = snapshot(ids).some((entry) => entry.status === 'error');
      if (failed) {
        commit(store.get().files, { error: 'Some files failed to upload' });
      }
      return snapshot(ids);
    } finally {
      release();
    }
  }

  store.set({ ...INITIAL_STATE, upload, abort, reset });

  return store;
}

const REPLACE_INITIAL_STATE: CMSMediaReplaceState = {
  isReplacing: false,
  isAborted: false,
  progress: 0,
  error: null,
  result: null,
  replace: () => Promise.resolve(),
  abort: () => {},
  reset: () => {},
};

/**
 * Nanostores atom managing the browser-callable asset-replace flow: sign,
 * PUT to S3, commit. Validation of file size, MIME type, and the variant
 * guard lives server-side in the `createSignedReplace` endpoint.
 */
export function createMediaReplaceAtom(
  $fetch: CMSFetch,
): WritableAtom<CMSMediaReplaceState> {
  const store = atom<CMSMediaReplaceState>({ ...REPLACE_INITIAL_STATE });

  let controller: AbortController | null = null;

  function abort() {
    controller?.abort();
    controller = null;
    const current = store.get();
    store.set({ ...current, isReplacing: false, isAborted: true });
  }

  function reset() {
    controller?.abort();
    controller = null;
    store.set({ ...REPLACE_INITIAL_STATE, replace, abort, reset });
  }

  async function replace(assetId: string, file: File): Promise<void> {
    controller = new AbortController();
    const { signal } = controller;

    store.set({
      ...store.get(),
      isReplacing: true,
      isAborted: false,
      progress: 0,
      error: null,
      result: null,
    });

    try {
      if (signal.aborted) return;

      // Sign the replacement.
      const signed = (await $fetch('/media/createSignedReplace', {
        method: 'POST',
        body: {
          assetId,
          file: { name: file.name, size: file.size, type: file.type },
        },
      })) as SignedReplace;

      if (signal.aborted) return;

      // PUT the new bytes to S3.
      await uploadWithXHR(
        signed.signedUrl,
        file,
        signed.headers,
        (loaded, total) => {
          store.set({
            ...store.get(),
            progress: Math.round((loaded / total) * 100),
          });
        },
        signal,
      );

      if (signal.aborted) return;

      // Commit: repoint the asset's row at the new object.
      const commit = (await $fetch('/media/commitReplace', {
        method: 'POST',
        body: { token: signed.token },
      })) as CommitReplaceResult;

      store.set({
        ...store.get(),
        isReplacing: false,
        progress: 100,
        result: {
          id: commit.asset.id,
          slug: commit.asset.slug,
          objectKey: commit.asset.objectKey,
        },
      });
    } catch (err) {
      const isAbortErr =
        err instanceof DOMException && err.name === 'AbortError';
      store.set({
        ...store.get(),
        isReplacing: false,
        error: isAbortErr
          ? 'Replace aborted.'
          : err instanceof Error
            ? err.message
            : 'Replace failed',
      });
    }
  }

  store.set({ ...REPLACE_INITIAL_STATE, replace, abort, reset });

  return store;
}
