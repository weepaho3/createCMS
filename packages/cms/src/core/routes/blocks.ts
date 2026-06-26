import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import * as z from 'zod';

import type {
  CMSProcedureCtx,
  CollectionWithName,
  InferBlockTreeNode,
  InferCreateBlockInput,
  InferUpdateBlockInput,
  ListRootsResult,
  RootSummary,
} from '../types';
import type { ResolvedSlugConfig } from '../types/definitions';

import { newId } from '../../utils/nanoid';
import {
  createInitialCommit,
  writeCommit,
  type ChangedVersion,
} from '../blocks/commit-writer';
import { deepCopySubtree, type BlockVersionRow } from '../blocks/copy-subtree';
import { diffTree } from '../blocks/diff-tree';
import { assertBranchWritable, requireRootInScope } from '../blocks/guards';
import {
  assertPlacementAllowed,
  buildPlacementIndex,
} from '../blocks/placement';
import {
  assembleBlockTree,
  loadBlocksAtCommit,
  type BlockTreeNode,
} from '../blocks/reconstruct-snapshot';
import { resolveBranchPolicy } from '../branch-policy';
import {
  blockVersions,
  branches,
  commitSnapshots,
  mergeRequests,
  publications,
  roots,
} from '../db/schema.generated';
import { cmsMeta, createCMSEndpoint } from '../endpoint';
import { CMSError, errorMessages } from '../errors';
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
import { batchFetchRoots } from '../root/batch-fetch';
import {
  type ListRootsQuery,
  type RootInput,
  type UpdateRootInput,
  ROOT_COLUMN_FIELDS,
  buildBlockInputSchema,
  buildListRootsQuerySchema,
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
import { userEnrichment } from '../user/enrichment';
import { loadVariables, substituteVariables } from '../variables';

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
  cmsCtx: CMSProcedureCtx,
) {
  const { db } = cmsCtx;
  const collectionName = def.name;
  // Derived once per collection: the placement rules the create/move/duplicate
  // routes enforce — `accepts`/`excludes` from `structure` plus the
  // `allowChildren` container gate from the block defs.
  const placementIndex = buildPlacementIndex(def.structure, def.blocks);

  // Branch-protection policy. When `protectPublishedBranches` is on, a branch is
  // read-only for direct content mutations exactly while it is published; the
  // mutation routes below call the shared `assertBranchWritable` guard.
  // `createRoot` seeds a fresh, unpublished branch and is never gated.
  const branchPolicy = resolveBranchPolicy(cmsCtx);

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

          if (!slug && !slugCfg.allowRoot) {
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

          if (slugCfg?.enabled && slug !== null) {
            await validateSlugUniqueness(
              tx as any,
              collectionName,
              parentRootId,
              slug,
              undefined,
              scope.roots?.insertColumns,
            );
          }

          const root = await scopedInsert(
            tx as any,
            'cms.roots',
            {
              id: newId('root'),
              collection: collectionName,
              parent_root_id: parentRootId,
              slug: slug,
              sort_order: 0,
              created_by: actor,
              // Plugin-contributed per-new-entry columns (Seam D): a new root is
              // a new logical entry, so the i18n plugin mints a fresh
              // translation_key here; none are added without such a plugin.
              ...(scope.roots?.newEntryColumns?.() ?? {}),
            },
            scope.roots,
          );

          const rootProps =
            (ctx.body.properties as Record<string, unknown> | undefined) ?? {};

          const { commitId, branchId } = await createInitialCommit(tx, def, {
            rootId: root.id,
            branchName: branchPolicy.defaultBranchName,
            message: commitMessage(message, 'Initial commit'),
            createdBy: actor,
            versions: [
              {
                blockId: root.id,
                type: collectionName,
                properties: rootProps,
                children: [],
              },
            ],
          });

          return {
            rootId: root.id,
            branchId,
            commitId,
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
     * @param filterValue Value to match in the filter field.
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

        const columnFields: Record<string, { column: any; alias: string }> = {
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

        const countQuery = sql`
          SELECT COUNT(*)::int AS count
          FROM (${filteredRootsQuery}) AS filtered_roots
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

        const rootRows = (result.rows as Array<Record<string, unknown>>).map(
          (row) => {
            const item: Record<string, unknown> = {
              rootId: row.root_id,
              createdAt: new Date(row.created_at as string),
              createdBy: (row.created_by as string | null) ?? undefined,
              parentRootId: (row.parent_root_id as string | null) ?? undefined,
              slug: (row.slug as string | null) ?? undefined,
              sortOrder: row.sort_order,
              properties: row.properties,
              hasPublications: parseInt(String(row.publication_count), 10) > 0,
              publicationCount: parseInt(String(row.publication_count), 10),
              branchCount: parseInt(String(row.branch_count), 10),
              openMergeRequestCount: parseInt(String(row.open_mr_count), 10),
            };

            enrich.apply(item, row);

            return item;
          },
        );

        // Full URL path per row: resolve each listed root's ancestor chain UP to
        // the top (an anchored recursive CTE — pagination-safe, unlike building
        // the path from only the loaded page), then apply the collection's slug
        // config. Parents are same-scope by construction, so no extra scope gate.
        const slugCfg = def.slug as ResolvedSlugConfig | undefined;
        if (slugCfg?.enabled && rootRows.length > 0) {
          const ids = rootRows.map((r) => r.rootId as string);
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
            item.path = pathByRoot.get(item.rootId as string) ?? '/';
          }
        }

        return {
          roots: rootRows,
          total,
          hasMore: offset + rootRows.length < total,
        } as unknown as ListRootsResult<TDef['root']['properties']>;
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

          const [branch] = await tx
            .select({
              id: branches.id,
              name: branches.name,
              headCommitId: branches.headCommitId,
            })
            .from(branches)
            .where(and(eq(branches.id, branchId), eq(branches.rootId, rootId)))
            .for('update');
          if (!branch) throw new CMSError('BRANCH_NOT_FOUND');
          await assertBranchWritable(tx, branchPolicy, rootId, branch.id);

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
          const blockProps = (properties as Record<string, unknown>) ?? {};

          const newChildrenArray = [...(parentVersion.children ?? [])];
          const insertPosition = position ?? newChildrenArray.length;
          newChildrenArray.splice(insertPosition, 0, childBlockId);

          const { commitId } = await writeCommit(tx, def, {
            rootId,
            branchId,
            parentCommitId: oldHeadId,
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
            commitId,
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
        }),
        metadata: cmsMeta(
          {
            $Infer: {
              query: {} as {
                rootId: string;
                branchId: string;
                commitId?: string;
                raw?: boolean;
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
        const { rootId, branchId, commitId, raw } = ctx.query;

        // Scope gate: reject a root outside the caller's scope before resolving
        // any commit (closes IDOR via rootId on both resolution paths). It also
        // confirms the root belongs to this collection, so the branch lookup
        // below no longer needs to join roots.
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

        if (!raw) {
          const vars = await loadVariables(db);
          substituteVariables(tree, vars);
        }

        return { tree, reconstructed } as unknown as {
          tree: InferBlockTreeNode<TDef['blocks'], TDef['root']['properties']>;
          reconstructed: boolean;
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

          const [branch] = await tx
            .select({
              id: branches.id,
              name: branches.name,
              headCommitId: branches.headCommitId,
            })
            .from(branches)
            .where(
              and(
                eq(branches.id, input.branchId),
                eq(branches.rootId, input.rootId),
              ),
            )
            .for('update');
          if (!branch) throw new CMSError('BRANCH_NOT_FOUND');
          await assertBranchWritable(tx, branchPolicy, input.rootId, branch.id);

          const oldHeadId = branch.headCommitId;

          const allSnaps = await tx
            .select({
              blockId: commitSnapshots.blockId,
              blockVersionId: commitSnapshots.blockVersionId,
            })
            .from(commitSnapshots)
            .where(eq(commitSnapshots.commitId, oldHeadId));

          const snapVersionIds = allSnaps.map((s) => s.blockVersionId);
          if (snapVersionIds.length === 0) throw new CMSError('EMPTY_SNAPSHOT');

          const allVersions = await tx
            .select()
            .from(blockVersions)
            .where(inArray(blockVersions.id, snapVersionIds));

          const versionByBlockId = new Map(
            allVersions.map((v) => [v.blockId, v]),
          );

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

          const descendants = new Set<string>();
          const collectDescendants = (id: string) => {
            const v = versionByBlockId.get(id);
            if (!v) return;
            for (const childId of v.children ?? []) {
              descendants.add(childId);
              collectDescendants(childId);
            }
          };
          collectDescendants(input.blockId);

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

          const { commitId } = await writeCommit(tx, def, {
            rootId: input.rootId,
            branchId: input.branchId,
            parentCommitId: oldHeadId,
            message: commitMessage(
              input.message,
              `Move block ${input.blockId}`,
            ),
            createdBy: userId,
            changed,
          });

          return { commitId };
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
        }),
        metadata: cmsMeta(
          {
            $Infer: {
              body: {} as {
                rootId: string;
                branchId: string;
                blockId: string;
                message?: string;
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

          const [branch] = await tx
            .select({
              id: branches.id,
              name: branches.name,
              headCommitId: branches.headCommitId,
            })
            .from(branches)
            .where(
              and(
                eq(branches.id, input.branchId),
                eq(branches.rootId, input.rootId),
              ),
            )
            .for('update');
          if (!branch) throw new CMSError('BRANCH_NOT_FOUND');
          await assertBranchWritable(tx, branchPolicy, input.rootId, branch.id);

          const oldHeadId = branch.headCommitId;

          const allSnaps = await tx
            .select({
              blockId: commitSnapshots.blockId,
              blockVersionId: commitSnapshots.blockVersionId,
            })
            .from(commitSnapshots)
            .where(eq(commitSnapshots.commitId, oldHeadId));

          const snapVersionIds = allSnaps.map((s) => s.blockVersionId);
          if (snapVersionIds.length === 0) throw new CMSError('EMPTY_SNAPSHOT');

          const allVersions = await tx
            .select()
            .from(blockVersions)
            .where(inArray(blockVersions.id, snapVersionIds));

          const versionByBlockId = new Map(
            allVersions.map((v) => [v.blockId, v]),
          );

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

          const deletedBlockIds = new Set<string>([input.blockId]);
          const collectDescendants = (blockId: string) => {
            const version = versionByBlockId.get(blockId);
            if (!version) return;
            for (const childId of version.children ?? []) {
              deletedBlockIds.add(childId);
              collectDescendants(childId);
            }
          };
          collectDescendants(input.blockId);

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

          const { commitId } = await writeCommit(tx, def, {
            rootId: input.rootId,
            branchId: input.branchId,
            parentCommitId: oldHeadId,
            message: commitMessage(
              input.message,
              `Delete block ${input.blockId}`,
            ),
            createdBy: userId,
            changed,
          });

          return { commitId };
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
     * @returns Object with mode ('root' or 'child'), commitId, blockId, and (for root) rootId and branchId.
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
        const { userId } = ctx.context;
        const input = ctx.body;

        return db.transaction(async (tx) => {
          await requireRootInScope(
            tx,
            input.rootId,
            collectionName,
            ctx.context.scope.roots,
          );

          const [sourceBranch] = await tx
            .select({
              id: branches.id,
              name: branches.name,
              headCommitId: branches.headCommitId,
            })
            .from(branches)
            .where(
              and(
                eq(branches.id, input.branchId),
                eq(branches.rootId, input.rootId),
              ),
            )
            .for('update');
          if (!sourceBranch) throw new CMSError('BRANCH_NOT_FOUND');
          await assertBranchWritable(
            tx,
            branchPolicy,
            input.rootId,
            sourceBranch.id,
          );

          const oldHeadId = sourceBranch.headCommitId;
          const allSnaps = await tx
            .select({
              blockId: commitSnapshots.blockId,
              blockVersionId: commitSnapshots.blockVersionId,
            })
            .from(commitSnapshots)
            .where(eq(commitSnapshots.commitId, oldHeadId));

          const snapVersionIds = allSnaps.map((s) => s.blockVersionId);
          if (snapVersionIds.length === 0) throw new CMSError('EMPTY_SNAPSHOT');

          const allVersions = await tx
            .select()
            .from(blockVersions)
            .where(inArray(blockVersions.id, snapVersionIds));

          const versionByBlockId = new Map<string, BlockVersionRow>(
            allVersions.map((v) => [
              v.blockId,
              {
                blockId: v.blockId,
                type: v.type,
                properties: v.properties,
                children: (v.children ?? []) as string[],
                deleted: v.deleted,
              },
            ]),
          );

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

            // A duplicated root is created top-level (parent_root_id NULL). The
            // core slug index is no longer unique, so this app-level check is the
            // authority — previously this path leaned on the DB unique and threw a
            // raw constraint error; now it throws SLUG_ALREADY_EXISTS cleanly.
            if (dupSlug !== null) {
              await validateSlugUniqueness(
                tx as any,
                collectionName,
                null,
                dupSlug,
                undefined,
                ctx.context.scope.roots?.insertColumns,
              );
            }

            const newRoot = await scopedInsert(
              tx as any,
              'cms.roots',
              {
                id: newId('root'),
                collection: collectionName,
                slug: dupSlug,
                created_by: userId,
                // Plugin-contributed per-new-entry columns (Seam D): a duplicate
                // is a NEW logical entry, so the i18n plugin mints a fresh
                // translation_key here.
                ...(ctx.context.scope.roots?.newEntryColumns?.() ?? {}),
              },
              ctx.context.scope.roots,
            );

            const versions: ChangedVersion[] = copies.map((copy) => {
              const isTopLevel = copy.oldBlockId === input.blockId;
              return {
                blockId: isTopLevel ? newRoot.id : copy.newBlockId,
                type: isTopLevel ? collectionName : copy.type,
                properties: isTopLevel
                  ? (input.targetProperties as Record<string, unknown>)
                  : copy.properties,
                children: copy.newChildren,
              };
            });

            const { commitId, branchId } = await createInitialCommit(tx, def, {
              rootId: newRoot.id,
              branchName: branchPolicy.defaultBranchName,
              message: commitMessage(input.message, 'Duplicated root'),
              createdBy: userId,
              versions,
            });

            return {
              mode: 'root' as const,
              rootId: newRoot.id,
              branchId,
              commitId,
            };
          }

          const parentVersion = versionByBlockId.get(
            input.targetParentBlockId!,
          );
          if (!parentVersion)
            throw new CMSError('PARENT_NOT_FOUND', {
              message: errorMessages.parentNotFound(input.targetParentBlockId!),
            });
          if (parentVersion.deleted)
            throw new CMSError('BLOCK_ALREADY_DELETED', {
              message: errorMessages.blockAlreadyDeleted(
                input.targetParentBlockId!,
              ),
            });

          assertPlacementAllowed(
            placementIndex,
            sourceVersion.type,
            input.targetParentBlockId === input.rootId
              ? 'root'
              : parentVersion.type,
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

          const { commitId } = await writeCommit(tx, def, {
            rootId: input.rootId,
            branchId: input.branchId,
            parentCommitId: oldHeadId,
            message: commitMessage(
              input.message,
              `Duplicate block ${input.blockId}`,
            ),
            createdBy: userId,
            changed,
          });

          return {
            mode: 'child' as const,
            commitId,
            blockId: topLevelCopyId,
          };
        });
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

        return db.transaction(async (tx) => {
          await requireRootInScope(
            tx,
            rootId,
            collectionName,
            ctx.context.scope.roots,
          );

          const [branch] = await tx
            .select({
              id: branches.id,
              name: branches.name,
              headCommitId: branches.headCommitId,
            })
            .from(branches)
            .where(and(eq(branches.id, branchId), eq(branches.rootId, rootId)))
            .for('update');
          if (!branch) throw new CMSError('BRANCH_NOT_FOUND');
          await assertBranchWritable(tx, branchPolicy, rootId, branch.id);

          const oldHeadId = branch.headCommitId;

          const [blockSnap] = await tx
            .select({ blockVersionId: commitSnapshots.blockVersionId })
            .from(commitSnapshots)
            .where(
              and(
                eq(commitSnapshots.commitId, oldHeadId),
                eq(commitSnapshots.blockId, blockId),
              ),
            );
          if (!blockSnap)
            throw new CMSError('BLOCK_NOT_FOUND', {
              message: errorMessages.blockNotFound(blockId),
            });

          const [currentVersion] = await tx
            .select()
            .from(blockVersions)
            .where(eq(blockVersions.id, blockSnap.blockVersionId));

          if (currentVersion.deleted)
            throw new CMSError('BLOCK_ALREADY_DELETED', {
              message: errorMessages.blockAlreadyDeleted(blockId),
            });

          if (currentVersion.type !== type)
            throw new CMSError('TYPE_MISMATCH', {
              message: errorMessages.typeMismatch(currentVersion.type, type),
              data: { expected: currentVersion.type, actual: type },
            });

          const mergedProperties = applyPropertyPatch(
            currentVersion.properties as Record<string, unknown>,
            (properties ?? {}) as Record<string, unknown>,
          );

          const { commitId } = await writeCommit(tx, def, {
            rootId,
            branchId,
            parentCommitId: oldHeadId,
            message: commitMessage(message, `Update ${type} block ${blockId}`),
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

          return { commitId };
        });
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

        return db.transaction(async (tx) => {
          await requireRootInScope(
            tx,
            rootId,
            collectionName,
            ctx.context.scope.roots,
          );

          const [branch] = await tx
            .select({
              id: branches.id,
              name: branches.name,
              headCommitId: branches.headCommitId,
            })
            .from(branches)
            .where(and(eq(branches.id, branchId), eq(branches.rootId, rootId)))
            .for('update');
          if (!branch) throw new CMSError('BRANCH_NOT_FOUND');
          await assertBranchWritable(tx, branchPolicy, rootId, branch.id);

          const oldHeadId = branch.headCommitId;

          const [blockSnap] = await tx
            .select({ blockVersionId: commitSnapshots.blockVersionId })
            .from(commitSnapshots)
            .where(
              and(
                eq(commitSnapshots.commitId, oldHeadId),
                eq(commitSnapshots.blockId, blockId),
              ),
            );
          if (!blockSnap)
            throw new CMSError('BLOCK_NOT_FOUND', {
              message: errorMessages.blockNotFound(blockId),
            });

          const [currentVersion] = await tx
            .select()
            .from(blockVersions)
            .where(eq(blockVersions.id, blockSnap.blockVersionId));

          if (currentVersion.deleted)
            throw new CMSError('BLOCK_ALREADY_DELETED', {
              message: errorMessages.blockAlreadyDeleted(blockId),
            });

          if (currentVersion.type !== collectionName)
            throw new CMSError('TYPE_MISMATCH', {
              message: errorMessages.typeMismatch(
                collectionName,
                currentVersion.type,
              ),
              data: { expected: collectionName, actual: currentVersion.type },
            });

          const mergedProperties = applyPropertyPatch(
            currentVersion.properties as Record<string, unknown>,
            (properties ?? {}) as Record<string, unknown>,
          );

          const { commitId } = await writeCommit(tx, def, {
            rootId,
            branchId,
            parentCommitId: oldHeadId,
            message: commitMessage(message, `Update root block ${blockId}`),
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

          // Update slug on roots table if provided
          const slugCfg = def.slug as ResolvedSlugConfig | undefined;
          if (slugCfg?.enabled && newSlug !== undefined) {
            const normalized = slugCfg.normalize
              ? normalizeSlug(newSlug)
              : newSlug;

            if (!normalized && !slugCfg.allowRoot) {
              throw new CMSError('SLUG_EMPTY_NOT_ALLOWED');
            }

            const [currentRoot] = await tx
              .select({
                slug: roots.slug,
                parentRootId: roots.parentRootId,
              })
              .from(roots)
              .where(eq(roots.id, rootId));

            // Only on an ACTUAL slug change: validate, capture the subtree's OLD
            // paths, apply the change, then auto-create redirects (old → page).
            if (currentRoot.slug !== normalized) {
              await validateSlugUniqueness(
                tx as any,
                collectionName,
                currentRoot.parentRootId,
                normalized,
                rootId,
                ctx.context.scope.roots?.insertColumns,
              );

              const captured = await captureSubtreePaths(
                tx as any,
                slugCfg,
                rootId,
              );

              await tx
                .update(roots)
                .set({ slug: normalized })
                .where(eq(roots.id, rootId));

              await recordSubtreeRedirects(
                tx as any,
                collectionName,
                captured,
                ctx.context.scope.redirects,
              );
            }
          }

          return { commitId };
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
        }),
        metadata: cmsMeta(
          {
            $Infer: {
              body: {} as {
                rootId: string;
                branchId: string;
                tree: BlockTreeNode;
                message?: string;
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
        const { rootId, branchId, tree, message } = ctx.body;

        return db.transaction(async (tx) => {
          await requireRootInScope(
            tx,
            rootId,
            collectionName,
            ctx.context.scope.roots,
          );

          const [branch] = await tx
            .select({
              id: branches.id,
              name: branches.name,
              headCommitId: branches.headCommitId,
            })
            .from(branches)
            .where(and(eq(branches.id, branchId), eq(branches.rootId, rootId)))
            .for('update');
          if (!branch) throw new CMSError('BRANCH_NOT_FOUND');
          await assertBranchWritable(tx, branchPolicy, rootId, branch.id);

          const oldHeadId = branch.headCommitId;

          const { blocks: currentBlocks } = await loadBlocksAtCommit(
            tx as any,
            oldHeadId,
            rootId,
          );

          const diff = diffTree(tree, currentBlocks);

          if (
            diff.created.length === 0 &&
            diff.updated.length === 0 &&
            diff.deleted.length === 0
          ) {
            return { commitId: oldHeadId };
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

          const { commitId } = await writeCommit(tx, def, {
            rootId,
            branchId,
            parentCommitId: oldHeadId,
            message: commitMessage(message, 'Batch update'),
            createdBy: userId,
            changed,
          });

          return { commitId };
        });
      },
    ),

    /**
     * Reparent a root to a new parent (or set to top-level); auto-creates redirects if parent changes.
     * Nesting must be enabled in collection definition; circular references are rejected.
     * @param rootId Root id to move.
     * @param newParentRootId New parent root id (or null for top-level).
     * @param sortOrder Sort order in parent's children (optional).
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
          sortOrder: z.number().optional(),
        }),
        metadata: cmsMeta(
          {
            $Infer: {
              body: {} as {
                rootId: string;
                newParentRootId: string | null;
                sortOrder?: number;
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

        const { rootId, newParentRootId, sortOrder } = ctx.body;

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

            if (await isAncestorOf(tx as any, newParentRootId, rootId)) {
              throw new CMSError('CIRCULAR_REFERENCE');
            }
          }

          if (root.slug) {
            await validateSlugUniqueness(
              tx as any,
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
            ? await captureSubtreePaths(tx as any, slugCfg, rootId)
            : [];

          await tx
            .update(roots)
            .set({
              parentRootId: newParentRootId,
              sortOrder: sortOrder ?? 0,
            })
            .where(eq(roots.id, rootId));

          if (reparented) {
            await recordSubtreeRedirects(
              tx as any,
              collectionName,
              captured,
              ctx.context.scope.redirects,
            );
          }

          return { rootId, newParentRootId };
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

        const map = await batchFetchRoots(
          db,
          [rootId],
          branchPolicy.defaultBranchName,
        );
        const root = map.get(rootId);
        if (!root) throw new CMSError('ROOT_NOT_FOUND');

        return root as unknown as RootSummary<TDef['root']['properties']>;
      },
    ),

    /**
     * Lookup a root by slug (and optional parent); returns root summary if unique.
     * Slugs are normalized if normalization is enabled in collection definition.
     * @param slug Slug to search for.
     * @param parentRootId Parent id for nested lookup (omit for top-level roots).
     * @returns Root summary (same fields as getRoot).
     * @throws SLUG_NOT_ENABLED when slug feature is disabled in collection definition.
     * @throws ROOT_NOT_FOUND when no root matches the slug.
     * @throws AMBIGUOUS_SLUG when multiple roots match (should not occur with proper uniqueness).
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

        const conditions = [
          eq(roots.collection, collectionName),
          eq(roots.slug, lookupSlug),
          isNull(roots.archivedAt),
          parent === null
            ? isNull(roots.parentRootId)
            : eq(roots.parentRootId, parent),
        ];
        if (ctx.context.scope.roots?.where) {
          conditions.push(ctx.context.scope.roots.where);
        }

        const matches = await db
          .select({ rootId: roots.id })
          .from(roots)
          .where(and(...conditions));

        if (matches.length === 0) throw new CMSError('ROOT_NOT_FOUND');
        if (matches.length > 1) throw new CMSError('AMBIGUOUS_SLUG');

        const rootId = matches[0].rootId;
        const map = await batchFetchRoots(
          db,
          [rootId],
          branchPolicy.defaultBranchName,
        );
        const root = map.get(rootId);
        if (!root) throw new CMSError('ROOT_NOT_FOUND');

        return root as unknown as RootSummary<TDef['root']['properties']>;
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
     * const result = await cmsClient.pages.deleteRoot({
     *   rootId: 'root_123'
     * });
     */
    deleteRoot: createCMSEndpoint(
      `/${collectionName}/deleteRoot`,
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
          // translation SIBLING reached only via read-time auto-upgrade (RB3) is
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
            oldPath = await resolveRootCurrentPath(tx as any, slugCfg, rootId);
          }

          // Soft-archive: history (branches/commits/blockVersions) is preserved;
          // physical removal is the pruning layer's job.
          await tx
            .update(roots)
            .set({ archivedAt: new Date() })
            .where(eq(roots.id, rootId));

          await recordArchiveRedirect(
            tx as any,
            collectionName,
            oldPath,
            parentRootId,
            ctx.context.scope.redirects,
          );

          return { rootId };
        });
      },
    ),

    // "Which pages embed this reusable block?" — group-level usage for the editor.
    // Reads the content_usages reference index (populated dark in RB1).
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
        // collection-agnostic expansion matches the old collection-scoped query.
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
        }),
        metadata: cmsMeta(
          {
            $Infer: {
              query: {} as {
                rootId: string;
                limit?: number;
                offset?: number;
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
        const result = await db.execute(sql`
          WITH total AS (
            SELECT COUNT(*)::int AS cnt FROM cms.commits WHERE root_id = ${rootId}
          )
          SELECT
            c.id,
            c.parent_commit_id,
            c.merge_source_commit_id,
            c.message,
            c.created_by,
            c.created_at,
            EXISTS (SELECT 1 FROM cms.publications p WHERE p.commit_id = c.id) AS is_published,
            COALESCE(b.name, c.origin_branch_name) AS branch_name,
            t.cnt AS total
            ${enrich.select}
          FROM cms.commits c
          CROSS JOIN total t
          LEFT JOIN cms.branches b ON b.id = c.branch_id
          ${enrich.join}
          WHERE c.root_id = ${rootId}
          GROUP BY c.id, c.parent_commit_id, c.merge_source_commit_id,
                   c.message, c.created_by, c.created_at,
                   b.name, c.origin_branch_name, t.cnt
                   ${enrich.groupBy}
          ORDER BY c.created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `);

        const rows = result.rows as Array<Record<string, unknown>>;
        const total = (rows[0]?.total as number) ?? 0;

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

          const item: Record<string, unknown> = {
            id: r.id,
            message: r.message,
            createdBy: r.created_by,
            createdAt: new Date(r.created_at as string).toISOString(),
            branch: r.branch_name as string,
            parents,
            type,
            isPublished: r.is_published,
          };

          enrich.apply(item, r);

          return item;
        });

        return { data, total, offset, limit };
      },
    ),
  };
}
