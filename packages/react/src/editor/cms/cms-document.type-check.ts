/**
 * Compile-time guarantees for useCmsDocument client duck-typing. Ships nothing
 * (no entry imports it) but is covered by `tsc --noEmit`.
 */
import type { BlockTreeNode } from '@createcms/schema';

import type { UseCmsDocumentOptions } from './types';

type PagesTree = BlockTreeNode & { type: 'root' | 'hero' | 'section' };
type EmailsTree = BlockTreeNode & { type: 'root' | 'banner' };

type PagesClient = {
  getBlockTree(args: {
    query: {
      rootId: string;
      branchId: string;
      raw?: boolean;
      includeReferencePreviews?: boolean;
    };
  }): Promise<{ tree: PagesTree; references?: Record<string, PagesTree> }>;
  getBranch(args: {
    query: { branchId: string } | { rootId: string; name: string };
  }): Promise<{ headCommitId: string }>;
  updateBlocks(args: {
    body: {
      rootId: string;
      branchId: string;
      tree: PagesTree;
      message?: string;
      expectedHeadCommitId?: string;
    };
  }): Promise<{ commit: { id: string } }>;
  resolveTree(args: {
    body: {
      rootId: string;
      branchId: string;
      tree: PagesTree;
      includeReferencePreviews?: boolean;
    };
  }): Promise<{ tree: PagesTree; references?: Record<string, PagesTree> }>;
};

type EmailsClient = {
  getBlockTree(args: {
    query: {
      rootId: string;
      branchId: string;
      raw?: boolean;
      includeReferencePreviews?: boolean;
    };
  }): Promise<{ tree: EmailsTree; references?: Record<string, EmailsTree> }>;
  getBranch(args: {
    query: { branchId: string } | { rootId: string; name: string };
  }): Promise<{ headCommitId: string }>;
  updateBlocks(args: {
    body: {
      rootId: string;
      branchId: string;
      tree: EmailsTree;
      message?: string;
      expectedHeadCommitId?: string;
    };
  }): Promise<{ commit: { id: string } }>;
  resolveTree(args: {
    body: {
      rootId: string;
      branchId: string;
      tree: EmailsTree;
      includeReferencePreviews?: boolean;
    };
  }): Promise<{ tree: EmailsTree; references?: Record<string, EmailsTree> }>;
};

declare const unionClient: PagesClient | EmailsClient;
const unionOpts: UseCmsDocumentOptions = {
  client: unionClient,
  rootId: 'r',
  branchId: 'b',
};
void unionOpts;

type MissingBranchClient = {
  getBlockTree(args: {
    query: { rootId: string; branchId: string };
  }): Promise<{ tree: BlockTreeNode }>;
  updateBlocks(args: {
    body: {
      rootId: string;
      branchId: string;
      tree: BlockTreeNode;
    };
  }): Promise<{ commit: { id: string } }>;
  resolveTree(args: {
    body: {
      rootId: string;
      branchId: string;
      tree: BlockTreeNode;
    };
  }): Promise<{ tree: BlockTreeNode }>;
};
declare const missingBranch: MissingBranchClient;
const badOpts: UseCmsDocumentOptions = {
  // @ts-expect-error - getBranch is required
  client: missingBranch,
  rootId: 'r',
  branchId: 'b',
};
void badOpts;

declare const doc: import('./types').UseCmsDocumentResult;
declare const onSave: (
  tree: BlockTreeNode,
  meta?: { message?: string },
) => void | Promise<void>;
const savePin: typeof onSave = doc.save;
void savePin;
