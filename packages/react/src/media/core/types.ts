import type {
  CmsAssetListItem,
  CmsMediaUploadFileState,
  CmsMediaUploadState,
} from '../../editor/cms/types';
import type { FilterState } from './filter';
import type { FolderRecord } from './folders';

export type MediaAsset = CmsAssetListItem;

export type MediaUsageScope = 'live' | 'published' | 'history';

/** An earlier version of an asset's bytes (`listRevisions`). */
export type MediaRevision = {
  id: string;
  originalName: string;
  mimeType?: string;
  size: number;
  width?: number | null;
  height?: number | null;
  note: string | null;
  uploadedBy?: string | null;
  createdAt: Date | string;
};

export type MediaUsageOccurrence = {
  branchId: string | null;
  branchName: string | null;
  blockId: string;
  propertyKey: string;
  /** JSON pointer inside the block's properties. */
  path: string;
  matchedBy: string;
  altState: string | null;
  revisionId: string | null;
};

export type MediaUsageItem = {
  rootId: string;
  collection: string;
  title: string;
  storedSlug: string | null;
  status: 'published' | 'scheduled' | 'draft';
  via: { rootId: string; title: string } | null;
  occurrences: MediaUsageOccurrence[];
};

export type MediaUsagePage = {
  total: { roots: number; occurrences: number; hiddenRoots: number };
  items: MediaUsageItem[];
  nextCursor: string | null;
};

export type MediaFolder = FolderRecord;

export type MediaUploadState = CmsMediaUploadState;
export type MediaUploadEntry = CmsMediaUploadFileState;
export type MediaUploadedAsset = {
  id: string;
  slug: string;
  objectKey: string;
};

export type MediaAssetStatus = 'private' | 'public';
export type MediaSortBy =
  | 'createdAt'
  | 'slug'
  | 'size'
  | 'originalName'
  | 'updatedAt'
  | 'width';
export type MediaSortDirection = 'asc' | 'desc';

/** The `listAssets` filter parameters (`FilterState` in wire form). */
export type MediaAssetFilterQuery = {
  folderId?: string;
  unfiled?: boolean;
  recursive?: boolean;
  status?: MediaAssetStatus;
  search?: string;
  q?: string;
  kinds?: string;
  mime?: string;
  provenance?: string;
  visibility?: string;
  uploadedBy?: string;
  createdFrom?: string;
  createdTo?: string;
  sizeMin?: number;
  sizeMax?: number;
  widthMin?: number;
  heightMin?: number;
  orientation?: 'landscape' | 'portrait' | 'square';
  usage?: 'used' | 'unused';
  usageScope?: 'live' | 'published';
  missingAlt?: boolean;
  expiringWithinDays?: number;
  archived?: boolean;
};

export type MediaAssetListQuery = MediaAssetFilterQuery & {
  limit?: number;
  offset?: number;
  cursor?: string;
  sortBy?: MediaSortBy;
  sortDirection?: MediaSortDirection;
  /** `false` skips the count; `total` is then `null`. */
  includeTotal?: boolean;
};

export type MediaAssetListResult = {
  assets: MediaAsset[];
  total: number | null;
  hasMore: boolean;
  nextCursor: string | null;
};

/** Every asset matching a filter on the server, minus `except`. */
export type MediaAllMatching = {
  query: MediaAssetFilterQuery;
  except: string[];
};

/** Bulk endpoints take explicit ids or a server-side selection (one of the two). */
export type MediaBulkTarget = {
  assetIds?: string[];
  allMatching?: MediaAllMatching;
};

export type MediaFacets = {
  kinds: Record<string, number>;
  provenance: Record<string, number>;
  visibility: Record<string, number>;
};

/** Server events the store reconciles (from `media.*` realtime events). */
export type MediaServerEvent =
  | {
      type:
        | 'media.asset.created'
        | 'media.asset.updated'
        | 'media.asset.replaced'
        | 'media.asset.archived'
        | 'media.asset.restored'
        | 'media.asset.purged'
        | 'media.rendition.created';
      assetId: string;
      revisionId?: string;
    }
  | {
      type:
        | 'media.folder.created'
        | 'media.folder.renamed'
        | 'media.folder.moved'
        | 'media.folder.deleted';
      folderId: string;
    };

type Signal = { signal?: AbortSignal };

/**
 * The media surface of a createcms React client (`cmsClient.media`), with
 * the live proxy envelope (`{ query }` / `{ body }`). Optional methods let a
 * smaller backend fit; the parts that need one check for it.
 */
