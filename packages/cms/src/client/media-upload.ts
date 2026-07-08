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
