'use client';

import type {
  CmsAssetListItem,
  CmsMediaUploadState,
} from '@createcms/react/editor/cms';
import type {
  MediaAssetFilterQuery,
  MediaBulkTarget,
  MediaClient,
  MediaFolderRecord as MediaFolder,
  MediaSortBy,
} from '@createcms/react/media';

import { DEMO_ASSETS } from '@/app/demo/_lib/assets';

function idleUploadState(): CmsMediaUploadState {
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
    error: undefined,
    budget: 6,
    upload: async () => [],
    replace: () => Promise.reject(new Error('The demo does not upload')),
    abort: () => {},
    retry: () => {},
    pause: () => {},
    resume: () => {},
    resolveDuplicate: () => {},
    regenerateRenditions: async () => [],
    reset: () => {},
  };
}

const DEMO_FOLDERS: MediaFolder[] = [
  { id: 'folder-brand', name: 'Brand', parentId: null },
  { id: 'folder-blog', name: 'Blog', parentId: null },
  { id: 'folder-logos', name: 'Logos', parentId: 'folder-brand' },
];

const EXTRA_ASSETS: CmsAssetListItem[] = [
  {
    id: 'brand-guide',
    slug: 'brand-guide.pdf',
    mimeType: 'application/pdf',
    size: 482_311,
    objectKey: 'brand-guide.pdf',
    url: null,
    deliveryUrl: '/demo/brand-guide.pdf',
    status: 'private',
    folderId: 'folder-brand',
    variantOf: null,
    uploadedBy: null,
    createdAt: '2026-02-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
  },
  {
    id: 'logo-mark',
    slug: 'logo-mark',
    mimeType: 'image/svg+xml',
    size: 1_024,
    objectKey: 'logo-mark.svg',
    url: '/demo/hero.svg',
    deliveryUrl: '/demo/hero.svg',
    status: 'public',
    folderId: 'folder-logos',
    variantOf: null,
    uploadedBy: null,
    createdAt: '2026-02-02T00:00:00.000Z',
    updatedAt: '2026-02-02T00:00:00.000Z',
  },
  {
    id: 'intro-clip',
    slug: 'intro-clip',
    mimeType: 'video/mp4',
    size: 12_582_912,
    objectKey: 'intro-clip.mp4',
    url: null,
    deliveryUrl: '/demo/intro-clip.mp4',
    status: 'private',
    folderId: null,
    variantOf: null,
    uploadedBy: null,
    createdAt: '2026-02-03T00:00:00.000Z',
    updatedAt: '2026-02-03T00:00:00.000Z',
  },
];

const PAGE_SIZE_FALLBACK = 40;

function compareAssets(sortBy: MediaSortBy, direction: 'asc' | 'desc') {
  const sign = direction === 'asc' ? 1 : -1;
  return (a: CmsAssetListItem, b: CmsAssetListItem): number => {
    switch (sortBy) {
      case 'slug':
      case 'originalName':
        return (
          sign *
          (a.originalName ?? a.slug).localeCompare(b.originalName ?? b.slug)
        );
      case 'size':
        return sign * (a.size - b.size);
      case 'width':
        return sign * ((a.width ?? -1) - (b.width ?? -1));
      case 'updatedAt':
        return sign * String(a.updatedAt).localeCompare(String(b.updatedAt));
      case 'createdAt':
        return sign * String(a.createdAt).localeCompare(String(b.createdAt));
    }
  };
}

const KIND_PREFIX: Record<string, string> = {
  image: 'image/',
  video: 'video/',
  audio: 'audio/',
  document: 'application/pdf',
};

/**
 * In-memory `MediaClient` for the media demo: folders, asset status, folder
 * membership, details and focal points live in the closure; `brand-guide`
 * counts as in use, so archiving it reports it under `skipped`. Downloads
 * are signed as the files under `/demo`. Uploads stay idle.
 */