export type MediaClient = {
  listAssets(
    args?: { query?: MediaAssetListQuery } & Signal,
  ): Promise<MediaAssetListResult>;
  listFolders(args?: {
    query?: { parentFolderId?: string };
  }): Promise<{ folders: MediaFolder[] }>;
  createFolder(args: {
    body: { name: string; parentFolderId?: string };
  }): Promise<{ folder: MediaFolder }>;
  moveAssets(args: {
    body: MediaBulkTarget & { folderId: string | null };
  }): Promise<{ moved: number; movedIds: string[]; skipped: string[] }>;
  archiveAssets(args: {
    body: MediaBulkTarget & { force?: boolean };
  }): Promise<{
    archived: number;
    archivedIds: string[];
    skipped: string[];
    skippedReasons?: Record<string, string>;
  }>;
  updateAssetsStatus(args: {
    body: MediaBulkTarget & { status: MediaAssetStatus };
  }): Promise<{ updated: number; updatedIds: string[]; skipped: string[] }>;
  useUploadAssets(): MediaUploadState;

  getAssets?(args: {
    query: { ids: string[] };
  }): Promise<{ assets: MediaAsset[] }>;
  getAssetFacets?(
    args?: { query?: MediaAssetFilterQuery } & Signal,
  ): Promise<MediaFacets>;
  updateAsset?(args: {
    body: {
      assetId: string;
      patch: {
        originalName?: string;
        metadata?: Record<string, unknown>;
        provenance?: MediaAsset['provenance'];
      };
      expectedUpdatedAt: string;
    };
  }): Promise<{ asset: MediaAsset }>;
  restoreAssets?(args: {
    body: MediaBulkTarget;
  }): Promise<{ restoredIds: string[]; skipped: string[] }>;
  renameFolder?(args: {
    body: { folderId: string; name: string };
  }): Promise<{ folder: MediaFolder }>;
  moveFolder?(args: {
    body: { folderId: string; newParentFolderId?: string | null };
  }): Promise<{ folder: MediaFolder }>;
  getFolderPath?(args: {
    query: { folderId: string };
  }): Promise<{ path: MediaFolder[] }>;
  deleteFolder?(args: {
    body: {
      folderId: string;
      mode?: 'empty-only' | 'move-to-parent' | 'archive-contents';
      dryRun?: boolean;
    };
  }): Promise<{
    folderId: string;
    folders: number;
    assets: number;
    assetsInUse: number;
    /** Roots (pages) using the assets in use. */
    pages?: number;
    skipped: string[];
  }>;
  getAssetUsages?(args: {
    query: {
      assetId: string;
      scope?: 'live' | 'published' | 'history';
      branchId?: string;
      collection?: string;
      missingAlt?: 'true' | 'false';
      cursor?: string;
      limit?: number;
    };
  }): Promise<MediaUsagePage>;
  getAssetUsageCounts?(args: {
    body: { assetIds: string[]; scope?: 'live' | 'published' | 'history' };
  }): Promise<{ counts: Record<string, { roots: number; published: number }> }>;
  listRevisions?(args: { query: { assetId: string } }): Promise<{
    revisions: MediaRevision[];
  }>;
  setCurrentRevision?(args: {
    body: { assetId: string; revisionId: string };
  }): Promise<{ asset: MediaAsset }>;
  createSignedReplace?(args: {
    body: {
      assetId: string;
      file: { name: string; size: number; type: string };
    };
  }): Promise<{
    signedUrl: string;
    headers: Record<string, string>;
    token: string;
  }>;
  commitReplace?(args: {
    body: { token: string; revisionNote?: string };
  }): Promise<{ asset: MediaAsset }>;
  setFocalPoint?(args: {
    body: { assetId: string; focal: { x: number; y: number } | null };
  }): Promise<{ asset: MediaAsset }>;
  /** Short-lived signed URLs for downloads, checked per asset. */
  downloadIntent?(args: {
    body: { assetIds: string[]; variantKey?: string; bulkJobId?: string };
  }): Promise<{
    items: { id: string; url: string; size: number; name: string }[];
    skipped: string[];
    expiresAt: string;
  }>;
  /** Server events (`media.*`), e.g. from the realtime client; returns the unsubscribe. */
  subscribe?(onEvent: (event: MediaServerEvent) => void): () => void;
};

export type { FilterState };
