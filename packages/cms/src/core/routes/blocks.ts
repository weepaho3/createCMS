import { and, eq, inArray, isNull, sql, type AnyColumn } from 'drizzle-orm';
import * as z from 'zod';

import type {
  AnyBlockDefinition,
  CMSProcedureContext,
  CollectionWithName,
  InferBlockTreeNode,
  InferCreateBlockInput,
  InferUpdateBlockInput,
  ListRootsResult,
  RootListItem,
} from '../types';
import type {
  ResolvedScope,
  ResolvedSlugConfig,
} from '../types/definitions';
import type { DrizzleInstance } from '../types/drizzle';

import { newId } from '../../utils/nanoid';
import { defaultPropertiesFor } from '../block-defaults';
import {
  createInitialCommit,
  fetchCommitSummary,
  writeCommit,
  type ChangedVersion,
} from '../blocks/commit-writer';
import { collectDescendantIds, deepCopySubtree } from '../blocks/copy-subtree';
import { diffTree } from '../blocks/diff-tree';
import { lockWritableBranch, requireRootInScope } from '../blocks/guards';
import {
  assertPlacementAllowed,
  buildPlacementIndex,
} from '../blocks/placement';
import {
  assembleBlockTree,
  loadBlocksAtCommit,
  loadVersionMapAtCommit,
  readRootSlug,
  withRootSlug,
  ROOT_SLUG_PROP,
  type BlockTreeNode,
} from '../blocks/reconstruct-snapshot';
import { resolveBranchPolicy } from '../branch-policy';
import {
  assets,
  blockVersions,
  branches,
  commitSnapshots,
  mergeRequests,
  publications,
  roots,
} from '../db/schema.generated';
import { cmsMeta, createCMSEndpoint } from '../endpoint';
import { CMSError, errorMessages } from '../errors';
import { resolveLinkPaths } from '../links';
import {
  captureSubtreePaths,
  recordArchiveRedirect,
  recordSubtreeRedirects,
} from '../redirects/auto-create';
import { resolveRootCurrentPath } from '../redirects/resolve';
import {
  coreReferenceResolver,
  getReferenceUsageDetails,
  isReferencedByLiveContent,
} from '../references';
import { batchFetchRootListItems } from '../root/batch-fetch';
import {
  type ListRootsQuery,
  type RootInput,
  type UpdateRootInput,
  ROOT_COLUMN_FIELDS,
  buildBlockInputSchema,
  buildListRootsQuerySchema,
  buildPropertiesSchema,
  buildRootInputSchema,
  buildUpdateBlockInputSchema,
  buildUpdateRootInputSchema,
} from '../schema-builders';
import { crossScopeColumns, scopedInsert } from '../scope';
import {
  buildFullPath,
  isAncestorOf,
  normalizeSlug,
  validateSlugUniqueness,
} from '../slug';
import { loadTemplateStrings } from '../templates';
import { userEnrichment } from '../user/enrichment';
import { parseTimestamp } from '../utils/parse-timestamp';
import {
  wireBooleanIsTrue,
  wireBooleanSchema,
} from '../utils/wire-boolean';
import { loadVariables, substituteVariables } from '../variables';
import { buildReferencePreviews } from './publications';

// ============================================================================
// Schemas
// ============================================================================

const blockTreeNodeSchema: z.ZodType<BlockTreeNode> = z.lazy(() =>
  z.object({
    blockId: z.string(),
    type: z.string(),
    properties: z.record(z.string(), z.unknown()),
    children: z.array(blockTreeNodeSchema),
  }),
);

/**
 * Applies a PATCH to a block's properties (JSON-Merge-Patch semantics):
 *   - a key set to a value  → overwrites it,
 *   - a key set to `null`    → deletes it,
 *   - an omitted key         → left unchanged.
 *
 * `null` is unambiguous here because no block-property value type uses `null`
 * as a meaningful value (values are string/number/boolean/reference, or the
 * key is absent). This keeps updates field-granular, which is collaboration-
 * friendly (clients send only what they changed) while still allowing deletes.
 */
function applyPropertyPatch(
  current: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete result[key];
    } else {
      result[key] = value;
    }
  }
  return result;
}

// ============================================================================
// Block routes factory
// ============================================================================

