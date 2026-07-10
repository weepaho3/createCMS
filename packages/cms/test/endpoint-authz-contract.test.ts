import { describe, expect, it } from 'vitest';

import { setupTestCMS } from '../src/test-utils/cms';

/**
 * Pins the endpoint authorization contract: every endpoint's hand-written
 * `{ permissionResource, operation }` metadata (set via `cmsMeta(...)` in the
 * route files) is what a consumer's `authMiddleware` receives
 * (`endpoint.ts` `runUserMiddleware` passes `meta.permissionResource` and
 * `meta.operation` straight into the middleware, which runs BEFORE the
 * handler). A wrong label silently mis-authorizes a privileged action, so
 * this test asserts both labels for EVERY endpoint the built `cms.api`
 * exposes, and a coverage guard fails the moment a new endpoint is added
 * without an entry here.
 *
 * Metadata is reachable directly off the built api: each endpoint's metadata
 * sits at `endpoint.options.metadata.cms` — the factory reads exactly that
 * shape (`factory.ts` lines ~834-844), the endpoint.ts wrapper copies
 * `options` onto the callable (`Object.assign(wrappedHandler, { path,
 * options })`), and better-call's own `createEndpoint` (used directly by the
 * public `media.asset` gate, bypassing the CMS wrapper) does the same
 * (`better-call/dist/endpoint.mjs`: `internalHandler.options = runtimeOptions`).
 * So the same access path (`.options.metadata.cms`) works for every endpoint,
 * wrapped or public.
 */

type Expected = { permissionResource: string | undefined; operation: string };

