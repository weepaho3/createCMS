import type {
  BlockProperty,
  BlockTreeNode,
  LinkValue,
  ResolvedLink,
  ResolvedReference,
} from '@createcms/schema';
import type { ReactNode } from 'react';

import type { CmsDocumentError } from './errors';

export type { CmsDocumentError, CmsFieldError } from './errors';

export type CmsDocumentStatus =
  | 'loading'
  | 'idle'
  | 'saving'
  | 'conflict'
  | 'error';

export type CmsDocumentClient = {
  getBlockTree(args: {
    query: {
      rootId: string;
      branchId: string;
      raw?: boolean;
      includeReferencePreviews?: boolean;
    };
  }): Promise<{
    tree: BlockTreeNode;
    reconstructed?: boolean;
    references?: Record<string, BlockTreeNode>;
  }>;
  getBranch(args: {
    query: { branchId: string } | { rootId: string; name: string };
  }): Promise<{ headCommitId: string }>;
  updateBlocks(args: {
    body: {
      rootId: string;
      branchId: string;
      tree: BlockTreeNode;
      message?: string;
      expectedHeadCommitId?: string;
    };
  }): Promise<{ commit: { id: string }; changed?: boolean }>;
  resolveTree(args: {
    body: {
      rootId: string;
      branchId: string;
      tree: BlockTreeNode;
      includeReferencePreviews?: boolean;
    };
  }): Promise<{
    tree: BlockTreeNode;
    references?: Record<string, BlockTreeNode>;
  }>;
};

export type CmsTemplatesClient = {
  getTemplateDefaults(args: {
    query: { collection: string; blockType: string };
  }): Promise<{ defaults: Record<string, string> }>;
};

export type CmsDocumentResolve = {
  reference?: (
    rootId: string,
    spec: BlockProperty,
  ) => ResolvedReference | Promise<ResolvedReference> | undefined;
  link?: (
    value: LinkValue,
    spec: BlockProperty,
  ) => ResolvedLink | Promise<ResolvedLink> | undefined;
  string?: (
    value: string,
    spec: BlockProperty,
  ) => string | Promise<string> | undefined;
};

export type UseCmsDocumentOptions = {
  client: CmsDocumentClient;
  rootId: string;
  branchId: string;
  message?: () => string | undefined;
  includeReferencePreviews?: boolean;
  templates?: CmsTemplatesClient;
  collection?: string;
};

export type UseCmsDocumentResult = {
  tree: BlockTreeNode | null;
  key: string;
  headCommitId: string | null;
  resolve: CmsDocumentResolve;
  status: CmsDocumentStatus;
  error: CmsDocumentError | null;
  save: {
    (
      tree: BlockTreeNode,
      meta?: { message?: string; force?: boolean },
    ): Promise<void>;
    (force: { force: true }): Promise<void>;
  };
  reload: () => Promise<void>;
  onChange: (change: { getTree: () => BlockTreeNode }) => void;
  onAdd: (blockType: string) => Promise<Record<string, unknown>>;
};

export type CmsAssetListQuery = {
  folderId?: string;
  unfiled?: boolean;
  status?: 'private' | 'public';
  search?: string;
  limit?: number;
  offset?: number;
  cursor?: string;
  sortBy?: 'createdAt' | 'slug' | 'size';
  sortDirection?: 'asc' | 'desc';
};