export function createBlocksEndpoints<TDef extends CollectionWithName>(
  def: TDef,
  cmsCtx: CMSProcedureContext,
) {
  const { db } = cmsCtx;
  const collectionName = def.name;
  // Derived once per collection: the placement rules the create/move/duplicate
  // routes enforce — `accepts`/`excludes` from `structure` plus the
  // `allowChildren` container gate from the block defs.
  const placementIndex = buildPlacementIndex(def.structure, def.blocks);

  // Branch-protection policy. When `protectPublishedBranches` is on, a branch is
  // read-only for direct content mutations exactly while it is published; the
  // mutation routes below lock the branch via the shared `lockWritableBranch`
  // guard, which enforces `assertBranchWritable`. `createRoot` seeds a fresh,
  // unpublished branch and is never gated. The collection's own
  // `branchProtection` (if any) overrides the global config.
  const branchPolicy = resolveBranchPolicy(cmsCtx, def.branchProtection);

  // When `forceCommitMessage` is on, a commit-producing route must be given a
  // non-empty `message`; otherwise it falls back to an auto-generated default.
  const forceCommitMessage = cmsCtx.forceCommitMessage === true;
  function commitMessage(
    message: string | undefined,
    fallback: string,
  ): string {
    if (forceCommitMessage && (message === undefined || message.trim() === ''))
      throw new CMSError('COMMIT_MESSAGE_REQUIRED');
    return message ?? fallback;
  }

  // Shared deep-copy implementation behind both `duplicateBlock` (mode-switched
  // union) and `duplicateRoot` (root mode forced, static return type). The
  // discriminant is purely "is `targetParentBlockId` absent": omit it → a new
  // top-level root is minted; provide it → the subtree is copied under a parent.
  type DuplicateInput = {
    rootId: string;
    branchId: string;
    blockId: string;
    targetParentBlockId?: string;
    targetProperties?: Record<string, unknown>;
    targetSlug?: string;
    targetIndex?: number;
    message?: string;
  };

  async function runDuplicate(
    tx: DrizzleInstance,
    scope: ResolvedScope,
    userId: string | undefined,
    input: DuplicateInput,
  ) {
    await requireRootInScope(tx, input.rootId, collectionName, scope.roots);

    const sourceBranch = await lockWritableBranch(
      tx,
      branchPolicy,
      input.rootId,
      input.branchId,
    );
    const oldHeadId = sourceBranch.headCommitId;

    const versionByBlockId = await loadVersionMapAtCommit(tx, oldHeadId);

    const sourceVersion = versionByBlockId.get(input.blockId);
    if (!sourceVersion)
      throw new CMSError('BLOCK_NOT_FOUND', {
        message: errorMessages.blockNotFound(input.blockId),
      });
    if (sourceVersion.deleted)
      throw new CMSError('BLOCK_ALREADY_DELETED', {
        message: errorMessages.blockAlreadyDeleted(input.blockId),
      });

    const { copies } = deepCopySubtree(versionByBlockId, input.blockId);
    const isRootDuplication = !input.targetParentBlockId;

    if (isRootDuplication) {
      if (!input.targetProperties) {
        throw new CMSError('MISSING_TARGET_PROPERTIES');
      }

      const slugCfg = def.slug as ResolvedSlugConfig | undefined;
      let dupSlug: string | null = null;
      if (slugCfg?.enabled && input.targetSlug) {
        dupSlug = slugCfg.normalize
          ? normalizeSlug(input.targetSlug)
          : input.targetSlug;
      }

      // cms-05: the slug is VERSIONED — seed it as the new root version's draft
      // `__slug`, NOT onto roots.slug (which stays null until this root is first
      // published). Drafts may collide, so there is no write-time uniqueness
      // check here; publish enforces it (PUBLISH_SLUG_CONFLICT).
      const newRoot = await scopedInsert(
        tx,
        'cms.roots',
        {
          id: newId('root'),
          collection: collectionName,
          slug: null,
          created_by: userId,
          // Plugin-contributed per-new-entry columns: a duplicate
          // is a NEW logical entry, so the i18n plugin mints a fresh
          // translation_key here.
          ...scope.roots?.newEntryColumns?.(),
        },
        scope.roots,
      );

      const versions: ChangedVersion[] = copies.map((copy) => {
        const isTopLevel = copy.oldBlockId === input.blockId;
        return {
          blockId: isTopLevel ? newRoot.id : copy.newBlockId,
          type: isTopLevel ? collectionName : copy.type,
          properties: isTopLevel
            ? withRootSlug(
                input.targetProperties as Record<string, unknown>,
                dupSlug,
              )
            : copy.properties,
          children: copy.newChildren,
        };
      });

      const { commit, branchId } = await createInitialCommit(tx, def, {
        rootId: newRoot.id,
        branchName: branchPolicy.defaultBranchName,
        message: commitMessage(input.message, 'Duplicated root'),
        createdBy: userId,
        versions,
      });

      // cms-05: `slug` is the DRAFT slug just seeded; `path` is a PUBLISHED
      // concern (roots.slug is still null), so it is undefined until this root is
      // published and the slug materializes.
      return {
        mode: 'root' as const,
        commit,
        rootId: newRoot.id,
        branchId,
        slug: dupSlug ?? undefined,
        path: undefined as string | undefined,
      };
    }

    const parentVersion = versionByBlockId.get(input.targetParentBlockId!);
    if (!parentVersion)
      throw new CMSError('PARENT_NOT_FOUND', {
        message: errorMessages.parentNotFound(input.targetParentBlockId!),
      });
    if (parentVersion.deleted)
      throw new CMSError('BLOCK_ALREADY_DELETED', {
        message: errorMessages.blockAlreadyDeleted(input.targetParentBlockId!),
      });

    assertPlacementAllowed(
      placementIndex,
      sourceVersion.type,
      input.targetParentBlockId === input.rootId ? 'root' : parentVersion.type,
    );

    const topLevelCopyId = copies[0].newBlockId;

    const updatedChildren = [...(parentVersion.children ?? [])];
    const insertAt =
      input.targetIndex !== undefined
        ? Math.min(input.targetIndex, updatedChildren.length)
        : updatedChildren.length;
    updatedChildren.splice(insertAt, 0, topLevelCopyId);

    const changed: ChangedVersion[] = [
      ...copies.map((copy) => ({
        blockId: copy.newBlockId,
        type: copy.type,
        properties: copy.properties,
        children: copy.newChildren,
      })),
      {
        blockId: parentVersion.blockId,
        type: parentVersion.type,
        properties: parentVersion.properties,
        children: updatedChildren,
      },
    ];

    const { commit } = await writeCommit(tx, def, {
      rootId: input.rootId,
      branchId: input.branchId,
      parentCommitId: oldHeadId,
      message: commitMessage(input.message, `Duplicate block ${input.blockId}`),
      createdBy: userId,
      changed,
    });

    return {
      mode: 'child' as const,
      commit,
      blockId: topLevelCopyId,
    };
  }

  // cms-04: write-time existence check for `image` and `reference` property
  // values. Zod validates only the SHAPE (both are stored as strings); it cannot
  // confirm the id actually resolves. Without this, a nonexistent asset id or
  // reference rootId is silently stored and only surfaces as a 404 at render.
  // We verify id-SHAPED values — an `ast_` asset id against the `assets` table,
  // a `rot_` rootId against the target collection's `roots` — and deliberately
  // leave every other string untouched: legacy path-style image values
  // (`/img.png`) and i18n `tgr_` translation-group keys are NOT direct ids, so
  // this never rejects a value that was never meant to point at a single row.
  // Array values are checked element-wise (list-of-reference, if a plugin adds
  // one). Runs inside the write transaction so the check sees uncommitted rows.
  async function assertPropertyReferencesExist(
    tx: DrizzleInstance,
    blockType: string,
    properties: Record<string, unknown> | undefined,
  ): Promise<void> {
    if (!properties) return;

    const specs = (
      blockType === collectionName || blockType === 'root'
        ? def.root.properties
        : def.blocks?.[blockType]?.properties
    ) as Record<string, { type: string; collection?: string }> | undefined;
    if (!specs) return;

    const assetIds = new Set<string>();
    const refIdsByCollection = new Map<string, Set<string>>();
    const addAsset = (v: unknown) => {
      if (typeof v === 'string' && v.startsWith('ast_')) assetIds.add(v);
    };
    const addRef = (targetCollection: string, v: unknown) => {
      if (typeof v === 'string' && v.startsWith('rot_')) {
        let set = refIdsByCollection.get(targetCollection);
        if (!set) refIdsByCollection.set(targetCollection, (set = new Set()));
        set.add(v);
      }
    };

    for (const [key, spec] of Object.entries(specs)) {
      const value = properties[key];
      if (value === undefined || value === null) continue;

      if (spec.type === 'image') {
        addAsset(value);
      } else if (spec.type === 'reference' && spec.collection) {
        addRef(spec.collection, value);
      } else if (spec.type === 'list') {
        // list-of-image / list-of-reference: check every element id exists.
        const of = (spec as { of?: { type?: string; collection?: string } }).of;
        const elements = Array.isArray(value) ? value : [];
        if (of?.type === 'image') {
          for (const el of elements) addAsset(el);
        } else if (of?.type === 'reference' && of.collection) {
          for (const el of elements) addRef(of.collection, el);
        }
      }
    }

    if (assetIds.size > 0) {
      const ids = [...assetIds];
      const found = await tx
        .select({ id: assets.id })
        .from(assets)
        .where(inArray(assets.id, ids));
      const foundSet = new Set(found.map((r) => r.id));
      const missing = ids.find((id) => !foundSet.has(id));
      if (missing !== undefined)
        throw new CMSError('INVALID_REFERENCE', {
          message: `Referenced image asset does not exist: ${missing}`,
          data: { kind: 'image', id: missing },
        });
    }

    for (const [targetCollection, idSet] of refIdsByCollection) {
      const ids = [...idSet];
      const found = await tx
        .select({ id: roots.id })
        .from(roots)
        .where(
          and(
            inArray(roots.id, ids),
            eq(roots.collection, targetCollection),
            isNull(roots.archivedAt),
          ),
        );
      const foundSet = new Set(found.map((r) => r.id));
      const missing = ids.find((id) => !foundSet.has(id));
      if (missing !== undefined)
        throw new CMSError('INVALID_REFERENCE', {
          message: `Referenced ${targetCollection} does not exist: ${missing}`,
          data: {
            kind: 'reference',
            collection: targetCollection,
            id: missing,
          },
        });
    }
  }

  // Shared core of `updateBlock` and `updateRoot`: scope-guard, lock the branch,
  // load the single target version, run the deleted/type guards, apply the
  // property patch, and write the one-version commit. The callers differ only in
  // which type they require the stored block to have — and how they frame a
  // mismatch — supplied via `verifyType`, plus the fallback commit message.
  // `updateRoot` runs its slug/redirect epilogue AFTER this returns.
  async function patchSingleVersion(
    tx: DrizzleInstance,
    scope: ResolvedScope,
    userId: string | undefined,
    input: {
      rootId: string;
      branchId: string;
      blockId: string;
      properties: Record<string, unknown> | undefined;
      message: string | undefined;
      fallbackMessage: string;
      verifyType: (storedType: string) => void;
      // Optimistic-concurrency precondition (cms-18); undefined → unchecked.
      expectedHeadCommitId?: string;
    },
  ) {
    await requireRootInScope(tx, input.rootId, collectionName, scope.roots);

    const branch = await lockWritableBranch(
      tx,
      branchPolicy,
      input.rootId,
      input.branchId,
    );
    const oldHeadId = branch.headCommitId;

    const [blockSnap] = await tx
      .select({ blockVersionId: commitSnapshots.blockVersionId })
      .from(commitSnapshots)
      .where(
        and(
          eq(commitSnapshots.commitId, oldHeadId),
          eq(commitSnapshots.blockId, input.blockId),
        ),
      );
    if (!blockSnap)
      throw new CMSError('BLOCK_NOT_FOUND', {
        message: errorMessages.blockNotFound(input.blockId),
      });

    const [currentVersion] = await tx
      .select()
      .from(blockVersions)
      .where(eq(blockVersions.id, blockSnap.blockVersionId));

    if (currentVersion.deleted)
      throw new CMSError('BLOCK_ALREADY_DELETED', {
        message: errorMessages.blockAlreadyDeleted(input.blockId),
      });

    input.verifyType(currentVersion.type);

    // cms-04: only the incoming patch values are new, so validate just those
    // (nulls are deletes — skipped inside the helper).
    await assertPropertyReferencesExist(
      tx,
      currentVersion.type,
      input.properties,
    );

    const mergedProperties = applyPropertyPatch(
      currentVersion.properties as Record<string, unknown>,
      (input.properties ?? {}) as Record<string, unknown>,
    );

    const { commit } = await writeCommit(tx, def, {
      rootId: input.rootId,
      branchId: input.branchId,
      parentCommitId: oldHeadId,
      expectedHeadCommitId: input.expectedHeadCommitId,
      message: commitMessage(input.message, input.fallbackMessage),
      createdBy: userId,
      changed: [
        {
          blockId: currentVersion.blockId,
          type: currentVersion.type,
          properties: mergedProperties,
          children: currentVersion.children,
        },
      ],
    });

    return { commit };
  }

  return {
    /**
     * Creates a new root (page/entry) with initial draft branch and commit.
     * Validates slug uniqueness and nesting constraints against collection definition.
     * @param message Optional commit message; defaults to 'Initial commit'.
     * @param slug Root slug (if enabled in collection definition); validated for uniqueness.
     * @param parentRootId Parent root id for nested collections; required if nesting is enabled.
     * @param properties Initial root-level properties.
     * @returns Root id, initial branch id, and initial commit id.
     * @throws SLUG_EMPTY_NOT_ALLOWED when slug is required but empty.
     * @throws NESTING_NOT_ENABLED when nesting is disabled but parentRootId is provided.
     * @throws PARENT_ROOT_NOT_FOUND when parentRootId does not exist.
     * @example
     * const result = await cmsClient.pages.createRoot({
     *   message: 'New page',
     *   slug: 'my-page',
     *   properties: { title: 'My Page' }
     * });
     */
    createRoot: createCMSEndpoint(
      `/${collectionName}/createRoot`,
      {
        method: 'POST',
        body: buildRootInputSchema(def.root.properties),
        metadata: cmsMeta(
          {
            $Infer: {
              body: {} as RootInput<TDef['root']['properties']>,
            },
          },
          {
            permissionResource: 'root',
            operation: 'create',
            scope: 'collection',
            collection: collectionName,
          },
        ),
      },
      async (ctx) => {
        const { userId, scope } = ctx.context;
        const actor = userId;
        const message = ctx.body.message;
        const parentRootId = ctx.body.parentRootId ?? null;
        const slugCfg = def.slug as ResolvedSlugConfig | undefined;

        let slug: string | null = null;

        if (slugCfg?.enabled) {
          const rawSlug = (ctx.body.slug as string | undefined) ?? '';
          slug = slugCfg.normalize ? normalizeSlug(rawSlug) : rawSlug;

          if (!slug && !slugCfg.allowIndex) {
            throw new CMSError('SLUG_EMPTY_NOT_ALLOWED');
          }

          if (parentRootId && !slugCfg.nested) {
            throw new CMSError('NESTING_NOT_ENABLED');
          }
        } else if (parentRootId) {
          throw new CMSError('NESTING_NOT_ENABLED');
        }

        return db.transaction(async (tx) => {
          if (parentRootId) {
            const [parent] = await tx
              .select({ id: roots.id })
              .from(roots)
              .where(
                and(
                  eq(roots.id, parentRootId),
                  eq(roots.collection, collectionName),
                  scope.roots?.where,
                ),
              );
            if (!parent) throw new CMSError('PARENT_ROOT_NOT_FOUND');
          }

          // cms-05: the slug is VERSIONED. It is seeded as the root version's
          // draft `__slug` (below) and left OFF roots.slug — the global slug
          // stays null until this root is first published. Drafts may collide,
          // so there is no blocking write-time uniqueness check; publish enforces
          // it (PUBLISH_SLUG_CONFLICT). The cheap empty check above stays.
          const root = await scopedInsert(
            tx,
            'cms.roots',
            {
              id: newId('root'),
              collection: collectionName,
              parent_root_id: parentRootId,
              slug: null,
              sort_order: 0,
              created_by: actor,
              // Plugin-contributed per-new-entry columns: a new root is
              // a new logical entry, so the i18n plugin mints a fresh
              // translation_key here; none are added without such a plugin.
              ...scope.roots?.newEntryColumns?.(),
            },
            scope.roots,
          );

          const rootProps =
            (ctx.body.properties as Record<string, unknown> | undefined) ?? {};

          const { commit, branchId } = await createInitialCommit(tx, def, {
            rootId: root.id,
            branchName: branchPolicy.defaultBranchName,
            message: commitMessage(message, 'Initial commit'),
            createdBy: actor,
            versions: [
              {
                blockId: root.id,
                type: collectionName,
                properties: slugCfg?.enabled
                  ? withRootSlug(rootProps, slug)
                  : rootProps,
                children: [],
              },
            ],
          });

          // `slug` is the DRAFT slug just seeded; `path` is a PUBLISHED concern
          // (roots.slug is still null), so it is undefined until publish.
          return {
            commit,
            rootId: root.id,
            branchId,
            slug: slug || undefined,
            path: undefined as string | undefined,
          };
        });
      },
    ),

    /**
     * Fetch a paginated list of roots with search, filter, and sort.
     * Includes publication counts, branch counts, and open merge request counts per root.
     * @param limit Pagination limit (default 20, max 100 enforced by schema).
     * @param offset Pagination offset (default 0).
     * @param search Search query for a field.
     * @param searchField Field to search (column or property name).
     * @param sortBy Field to sort by (default 'createdAt').
     * @param sortDirection 'asc' or 'desc' (default 'desc').
     * @param filterField Field to filter on.
     * @param filterValue Case-insensitive ILIKE pattern matched against filterField.
     *   Passed RAW (unlike `search`, which is auto-wrapped as %term%): a bare value
     *   is an exact case-insensitive match; include SQL `%`/`_` wildcards yourself for
     *   partial matches (e.g. 'about%'). Use `search`/`searchField` for substring search.
     * @param hasPublications Filter roots: true (has any publication), false (none), or undefined (both).
     * @param createdAfter Filter roots created after this ISO date.
     * @param createdBefore Filter roots created before this ISO date.
     * @param parentRootId Filter by parent root; use 'null' or '' for top-level roots.
     * @returns Paginated result with roots array, total count, and hasMore flag.
     * @example
     * const result = await cmsClient.pages.listRoots({
     *   limit: 20,
     *   offset: 0,
     *   sortBy: 'createdAt',
     *   sortDirection: 'desc'
     * });
     */
    listRoots: createCMSEndpoint(
      `/${collectionName}/listRoots`,
      {
        method: 'GET',
        query: buildListRootsQuerySchema(def.root.properties),
        metadata: cmsMeta(
          {
            $Infer: {
              query: {} as ListRootsQuery<TDef['root']['properties']>,
            },
          },
          {
            permissionResource: 'root',
            operation: 'read',
            scope: 'collection',
            collection: collectionName,
          },
        ),
      },
      async (ctx) => {
        const { scope } = ctx.context;
        const query = ctx.query ?? {};

        const {
          limit = 20,
          offset = 0,
          search,
          searchField,
          sortBy,
          sortDirection = 'desc',
          filterField,
          filterValue,
          hasPublications,
          createdAfter,
          createdBefore,
          parentRootId: parentFilter,
        } = query;

        const columnFields: Record<
          string,
          { column: AnyColumn; alias: string }
        > = {
          rootId: { column: roots.id, alias: 'root_id' },
          slug: { column: roots.slug, alias: 'slug' },
          createdAt: { column: roots.createdAt, alias: 'created_at' },
          createdBy: { column: roots.createdBy, alias: 'created_by' },
        };
        const isColumnField = (f: string) =>
          (ROOT_COLUMN_FIELDS as readonly string[]).includes(f);

        const conditions = [
          eq(roots.collection, collectionName),
          eq(blockVersions.deleted, false),
          isNull(roots.archivedAt),
        ];
        if (scope.roots?.where) conditions.push(scope.roots.where);

        if (search && searchField) {
          if (isColumnField(searchField)) {
            const col = columnFields[searchField].column;
            conditions.push(sql`${col}::text ILIKE ${`%${search}%`}`);
          } else {
            conditions.push(
              sql`${blockVersions.properties}->>${searchField} ILIKE ${`%${search}%`}`,
            );
          }
        }
        if (createdAfter) {
          conditions.push(sql`${roots.createdAt} >= ${createdAfter}`);
        }
        if (createdBefore) {
          conditions.push(sql`${roots.createdAt} <= ${createdBefore}`);
        }
        if (filterField && filterValue !== undefined) {
          if (isColumnField(filterField)) {
            const col = columnFields[filterField].column;
            conditions.push(sql`${col}::text ILIKE ${filterValue}`);
          } else {
            conditions.push(
              sql`${blockVersions.properties}->>${filterField} ILIKE ${filterValue}`,
            );
          }
        }
        if (hasPublications === true) {
          conditions.push(
            sql`EXISTS (
              SELECT 1
              FROM ${publications}
              WHERE ${publications.rootId} = ${roots.id}
            )`,
          );
        } else if (hasPublications === false) {
          conditions.push(
            sql`NOT EXISTS (
              SELECT 1
              FROM ${publications}
              WHERE ${publications.rootId} = ${roots.id}
            )`,
          );
        }
        if (parentFilter !== undefined) {
          if (parentFilter === 'null' || parentFilter === '') {
            conditions.push(sql`${roots.parentRootId} IS NULL`);
          } else {
            conditions.push(eq(roots.parentRootId, parentFilter));
          }
        }

        const whereClause = and(...conditions)!;

        let orderExpr;
        if (!sortBy || isColumnField(sortBy)) {
          const alias = columnFields[sortBy ?? 'createdAt'].alias;
          orderExpr = sql.raw(alias);
        } else if (
          (def.root.properties as Record<string, { type?: string }>)[sortBy]
            ?.type === 'number'
        ) {
          // cms-10: a numeric property must sort as a NUMBER, not as JSONB text
          // (where "10" < "9"). Number properties validate as `z.number()`, so
          // fresh data is always a JSON number or absent. Guard the cast against
          // any non-numeric text (a legacy row, a `string -> number` type change,
          // or data written outside the API): only cast values matching a numeric
          // pattern, otherwise sort them as NULL. A bare `::numeric` on "banana"
          // would raise `invalid input syntax for type numeric` and 500 the whole
          // list request.
          orderExpr = sql`CASE WHEN properties->>${sortBy} ~ '^-?[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?$' THEN (properties->>${sortBy})::numeric END`;
        } else {
          orderExpr = sql`properties->>${sortBy}`;
        }
        const dirExpr = sortDirection === 'asc' ? sql`ASC` : sql`DESC`;

        const enrich = userEnrichment(ctx, {
          cmsColumn: 'cms.roots.created_by',
          alias: 'root_user',
          outputKey: 'createdByUser',
        });

        const filteredRootsQuery = sql`
          SELECT
            ${roots.id} AS root_id,
            ${roots.createdAt} AS created_at,
            ${roots.createdBy} AS created_by,
            ${roots.parentRootId} AS parent_root_id,
            ${roots.slug} AS slug,
            ${roots.sortOrder} AS sort_order,
            ${blockVersions.properties} AS properties,
            COUNT(${publications.rootId})::int AS publication_count,
            (SELECT COUNT(*)::int FROM ${branches} AS b WHERE b.root_id = ${roots.id}) AS branch_count,
            (SELECT COUNT(*)::int FROM ${mergeRequests} AS mr WHERE mr.root_id = ${roots.id} AND mr.status = 'open') AS open_mr_count
            ${enrich.select}
          FROM ${roots}
          JOIN ${branches}
            ON ${branches.rootId} = ${roots.id}
           AND ${branches.name} = ${branchPolicy.defaultBranchName}
          JOIN ${commitSnapshots}
            ON ${commitSnapshots.commitId} = ${branches.headCommitId}
           AND ${commitSnapshots.blockId} = ${roots.id}
          JOIN ${blockVersions}
            ON ${blockVersions.id} = ${commitSnapshots.blockVersionId}
          LEFT JOIN ${publications}
            ON ${publications.rootId} = ${roots.id}
          ${enrich.join}
          WHERE ${whereClause}
          GROUP BY ${roots.id}, ${roots.createdAt}, ${roots.createdBy},
                   ${roots.parentRootId}, ${roots.slug}, ${roots.sortOrder},
                   ${blockVersions.properties}
                   ${enrich.groupBy}
        `;

        // Slim count: same filtering joins + WHERE as the main query, but drops
        // everything COUNT doesn't need — the two correlated COUNT subqueries,
        // the user-enrichment join, the LEFT JOIN publications (the publication
        // filters use self-contained EXISTS subqueries in whereClause, not the
        // join), and the GROUP BY. The roots→branches→commitSnapshots→
        // blockVersions joins are INNER and decide which roots match, so they
        // stay. COUNT(DISTINCT roots.id) mirrors the main query's GROUP BY on
        // roots.id, keeping the total equal to the distinct roots returned
        // pre-LIMIT even if the joins ever fan out to multiple rows per root.
        const countQuery = sql`
          SELECT COUNT(DISTINCT ${roots.id})::int AS count
          FROM ${roots}
          JOIN ${branches}
            ON ${branches.rootId} = ${roots.id}
           AND ${branches.name} = ${branchPolicy.defaultBranchName}
          JOIN ${commitSnapshots}
            ON ${commitSnapshots.commitId} = ${branches.headCommitId}
           AND ${commitSnapshots.blockId} = ${roots.id}
          JOIN ${blockVersions}
            ON ${blockVersions.id} = ${commitSnapshots.blockVersionId}
          WHERE ${whereClause}
        `;

        const mainQuery = sql`
          SELECT *
          FROM (${filteredRootsQuery}) AS filtered_roots
          ORDER BY ${orderExpr} ${dirExpr}
          LIMIT ${limit}
          OFFSET ${offset}
        `;

        const [countResult, result] = await Promise.all([
          db.execute(countQuery),
          db.execute(mainQuery),
        ]);

        const total = parseInt(
          (countResult.rows[0] as { count: string }).count,
          10,
        );

        // Raw-SQL row: the hand-selected column shape. Typing it lets the mapper
        // below be structurally checked against RootListItem rather than blindly
        // asserted. `properties` (JSON column) and the numeric/timestamp columns
        // stay wide — they are the coerced/dynamic leaves.
        const resultRows = result.rows as Array<{
          root_id: string;
          created_at: unknown;
          created_by: string | null;
          parent_root_id: string | null;
          slug: string | null;
          sort_order: number;
          properties: unknown;
          publication_count: unknown;
          branch_count: unknown;
          open_mr_count: unknown;
        }>;

        const rootRows = resultRows.map((row) => {
          const item: RootListItem<TDef['root']['properties']> = {
            id: row.root_id,
            createdAt: parseTimestamp(row.created_at),
            createdBy: row.created_by ?? undefined,
            parentRootId: row.parent_root_id ?? undefined,
            slug: row.slug ?? undefined,
            sortOrder: row.sort_order,
            // JSON column — the one genuinely-dynamic leaf. Strip the reserved
            // `__slug` draft key (cms-05) so it never leaks into list output;
            // this raw query bypasses the batchFetch helpers that strip elsewhere.
            properties: withRootSlug(
              (row.properties ?? {}) as Record<string, unknown>,
              null,
            ) as RootListItem<TDef['root']['properties']>['properties'],
            hasPublications: parseInt(String(row.publication_count), 10) > 0,
            publicationCount: parseInt(String(row.publication_count), 10),
            branchCount: parseInt(String(row.branch_count), 10),
            openMergeRequestCount: parseInt(String(row.open_mr_count), 10),
          };

          enrich.apply(item, row);

          return item;
        });

        // Full URL path per row: resolve each listed root's ancestor chain UP to
        // the top (an anchored recursive CTE — pagination-safe, unlike building
        // the path from only the loaded page), then apply the collection's slug
        // config. Parents are same-scope by construction, so no extra scope gate.
        const slugCfg = def.slug as ResolvedSlugConfig | undefined;
        if (slugCfg?.enabled && rootRows.length > 0) {
          const ids = rootRows.map((r) => r.id as string);
          const pathRes = await db.execute(sql`
            WITH RECURSIVE ancestry AS (
              SELECT ${roots.id} AS leaf_id, ${roots.id} AS id,
                     ${roots.parentRootId} AS parent_root_id,
                     ${roots.slug} AS slug, 0 AS depth
              FROM ${roots}
              WHERE ${inArray(roots.id, ids)}
              UNION ALL
              SELECT a.leaf_id, r.id, r.parent_root_id, r.slug, a.depth + 1
              FROM ${roots} r
              JOIN ancestry a ON r.id = a.parent_root_id
              WHERE r.collection = ${collectionName}
            )
            SELECT leaf_id, array_agg(slug ORDER BY depth DESC) AS segs
            FROM ancestry
            GROUP BY leaf_id
          `);
          const pathByRoot = new Map<string, string>();
          for (const row of pathRes.rows as Array<{
            leaf_id: string;
            segs: (string | null)[];
          }>) {
            const segs = (row.segs ?? []).filter((s): s is string =>
              Boolean(s),
            );
            pathByRoot.set(row.leaf_id, buildFullPath(slugCfg, segs));
          }
          for (const item of rootRows) {
            item.path = pathByRoot.get(item.id as string) ?? '/';
          }
        }

        const response: ListRootsResult<TDef['root']['properties']> = {
          roots: rootRows,
          total,
          hasMore: offset + rootRows.length < total,
        };
        return response;
      },
    ),
    /**
     * Create a new block as a child of a parent block in a branch.
     * @param rootId Root id (must be in caller's scope).
     * @param branchId Branch id.
     * @param parentBlockId Block id of the intended parent.
     * @param type Block type (must match a defined block type in collection).
     * @param properties Initial block properties.
     * @param position Index in parent's children array (default: append).
     * @param message Optional commit message; defaults to 'Add {type} block'.
     * @returns New commit id and new block id.
     * @throws PARENT_NOT_FOUND when parentBlockId does not exist in current snapshot.
     * @throws BLOCK_ALREADY_DELETED when parent block is marked deleted.
     * @throws BRANCH_NOT_FOUND when branch does not exist.
     * @example
     * const result = await cmsClient.pages.createBlock({
     *   rootId: 'root_123',
     *   branchId: 'br_main',
     *   parentBlockId: 'block_abc',
     *   type: 'TextBlock',
     *   properties: { text: 'Hello' }
     * });
     */
    createBlock: createCMSEndpoint(
      `/${collectionName}/createBlock`,
      {
        method: 'POST',
        body: buildBlockInputSchema<TDef['blocks']>(def.blocks),
        metadata: cmsMeta(
          {
            $Infer: {
              body: {} as InferCreateBlockInput<TDef['blocks']>,
            },
          },
          {
            permissionResource: 'block',
            operation: 'create',
            scope: 'collection',
            collection: collectionName,
          },
        ),
      },
      async (ctx) => {
        const { userId } = ctx.context;
        const {
          rootId,
          branchId,
          parentBlockId,
          properties,
          type,
          message,
          position,
        } = ctx.body;

        return db.transaction(async (tx) => {
          await requireRootInScope(
            tx,
            rootId,
            collectionName,
            ctx.context.scope.roots,
          );

          const branch = await lockWritableBranch(
            tx,
            branchPolicy,
            rootId,
            branchId,
          );
          const oldHeadId = branch.headCommitId;

          const [parentSnap] = await tx
            .select({ blockVersionId: commitSnapshots.blockVersionId })
            .from(commitSnapshots)
            .where(
              and(
                eq(commitSnapshots.commitId, oldHeadId),
                eq(commitSnapshots.blockId, parentBlockId),
              ),
            );
          if (!parentSnap)
            throw new CMSError('PARENT_NOT_FOUND', {
              message: errorMessages.parentNotFound(parentBlockId),
            });

          const [parentVersion] = await tx
            .select()
            .from(blockVersions)
            .where(eq(blockVersions.id, parentSnap.blockVersionId));

          if (parentVersion.deleted)
            throw new CMSError('BLOCK_ALREADY_DELETED', {
              message: errorMessages.blockAlreadyDeleted(parentBlockId),
            });

          // Enforce the collection's placement rules. The root block's id equals
          // the rootId and is stored with `type === collectionName`, so normalize
          // it to the literal 'root' the structure map keys on.
          assertPlacementAllowed(
            placementIndex,
            type,
            parentBlockId === rootId ? 'root' : parentVersion.type,
          );

          const childBlockId = newId('block');
          // Server-side template defaults: pre-fill any property the caller did
          // NOT provide with this block type's template, scoped to the active
          // tenant/language. The raw template string is stored as-is so embedded
          // {{variables}} stay live (resolved at read time). Caller values win.
          const templateDefaults = await loadTemplateStrings(
            tx,
            collectionName,
            type,
            ctx.context.scope?.templates?.where,
          );
          // toe-ed-09: seed the new block's properties from its definition's
          // per-property `defaultValue`s as the LOWEST-priority base. Precedence
          // (lowest → highest): schema defaults < template prefill < caller
          // values. Defaults only fill gaps a caller/template left unset.
          const blockDef = def.blocks?.[type];
          const propertyDefaults = blockDef
            ? defaultPropertiesFor(blockDef as AnyBlockDefinition)
            : {};
          const blockProps = {
            ...propertyDefaults,
            ...templateDefaults,
            ...(properties as Record<string, unknown> | undefined),
          };

          // cms-04: reject nonexistent image asset / reference ids at write time.
          await assertPropertyReferencesExist(tx, type, blockProps);

          const newChildrenArray = [...(parentVersion.children ?? [])];
          const insertPosition = position ?? newChildrenArray.length;
          newChildrenArray.splice(insertPosition, 0, childBlockId);

          const { commit } = await writeCommit(tx, def, {
            rootId,
            branchId,
            parentCommitId: oldHeadId,
            // cms-18: optional optimistic-concurrency head precondition. Field
            // added to the create-block body schema by the schema-builders; read
            // defensively so this file is self-contained.
            expectedHeadCommitId: (
              ctx.body as { expectedHeadCommitId?: string }
            ).expectedHeadCommitId,
            message: commitMessage(message, `Add ${type} block`),
            createdBy: userId,
            changed: [
              {
                blockId: childBlockId,
                type,
                properties: blockProps,
                children: [],
              },
              {
                blockId: parentVersion.blockId,
                type: parentVersion.type,
                properties: parentVersion.properties,
                children: newChildrenArray,
              },
            ],
          });

          return {
            commit,
            blockId: childBlockId,
          };
        });
      },
    ),

    /**
     * Retrieve the block tree for a root at a specific commit or branch head.
     * Optionally substitutes variables in properties unless raw mode is enabled.
     * @param rootId Root id.
     * @param branchId Branch id (used to resolve head commit if commitId not provided).
     * @param commitId Specific commit id to retrieve; defaults to branch head if omitted.
     * @param raw If true, skip variable substitution (return raw tree).
     * @returns Tree object (nested blocks) and reconstructed flag (true if commit was partial snapshot).
     * @throws ROOT_NOT_FOUND when root does not exist.
     * @throws BRANCH_NOT_FOUND when branch does not exist.
     * @example
     * const result = await cmsClient.pages.getBlockTree({
     *   rootId: 'root_123',
     *   branchId: 'br_main'
     * });
     */
    getBlockTree: createCMSEndpoint(
      `/${collectionName}/getBlockTree`,
      {
        method: 'GET',
        query: z.object({
          rootId: z.string(),
          branchId: z.string(),
          commitId: z.string().optional(),
          raw: z.coerce.boolean().optional(),
          includeReferencePreviews: z.coerce.boolean().optional(),
        }),
        metadata: cmsMeta(
          {
            $Infer: {
              query: {} as {
                rootId: string;
                branchId: string;
                commitId?: string;
                raw?: boolean;
                includeReferencePreviews?: boolean;
              },
            },
          },
          {
            permissionResource: 'block',
            operation: 'read',
            scope: 'collection',
            collection: collectionName,
          },
        ),
      },
      async (ctx) => {
        const { rootId, branchId, commitId, raw, includeReferencePreviews } =
          ctx.query;

        // Scope gate: reject a root outside the caller's scope before resolving
        // any commit (closes IDOR via rootId on both resolution paths). It also
        // confirms the root belongs to this collection, so the branch lookup
        // below does not join roots.
        await requireRootInScope(
          db,
          rootId,
          collectionName,
          ctx.context.scope.roots,
        );

        let targetCommitId: string;

        if (commitId) {
          targetCommitId = commitId;
        } else {
          const [branch] = await db
            .select({ headCommitId: branches.headCommitId })
            .from(branches)
            .where(and(eq(branches.id, branchId), eq(branches.rootId, rootId)));
          if (!branch) throw new CMSError('BRANCH_NOT_FOUND');
          targetCommitId = branch.headCommitId;
        }

        const { blocks, reconstructed } = await loadBlocksAtCommit(
          db,
          targetCommitId,
          rootId,
        );

        const tree = assembleBlockTree(blocks, rootId);
        if (!tree) throw new CMSError('ROOT_NOT_FOUND');

        const scope = ctx.context.scope;
        // Load variables once: needed to substitute the main tree (unless raw)
        // and/or to render the reference previews (always resolved).
        const vars =
          !raw || includeReferencePreviews
            ? await loadVariables(db, scope)
            : null;
        if (!raw && vars) substituteVariables(tree, vars);
        // Resolve link properties to their current language-aware href (unless
        // raw — the editor keeps the stored target for re-picking).
        if (!raw) {
          await resolveLinkPaths(
            db,
            tree,
            def,
            cmsCtx.collections,
            scope.referenceResolver ?? coreReferenceResolver,
            crossScopeColumns(scope.roots),
          );
        }

        // Opt-in sidecar: the PUBLISHED preview of every reference embedded in the
        // tree, keyed by the stored reference value — one call instead of N
        // getPublishedContent round-trips. Resolved through the active scope.
        let references: Record<string, BlockTreeNode> | undefined;
        if (includeReferencePreviews && vars) {
          references = await buildReferencePreviews(
            db,
            tree,
            def,
            cmsCtx.collections,
            scope.referenceResolver ?? coreReferenceResolver,
            crossScopeColumns(scope.roots),
            vars,
            scope.abTestResolver,
          );
        }

        return {
          tree,
          reconstructed,
          ...(references ? { references } : {}),
        } as unknown as {
          tree: InferBlockTreeNode<TDef['blocks'], TDef['root']['properties']>;
          reconstructed: boolean;
          references?: Record<string, BlockTreeNode>;
        };
      },
    ),

    /**
     * Move a block to a new parent and/or position within its parent's children.
     * @param rootId Root id.
     * @param branchId Branch id.
     * @param blockId Block id to move.
     * @param newParentBlockId Block id of the new parent.
     * @param newIndex Index in the new parent's children (clamped to valid range).
     * @param message Optional commit message; defaults to 'Move block {blockId}'.
     * @returns New commit id.
     * @throws BLOCK_NOT_FOUND when blockId does not exist.
     * @throws CANNOT_MOVE_ROOT when attempting to move the root block itself.
     * @throws CANNOT_MOVE_INTO_SELF when newParentBlockId is the same as blockId.
     * @throws CANNOT_MOVE_INTO_DESCENDANT when newParentBlockId is a descendant of blockId.
     * @throws BLOCK_ALREADY_DELETED when block or parent is marked deleted.
     * @throws BRANCH_NOT_FOUND when branch does not exist.
     */
    moveBlock: createCMSEndpoint(
      `/${collectionName}/moveBlock`,
      {
        method: 'POST',
        body: z.object({
          rootId: z.string(),
          branchId: z.string(),
          blockId: z.string(),
          newParentBlockId: z.string(),
          newIndex: z.number().int().min(0),
          message: z.string().optional(),
          expectedHeadCommitId: z.string().optional(),
        }),
        metadata: cmsMeta(
          {
            $Infer: {
              body: {} as {
                rootId: string;
                branchId: string;
                blockId: string;
                newParentBlockId: string;
                newIndex: number;
                message?: string;
                expectedHeadCommitId?: string;
              },
            },
          },
          {
            permissionResource: 'block',
            operation: 'update',
            scope: 'collection',
            collection: collectionName,
          },
        ),
      },
      async (ctx) => {
        const { userId } = ctx.context;
        const input = ctx.body;

        return db.transaction(async (tx) => {
          await requireRootInScope(
            tx,
            input.rootId,
            collectionName,
            ctx.context.scope.roots,
          );

          const branch = await lockWritableBranch(
            tx,
            branchPolicy,
            input.rootId,
            input.branchId,
          );
          const oldHeadId = branch.headCommitId;

          const versionByBlockId = await loadVersionMapAtCommit(tx, oldHeadId);

          const movedBlock = versionByBlockId.get(input.blockId);
          if (!movedBlock)
            throw new CMSError('BLOCK_NOT_FOUND', {
              message: errorMessages.blockNotFound(input.blockId),
            });
          if (movedBlock.deleted)
            throw new CMSError('BLOCK_ALREADY_DELETED', {
              message: errorMessages.blockAlreadyDeleted(input.blockId),
            });

          let oldParentId: string | null = null;
          for (const [id, v] of versionByBlockId) {
            if ((v.children ?? []).includes(input.blockId)) {
              oldParentId = id;
              break;
            }
          }
          if (!oldParentId) throw new CMSError('CANNOT_MOVE_ROOT');

          if (input.newParentBlockId === input.blockId)
            throw new CMSError('CANNOT_MOVE_INTO_SELF');

          const descendants = new Set(
            collectDescendantIds(versionByBlockId, input.blockId),
          );

          if (descendants.has(input.newParentBlockId))
            throw new CMSError('CANNOT_MOVE_INTO_DESCENDANT');

          const oldParent = versionByBlockId.get(oldParentId);
          if (!oldParent)
            throw new CMSError('PARENT_NOT_FOUND', {
              message: errorMessages.parentNotFound(oldParentId),
            });
          if (oldParent.deleted)
            throw new CMSError('BLOCK_ALREADY_DELETED', {
              message: errorMessages.blockAlreadyDeleted(oldParentId),
            });

          const isSameParent = oldParentId === input.newParentBlockId;

          const changed: ChangedVersion[] = [];

          if (isSameParent) {
            const updatedChildren = (oldParent.children ?? []).filter(
              (id) => id !== input.blockId,
            );
            const clampedIndex = Math.min(
              input.newIndex,
              updatedChildren.length,
            );
            updatedChildren.splice(clampedIndex, 0, input.blockId);

            changed.push({
              blockId: oldParent.blockId,
              type: oldParent.type,
              properties: oldParent.properties,
              children: updatedChildren,
            });
          } else {
            const newParent = versionByBlockId.get(input.newParentBlockId);
            if (!newParent)
              throw new CMSError('PARENT_NOT_FOUND', {
                message: errorMessages.parentNotFound(input.newParentBlockId),
              });
            if (newParent.deleted)
              throw new CMSError('BLOCK_ALREADY_DELETED', {
                message: errorMessages.blockAlreadyDeleted(
                  input.newParentBlockId,
                ),
              });

            assertPlacementAllowed(
              placementIndex,
              movedBlock.type,
              input.newParentBlockId === input.rootId ? 'root' : newParent.type,
            );

            const oldChildren = (oldParent.children ?? []).filter(
              (id) => id !== input.blockId,
            );
            const newChildren = [...(newParent.children ?? [])];
            const clampedIndex = Math.min(input.newIndex, newChildren.length);
            newChildren.splice(clampedIndex, 0, input.blockId);

            changed.push(
              {
                blockId: oldParent.blockId,
                type: oldParent.type,
                properties: oldParent.properties,
                children: oldChildren,
              },
              {
                blockId: newParent.blockId,
                type: newParent.type,
                properties: newParent.properties,
                children: newChildren,
              },
            );
          }

          const { commit } = await writeCommit(tx, def, {
            rootId: input.rootId,
            branchId: input.branchId,
            parentCommitId: oldHeadId,
            expectedHeadCommitId: input.expectedHeadCommitId,
            message: commitMessage(
              input.message,
              `Move block ${input.blockId}`,
            ),
            createdBy: userId,
            changed,
          });

          return { commit };
        });
      },
    ),

    /**
     * Mark a block and all its descendants as deleted (soft delete via tombstones).
     * Updates parent to remove the deleted block from its children array.
     * @param rootId Root id.
     * @param branchId Branch id.
     * @param blockId Block id to delete.
     * @param message Optional commit message; defaults to 'Delete block {blockId}'.
     * @returns New commit id.
     * @throws BLOCK_NOT_FOUND when blockId does not exist.
     * @throws BLOCK_ALREADY_DELETED when block is already marked deleted.
     * @throws PARENT_NOT_FOUND when parent of block cannot be determined.
     * @throws BRANCH_NOT_FOUND when branch does not exist.
     */
    deleteBlock: createCMSEndpoint(
      `/${collectionName}/deleteBlock`,
      {
        method: 'POST',
        body: z.object({
          rootId: z.string(),
          branchId: z.string(),
          blockId: z.string(),
          message: z.string().optional(),
          expectedHeadCommitId: z.string().optional(),
        }),
        metadata: cmsMeta(
          {
            $Infer: {
              body: {} as {
                rootId: string;
                branchId: string;
                blockId: string;
                message?: string;
                expectedHeadCommitId?: string;
              },
            },
          },
          {
            permissionResource: 'block',
            operation: 'delete',
            scope: 'collection',
            collection: collectionName,
          },
        ),
      },
      async (ctx) => {
        const { userId } = ctx.context;
        const input = ctx.body;

        return db.transaction(async (tx) => {
          await requireRootInScope(
            tx,
            input.rootId,
            collectionName,
            ctx.context.scope.roots,
          );

          const branch = await lockWritableBranch(
            tx,
            branchPolicy,
            input.rootId,
            input.branchId,
          );
          const oldHeadId = branch.headCommitId;

          const versionByBlockId = await loadVersionMapAtCommit(tx, oldHeadId);

          const targetBlock = versionByBlockId.get(input.blockId);
          if (!targetBlock)
            throw new CMSError('BLOCK_NOT_FOUND', {
              message: errorMessages.blockNotFound(input.blockId),
            });

          if (targetBlock.deleted)
            throw new CMSError('BLOCK_ALREADY_DELETED', {
              message: errorMessages.blockAlreadyDeleted(input.blockId),
            });

          const isRootBlock = input.blockId === input.rootId;

          let parentBlockId: string | null = null;
          if (!isRootBlock) {
            for (const [id, v] of versionByBlockId) {
              if ((v.children ?? []).includes(input.blockId)) {
                parentBlockId = id;
                break;
              }
            }
            if (!parentBlockId)
              throw new CMSError('PARENT_NOT_FOUND', {
                message: errorMessages.parentNotFound('unknown'),
              });
          }

          const deletedBlockIds = new Set<string>([
            input.blockId,
            ...collectDescendantIds(versionByBlockId, input.blockId),
          ]);

          const tombstones = [...deletedBlockIds]
            .map((deletedId) => {
              const oldVersion = versionByBlockId.get(deletedId);
              if (!oldVersion) return null;
              return {
                blockId: oldVersion.blockId,
                type: oldVersion.type,
                properties: oldVersion.properties,
                children: oldVersion.children ?? [],
                deleted: true,
              };
            })
            .filter((v): v is NonNullable<typeof v> => v !== null);

          const changed: ChangedVersion[] = [...tombstones];

          if (!isRootBlock) {
            const parentVersion = versionByBlockId.get(parentBlockId!);
            if (!parentVersion)
              throw new CMSError('PARENT_NOT_FOUND', {
                message: errorMessages.parentNotFound(parentBlockId!),
              });

            const updatedChildren = (parentVersion.children ?? []).filter(
              (id) => id !== input.blockId,
            );

            changed.push({
              blockId: parentVersion.blockId,
              type: parentVersion.type,
              properties: parentVersion.properties,
              children: updatedChildren,
            });
          }

          const { commit } = await writeCommit(tx, def, {
            rootId: input.rootId,
            branchId: input.branchId,
            parentCommitId: oldHeadId,
            expectedHeadCommitId: input.expectedHeadCommitId,
            message: commitMessage(
              input.message,
              `Delete block ${input.blockId}`,
            ),
            createdBy: userId,
            changed,
          });

          return { commit, deletedBlockIds: [...deletedBlockIds] };
        });
      },
    ),

    /**
     * Clone a block subtree to a new location (child duplication) or create a new root from it (root duplication).
     * For root duplication, creates a new root; for child duplication, inserts under a parent.
     * @param rootId Root id (for source branch).
     * @param branchId Source branch id.
     * @param blockId Block id to duplicate (and its entire subtree).
     * @param targetParentBlockId Parent block for the duplicate (omit for root duplication).
     * @param targetProperties Root properties (required for root duplication only).
     * @param targetSlug Slug for duplicated root (optional; validated for uniqueness).
     * @param targetIndex Index in parent's children for child duplication.
     * @param message Optional commit message.
     * @returns Object with `mode` ('root' or 'child') and `commit` ({ id, message, createdAt, createdBy }); child mode also returns `blockId`, root mode also returns `rootId`, `branchId`, `slug`, and `path`.
     * @throws MISSING_TARGET_PROPERTIES when root duplication but targetProperties not provided.
     * @throws BLOCK_NOT_FOUND when source blockId does not exist.
     * @throws BLOCK_ALREADY_DELETED when source block is marked deleted.
     * @throws PARENT_NOT_FOUND when targetParentBlockId does not exist (child mode).
     */
    duplicateBlock: createCMSEndpoint(
      `/${collectionName}/duplicateBlock`,
      {
        method: 'POST',
        body: z.object({
          rootId: z.string(),
          branchId: z.string(),
          blockId: z.string(),
          targetParentBlockId: z.string().optional(),
          targetProperties: z.record(z.string(), z.unknown()).optional(),
          targetSlug: z.string().optional(),
          targetIndex: z.number().int().min(0).optional(),
          message: z.string().optional(),
        }),
        metadata: cmsMeta(
          {
            $Infer: {
              body: {} as {
                rootId: string;
                branchId: string;
                blockId: string;
                targetParentBlockId?: string;
                targetProperties?: Record<string, unknown>;
                targetSlug?: string;
                targetIndex?: number;
                message?: string;
              },
            },
          },
          {
            permissionResource: 'block',
            operation: 'create',
            scope: 'collection',
            collection: collectionName,
          },
        ),
      },
      async (ctx) => {
        return db.transaction((tx) =>
          runDuplicate(tx, ctx.context.scope, ctx.context.userId, ctx.body),
        );
      },
    ),

    /**
     * Duplicate an entire root: deep-copies the whole block tree into a NEW
     * top-level root (parent_root_id NULL). Thin wrapper over the shared
     * duplication path forced into root mode — `targetParentBlockId`/`targetIndex`
     * are omitted so `isRootDuplication` is always true and the return type is
     * static (no `mode` discriminant). For copying a subtree UNDER an existing
     * parent, use `duplicateBlock` instead.
     * @param rootId Source root id.
     * @param branchId Source branch id.
     * @param blockId Root block id to duplicate.
     * @param targetProperties Properties for the new root block (required).
     * @param targetSlug Optional slug for the new root (slug-enabled collections).
     * @param message Optional commit message; defaults to 'Duplicated root'.
     * @returns The new root: { commit, rootId, branchId, slug?, path? }.
     * @throws BLOCK_NOT_FOUND / BLOCK_ALREADY_DELETED / SLUG_ALREADY_EXISTS
     */
    duplicateRoot: createCMSEndpoint(
      `/${collectionName}/duplicateRoot`,
      {
        method: 'POST',
        body: z.object({
          rootId: z.string(),
          branchId: z.string(),
          blockId: z.string(),
          targetProperties: z.record(z.string(), z.unknown()),
          targetSlug: z.string().optional(),
          message: z.string().optional(),
        }),
        metadata: cmsMeta(
          {
            $Infer: {
              body: {} as {
                rootId: string;
                branchId: string;
                blockId: string;
                targetProperties: Record<string, unknown>;
                targetSlug?: string;
                message?: string;
              },
            },
          },
          {
            permissionResource: 'block',
            operation: 'create',
            scope: 'collection',
            collection: collectionName,
          },
        ),
      },
      async (ctx) => {
        const res = await db.transaction((tx) =>
          runDuplicate(tx, ctx.context.scope, ctx.context.userId, {
            ...ctx.body,
            // Force root mode: no parent → `isRootDuplication` is always true.
            targetParentBlockId: undefined,
          }),
        );
        // `res` is statically the root branch; narrow away the `child` union arm
        // so `duplicateRoot` exposes a non-union return type.
        return res as Extract<typeof res, { mode: 'root' }>;
      },
    ),

    /**
     * Update a block's properties using JSON-Merge-Patch semantics (null deletes, missing keys unchanged).
     * @param rootId Root id.
     * @param branchId Branch id.
     * @param blockId Block id to update.
     * @param type Block type (must match current block type).
     * @param properties Properties to merge (null values delete keys).
     * @param message Optional commit message; defaults to 'Update {type} block {blockId}'.
     * @returns New commit id.
     * @throws BLOCK_NOT_FOUND when blockId does not exist.
     * @throws BLOCK_ALREADY_DELETED when block is marked deleted.
     * @throws TYPE_MISMATCH when provided type does not match current block type.
     * @throws BRANCH_NOT_FOUND when branch does not exist.
     */
    updateBlock: createCMSEndpoint(
      `/${collectionName}/updateBlock`,
      {
        method: 'POST',
        body: buildUpdateBlockInputSchema<TDef['blocks']>(def.blocks),
        metadata: cmsMeta(
          {
            $Infer: {
              body: {} as InferUpdateBlockInput<TDef['blocks']>,
            },
          },
          {
            permissionResource: 'block',
            operation: 'update',
            scope: 'collection',
            collection: collectionName,
          },
        ),
      },
      async (ctx) => {
        const { userId } = ctx.context;
        const { rootId, branchId, blockId, type, properties, message } =
          ctx.body;

        return db.transaction((tx) =>
          patchSingleVersion(tx, ctx.context.scope, userId, {
            rootId,
            branchId,
            blockId,
            properties,
            message,
            fallbackMessage: `Update ${type} block ${blockId}`,
            // cms-18: optional optimistic-concurrency head precondition. The
            // field is added to the update-block body schema by the
            // schema-builders; read it defensively so this file is self-
            // contained (undefined when the schema has not yet added it).
            expectedHeadCommitId: (
              ctx.body as { expectedHeadCommitId?: string }
            ).expectedHeadCommitId,
            verifyType: (storedType) => {
              if (storedType !== type)
                throw new CMSError('TYPE_MISMATCH', {
                  message: errorMessages.typeMismatch(storedType, type),
                  data: { expected: storedType, actual: type },
                });
            },
          }),
        );
      },
    ),

    /**
     * Update root properties and/or slug; auto-creates redirects if slug changes.
     * For slug changes, validates uniqueness, captures old subtree paths, then creates redirects.
     * @param rootId Root id.
     * @param branchId Branch id.
     * @param properties Root properties to merge (null values delete keys).
     * @param slug New slug (if slug is enabled in collection); validated and auto-redirected.
     * @param message Optional commit message; defaults to 'Update root block {rootId}'.
     * @returns New commit id.
     * @throws BLOCK_NOT_FOUND when root block does not exist.
     * @throws BLOCK_ALREADY_DELETED when root is marked deleted.
     * @throws TYPE_MISMATCH when root type does not match collection name.
     * @throws SLUG_EMPTY_NOT_ALLOWED when slug required but empty.
     * @throws BRANCH_NOT_FOUND when branch does not exist.
     * @example
     * const result = await cmsClient.pages.updateRoot({
     *   rootId: 'root_123',
     *   branchId: 'br_main',
     *   properties: { title: 'Updated Title' },
     *   slug: 'updated-slug'
     * });
     */
    updateRoot: createCMSEndpoint(
      `/${collectionName}/updateRoot`,
      {
        method: 'POST',
        body: buildUpdateRootInputSchema<TDef['root']['properties']>(
          def.root.properties,
        ),
        metadata: cmsMeta(
          {
            $Infer: {
              body: {} as UpdateRootInput<TDef['root']['properties']>,
            },
          },
          {
            permissionResource: 'root',
            operation: 'update',
            scope: 'collection',
            collection: collectionName,
          },
        ),
      },
      async (ctx) => {
        const { userId } = ctx.context;
        const {
          rootId,
          branchId,
          properties,
          slug: newSlug,
          message,
        } = ctx.body;
        const blockId = rootId;
        const slugCfg = def.slug as ResolvedSlugConfig | undefined;

        // cms-05: the slug is VERSIONED — a slug edit is folded into the root
        // version's reserved `__slug` property and committed to THIS branch, so
        // it no longer touches roots.slug (the live URL) until publish. Redirects
        // and uniqueness therefore move to the publish path; here we keep only
        // the cheap empty/format check. Clearing the slug (empty, allowIndex) sends
        // `__slug: null`, which the merge-patch deletes.
        let patch = properties as Record<string, unknown> | undefined;
        if (slugCfg?.enabled && newSlug !== undefined) {
          const normalized = slugCfg.normalize ? normalizeSlug(newSlug) : newSlug;
          if (!normalized && !slugCfg.allowIndex) {
            throw new CMSError('SLUG_EMPTY_NOT_ALLOWED');
          }
          patch = {
            ...patch,
            [ROOT_SLUG_PROP]: normalized === '' ? null : normalized,
          };
        }

        return db.transaction(async (tx) => {
          const { commit } = await patchSingleVersion(
            tx,
            ctx.context.scope,
            userId,
            {
              rootId,
              branchId,
              blockId,
              properties: patch,
              message,
              fallbackMessage: `Update root block ${blockId}`,
              // cms-18: optional optimistic-concurrency head precondition (see
              // updateBlock). Field added to the update-root body schema by the
              // schema-builders; read defensively.
              expectedHeadCommitId: (
                ctx.body as { expectedHeadCommitId?: string }
              ).expectedHeadCommitId,
              verifyType: (storedType) => {
                if (storedType !== collectionName)
                  throw new CMSError('TYPE_MISMATCH', {
                    message: errorMessages.typeMismatch(
                      collectionName,
                      storedType,
                    ),
                    data: { expected: collectionName, actual: storedType },
                  });
              },
            },
          );

          // Read the committed DRAFT slug back from the new head root version, so
          // the client learns the server-normalized value without a refetch. This
          // is the per-branch draft slug — NOT the live roots.slug, which only
          // changes on publish.
          let draftSlug: string | undefined;
          if (slugCfg?.enabled) {
            const [rv] = await tx
              .select({ properties: blockVersions.properties })
              .from(commitSnapshots)
              .innerJoin(
                blockVersions,
                eq(blockVersions.id, commitSnapshots.blockVersionId),
              )
              .where(
                and(
                  eq(commitSnapshots.commitId, commit.id),
                  eq(commitSnapshots.blockId, rootId),
                ),
              );
            draftSlug = rv
              ? (readRootSlug(rv.properties as Record<string, unknown>) ??
                undefined)
              : undefined;
          }

          return {
            commit,
            slug: draftSlug,
          };
        });
      },
    ),

    /**
     * Batch update a tree: create new blocks, update existing blocks, and delete others in one commit.
     * If tree is identical to current state, no commit is created (returns oldHeadId).
     * @param rootId Root id.
     * @param branchId Branch id.
     * @param tree Desired final block tree structure.
     * @param message Optional commit message; defaults to 'Batch update'.
     * @returns New commit id (or old head id if no changes).
     * @throws BRANCH_NOT_FOUND when branch does not exist.
     * @example
     * const result = await cmsClient.pages.updateBlocks({
     *   rootId: 'root_123',
     *   branchId: 'br_main',
     *   tree: { blockId: 'root_123', type: 'Page', properties: {}, children: [] }
     * });
     */
    updateBlocks: createCMSEndpoint(
      `/${collectionName}/updateBlocks`,
      {
        method: 'POST',
        body: z.object({
          rootId: z.string(),
          branchId: z.string(),
          tree: z.lazy(() => blockTreeNodeSchema) as z.ZodType<BlockTreeNode>,
          message: z.string().optional(),
          expectedHeadCommitId: z.string().optional(),
        }),
        metadata: cmsMeta(
          {
            $Infer: {
              body: {} as {
                rootId: string;
                branchId: string;
                tree: BlockTreeNode;
                message?: string;
                expectedHeadCommitId?: string;
              },
            },
          },
          {
            permissionResource: 'block',
            operation: 'update',
            scope: 'collection',
            collection: collectionName,
          },
        ),
      },
      async (ctx) => {
        const { userId } = ctx.context;
        const { rootId, branchId, tree, message, expectedHeadCommitId } =
          ctx.body;

        return db.transaction(async (tx) => {
          await requireRootInScope(
            tx,
            rootId,
            collectionName,
            ctx.context.scope.roots,
          );

          const branch = await lockWritableBranch(
            tx,
            branchPolicy,
            rootId,
            branchId,
          );
          const oldHeadId = branch.headCommitId;

          const { blocks: currentBlocks } = await loadBlocksAtCommit(
            tx,
            oldHeadId,
            rootId,
          );

          // toe-ed-01(a): the posted tree's root node MUST be this root. Do this
          // FIRST — it is the cheapest guard and the highest-stakes: a mismatched
          // root blockId makes diffTree treat the posted node as a fresh "create"
          // and the real root as a "delete", tombstoning the live root.
          if (tree.blockId !== rootId)
            throw new CMSError('TYPE_MISMATCH', {
              message: `updateBlocks tree root blockId '${tree.blockId}' does not match rootId '${rootId}'`,
              data: {
                reason: 'root-blockid-mismatch',
                expected: rootId,
                actual: tree.blockId,
              },
            });

          // toe-ed-02: getBlockTree emits the root node with the logical marker
          // `type: 'root'` (assembleBlockTree), but the store keys the root
          // version on the collection name. Map `'root'` back to the collection
          // name BEFORE diffing (mirroring routes/merges.ts), so a tree loaded via
          // getBlockTree and posted straight back is a lossless no-op instead of
          // persisting the literal `'root'` and type-flipping the root every read.
          const normalizedTree: BlockTreeNode =
            tree.type === 'root' ? { ...tree, type: collectionName } : tree;

          // toe-ed-01(b,c,d): the batch save is the visual editor's ONLY write
          // path, so it must enforce the same structural guarantees createBlock
          // does per-insert. The request body uses the generic blockTreeNodeSchema
          // (any type, any properties), so validate the desired tree here:
          //  (b) every written node's `type` is a known block type,
          //  (c) its properties satisfy that type's schema, and
          //  (d) every parent→child edge being (re)written is a legal placement.
          //
          // Crucially, validation keys off the DIFF, not the raw posted tree:
          // only CREATED and UPDATED nodes are rewritten by writeCommit, so only
          // those are checked. Re-validating UNCHANGED pre-existing blocks was the
          // source of two defects — it (1) bypassed the root (skipping it wholesale
          // let updateBlocks persist root props updateRoot would reject) and (2)
          // let ONE stale sibling (e.g. a prior PATCH null-deleted a now-required
          // prop, schema drift, or a link `.min(1)` over links stored empty) brick
          // the editor's only batch-save path even when the user never touched it.
          const diff = diffTree(normalizedTree, currentBlocks);

          if (
            diff.created.length === 0 &&
            diff.updated.length === 0 &&
            diff.deleted.length === 0
          ) {
            // No-op save: the head is unchanged. Return it with changed:false so
            // the caller can distinguish "nothing to save" from a real commit
            // (the payload is otherwise identical to a fresh commit). A no-op has
            // nothing to (re)write, so structural validation is skipped entirely.
            const headCommit = await fetchCommitSummary(tx, oldHeadId);
            return { commit: headCommit!, changed: false };
          }

          // The diff carries child IDs, not typed child nodes; index the posted
          // tree once so placement can resolve each child's `type`.
          const nodesById = new Map<string, BlockTreeNode>();
          const indexNodes = (node: BlockTreeNode): void => {
            nodesById.set(node.blockId, node);
            for (const child of node.children) indexNodes(child);
          };
          indexNodes(normalizedTree);

          // A non-root written node's type must resolve to a known block type;
          // the collection root type is accepted too (mirrors
          // assertPropertyReferencesExist, which treats it as root-typed).
          const validBlockTypes = new Set<string>([
            collectionName,
            ...Object.keys(def.blocks ?? {}),
          ]);
          // Build each type's property schema once (create + patch variants) and
          // reuse it across every node of that type.
          const strictSchemas = new Map<string, z.ZodType>();
          const patchSchemas = new Map<string, z.ZodType>();
          const propertiesSchemaFor = (
            type: string,
            allOptional: boolean,
          ): z.ZodType => {
            const cache = allOptional ? patchSchemas : strictSchemas;
            const cached = cache.get(type);
            if (cached) return cached;
            const specs =
              type === collectionName
                ? def.root.properties
                : def.blocks![type].properties;
            const built = buildPropertiesSchema(specs, allOptional);
            cache.set(type, built);
            return built;
          };

          // (b) + (c): validate a node writeCommit will (re)write. CREATED nodes
          // are STRICT (required props enforced, exactly like createBlock). UPDATED
          // nodes — INCLUDING the ROOT — are PATCH-tolerant (`allOptional`): only
          // the props actually present are type-checked, so the save mirrors
          // updateBlock/updateRoot and neither the root (defect 1) nor a
          // now-invalid untouched sibling (defect 2) is mis-handled.
          const validateWrittenNode = (
            node: BlockTreeNode,
            strict: boolean,
          ): void => {
            const isRoot = node.blockId === rootId;

            // (b) block-type existence. The root's type is collection-scoped
            // (validated against def.root below); every other written node must
            // name a known block type.
            if (!isRoot && !validBlockTypes.has(node.type))
              throw new CMSError('TYPE_MISMATCH', {
                message: `Unknown block type '${node.type}' for block ${node.blockId}`,
                data: {
                  reason: 'unknown-type',
                  type: node.type,
                  blockId: node.blockId,
                },
              });

            // (c) property validation — the ROOT validates against def.root, every
            // other node against its block type. `allOptional` is inverted from
            // `strict` (created → strict/required-enforcing, updated → patch).
            const schema = propertiesSchemaFor(
              isRoot ? collectionName : node.type,
              /* allOptional */ !strict,
            );
            const parsed = schema.safeParse(node.properties);
            if (!parsed.success)
              throw new CMSError('TYPE_MISMATCH', {
                message: isRoot
                  ? `Invalid root properties (block ${node.blockId}): ${parsed.error.message}`
                  : `Invalid properties for block type '${node.type}' (block ${node.blockId}): ${parsed.error.message}`,
                data: {
                  reason: isRoot
                    ? 'invalid-root-properties'
                    : 'invalid-properties',
                  type: node.type,
                  blockId: node.blockId,
                  issues: parsed.error.issues,
                },
              });
          };

          for (const b of diff.created)
            validateWrittenNode(nodesById.get(b.blockId)!, /* strict */ true);
          for (const b of diff.updated)
            validateWrittenNode(nodesById.get(b.blockId)!, /* strict */ false);

          // (d) placement: assert every parent→child edge writeCommit will
          // (re)write — i.e. the child list of every CREATED or UPDATED node.
          // Edges among purely-unchanged nodes are left untouched (skipping them
          // is the other half of the defect-2 fix). Root's stored type normalizes
          // to the literal 'root' the structure map keys on, mirroring createBlock.
          for (const b of [...diff.created, ...diff.updated]) {
            const node = nodesById.get(b.blockId)!;
            const parentType = node.blockId === rootId ? 'root' : node.type;
            for (const child of node.children)
              assertPlacementAllowed(placementIndex, child.type, parentType);
          }

          // cms-04: validate image/reference ids on every block being written
          // (created or updated) — the batch save path must not bypass the check
          // the single create/update handlers enforce.
          for (const b of [...diff.created, ...diff.updated]) {
            await assertPropertyReferencesExist(tx, b.type, b.properties);
          }

          const changed: ChangedVersion[] = [
            ...diff.created.map((b) => ({
              blockId: b.blockId,
              type: b.type,
              properties: b.properties,
              children: b.children,
            })),
            ...diff.updated.map((b) => ({
              blockId: b.blockId,
              type: b.type,
              properties: b.properties,
              children: b.children,
            })),
            ...diff.deleted
              .map((blockId) => {
                const existing = currentBlocks.get(blockId);
                if (!existing) return null;
                return {
                  blockId,
                  type: existing.type,
                  properties: existing.properties,
                  children: existing.children,
                  deleted: true,
                };
              })
              .filter((v): v is NonNullable<typeof v> => v !== null),
          ];

          const { commit } = await writeCommit(tx, def, {
            rootId,
            branchId,
            parentCommitId: oldHeadId,
            expectedHeadCommitId,
            message: commitMessage(message, 'Batch update'),
            createdBy: userId,
            changed,
          });

          return { commit, changed: true };
        });
      },
    ),

    /**
     * Reparent a root to a new parent (or set to top-level); auto-creates redirects if parent changes.
     * Nesting must be enabled in collection definition; circular references are rejected.
     * @param rootId Root id to move.
     * @param newParentRootId New parent root id (or null for top-level).
     * @param position Sort order in parent's children (optional).
     * @returns Root id and new parent root id.
     * @throws NESTING_NOT_ENABLED when nesting is disabled in collection definition.
     * @throws ROOT_NOT_FOUND when rootId does not exist.
     * @throws PARENT_ROOT_NOT_FOUND when newParentRootId does not exist.
     * @throws CIRCULAR_REFERENCE when newParentRootId is a descendant of rootId.
     */
    moveRoot: createCMSEndpoint(
      `/${collectionName}/moveRoot`,
      {
        method: 'POST',
        body: z.object({
          rootId: z.string(),
          newParentRootId: z.string().nullable(),
          position: z.number().optional(),
        }),
        metadata: cmsMeta(
          {
            $Infer: {
              body: {} as {
                rootId: string;
                newParentRootId: string | null;
                position?: number;
              },
            },
          },
          {
            permissionResource: 'root',
            operation: 'update',
            scope: 'collection',
            collection: collectionName,
          },
        ),
      },
      async (ctx) => {
        const slugCfg = def.slug as ResolvedSlugConfig | undefined;
        if (!slugCfg?.enabled || !slugCfg.nested) {
          throw new CMSError('NESTING_NOT_ENABLED');
        }

        const { rootId, newParentRootId, position } = ctx.body;

        return db.transaction(async (tx) => {
          const [root] = await tx
            .select({
              id: roots.id,
              slug: roots.slug,
              parentRootId: roots.parentRootId,
            })
            .from(roots)
            .where(
              and(
                eq(roots.id, rootId),
                eq(roots.collection, collectionName),
                ctx.context.scope.roots?.where,
              ),
            )
            .for('update');
          if (!root) throw new CMSError('ROOT_NOT_FOUND');

          if (newParentRootId !== null) {
            const [parent] = await tx
              .select({ id: roots.id })
              .from(roots)
              .where(
                and(
                  eq(roots.id, newParentRootId),
                  eq(roots.collection, collectionName),
                  ctx.context.scope.roots?.where,
                ),
              );
            if (!parent) throw new CMSError('PARENT_ROOT_NOT_FOUND');

            if (await isAncestorOf(tx, newParentRootId, rootId)) {
              throw new CMSError('CIRCULAR_REFERENCE');
            }
          }

          if (root.slug) {
            await validateSlugUniqueness(
              tx,
              collectionName,
              newParentRootId,
              root.slug,
              rootId,
              ctx.context.scope.roots?.insertColumns,
            );
          }

          // Only an ACTUAL reparent shifts URLs — a same-parent sort reorder
          // does not. Capture the moving subtree's OLD paths before the reparent,
          // then auto-create redirects (every descendant's URL shifts too).
          const reparented = newParentRootId !== root.parentRootId;
          const captured = reparented
            ? await captureSubtreePaths(tx, slugCfg, rootId)
            : [];

          const effectiveSortOrder = position ?? 0;
          await tx
            .update(roots)
            .set({
              parentRootId: newParentRootId,
              sortOrder: effectiveSortOrder,
            })
            .where(eq(roots.id, rootId));

          let redirectsCreated = 0;
          if (reparented) {
            redirectsCreated = await recordSubtreeRedirects(
              tx,
              collectionName,
              captured,
              ctx.context.scope.redirects,
            );
          }

          const path = slugCfg?.enabled
            ? ((await resolveRootCurrentPath(
                tx,
                slugCfg,
                rootId,
                ctx.context.scope.roots,
              )) ?? undefined)
            : undefined;

          return {
            rootId,
            newParentRootId,
            path,
            sortOrder: effectiveSortOrder,
            redirectsCreated,
          };
        });
      },
    ),

    /**
     * Fetch a single root with its current properties, metadata, and publication info.
     * @param rootId Root id.
     * @returns Root summary including properties, createdAt, createdBy, slug, publication count, etc.
     * @throws ROOT_NOT_FOUND when root does not exist.
     * @example
     * const root = await cmsClient.pages.getRoot({
     *   rootId: 'root_123'
     * });
     *
     * @remarks Draft reads are intentionally split by handle: `getRoot` (by id)
     * and `getRootBySlug` (by slug/parent). This differs from
     * `getPublishedContent`, which multiplexes rootId|slug|path behind one public
     * content-delivery entrypoint. Draft callers already know which handle they
     * hold, so two narrow endpoints give sharper types/errors; `path` resolution
     * is a published-content concern and is deliberately absent here.
     */
    getRoot: createCMSEndpoint(
      `/${collectionName}/getRoot`,
      {
        method: 'GET',
        query: z.object({ rootId: z.string() }),
        metadata: cmsMeta(
          {
            $Infer: {
              query: {} as { rootId: string },
            },
          },
          {
            permissionResource: 'root',
            operation: 'read',
            scope: 'collection',
            collection: collectionName,
          },
        ),
      },
      async (ctx) => {
        const { rootId } = ctx.query;

        await requireRootInScope(
          db,
          rootId,
          collectionName,
          ctx.context.scope.roots,
        );

        const map = await batchFetchRootListItems(db, [rootId], {
          collectionName,
          defaultBranchName: branchPolicy.defaultBranchName,
          slugConfig: def.slug as ResolvedSlugConfig | undefined,
        });
        const root = map.get(rootId);
        if (!root) throw new CMSError('ROOT_NOT_FOUND');

        return root as unknown as RootListItem<TDef['root']['properties']>;
      },
    ),

    /**
     * Lookup a root by its DRAFT slug (and optional parent); returns root summary
     * if unique. This is a DRAFT read (companion to `getRoot` by id): under cms-05
     * the slug is versioned, so it matches the per-branch `__slug` stored on the
     * default branch's head root version — NOT the published `roots.slug` (which
     * `getPublishedContent` resolves). An unpublished page is therefore findable by
     * the slug the editor is about to publish. Slugs are normalized if
     * normalization is enabled in the collection definition.
     * @param slug Draft slug to search for.
     * @param parentRootId Parent id for nested lookup (omit for top-level roots).
     * @returns Root summary (same fields as getRoot).
     * @throws SLUG_NOT_ENABLED when slug feature is disabled in collection definition.
     * @throws ROOT_NOT_FOUND when no root matches the slug.
     * @throws AMBIGUOUS_SLUG when multiple roots match (drafts may collide).
     */
    getRootBySlug: createCMSEndpoint(
      `/${collectionName}/getRootBySlug`,
      {
        method: 'GET',
        query: z.object({
          slug: z.string(),
          parentRootId: z.string().optional(),
        }),
        metadata: cmsMeta(
          {
            $Infer: {
              query: {} as { slug: string; parentRootId?: string },
            },
          },
          {
            permissionResource: 'root',
            operation: 'read',
            scope: 'collection',
            collection: collectionName,
          },
        ),
      },
      async (ctx) => {
        const slugCfg = def.slug as ResolvedSlugConfig | undefined;
        if (!slugCfg?.enabled) throw new CMSError('SLUG_NOT_ENABLED');

        const lookupSlug = slugCfg.normalize
          ? normalizeSlug(ctx.query.slug)
          : ctx.query.slug;
        const parent = ctx.query.parentRootId ?? null;

        // Match the DRAFT slug on the default branch's head root version
        // (block_versions.properties->>'__slug'). `roots` is left un-aliased so
        // an active scope `where` (which references "cms"."roots") still binds.
        const parentCond =
          parent === null
            ? sql`cms.roots.parent_root_id IS NULL`
            : sql`cms.roots.parent_root_id = ${parent}`;
        const scopeCond = ctx.context.scope.roots?.where
          ? sql`AND ${ctx.context.scope.roots.where}`
          : sql``;
        const matchResult = await db.execute(sql`
          SELECT cms.roots.id
          FROM cms.roots
          JOIN cms.branches b
            ON b.root_id = cms.roots.id
           AND b.name = ${branchPolicy.defaultBranchName}
          JOIN cms.commit_snapshots cs
            ON cs.commit_id = b.head_commit_id
           AND cs.block_id = cms.roots.id
          JOIN cms.block_versions bv
            ON bv.id = cs.block_version_id
          WHERE cms.roots.collection = ${collectionName}
            AND cms.roots.archived_at IS NULL
            AND (bv.properties->>${ROOT_SLUG_PROP}) = ${lookupSlug}
            AND ${parentCond}
            ${scopeCond}
        `);
        const matches = matchResult.rows as Array<{ id: string }>;

        if (matches.length === 0) throw new CMSError('ROOT_NOT_FOUND');
        if (matches.length > 1) throw new CMSError('AMBIGUOUS_SLUG');

        const rootId = matches[0].id;
        const map = await batchFetchRootListItems(db, [rootId], {
          collectionName,
          defaultBranchName: branchPolicy.defaultBranchName,
          slugConfig: def.slug as ResolvedSlugConfig | undefined,
        });
        const root = map.get(rootId);
        if (!root) throw new CMSError('ROOT_NOT_FOUND');

        return root as unknown as RootListItem<TDef['root']['properties']>;
      },
    ),

    /**
     * Soft-archive a root (history preserved); auto-creates redirect from old path to parent.
     * Rejects deletion if root has active child pages or is embedded as a reusable block.
     * @param rootId Root id.
     * @returns Root id.
     * @throws ROOT_NOT_FOUND when root does not exist or is already archived.
     * @throws ROOT_HAS_CHILDREN when root has unarchived child pages.
     * @throws ROOT_IN_USE when root is embedded as a reusable block on live pages.
     * @example
     * const result = await cmsClient.pages.archiveRoot({
     *   rootId: 'root_123'
     * });
     */
    archiveRoot: createCMSEndpoint(
      `/${collectionName}/archiveRoot`,
      {
        method: 'POST',
        body: z.object({ rootId: z.string() }),
        metadata: cmsMeta(
          {
            $Infer: {
              body: {} as { rootId: string },
            },
          },
          {
            permissionResource: 'root',
            operation: 'delete',
            scope: 'collection',
            collection: collectionName,
          },
        ),
      },
      async (ctx) => {
        const { rootId } = ctx.body;

        return db.transaction(async (tx) => {
          // Scoped + locked existence check. Archived roots are already "gone",
          // so re-deleting one 404s (excluded via archivedAt IS NULL).
          const [root] = await tx
            .select({ id: roots.id })
            .from(roots)
            .where(
              and(
                eq(roots.id, rootId),
                eq(roots.collection, collectionName),
                isNull(roots.archivedAt),
                ctx.context.scope.roots?.where,
              ),
            )
            .for('update');
          if (!root) throw new CMSError('ROOT_NOT_FOUND');

          // Refuse to archive a page that still has live child pages — archiving
          // a parent must never orphan or hide its children (nesting + SEO).
          const [child] = await tx
            .select({ id: roots.id })
            .from(roots)
            .where(
              and(eq(roots.parentRootId, rootId), isNull(roots.archivedAt)),
            )
            .limit(1);
          if (child) throw new CMSError('ROOT_HAS_CHILDREN');

          // Refuse to archive a root that is the DIRECTLY-referenced ANCHOR of any
          // live reference (a reusable block embedded on a live page) — archiving
          // it would make the block VANISH from those pages. ANCHOR-only: a
          // translation SIBLING reached only via read-time auto-upgrade is
          // NOT protected here, so removing a translation degrades hosts gracefully
          // to the stored anchor rather than being blocked. This protects EVERY
          // referenced root regardless of the `reusableBlock` flag (the flag is
          // ergonomics only, never a safety gate).
          if (
            await isReferencedByLiveContent(
              tx,
              rootId,
              crossScopeColumns(ctx.context.scope.roots),
            )
          ) {
            throw new CMSError('ROOT_IN_USE');
          }

          // Capture the old path + parent BEFORE archiving so the gone URL can
          // redirect to the parent page.
          const slugCfg = def.slug as ResolvedSlugConfig | undefined;
          let oldPath: string | null = null;
          let parentRootId: string | null = null;
          if (slugCfg?.enabled) {
            const [r] = await tx
              .select({ parentRootId: roots.parentRootId })
              .from(roots)
              .where(eq(roots.id, rootId));
            parentRootId = r?.parentRootId ?? null;
            oldPath = await resolveRootCurrentPath(tx, slugCfg, rootId);
          }

          // Soft-archive: history (branches/commits/blockVersions) is preserved;
          // physical removal is the pruning layer's job.
          await tx
            .update(roots)
            .set({ archivedAt: new Date() })
            .where(eq(roots.id, rootId));

          const redirectsCreated = await recordArchiveRedirect(
            tx,
            collectionName,
            oldPath,
            parentRootId,
            ctx.context.scope.redirects,
          );

          // `path` is the now-archived URL (for a "removed /x" confirmation);
          // `redirectsCreated` is 1 when an archive redirect was written.
          return {
            rootId,
            path: oldPath ?? undefined,
            redirectsCreated,
          };
        });
      },
    ),

    // "Which pages embed this reusable block?" — group-level usage for the editor.
    // Reads the content_usages reference index (populated dark).
    /**
     * List all pages that embed this reusable block (usage details for editor).
     * Under i18n, expands to all translation siblings to report cross-language usage.
     * @param rootId Root id of the reusable block.
     * @returns Usage details including which roots reference this block.
     * @throws ROOT_NOT_FOUND when rootId does not exist.
     */
    getReferenceUsages: createCMSEndpoint(
      `/${collectionName}/getReferenceUsages`,
      {
        method: 'GET',
        query: z.object({ rootId: z.string() }),
        metadata: cmsMeta(
          { $Infer: { query: {} as { rootId: string } } },
          {
            permissionResource: 'root',
            operation: 'read',
            scope: 'collection',
            collection: collectionName,
          },
        ),
      },
      async (ctx) => {
        const { scope } = ctx.context;

        // IDOR boundary: the inspected block must be in the caller's scope
        // (tenant + active language). The usage result is matched by rootId, so
        // it stays within the caller's own data.
        await requireRootInScope(
          db,
          ctx.query.rootId,
          collectionName,
          scope.roots,
        );

        // GROUP-LEVEL usage: under i18n, expand the inspected root's translation
        // group to ALL sibling rootIds (cross-language by design — "used on N
        // pages in any language") so a translated sibling reports the true usage
        // instead of 0. Via the scope's reference resolver: identity (just the
        // one root) without i18n; the whole translation group with it. A group is
        // single-collection (a unique key per logical entry), so the resolver's
        // collection-agnostic expansion matches a plain collection-scoped query.
        const resolver = scope.referenceResolver ?? coreReferenceResolver;
        const crossCols = crossScopeColumns(scope.roots);
        const rootIds = await resolver.expandGroup(db, crossCols, [
          ctx.query.rootId,
        ]);

        return getReferenceUsageDetails(db, rootIds, crossCols);
      },
    ),

    /**
     * Fetch commit history for a root across all branches, ordered by creation time descending.
     * Returns commit details including message, author, branch, parents, and publish status.
     * @param rootId Root id.
     * @param limit Max commits to return (default 50, max 200).
     * @param offset Offset for pagination (default 0).
     * @param withChanges When true, each returned commit gains a `changes` field
     *   with `{ added, modified, deleted }` block counts — a cheap ID-level
     *   set-diff between the commit's snapshot and its parent commit's snapshot
     *   (no block properties are loaded). Counts are VERSION-level: any block
     *   whose stored version changed is counted, so a pure move counts as
     *   `modified` on the parent whose children array changed — coarser than
     *   getDiff's classification, intended for history badges. Initial commits
     *   count every live block as added. Merge commits diff against their FIRST
     *   parent only (parent_commit_id — the target-side parent), so the counts
     *   read as "what this merge landed on the target branch". Merge and revert
     *   snapshots drop deletion-landed blocks entirely instead of carrying
     *   tombstones; such absence-based deletions count as `deleted` all the
     *   same (and a revert that restores a dropped block counts it as `added`).
     *   Commits without a snapshot — or whose parent's snapshot is gone (admin
     *   pruning) — omit
     *   `changes` entirely rather than reporting a meaningless diff; in practice
     *   every commit writer (writeCommit, createInitialCommit, executeMerge,
     *   revertBranch) writes a full snapshot, so this only guards repaired or
     *   pruned histories.
     * @returns Array of commit records with total count, offset, and limit.
     * @throws ROOT_NOT_FOUND when rootId does not exist.
     * @example
     * const history = await cmsClient.pages.getRootHistory({
     *   rootId: 'root_123',
     *   limit: 20,
     *   offset: 0
     * });
     */
    getRootHistory: createCMSEndpoint(
      `/${collectionName}/getRootHistory`,
      {
        method: 'GET',
        query: z.object({
          rootId: z.string(),
          limit: z.coerce.number().min(1).max(200).optional(),
          offset: z.coerce.number().min(0).optional(),
          withChanges: wireBooleanSchema.optional(),
        }),
        metadata: cmsMeta(
          {
            $Infer: {
              query: {} as {
                rootId: string;
                limit?: number;
                offset?: number;
                withChanges?: boolean;
              },
            },
          },
          {
            permissionResource: 'root',
            operation: 'read',
            scope: 'collection',
            collection: collectionName,
          },
        ),
      },
      async (ctx) => {
        const { rootId } = ctx.query;
        const limit = ctx.query.limit ?? 50;
        const offset = ctx.query.offset ?? 0;
        const withChanges = wireBooleanIsTrue(ctx.query.withChanges);

        await requireRootInScope(
          db,
          rootId,
          collectionName,
          ctx.context.scope.roots,
        );

        const enrich = userEnrichment(ctx, {
          cmsColumn: 'c.created_by',
          alias: 'commit_user',
          outputKey: 'createdByUser',
        });

        // Branch attribution is STORED on each commit (commits.branch_id /
        // origin_branch_name), set at write time — deterministic, no heuristic.
        // Join the live branch for its current name (follows renames) and fall
        // back to the deletion-proof snapshot if the branch was removed.
        // Total from a separate count (not a per-row CROSS JOIN), so it stays
        // correct — and `hasMore` with it — even when a page past the end returns
        // zero rows.
        const [countResult, result] = await Promise.all([
          db.execute(sql`
            SELECT COUNT(*)::int AS cnt FROM cms.commits WHERE root_id = ${rootId}
          `),
          db.execute(sql`
            SELECT
              c.id,
              c.parent_commit_id,
              c.merge_source_commit_id,
              c.message,
              c.created_by,
              c.created_at,
              EXISTS (SELECT 1 FROM cms.publications p WHERE p.commit_id = c.id) AS is_published,
              COALESCE(b.name, c.origin_branch_name) AS branch_name
              ${enrich.select}
            FROM cms.commits c
            LEFT JOIN cms.branches b ON b.id = c.branch_id
            ${enrich.join}
            WHERE c.root_id = ${rootId}
            GROUP BY c.id, c.parent_commit_id, c.merge_source_commit_id,
                     c.message, c.created_by, c.created_at,
                     b.name, c.origin_branch_name
                     ${enrich.groupBy}
            ORDER BY c.created_at DESC
            LIMIT ${limit} OFFSET ${offset}
          `),
        ]);

        const rows = result.rows as Array<Record<string, unknown>>;
        const total = (countResult.rows[0] as { cnt: number })?.cnt ?? 0;

        // withChanges (opt-in): version-level change counts per commit, computed
        // as an ID-level set-diff between each commit's snapshot and its parent
        // commit's snapshot — ONE query for the whole page, no block properties
        // loaded. Snapshots are complete per-commit maps, but the two sides are
        // NOT id-subsets of each other: writeCommit copies tombstones forward,
        // yet merge snapshots EXCLUDE one-side-deleted blocks entirely
        // (buildMergedSnapshot and the fast-forward path filter tombstones) and
        // revert snapshots are exactly the target commit's map — so a block
        // live in the parent can be simply ABSENT from the child. A per-pair
        // FULL OUTER JOIN between the two snapshots (LATERAL, because the
        // pairs CTE itself cannot be full-outer-joined) sees both sides.
        // Per block id, child version C vs parent version P:
        //   same version id            → unchanged, not counted
        //   no P row, C live           → added (initial commits hit this for
        //                                 every live block; only-in-C tombstones
        //                                 are not counted)
        //   C live,    P tombstone     → added (re-created block id)
        //   C live,    P live          → modified
        //   C tombstone, P live        → deleted
        //   no C row,  P live          → deleted (merge/revert dropped the id)
        //   C tombstone, P tombstone   → not counted (nor "no C row, P
        //                                 tombstone" — already deleted)
        // Merge commits diff against parent_commit_id only (the target-side
        // parent) — see the endpoint JSDoc.
        const changesByCommit = new Map<
          string,
          { added: number; modified: number; deleted: number }
        >();
        if (withChanges && rows.length > 0) {
          const pairs = sql.join(
            rows.map(
              (r) =>
                sql`(${r.id as string}::text, ${(r.parent_commit_id as string | null) ?? null}::text)`,
            ),
            sql`, `,
          );
          const changesResult = await db.execute(sql`
            WITH pairs(child_id, parent_id) AS (VALUES ${pairs})
            SELECT
              p.child_id,
              -- A side whose snapshot is gone (pruned/repaired history) would
              -- make every surviving row count as "added" (parent gone) or
              -- "deleted" (child gone); flag both so the entry omits
              -- \`changes\` instead of reporting a meaningless diff. A pair
              -- where NEITHER side has snapshot rows yields no lateral rows,
              -- so it produces no group and is omitted the same way.
              (p.parent_id IS NOT NULL AND NOT EXISTS (
                SELECT 1 FROM cms.commit_snapshots ps WHERE ps.commit_id = p.parent_id
              )) AS parent_snapshot_missing,
              NOT EXISTS (
                SELECT 1 FROM cms.commit_snapshots cs WHERE cs.commit_id = p.child_id
              ) AS child_snapshot_missing,
              COUNT(*) FILTER (WHERE
                d.c_version_id IS NOT NULL AND NOT bv_c.deleted
                AND (d.p_version_id IS NULL
                     OR (d.p_version_id <> d.c_version_id AND bv_p.deleted))
              )::int AS added,
              COUNT(*) FILTER (WHERE
                d.c_version_id IS NOT NULL AND d.p_version_id IS NOT NULL
                AND d.p_version_id <> d.c_version_id
                AND NOT bv_c.deleted AND NOT bv_p.deleted
              )::int AS modified,
              COUNT(*) FILTER (WHERE
                d.p_version_id IS NOT NULL AND NOT bv_p.deleted
                AND (d.c_version_id IS NULL
                     OR (d.p_version_id <> d.c_version_id AND bv_c.deleted))
              )::int AS deleted
            FROM pairs p
            CROSS JOIN LATERAL (
              SELECT
                cs_c.block_version_id AS c_version_id,
                cs_p.block_version_id AS p_version_id
              FROM (SELECT block_id, block_version_id FROM cms.commit_snapshots
                    WHERE commit_id = p.child_id) cs_c
              FULL OUTER JOIN
                   (SELECT block_id, block_version_id FROM cms.commit_snapshots
                    WHERE commit_id = p.parent_id) cs_p
                ON cs_p.block_id = cs_c.block_id
            ) d
            LEFT JOIN cms.block_versions bv_c ON bv_c.id = d.c_version_id
            LEFT JOIN cms.block_versions bv_p ON bv_p.id = d.p_version_id
            GROUP BY p.child_id, p.parent_id
          `);
          for (const row of changesResult.rows as Array<{
            child_id: string;
            parent_snapshot_missing: boolean;
            child_snapshot_missing: boolean;
            added: number;
            modified: number;
            deleted: number;
          }>) {
            if (row.parent_snapshot_missing || row.child_snapshot_missing) {
              continue;
            }
            changesByCommit.set(row.child_id, {
              added: row.added,
              modified: row.modified,
              deleted: row.deleted,
            });
          }
        }

        const data = rows.map((r) => {
          const parents: string[] = [];
          if (r.parent_commit_id) parents.push(r.parent_commit_id as string);
          if (r.merge_source_commit_id)
            parents.push(r.merge_source_commit_id as string);

          const type: 'commit' | 'merge' | 'initial' = r.merge_source_commit_id
            ? 'merge'
            : !r.parent_commit_id
              ? 'initial'
              : 'commit';

          // Intersection keeps the enrichment keys open (enrich.apply writes
          // dynamic columns) while still typing `changes` for callers.
          const item: Record<string, unknown> & {
            changes?: { added: number; modified: number; deleted: number };
          } = {
            id: r.id,
            message: r.message,
            createdBy: r.created_by,
            // A Date, like every other list endpoint (listRoots, listBranches,
            // comments, approvals) — not an ISO string (ret-15).
            createdAt: parseTimestamp(r.created_at),
            branch: r.branch_name as string,
            parents,
            type,
            isPublished: r.is_published,
          };

          // Empty map unless withChanges — entries without a computable diff
          // (missing snapshots) omit the field entirely.
          const changes = changesByCommit.get(r.id as string);
          if (changes) item.changes = changes;

          enrich.apply(item, r);

          return item;
        });

        return {
          commits: data,
          total,
          hasMore: offset + data.length < total,
        };
      },
    ),
  };
}
