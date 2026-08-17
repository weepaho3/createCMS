'use client';

import type {
  CmsAssetListQuery,
  CmsFieldSources,
  CmsMediaUploadState,
  CmsRootListQuery,
  CmsVariableListQuery,
} from '@createcms/react/editor/cms';

import { DEMO_ASSETS } from '@/app/demo/_lib/assets';

function idleUploadState(): CmsMediaUploadState {
  return {
    isUploading: false,
    isAborted: false,
    files: [],
    totalProgress: 0,
    error: undefined,
    upload: async () => {},
    abort: () => {},
    reset: () => {},
  };
}

export function useDemoFieldSources(): CmsFieldSources {
  return {
    assets: {
      async list(query?: CmsAssetListQuery) {
        const search = query?.search?.toLowerCase();
        const filtered = search
          ? DEMO_ASSETS.filter(
              (item) =>
                item.id.toLowerCase().includes(search) ||
                item.slug.toLowerCase().includes(search),
            )
          : DEMO_ASSETS;
        const offset = query?.offset ?? 0;
        const limit = query?.limit ?? filtered.length;
        const assets = filtered.slice(offset, offset + limit);
        return {
          assets,
          total: filtered.length,
          hasMore: false,
          nextCursor: null,
        };
      },
      async get(ids: string[]) {
        return DEMO_ASSETS.filter((item) => ids.includes(item.id));
      },
      useUpload: idleUploadState,
    },
    roots: {
      async list(_collection: string, _query?: CmsRootListQuery) {
        return { roots: [], total: 0, hasMore: false };
      },
      async get(_collection: string, _rootId: string) {
        throw new Error('demo has no roots');
      },
      async bySlug(_collection: string, _slug: string, _parentRootId?: string) {
        throw new Error('demo has no roots');
      },
    },
    variables: {
      async list(_query?: CmsVariableListQuery) {
        return { variables: [], total: 0, hasMore: false };
      },
    },
    templates: {
      async defaults(_collection: string, _blockType: string) {
        return {};
      },
    },
  };
}
