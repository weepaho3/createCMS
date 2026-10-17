import { vi } from 'vitest';

import type {
  MediaAsset,
  MediaClient,
  MediaFolder,
  MediaUploadEntry,
  MediaUploadState,
} from './types';

export function makeAsset(overrides: Partial<MediaAsset> = {}): MediaAsset {
  const id = overrides.id ?? 'ast_1';
  return {
    id,
    slug: id,
    mimeType: 'image/png',
    size: 100,
    objectKey: `assets/${id}.png`,
    url: `https://cdn.test/assets/${id}.png`,
    deliveryUrl: `/api/cms/media/asset/${id}`,
    status: 'public',
    folderId: null,
    variantOf: null,
    uploadedBy: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function makeAssets(count: number, prefix = 'ast_'): MediaAsset[] {
  return Array.from({ length: count }, (_, i) =>
    makeAsset({ id: `${prefix}${i + 1}` }),
  );
}

export function makeFolder(overrides: Partial<MediaFolder> = {}): MediaFolder {
  const id = overrides.id ?? 'fld_1';
  return { id, name: id, parentId: null, ...overrides };
}

export function makeUploadState(
  overrides: Partial<MediaUploadState> = {},
): MediaUploadState {
  return {
    isUploading: false,
    files: [],
    progress: {
      loaded: 0,
      total: 0,
      fraction: 0,
      bytesPerSecond: null,
      eta: null,
    },
    error: null,
    budget: 6,
    upload: vi.fn(async () => []),
    replace: vi.fn(async () => makeEntry({ kind: 'replace' })),
    abort: vi.fn(),
    retry: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    resolveDuplicate: vi.fn(),
    regenerateRenditions: vi.fn(async () => []),
    reset: vi.fn(),
    ...overrides,
  };
}

export function makeEntry(
  overrides: Partial<MediaUploadEntry> = {},
): MediaUploadEntry {
  const name = overrides.name ?? 'hero.png';
  const file = new File(['x'], name, { type: 'image/png' });
  return {
    id: 'up_1',
    kind: 'create',
    file,
    name,
    size: 100,
    type: 'image/png',
    status: 'queued',
    phase: null,
    loaded: 0,
    total: 100,
    progress: 0,
    attempt: 0,
    nextRetryAt: null,
    folderId: null,
    ...overrides,
  };
}

export type FakeClient = {
  [K in keyof MediaClient]: ReturnType<
    typeof vi.fn<NonNullable<MediaClient[K]>>
  >;
};

/** A `MediaClient` of `vi.fn()`s resolving with one asset, no folders and an idle upload state. */
export function makeClient(overrides: Partial<FakeClient> = {}): FakeClient {
  const uploadState = makeUploadState();
  return {
    listAssets: vi.fn(async () => ({
      assets: [makeAsset()],
      total: 1,
      hasMore: false,
      nextCursor: null,
    })),
    listFolders: vi.fn(async () => ({ folders: [] })),
    createFolder: vi.fn(async ({ body }) => ({
      folder: makeFolder({
        id: 'fld_new',
        name: body.name,
        parentId: body.parentFolderId ?? null,
      }),
    })),
    moveAssets: vi.fn(async ({ body }) => ({
      moved: body.assetIds.length,
      movedIds: body.assetIds,
      skipped: [],
    })),
    archiveAssets: vi.fn(async ({ body }) => ({
      archived: body.assetIds.length,
      archivedIds: body.assetIds,
      skipped: [],
    })),
    updateAssetsStatus: vi.fn(async ({ body }) => ({
      updated: body.assetIds.length,
      updatedIds: body.assetIds,
      skipped: [],
    })),
    useUploadAssets: vi.fn(() => uploadState),
    ...overrides,
  };
}

export function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets every already-queued microtask (resolved promises, `await`s) run. */
export function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
