'use client';

import type {
  CmsAssetListItem,
  CmsMediaUploadState,
} from '@createcms/react/editor/cms';
import type { MediaClient, MediaFolder } from '@createcms/react/media';

import { DEMO_ASSETS } from '@/app/demo/_lib/assets';

function idleUploadState(): CmsMediaUploadState {
  return {
    isUploading: false,
    files: [],
    progress: { loaded: 0, total: 0, fraction: 0 },
    error: undefined,
    upload: async () => [],
    abort: () => {},
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
    url: '/demo/brand-guide.pdf',
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
    url: '/demo/intro-clip.mp4',
    status: 'private',
    folderId: null,
    variantOf: null,
    uploadedBy: null,
    createdAt: '2026-02-03T00:00:00.000Z',
    updatedAt: '2026-02-03T00:00:00.000Z',
  },
];

const PAGE_SIZE_FALLBACK = 40;

function compareAssets(
  sortBy: 'createdAt' | 'slug' | 'size',
  direction: 'asc' | 'desc',
) {
  const sign = direction === 'asc' ? 1 : -1;
  return (a: CmsAssetListItem, b: CmsAssetListItem): number => {
    switch (sortBy) {
      case 'slug':
        return sign * a.slug.localeCompare(b.slug);
      case 'size':
        return sign * (a.size - b.size);
      case 'createdAt':
        return sign * String(a.createdAt).localeCompare(String(b.createdAt));
    }
  };
}

/**
 * In-memory `MediaClient` for the media demo: folders, asset status and
 * folder membership live in the closure; `brand-guide` counts as in use, so
 * archiving it reports it under `skipped`. Uploads stay idle.
 */
export function demoMediaClient(): MediaClient {
  const folders = structuredClone(DEMO_FOLDERS);
  const assets = structuredClone([...DEMO_ASSETS, ...EXTRA_ASSETS]);
  const inUse = new Set(['brand-guide']);

  const byIds = (ids: string[]) =>
    assets.filter((asset) => ids.includes(asset.id));

  return {
    async listAssets(args) {
      const query = args?.query;
      const search = query?.search?.toLowerCase();
      let filtered = assets.filter((asset) => asset.status !== 'archived');
      if (query?.folderId) {
        filtered = filtered.filter(
          (asset) => asset.folderId === query.folderId,
        );
      } else if (query?.unfiled) {
        filtered = filtered.filter((asset) => asset.folderId === null);
      }
      if (search) {
        filtered = filtered.filter(
          (asset) =>
            asset.id.toLowerCase().includes(search) ||
            asset.slug.toLowerCase().includes(search),
        );
      }
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
        folders: folders.filter((folder) => folder.parentId === parentId),
      };
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
      for (const asset of byIds(body.assetIds)) {
        asset.folderId = body.folderId;
        movedIds.push(asset.id);
      }
      return { moved: movedIds.length, movedIds, skipped: [] };
    },
    async archiveAssets({ body }) {
      const archivedIds: string[] = [];
      const skipped: string[] = [];
      for (const asset of byIds(body.assetIds)) {
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
      for (const asset of byIds(body.assetIds)) {
        asset.status = body.status;
        updatedIds.push(asset.id);
      }
      return { updated: updatedIds.length, updatedIds, skipped: [] };
    },
    useUploadAssets: idleUploadState,
  };
}

/** The one client the demo media page uses, so its mutations survive remounts. */
export const demoMedia = demoMediaClient();