// ns -> endpoint -> expected labels. Public endpoints (no permissionResource
// declared in source, e.g. media.asset) expect `permissionResource: undefined`.
const EXPECTED: Record<string, Record<string, Expected>> = {
  // `pages` == the test collection name (src/test-utils/fixtures.ts). Merges
  // every collection-scoped endpoint family: approvals, blocks, branches,
  // comments, merges, publications, redirects (routes/collection.ts).
  pages: {
    // routes/approvals.ts
    requestApproval: { permissionResource: 'approval', operation: 'create' },
    submitApproval: { permissionResource: 'approval', operation: 'update' },
    submitRejection: { permissionResource: 'approval', operation: 'update' },
    cancelApproval: { permissionResource: 'approval', operation: 'delete' },
    getApproval: { permissionResource: 'approval', operation: 'read' },
    listApprovals: { permissionResource: 'approval', operation: 'read' },

    // routes/blocks.ts
    createRoot: { permissionResource: 'root', operation: 'create' },
    listRoots: { permissionResource: 'root', operation: 'read' },
    createBlock: { permissionResource: 'block', operation: 'create' },
    getBlockTree: { permissionResource: 'block', operation: 'read' },
    moveBlock: { permissionResource: 'block', operation: 'update' },
    deleteBlock: { permissionResource: 'block', operation: 'delete' },
    duplicateBlock: { permissionResource: 'block', operation: 'create' },
    // Relabeled root:create (was block:create) — duplicateRoot forces root
    // mode (no parent) and mints a NEW top-level root, the same privileged
    // act createRoot guards as 'root'. See Plan 003 Step 3.
    duplicateRoot: { permissionResource: 'root', operation: 'create' },
    updateBlock: { permissionResource: 'block', operation: 'update' },
    updateRoot: { permissionResource: 'root', operation: 'update' },
    updateBlocks: { permissionResource: 'block', operation: 'update' },
    moveRoot: { permissionResource: 'root', operation: 'update' },
    getRoot: { permissionResource: 'root', operation: 'read' },
    getRootBySlug: { permissionResource: 'root', operation: 'read' },
    archiveRoot: { permissionResource: 'root', operation: 'delete' },
    getReferenceUsages: { permissionResource: 'root', operation: 'read' },
    getRootHistory: { permissionResource: 'root', operation: 'read' },

    // routes/branches.ts
    getBranch: { permissionResource: 'branch', operation: 'read' },
    listBranches: { permissionResource: 'branch', operation: 'read' },
    createBranch: { permissionResource: 'branch', operation: 'create' },
    renameBranch: { permissionResource: 'branch', operation: 'update' },
    deleteBranch: { permissionResource: 'branch', operation: 'delete' },
    revertBranch: { permissionResource: 'branch', operation: 'update' },
    checkDivergence: { permissionResource: 'branch', operation: 'read' },

    // routes/comments.ts
    createCommentThread: { permissionResource: 'comment', operation: 'create' },
    createCommentMessage: {
      permissionResource: 'comment',
      operation: 'create',
    },
    listCommentThreads: { permissionResource: 'comment', operation: 'read' },
    getCommentThread: { permissionResource: 'comment', operation: 'read' },
    resolveCommentThread: {
      permissionResource: 'comment',
      operation: 'update',
    },
    deleteCommentThread: {
      permissionResource: 'comment',
      operation: 'delete',
    },
    reopenCommentThread: { permissionResource: 'comment', operation: 'update' },
    updateCommentMessage: {
      permissionResource: 'comment',
      operation: 'update',
    },
    deleteCommentMessage: {
      permissionResource: 'comment',
      operation: 'delete',
    },
    listMentions: { permissionResource: 'comment', operation: 'read' },

    // routes/merges.ts
    getDiff: { permissionResource: 'mergeRequest', operation: 'read' },
    checkConflicts: { permissionResource: 'mergeRequest', operation: 'read' },
    createMergeRequest: {
      permissionResource: 'mergeRequest',
      operation: 'create',
    },
    listMergeRequests: {
      permissionResource: 'mergeRequest',
      operation: 'read',
    },
    updateMergeRequest: {
      permissionResource: 'mergeRequest',
      operation: 'update',
    },
    closeMergeRequest: {
      permissionResource: 'mergeRequest',
      operation: 'update',
    },
    reopenMergeRequest: {
      permissionResource: 'mergeRequest',
      operation: 'update',
    },
    executeMerge: { permissionResource: 'mergeRequest', operation: 'update' },
    createMergeBlockVersion: {
      permissionResource: 'mergeRequest',
      operation: 'create',
    },
    applyConflictResolutions: {
      permissionResource: 'mergeRequest',
      operation: 'update',
    },

    // routes/publications.ts
    publishBranch: { permissionResource: 'publication', operation: 'create' },
    unpublishBranch: {
      permissionResource: 'publication',
      operation: 'delete',
    },
    schedulePublication: {
      permissionResource: 'publication',
      operation: 'create',
    },
    scheduleUnpublish: {
      permissionResource: 'publication',
      operation: 'delete',
    },
    // Public routing endpoint — still carries permissionResource so a
    // consumer's authMiddleware can grant it an anon-read carve-out.
    getPublishedContent: {
      permissionResource: 'publishedContent',
      operation: 'read',
    },
    listPublications: {
      permissionResource: 'publication',
      operation: 'read',
    },

    // routes/redirects.ts
    resolveRedirect: {
      permissionResource: 'publishedContent',
      operation: 'read',
    },
    createRedirect: { permissionResource: 'redirect', operation: 'create' },
    updateRedirect: { permissionResource: 'redirect', operation: 'update' },
    archiveRedirect: { permissionResource: 'redirect', operation: 'delete' },
    listRedirects: { permissionResource: 'redirect', operation: 'read' },
  },

  // routes/media.ts (MEDIA_META spread: permissionResource 'media', scope
  // system, + per-endpoint operation)
  media: {
    createFolder: { permissionResource: 'media', operation: 'create' },
    moveFolder: { permissionResource: 'media', operation: 'update' },
    deleteFolder: { permissionResource: 'media', operation: 'delete' },
    listFolders: { permissionResource: 'media', operation: 'read' },
    listAssets: { permissionResource: 'media', operation: 'read' },
    getAssets: { permissionResource: 'media', operation: 'read' },
    // Public asset redirect, built with better-call's `createEndpoint`
    // directly (not `createCMSEndpoint`) and marked `public: true` — it does
    // its own access control. No `permissionResource` in source.
    asset: { permissionResource: undefined, operation: 'read' },
    updateAssetsStatus: { permissionResource: 'media', operation: 'update' },
    moveAssets: { permissionResource: 'media', operation: 'update' },
    archiveAssets: { permissionResource: 'media', operation: 'delete' },
    getAssetUsages: { permissionResource: 'media', operation: 'read' },
    createSignedUpload: { permissionResource: 'media', operation: 'create' },
    uploadAssets: { permissionResource: 'media', operation: 'create' },
    replaceAsset: { permissionResource: 'media', operation: 'update' },
  },

  // routes/notifications.ts (setupTestCMS defaults notifications enabled)
  notifications: {
    list: { permissionResource: 'notification', operation: 'read' },
    markNotificationsRead: {
      permissionResource: 'notification',
      operation: 'update',
    },
    markNotificationsUnread: {
      permissionResource: 'notification',
      operation: 'update',
    },
    archiveNotification: {
      permissionResource: 'notification',
      operation: 'delete',
    },
  },

  // routes/admin.ts
  admin: {
    runPruning: { permissionResource: 'admin', operation: 'delete' },
    runScheduled: { permissionResource: 'admin', operation: 'create' },
    reindexSearch: { permissionResource: 'admin', operation: 'create' },
  },

  // routes/variables.ts
  variables: {
    list: { permissionResource: 'variable', operation: 'read' },
    getVariable: { permissionResource: 'variable', operation: 'read' },
    createVariable: { permissionResource: 'variable', operation: 'create' },
    updateVariable: { permissionResource: 'variable', operation: 'update' },
    deleteVariable: { permissionResource: 'variable', operation: 'delete' },
    getVariableUsages: { permissionResource: 'variable', operation: 'read' },
  },

  // routes/templates.ts
  templates: {
    list: { permissionResource: 'template', operation: 'read' },
    getTemplate: { permissionResource: 'template', operation: 'read' },
    createTemplate: { permissionResource: 'template', operation: 'create' },
    updateTemplate: { permissionResource: 'template', operation: 'update' },
    deleteTemplate: { permissionResource: 'template', operation: 'delete' },
    resolveTemplate: { permissionResource: 'template', operation: 'read' },
    getTemplateDefaults: {
      permissionResource: 'template',
      operation: 'read',
    },
  },

  // routes/search.ts
  search: {
    query: { permissionResource: 'search', operation: 'read' },
  },

  // routes/releases.ts
  releases: {
    createRelease: { permissionResource: 'release', operation: 'create' },
    addToRelease: { permissionResource: 'release', operation: 'update' },
    removeFromRelease: { permissionResource: 'release', operation: 'update' },
    setReleaseItems: { permissionResource: 'release', operation: 'update' },
    getRelease: { permissionResource: 'release', operation: 'read' },
    listReleases: { permissionResource: 'release', operation: 'read' },
    publishRelease: { permissionResource: 'release', operation: 'update' },
  },

  // routes/users.ts
  users: {
    whoami: { permissionResource: 'user', operation: 'read' },
    listReviewers: { permissionResource: 'user', operation: 'read' },
  },
};

