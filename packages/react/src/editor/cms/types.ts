import type {
  AnyCollectionDefinition,
  BlockTreeNode,
  ResolvedLink,
  ResolvedReference,
} from '@createcms/schema';
import type { ReactNode } from 'react';

import type { EditorDocument, Field, PersistenceOptions } from '../core';
import type { CmsDocumentError } from './errors';

export type { CmsDocumentError, CmsFieldError } from './errors';

/** Load state of `useCmsDocument`; save state lives in the editor store (`useSave`). */
export type CmsDocumentStatus = 'loading' | 'idle' | 'error';

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

/**
 * Display resolvers per field kind for `Canvas.Root`'s `resolve`:
 * references from the `getBlockTree` sidecar or `resolveTree`, links to
 * their current href, `{{variables}}` in text filled in.
 */
export type CmsDocumentResolve = {
  reference: (
    value: unknown,
    spec: Field,
  ) => ResolvedReference | Promise<ResolvedReference | undefined> | undefined;
  link: (
    value: unknown,
    spec: Field,
  ) => ResolvedLink | Promise<ResolvedLink | undefined> | undefined;
  text: (value: unknown, spec: Field) => string | Promise<string> | undefined;
  textarea: (
    value: unknown,
    spec: Field,
  ) => string | Promise<string> | undefined;
  richText: (
    value: unknown,
    spec: Field,
  ) => string | Promise<string> | undefined;
};

export type UseCmsDocumentOptions = {
  client: CmsDocumentClient;
  /** The collection definition of the document; maps trees to editor documents. */
  definition: AnyCollectionDefinition;
  rootId: string;
  branchId: string;
  /** The commit message of each save (a save's own `message` wins). */
  message?: () => string | undefined;
  /** Saves on their own after edits (each save is a commit). Default `false`. */
  autosave?: PersistenceOptions['autosave'];
  includeReferencePreviews?: boolean;
  templates?: CmsTemplatesClient;
  /** Collection name for `templates.getTemplateDefaults`. */
  collection?: string;
};

export type UseCmsDocumentResult = {
  /** The loaded document in editor shape, `null` while loading. */
  doc: EditorDocument | null;
  key: string;
  headCommitId: string | null;
  resolve: CmsDocumentResolve;
  status: CmsDocumentStatus;
  /** The last load failure. */
  error: CmsDocumentError | null;
  /** Pass to `Editor.Root`: saves through `updateBlocks` with the loaded head as base. */
  persistence: PersistenceOptions;
  reload: () => Promise<void>;
  onChange: (change: { getDocument: () => EditorDocument }) => void;
  /** Template defaults for a new block of `blockType`, in editor shape. */
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

export type CmsMediaUploadStatus =
  | 'pending'
  | 'uploading'
  | 'success'
  | 'error'
  | 'aborted';

export type CmsMediaUploadFileState = {
  id: string;
  file: File;
  name: string;
  size: number;
  type: string;
  status: CmsMediaUploadStatus;
  loaded: number;
  total: number;
  /** 0..1 */
  progress: number;
  error?: { code: string; message: string };
  optimized?: boolean;
  originalVariantId?: string;
  result?: { id: string; slug: string; objectKey: string };
};

export type CmsMediaUploadProgress = {
  loaded: number;
  total: number;
  fraction: number;
};

export type CmsMediaUploadState = {
  isUploading: boolean;
  files: CmsMediaUploadFileState[];
  progress: CmsMediaUploadProgress;
  error: unknown;
  upload: (
    files: File[],
    options?: { folderId?: string; concurrency?: number; signal?: AbortSignal },
  ) => Promise<CmsMediaUploadFileState[]>;
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