export type CmsAssetListItem = {
  id: string;
  slug: string;
  mimeType: string;
  size: number;
  objectKey: string;
  /** Direct bucket URL; `null` for private assets. */
  url: string | null;
  /** The asset gate path; works for every asset. */
  deliveryUrl: string;
  status: string;
  /** The file name as uploaded. */
  originalName?: string | null;
  width?: number | null;
  height?: number | null;
  provenance?: 'unknown' | 'captured' | 'ai_generated' | 'ai_edited';
  /** `AssetMetadata` from `@createcms/core`. */
  metadata?: Record<string, unknown>;
  /** Live variants, read instead of guessing sizes. */
  variants?: {
    variantKey: string;
    width: number | null;
    height: number | null;
    size: number;
  }[];
  folderId: string | null;
  variantOf: string | null;
  uploadedBy: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type CmsAssetListResult = {
  assets: CmsAssetListItem[];
  total: number;
  hasMore: boolean;
  nextCursor: string | null;
};

export type CmsRootListQuery = {
  limit?: number;
  offset?: number;
  search?: string;
  searchField?: string;
  sortBy?: string;
  sortDirection?: 'asc' | 'desc';
  filterField?: string;
  filterValue?: string;
  hasPublications?: boolean;
  createdAfter?: Date | string;
  createdBefore?: Date | string;
  parentRootId?: string;
};

export type CmsRootListItem = {
  id: string;
  slug?: string;
  path?: string;
  properties: Record<string, unknown>;
};

export type CmsRootListResult = {
  roots: CmsRootListItem[];
  total: number;
  hasMore: boolean;
};

export type CmsVariableListItem = {
  key: string;
  value: string;
  description?: string | null;
};

export type CmsVariableListQuery = {
  limit?: number;
  offset?: number;
  search?: string;
};

export type CmsVariableListResult = {
  variables: CmsVariableListItem[];
  total: number;
  hasMore: boolean;
};

/**
 * Where an upload stands. Active: `queued`, `preparing`, `signing`,
 * `uploading`, `completing`, `retrying`. Waiting: `paused`. Final:
 * `success`, `error`, `aborted`.
 */
export type CmsMediaUploadStatus =
  | 'queued'
  | 'preparing'
  | 'signing'
  | 'uploading'
  | 'completing'
  | 'success'
  | 'paused'
  | 'retrying'
  | 'error'
  | 'aborted';

export type CmsMediaUploadPhase =
  | 'hashing'
  | 'optimizing'
  | 'finalizing'
  | 'processing'
  | 'renditions'
  | null;

export type CmsMediaUploadFileState = {
  id: string;
  kind: 'create' | 'replace' | 'rendition';
  /** The entry a `rendition` entry belongs to. */
  parentId?: string;
  /** The variant a `rendition` entry produces, e.g. `w640.webp`. */
  variantKey?: string;
  file: File;
  name: string;
  size: number;
  type: string;
  status: CmsMediaUploadStatus;
  phase: CmsMediaUploadPhase;
  loaded: number;
  total: number;
  /** 0..1; at most 0.99 until `success`. */
  progress: number;
  attempt: number;
  nextRetryAt: number | null;
  folderId: string | null;
  targetAssetId?: string;
  sha256?: string;
  duplicateOf?: { assetId: string; folderId: string | null }[];
  error?: {
    code: string;
    message: string;
    retryable: boolean;
    timedOut?: boolean;
  };
  optimize?: {
    optimized: boolean;
    bytesBefore: number;
    bytesAfter: number;
    warnings: { code: string; message: string }[];
  };
  result?: { id: string; slug: string; objectKey: string };
};

export type CmsMediaUploadProgress = {
  loaded: number;
  total: number;
  fraction: number;
  bytesPerSecond: number | null;
  /** Seconds left; `null` early in a transfer or while stalled. */
  eta: number | null;
};

export type CmsMediaUploadOptions = {
  folderId?: string;
  signal?: AbortSignal;
  optimize?: boolean;
  dedupe?: boolean;
};

export type CmsMediaDuplicateDecision =
  | { action: 'use-existing'; assetId: string }
  | { action: 'upload-copy' }
  | { action: 'replace'; assetId: string };

export type CmsMediaUploadState = {
  isUploading: boolean;
  files: CmsMediaUploadFileState[];
  progress: CmsMediaUploadProgress;
  error: unknown;
  budget: number;
  upload: (
    files: File[],
    options?: CmsMediaUploadOptions,
  ) => Promise<CmsMediaUploadFileState[]>;
  replace: (
    assetId: string,
    file: File,
    options?: Pick<CmsMediaUploadOptions, 'signal' | 'optimize'> & {
      revisionNote?: string;
    },
  ) => Promise<CmsMediaUploadFileState>;
  abort: (id?: string) => void;
  retry: (id?: string) => void;
  pause: (id?: string) => void;
  resume: (id?: string) => void;
  resolveDuplicate: (id: string, decision: CmsMediaDuplicateDecision) => void;
  regenerateRenditions: (assetId: string) => Promise<CmsMediaUploadFileState[]>;
  reset: () => void;
};

export type CmsMediaClient = {
  listAssets(args?: { query?: CmsAssetListQuery }): Promise<CmsAssetListResult>;
  getAssets(args: { query: { ids: string[] } }): Promise<{
    assets: CmsAssetListItem[];
  }>;
  useUploadAssets?(): CmsMediaUploadState;
};

export type CmsVariablesClient = {
  list(args?: { query?: CmsVariableListQuery }): Promise<CmsVariableListResult>;
};

export type CmsCollectionRootsClient = {
  listRoots(args?: { query?: CmsRootListQuery }): Promise<CmsRootListResult>;
  getRoot(args: { query: { rootId: string } }): Promise<CmsRootListItem>;
  getRootBySlug(args: {
    query: { slug: string; parentRootId?: string };
  }): Promise<CmsRootListItem>;
};

export type UseCmsFieldSourcesClient = {
  media: CmsMediaClient;
  variables: CmsVariablesClient;
  templates?: CmsTemplatesClient;
};

export type CmsFieldSources = {
  assets: {
    list(query?: CmsAssetListQuery): Promise<CmsAssetListResult>;
    get(ids: string[]): Promise<CmsAssetListItem[]>;
    useUpload(): CmsMediaUploadState;
  };
  roots: {
    list(
      collection: string,
      query?: CmsRootListQuery,
    ): Promise<CmsRootListResult>;
    get(collection: string, rootId: string): Promise<CmsRootListItem>;
    bySlug(
      collection: string,
      slug: string,
      parentRootId?: string,
    ): Promise<CmsRootListItem>;
  };
  variables: {
    list(query?: CmsVariableListQuery): Promise<CmsVariableListResult>;
  };
  templates: {
    defaults(
      collection: string,
      blockType: string,
    ): Promise<Record<string, string>>;
  };
};

export type CmsSuggestItem = {
  insertText: string;
  [key: string]: unknown;
};

export type CmsSuggestRenderContext = {
  items: CmsSuggestItem[];
  highlighted: number;
  query: string;
  rect: DOMRect;
  accept: (index: number) => void;
};

export type CmsVariableSuggest = {
  pattern: RegExp;
  getItems: (query: string) => CmsSuggestItem[];
  render: (ctx: CmsSuggestRenderContext) => ReactNode;
};