function metaOf(cms: any, ns: string, ep: string) {
  return cms.api?.[ns]?.[ep]?.options?.metadata?.cms;
}

describe('endpoint authorization contract', () => {
  it('reachability: metadata is readable directly off the built api', async () => {
    const { cms } = await setupTestCMS();
    const meta = (cms.api as any).pages.createRoot?.options?.metadata?.cms;
    expect(meta?.permissionResource).toBe('root');
    expect(meta?.operation).toBe('create');
  });

  it('every endpoint carries the expected permissionResource + operation', async () => {
    const { cms } = await setupTestCMS();
    for (const [ns, eps] of Object.entries(EXPECTED)) {
      for (const [ep, want] of Object.entries(eps)) {
        const cms_ = metaOf(cms, ns, ep);
        expect(cms_, `${ns}.${ep} has cms metadata`).toBeDefined();
        expect(cms_.permissionResource, `${ns}.${ep} permissionResource`).toBe(
          want.permissionResource,
        );
        expect(cms_.operation, `${ns}.${ep} operation`).toBe(want.operation);
      }
    }
  });

  it('the expected map covers every callable endpoint (no unmapped endpoints)', async () => {
    const { cms } = await setupTestCMS();
    const unmapped: string[] = [];
    for (const [ns, eps] of Object.entries(
      cms.api as Record<string, Record<string, unknown>>,
    )) {
      for (const ep of Object.keys(eps)) {
        const fn = (eps as any)[ep];
        const isEndpoint = typeof fn === 'function' && fn?.options?.metadata !== undefined;
        if (!isEndpoint) continue;
        if (!EXPECTED[ns]?.[ep]) unmapped.push(`${ns}.${ep}`);
      }
    }
    expect(unmapped, `unmapped endpoints: ${unmapped.join(', ')}`).toEqual([]);
  });
});
