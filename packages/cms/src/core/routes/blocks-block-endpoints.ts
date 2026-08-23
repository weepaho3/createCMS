import { and, eq } from 'drizzle-orm';
import * as z from 'zod';

import type {
  AnyBlockDefinition,
  CollectionWithName,
  InferBlockTreeNode,
  InferCreateBlockInput,
  InferUpdateBlockInput,
} from '../types';

import { newId } from '../../utils/nanoid';
import { defaultPropertiesFor } from '../block-defaults';
import {
  fetchCommitSummary,
  writeCommit,
  type ChangedVersion,
} from '../blocks/commit-writer';
import { collectDescendantIds } from '../blocks/copy-subtree';
import { diffTree } from '../blocks/diff-tree';
import { lockWritableBranch, requireRootInScope } from '../blocks/guards';
import { assertPlacementAllowed } from '../blocks/placement';
import {
  assembleBlockTree,
  loadBlocksAtCommit,
  loadVersionMapAtCommit,
  type BlockTreeNode,
} from '../blocks/reconstruct-snapshot';
import {
  blockVersions,
  branches,
  commitSnapshots,
} from '../db/schema.generated';
import { cmsMeta, createCMSEndpoint } from '../endpoint';
import { CMSError, errorMessages } from '../errors';
import { resolveLinkPaths } from '../links';
import { coreReferenceResolver, getReferenceUsageDetails } from '../references';
import {
  buildReferencePreviews,
  resolveTreeReferences,
} from '../references-render';
import {
  buildBlockInputSchema,
  buildPropertiesSchema,
  buildUpdateBlockInputSchema,
} from '../schema-builders';
import { crossScopeColumns } from '../scope';
import { loadTemplateStrings } from '../templates';
import { wireBooleanIsTrue, wireBooleanSchema } from '../utils/wire-boolean';
import { loadVariables, substituteVariables } from '../variables';
import {
  blockTreeNodeSchema,
  resolvedLinkKeys,
  type BlocksContext,
} from './blocks-context';

// ============================================================================
// Block endpoints (9): createBlock, getBlockTree, resolveTree, moveBlock, deleteBlock,
// duplicateBlock, updateBlock, updateBlocks, getReferenceUsages
// ============================================================================

