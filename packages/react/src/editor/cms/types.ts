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
  url: string;
  status: string;
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

export type CmsMediaUploadFileState = {
  name: string;
  progress: number;
  status: 'pending' | 'uploading' | 'done' | 'error';
  error?: string;
  optimized?: boolean;
  originalVariantId?: string;
  result?: { id: string; slug: string; objectKey: string };
};

export type CmsMediaUploadState = {
  isUploading: boolean;
  isAborted: boolean;
  files: CmsMediaUploadFileState[];
  totalProgress: number;
  error: unknown;
  upload: (files: File[], options?: { folderId?: string }) => Promise<void>;
  abort: () => void;
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
