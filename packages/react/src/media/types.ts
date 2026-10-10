import type {
  CmsAssetListItem,
  CmsAssetListQuery,
  CmsAssetListResult,
  CmsMediaUploadFileState,
  CmsMediaUploadState,
} from '../editor/cms/types';

export type MediaAsset = CmsAssetListItem;

export type MediaFolder = {
  id: string;
  name: string;
  parentId: string | null;
};

export type MediaUploadState = CmsMediaUploadState;
export type MediaUploadEntry = CmsMediaUploadFileState;
export type MediaUploadedAsset = {
  id: string;
  slug: string;
  objectKey: string;
};

/** Ids the server changed and ids it skipped (in use, archived or out of scope). */
export type MediaBulkResult = { ids: string[]; skipped: string[] };

export type MediaAssetStatus = 'private' | 'public';
export type MediaSortBy = 'createdAt' | 'slug' | 'size';
export type MediaSortDirection = 'asc' | 'desc';

/**
 * The media surface of a createcms React client (`cmsClient.media`), with
 * the live proxy envelope (`{ query }` / `{ body }`). `useUploadAssets` is a
 * hook; `Media.Root` calls it on every render.
 */
export type MediaClient = {
  listAssets(args?: { query?: CmsAssetListQuery }): Promise<CmsAssetListResult>;
  listFolders(args?: {
    query?: { parentFolderId?: string };
  }): Promise<{ folders: MediaFolder[] }>;
  createFolder(args: {
    body: { name: string; parentFolderId?: string };
  }): Promise<{ folder: MediaFolder }>;
  moveAssets(args: {
    body: { assetIds: string[]; folderId: string | null };
  }): Promise<{ moved: number; movedIds: string[]; skipped: string[] }>;
  archiveAssets(args: {
    body: { assetIds: string[] };
  }): Promise<{ archived: number; archivedIds: string[]; skipped: string[] }>;
  updateAssetsStatus(args: {
    body: { assetIds: string[]; status: MediaAssetStatus };
  }): Promise<{ updated: number; updatedIds: string[]; skipped: string[] }>;
  useUploadAssets(): MediaUploadState;
};

export type MediaSelectionMode = 'none' | 'single' | 'multiple';

export type MediaListStatus = 'idle' | 'loading' | 'loadingMore' | 'error';

export type MediaMutationState = {
  status: 'idle' | 'pending' | 'error';
  error: unknown;
  skipped: string[];
};

export type MediaLibraryState = {
  /** `null` is the root level (unfiled assets). */
  folderId: string | null;
  /** Folders between the root and the current folder, root excluded, current folder last. */
  path: MediaFolder[];
  folders: MediaFolder[];
  assets: MediaAsset[];
  total: number;
  nextCursor: string | null;
  search: string;
  sortBy: MediaSortBy;
  sortDirection: MediaSortDirection;
  /** List state: `load`, `loadMore` and `refresh` only. */
  status: MediaListStatus;
  /** The error of the last failed list request; `null` while `status !== 'error'`. */
  error: unknown;
  mutation: MediaMutationState;
  /** Selected asset ids in selection order. */
  selected: string[];
};
