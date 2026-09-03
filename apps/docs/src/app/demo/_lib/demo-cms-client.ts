import type { BlockTreeNode } from '@createcms/core';
import type {
  CmsDocumentClient,
  CmsMediaUploadState,
  CmsRootListItem,
  CmsRootListQuery,
  CmsRootListResult,
  UseCmsFieldSourcesClient,
} from '@createcms/react/editor/cms';

import { DEMO_ASSETS } from '@/app/demo/_lib/assets';
import { PAGES_TREE } from '@/app/demo/_lib/pages-tree';

type DemoPagesClient = CmsDocumentClient & {
  listRoots(args?: { query?: CmsRootListQuery }): Promise<CmsRootListResult>;
  getRoot(args: { query: { rootId: string } }): Promise<CmsRootListItem>;
  getRootBySlug(args: {
    query: { slug: string; parentRootId?: string };
  }): Promise<CmsRootListItem>;
};

export type DemoCmsClient = UseCmsFieldSourcesClient & {
  pages: DemoPagesClient;
};

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

function pageRoot(tree: BlockTreeNode) {
  return {
    id: tree.blockId,
    slug: 'home',
    properties: tree.properties ?? {},
  };
}

/** In-memory createCMS client for docs demos. Mutates a cloned tree on save. */
export function createDemoCmsClient(
  initialTree: BlockTreeNode = PAGES_TREE,
): DemoCmsClient {
  let tree = structuredClone(initialTree);
  let headCommitId = 'demo-head';

  const pages: DemoPagesClient = {
    async getBlockTree() {
      return { tree };
    },
    async getBranch() {
      return { headCommitId };
    },
    async updateBlocks({ body }) {
      tree = body.tree;
      headCommitId = `demo-${Date.now()}`;
      return { commit: { id: headCommitId }, changed: true };
    },
    async resolveTree({ body }) {
      return { tree: body.tree };
    },
    async listRoots() {
      const root = pageRoot(tree);
      return { roots: [root], total: 1, hasMore: false };
    },
    async getRoot() {
      return pageRoot(tree);
    },
    async getRootBySlug() {
      return pageRoot(tree);
    },
  };

  return {
    media: {
      async listAssets(args) {
        const query = args?.query;
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
          hasMore: offset + assets.length < filtered.length,
          nextCursor: null,
        };
      },
      async getAssets({ query }) {
        const ids = new Set(query.ids);
        return {
          assets: DEMO_ASSETS.filter((item) => ids.has(item.id)),
        };
      },
      useUploadAssets: idleUploadState,
    },
    variables: {
      async list() {
        return { variables: [], total: 0, hasMore: false };
      },
    },
    templates: {
      async getTemplateDefaults() {
        return { defaults: {} };
      },
    },
    pages,
  };
}
