import type { WritableAtom } from 'nanostores';

import { atom } from 'nanostores';

import type {
  CMSFetch,
  CMSMediaUploadFileState,
  CMSMediaUploadOptions,
  CMSMediaUploadState,
} from './types';

// ============================================================================
// Constants
// ============================================================================

const FORBIDDEN_XHR_HEADERS = new Set([
  'content-length',
  'host',
  'connection',
  'user-agent',
  'referer',
  'origin',
]);

// ============================================================================
// Types
// ============================================================================

type SignedAsset = {
  id: string;
  slug: string;
  objectKey: string;
  signedUrl: string;
  headers: Record<string, string>;
};

// The `createSignedReplace` response shape (routes/media.ts).
type SignedReplace = {
  assetId: string;
  slug: string;
  objectKey: string;
  signedUrl: string;
  headers: Record<string, string>;
};

// The `commitReplace` response shape (routes/media.ts) — trimmed to what the
// replace atom's `result` surfaces; call `cmsClient.media.commitReplace`
// directly (fully typed) for the complete listAssets-shaped asset.
type CommitReplaceResult = {
  asset: { id: string; slug: string; objectKey: string };
};

/**
 * State for the browser-callable "replace an asset's bytes" flow
 * (`createSignedReplace` -> PUT to S3 -> `commitReplace`) — the client half of
 * `replaceAsset` (server-only, since a `File`/`Blob` cannot survive the JSON
 * request body; see replaceAsset's docstring in routes/media.ts, Plan 007
 * part A).
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

// ============================================================================
// XHR Upload
// ============================================================================

function uploadWithXHR(
  url: string,
  file: File | Blob,
  headers: Record<string, string>,
  onProgress: (loaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Upload aborted', 'AbortError'));
      return;
    }

    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url, true);

    for (const [key, value] of Object.entries(headers)) {
      if (!FORBIDDEN_XHR_HEADERS.has(key.toLowerCase())) {
        xhr.setRequestHeader(key, value);
      }
    }

    if (signal) {
      signal.addEventListener(
        'abort',
        () => {
          xhr.abort();
          reject(new DOMException('Upload aborted', 'AbortError'));
        },
        { once: true },
      );
    }

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(event.loaded, event.total);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Upload failed with status ${xhr.status}`));
      }
    };

    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.onabort = () =>
      reject(new DOMException('Upload aborted', 'AbortError'));

    xhr.send(file);
  });
}

// ============================================================================
// Helpers
// ============================================================================

function computeTotalProgress(files: CMSMediaUploadFileState[]): number {
  if (files.length === 0) return 0;
  const sum = files.reduce((acc, f) => acc + f.progress, 0);
  return Math.round(sum / files.length);
}

// ============================================================================
// Atom Factory
// ============================================================================

const INITIAL_STATE: CMSMediaUploadState = {
  isUploading: false,
  isAborted: false,
  files: [],
  totalProgress: 0,
  error: null,
  upload: () => Promise.resolve(),
  abort: () => {},
  reset: () => {},
};

/**
 * Creates a nanostores atom that manages media upload state.
 *
 * Pipeline: sign -> upload primary files.
 *
 * Server-side validation (file size, count, MIME types) is handled by the
 * `createSignedUpload` endpoint.
 */
export function createMediaUploadAtom(
  $fetch: CMSFetch,
): WritableAtom<CMSMediaUploadState> {
  const store = atom<CMSMediaUploadState>({ ...INITIAL_STATE });

  let controller: AbortController | null = null;

  function updateFileState(
    index: number,
    patch: Partial<CMSMediaUploadFileState>,
  ) {
    const current = store.get();
    const files = [...current.files];
    files[index] = { ...files[index], ...patch };
    store.set({
      ...current,
      files,
      totalProgress: computeTotalProgress(files),
    });
  }

  function abort() {
    controller?.abort();
    controller = null;
    const current = store.get();
    store.set({ ...current, isUploading: false, isAborted: true });
  }

  function reset() {
    controller?.abort();
    controller = null;
    store.set({ ...INITIAL_STATE, upload, abort, reset });
  }

  async function upload(
    files: File[],
    options?: CMSMediaUploadOptions,
  ): Promise<void> {
    if (files.length === 0) return;

    controller = new AbortController();
    const { signal } = controller;

    store.set({
      ...store.get(),
      isUploading: true,
      isAborted: false,
      files: files.map((f) => ({
        name: f.name,
        progress: 0,
        status: 'pending',
      })),
      totalProgress: 0,
      error: null,
    });

    try {
      if (signal.aborted) return;

      // 1. Sign files
      const signResponse = (await $fetch('/media/createSignedUpload', {
        method: 'POST',
        body: {
          files: files.map((f) => ({
            name: f.name,
            size: f.size,
            type: f.type,
          })),
          folderId: options?.folderId,
        },
      })) as { assets: SignedAsset[]; expiresAt: Date };

      if (signal.aborted) return;

      // 2. Upload files to S3
      const uploadPromises = signResponse.assets.map(async (asset, index) => {
        updateFileState(index, { status: 'uploading' });

        try {
          await uploadWithXHR(
            asset.signedUrl,
            files[index],
            asset.headers,
            (loaded, total) => {
              updateFileState(index, {
                progress: Math.round((loaded / total) * 100),
              });
            },
            signal,
          );

          updateFileState(index, {
            progress: 100,
            status: 'done',
            result: {
              id: asset.id,
              slug: asset.slug,
              objectKey: asset.objectKey,
            },
          });
        } catch (err) {
          const isAbortErr =
            err instanceof DOMException && err.name === 'AbortError';
          updateFileState(index, {
            status: 'error',
            error: isAbortErr
              ? 'Upload aborted.'
              : err instanceof Error
                ? err.message
                : 'Upload failed',
          });
        }
      });

      await Promise.allSettled(uploadPromises);

      // 3. Finalize
      const finalState = store.get();
      const hasErrors = finalState.files.some((f) => f.status === 'error');

      store.set({
        ...finalState,
        isUploading: false,
        totalProgress: computeTotalProgress(finalState.files),
        error: hasErrors ? 'Some files failed to upload' : null,
      });
    } catch (err) {
      store.set({
        ...store.get(),
        isUploading: false,
        error: err instanceof Error ? err.message : err,
      });
    }
  }

  store.set({ ...INITIAL_STATE, upload, abort, reset });

  return store;
}

// ============================================================================
// Replace Atom Factory
// ============================================================================

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
 * Creates a nanostores atom that manages the browser-callable asset-replace
 * flow: sign -> PUT to S3 -> commit. This is the client half `replaceAsset`
 * itself cannot have (see its docstring, Plan 007 part A) — `uploadWithXHR` is
 * reused unchanged from the upload atom above.
 *
 * Server-side validation (file size, MIME type, variant guard) is handled by
 * the `createSignedReplace` endpoint.
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

      // 1. Sign the replacement.
      const signed = (await $fetch('/media/createSignedReplace', {
        method: 'POST',
        body: {
          assetId,
          file: { name: file.name, size: file.size, type: file.type },
        },
      })) as SignedReplace;

      if (signal.aborted) return;

      // 2. PUT the new bytes to S3.
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

      // 3. Commit: repoint the asset's row at the new object.
      const commit = (await $fetch('/media/commitReplace', {
        method: 'POST',
        body: {
          assetId,
          objectKey: signed.objectKey,
          slug: signed.slug,
          mimeType: file.type,
          size: file.size,
        },
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
