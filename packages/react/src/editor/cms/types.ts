import type {
  BlockProperty,
  BlockTreeNode,
  LinkValue,
  ResolvedLink,
  ResolvedReference,
} from '@createcms/schema';

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