export function demoMediaClient(): MediaClient {
  const folders = structuredClone(DEMO_FOLDERS);
  const assets = structuredClone([...DEMO_ASSETS, ...EXTRA_ASSETS]);
  const inUse = new Set(['brand-guide']);

  const matching = (query: MediaAssetFilterQuery | undefined) => {
    const search = (query?.q ?? query?.search)?.toLowerCase();
    let filtered = assets.filter(
      (asset) => (asset.status === 'archived') === !!query?.archived,
    );
    if (query?.folderId) {
      filtered = filtered.filter((asset) => asset.folderId === query.folderId);
    } else if (query?.unfiled) {
      filtered = filtered.filter((asset) => asset.folderId === null);
    }
    if (search) {
      filtered = filtered.filter(
        (asset) =>
          asset.id.toLowerCase().includes(search) ||
          (asset.originalName ?? asset.slug).toLowerCase().includes(search),
      );
    }
    if (query?.kinds) {
      const prefixes = query.kinds
        .split(',')
        .map((kind) => KIND_PREFIX[kind] ?? '~');
      filtered = filtered.filter((asset) =>
        prefixes.some((prefix) => asset.mimeType.startsWith(prefix)),
      );
    }
    return filtered;
  };

  const byIds = (target: MediaBulkTarget) => {
    if (target.allMatching) {
      const except = new Set(target.allMatching.except);
      return matching(target.allMatching.query).filter(
        (asset) => !except.has(asset.id),
      );
    }
    const ids = target.assetIds ?? [];
    return assets.filter((asset) => ids.includes(asset.id));
  };

  return {
    async listAssets(args) {
      const query = args?.query;
      const filtered = matching(query);
      filtered.sort(
        compareAssets(
          query?.sortBy ?? 'createdAt',
          query?.sortDirection ?? 'desc',
        ),
      );
      const offset = Number(query?.cursor ?? query?.offset ?? 0);
      const limit = query?.limit ?? PAGE_SIZE_FALLBACK;
      const page = filtered.slice(offset, offset + limit);
      const hasMore = offset + page.length < filtered.length;
      return {
        assets: page,
        total: filtered.length,
        hasMore,
        nextCursor: hasMore ? String(offset + page.length) : null,
      };
    },
    async listFolders(args) {
      const parentId = args?.query?.parentFolderId ?? null;
      return {
        folders: folders
          .filter((folder) => folder.parentId === parentId)
          .map((folder) => ({
            ...folder,
            folderCount: folders.filter((child) => child.parentId === folder.id)
              .length,
            assetCount: assets.filter(
              (asset) =>
                asset.folderId === folder.id && asset.status !== 'archived',
            ).length,
          })),
      };
    },
    async getFolderPath({ query }) {
      const path: MediaFolder[] = [];
      let current = folders.find((folder) => folder.id === query.folderId);
      while (current) {
        path.unshift(current);
        const parentId: string | null = current.parentId;
        current = folders.find((folder) => folder.id === parentId);
      }
      return { path };
    },
    async renameFolder({ body }) {
      const folder = folders.find((entry) => entry.id === body.folderId);
      if (!folder) throw { code: 'FOLDER_NOT_FOUND' };
      if (
        folders.some(
          (entry) =>
            entry.parentId === folder.parentId &&
            entry.name === body.name &&
            entry.id !== folder.id,
        )
      ) {
        throw { code: 'FOLDER_NAME_TAKEN' };
      }
      folder.name = body.name;
      return { folder };
    },
    async restoreAssets({ body }) {
      const restoredIds: string[] = [];
      for (const asset of assets.filter((entry) =>
        body.assetIds?.includes(entry.id),
      )) {
        if (asset.status === 'archived') {
          asset.status = 'private';
          restoredIds.push(asset.id);
        }
      }
      return { restoredIds, skipped: [] };
    },
    async createFolder({ body }) {
      const folder: MediaFolder = {
        id: `folder-${Date.now().toString(36)}`,
        name: body.name,
        parentId: body.parentFolderId ?? null,
      };
      folders.push(folder);
      return { folder };
    },
    async moveAssets({ body }) {
      const movedIds: string[] = [];
      for (const asset of byIds(body)) {
        asset.folderId = body.folderId;
        movedIds.push(asset.id);
      }
      return { moved: movedIds.length, movedIds, skipped: [] };
    },
    async archiveAssets({ body }) {
      const archivedIds: string[] = [];
      const skipped: string[] = [];
      for (const asset of byIds(body)) {
        if (inUse.has(asset.id)) {
          skipped.push(asset.id);
          continue;
        }
        asset.status = 'archived';
        archivedIds.push(asset.id);
      }
      return { archived: archivedIds.length, archivedIds, skipped };
    },
    async updateAssetsStatus({ body }) {
      const updatedIds: string[] = [];
      for (const asset of byIds(body)) {
        asset.status = body.status;
        updatedIds.push(asset.id);
      }
      return { updated: updatedIds.length, updatedIds, skipped: [] };
    },
    async updateAsset({ body }) {
      const asset = assets.find((a) => a.id === body.assetId);
      if (!asset) throw { body: { code: 'ASSET_NOT_FOUND' } };
      if (String(asset.updatedAt) !== body.expectedUpdatedAt) {
        throw { body: { code: 'ASSET_CONFLICT', data: { asset } } };
      }
      const { metadata, ...rest } = body.patch;
      Object.assign(asset, rest, {
        metadata: mergeMetadata(asset.metadata ?? {}, metadata ?? {}),
        updatedAt: new Date().toISOString(),
      });
      return { asset: structuredClone(asset) };
    },
    async setFocalPoint({ body }) {
      const asset = assets.find((a) => a.id === body.assetId);
      if (!asset) throw { body: { code: 'ASSET_NOT_FOUND' } };
      asset.metadata = mergeMetadata(asset.metadata ?? {}, {
        focal: body.focal,
      });
      asset.updatedAt = new Date().toISOString();
      return { asset: structuredClone(asset) };
    },
    async purgeAssets({ body }) {
      const purgedIds = assets
        .filter((asset) => body.assetIds.includes(asset.id))
        .map((asset) => asset.id);
      for (const id of purgedIds) {
        assets.splice(
          assets.findIndex((asset) => asset.id === id),
          1,
        );
      }
      return {
        purgedIds,
        skipped: body.assetIds
          .filter((id) => !purgedIds.includes(id))
          .map((id) => ({ id, reason: 'ASSET_NOT_FOUND' })),
        objectsDeleted: purgedIds.length,
        danglingUsages: [],
      };
    },
    async listRevisions() {
      return { revisions: [] };
    },
    async downloadIntent({ body }) {
      const items = assets
        .filter((asset) => body.assetIds.includes(asset.id))
        .map((asset) => ({
          id: asset.id,
          url: asset.deliveryUrl,
          size: asset.size,
          name: asset.originalName ?? asset.slug,
        }));
      return {
        items,
        skipped: body.assetIds.filter((id) => !items.some((i) => i.id === id)),
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      };
    },
    useUploadAssets: idleUploadState,
  };
}

/** `patch` merged key by key into `base`; `null` removes a key. */
function mergeMetadata(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete out[key];
    else if (
      typeof value === 'object' &&
      !Array.isArray(value) &&
      typeof out[key] === 'object' &&
      out[key] !== null
    ) {
      out[key] = mergeMetadata(
        out[key] as Record<string, unknown>,
        value as Record<string, unknown>,
      );
    } else out[key] = value;
  }
  return out;
}

/** The one client the demo media page uses, so its mutations survive remounts. */
export const demoMedia = demoMediaClient();