export function createBlockEndpoints<TDef extends CollectionWithName>(
  ctx: BlocksContext<TDef>,
) {
  const {
    def,
    cmsCtx,
    db,
    collectionName,
    placementIndex,
    branchPolicy,
    commitMessage,
    runDuplicate,
    collectPropertyReferences,
    assertCollectedReferencesExist,
    assertPropertyReferencesExist,
    patchSingleVersion,
  } = ctx;

  return {
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
          // Schema validation already rejects a negative/fractional `position`
          // (see buildBlockInputSchema); an out-of-range POSITIVE index would
          // still land correctly via splice's own clamping, but make that
          // explicit rather than incidental — matches moveBlock's clamp.
          const insertPosition = Math.min(
            position ?? newChildrenArray.length,
            newChildrenArray.length,
          );
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
          raw: wireBooleanSchema.optional(),
          includeReferencePreviews: wireBooleanSchema.optional(),
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
        const { rootId, branchId, commitId } = ctx.query;
        const raw = wireBooleanIsTrue(ctx.query.raw);
        const includeReferencePreviews = wireBooleanIsTrue(
          ctx.query.includeReferencePreviews,
        );

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
     * Resolve a posted, unsaved tree the way `getBlockTree` (without `raw`)
     * resolves a stored one: variables substituted, links resolved to their
     * current href, and — on request — the published preview of every embedded
     * reference as a `references` sidecar and/or the references inlined into
     * the tree. Nothing is persisted and no commit is written; the tree is not
     * validated against the schema (unknown block types and undeclared
     * properties pass through untouched), so an editor can preview a
     * half-finished tree.
     * @param rootId Root id (scope gate: the root must exist in the caller's scope and this collection).
     * @param branchId Branch of that root (must exist; not read).
     * @param tree The tree to resolve, root node first (`type: 'root'` as `getBlockTree` returns it).
     * @param includeReferencePreviews Also return the `references` sidecar (published previews keyed by the stored reference value).
     * @param inlineReferences Replace reference values by their resolved published trees inside `tree` (the `getPublishedContent` shape).
     * @returns The resolved tree and, when requested, the `references` sidecar.
     * @throws ROOT_NOT_FOUND when the root is not in scope or not in this collection.
     * @throws BRANCH_NOT_FOUND when the branch does not belong to the root.
     * @example
     * const { tree } = await cmsClient.pages.resolveTree({
     *   rootId: 'root_123',
     *   branchId: 'br_main',
     *   tree: editedTree,
     * });
     */
    resolveTree: createCMSEndpoint(
      `/${collectionName}/resolveTree`,
      {
        method: 'POST',
        body: z.object({
          rootId: z.string(),
          branchId: z.string(),
          tree: z.lazy(() => blockTreeNodeSchema) as z.ZodType<BlockTreeNode>,
          includeReferencePreviews: z.boolean().optional(),
          inlineReferences: z.boolean().optional(),
        }),
        metadata: cmsMeta(
          {
            $Infer: {
              body: {} as {
                rootId: string;
                branchId: string;
                tree: BlockTreeNode;
                includeReferencePreviews?: boolean;
                inlineReferences?: boolean;
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
        const {
          rootId,
          branchId,
          tree,
          includeReferencePreviews,
          inlineReferences,
        } = ctx.body;

        // Scope gate first (closes IDOR via rootId): the root must exist in the
        // caller's scope and belong to this collection.
        await requireRootInScope(
          db,
          rootId,
          collectionName,
          ctx.context.scope.roots,
        );
        const [branch] = await db
          .select({ id: branches.id })
          .from(branches)
          .where(and(eq(branches.id, branchId), eq(branches.rootId, rootId)));
        if (!branch) throw new CMSError('BRANCH_NOT_FOUND');

        const scope = ctx.context.scope;
        const resolver = scope.referenceResolver ?? coreReferenceResolver;
        const scopeColumns = crossScopeColumns(scope.roots);
        const vars = await loadVariables(db, scope);

        // The sidecar is keyed by the STORED reference values, so it is built
        // from the tree as posted — before any inlining replaces those values.
        let references: Record<string, BlockTreeNode> | undefined;
        if (includeReferencePreviews) {
          references = await buildReferencePreviews(
            db,
            tree,
            def,
            cmsCtx.collections,
            resolver,
            scopeColumns,
            vars,
            scope.abTestResolver,
          );
        }

        // Same order as the published render: inline references first, then
        // variables and links, so both also apply inside inlined subtrees.
        if (inlineReferences) {
          await resolveTreeReferences(
            db,
            tree,
            def,
            cmsCtx.collections,
            resolver,
            scopeColumns,
            new Set([rootId]),
            0,
            scope.abTestResolver,
          );
        }
        substituteVariables(tree, vars);
        await resolveLinkPaths(
          db,
          tree,
          def,
          cmsCtx.collections,
          resolver,
          scopeColumns,
        );

        return {
          tree,
          ...(references ? { references } : {}),
        } as unknown as {
          tree: InferBlockTreeNode<TDef['blocks'], TDef['root']['properties']>;
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
     * Clone a block subtree under an existing parent (child duplication only).
     * To spin a subtree off into a brand-new top-level entry, use `duplicateRoot`
     * instead.
     * @param rootId Root id (for source branch).
     * @param branchId Source branch id.
     * @param blockId Block id to duplicate (and its entire subtree).
     * @param targetParentBlockId Parent block for the duplicate.
     * @param targetIndex Index in parent's children.
     * @param message Optional commit message.
     * @returns Object with `mode` (always `'child'`), `commit` ({ id, message, createdAt, createdBy }), and `blockId` (the new copy's id).
     * @throws BLOCK_NOT_FOUND when source blockId does not exist.
     * @throws BLOCK_ALREADY_DELETED when source block is marked deleted.
     * @throws PARENT_NOT_FOUND when targetParentBlockId does not exist.
     * @throws DUPLICATE_BLOCK_REQUIRES_PARENT when targetParentBlockId is omitted.
     */
    duplicateBlock: createCMSEndpoint(
      `/${collectionName}/duplicateBlock`,
      {
        method: 'POST',
        body: z.object({
          rootId: z.string(),
          branchId: z.string(),
          blockId: z.string(),
          targetParentBlockId: z.string(),
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
                targetParentBlockId: string;
                targetProperties?: Record<string, unknown>;
                targetSlug?: string;
                targetIndex?: number;
                message?: string;
              },
            },
          },
          {
            // Child-duplication only (root mode moved to `duplicateRoot`), so
            // 'block' is the exhaustive most-privileged act this endpoint can
            // perform.
            permissionResource: 'block',
            operation: 'create',
            scope: 'collection',
            collection: collectionName,
          },
        ),
      },
      async (ctx) => {
        // Defensive boundary guard: schema validation already requires
        // targetParentBlockId, but make the invariant explicit here since
        // runDuplicate's root-mode branch is a privileged act (root:create)
        // that this endpoint must never reach.
        if (!ctx.body.targetParentBlockId) {
          throw new CMSError('DUPLICATE_BLOCK_REQUIRES_PARENT');
        }
        const res = await db.transaction((tx) =>
          runDuplicate(tx, ctx.context.scope, ctx.context.userId, ctx.body),
        );
        // `res` is statically the child branch now that targetParentBlockId is
        // required; narrow away the `root` union arm so callers don't have to.
        return res as Extract<typeof res, { mode: 'child' }>;
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
            if (!parsed.success) {
              // A failing link property whose value carries the READ shape
              // (`href` / `targetRootId`) means the caller wrote back a
              // resolved tree; the hint names the fix (raw: true).
              const resolved = resolvedLinkKeys(
                isRoot
                  ? def.root.properties
                  : (def.blocks?.[node.type]?.properties ?? {}),
                node.properties,
                parsed.error.issues,
              );
              const hint =
                resolved.length > 0
                  ? ` The value of '${resolved.join("', '")}' looks resolved (href instead of the stored fields); read the tree with raw: true to get writable link values.`
                  : '';
              const message = isRoot
                ? `Invalid root properties (block ${node.blockId}): ${parsed.error.message}`
                : `Invalid properties for block type '${node.type}' (block ${node.blockId}): ${parsed.error.message}`;
              throw new CMSError('TYPE_MISMATCH', {
                message: `${message}${hint}`,
                data: {
                  reason: isRoot
                    ? 'invalid-root-properties'
                    : 'invalid-properties',
                  type: node.type,
                  blockId: node.blockId,
                  issues: parsed.error.issues,
                  ...(resolved.length > 0
                    ? { resolvedLinkKeys: resolved }
                    : {}),
                },
              });
            }
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
          // (created or updated). Collect all ids across the diff first, then
          // validate with ONE asset query + ONE roots query per distinct
          // collection — instead of two-plus queries per block serialized
          // under the branch lock.
          const batchAssetIds = new Map<string, string>();
          const batchRefIdsByCollection = new Map<
            string,
            Map<string, string>
          >();
          for (const b of [...diff.created, ...diff.updated]) {
            collectPropertyReferences(
              b.type,
              b.properties,
              batchAssetIds,
              batchRefIdsByCollection,
            );
          }
          await assertCollectedReferencesExist(
            tx,
            batchAssetIds,
            batchRefIdsByCollection,
          );

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
  };
}
