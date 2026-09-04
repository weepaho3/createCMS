import { and, eq, inArray, isNull } from 'drizzle-orm';
import * as z from 'zod';

import type {
  BlockProperty,
  CMSProcedureContext,
  CollectionWithName,
} from '../types';
import type { ResolvedScope, ResolvedSlugConfig } from '../types/definitions';
import type { DrizzleInstance } from '../types/drizzle';

import { newId } from '../../utils/nanoid';
import {
  createInitialCommit,
  writeCommit,
  type ChangedVersion,
} from '../blocks/commit-writer';
import { deepCopySubtree } from '../blocks/copy-subtree';
import { lockWritableBranch, requireRootInScope } from '../blocks/guards';
import {
  assertPlacementAllowed,
  buildPlacementIndex,
} from '../blocks/placement';
import {
  loadVersionMapAtCommit,
  withRootSlug,
  type BlockTreeNode,
} from '../blocks/reconstruct-snapshot';
import { resolveBranchPolicy } from '../branch-policy';
import {
  assets,
  blockVersions,
  commitSnapshots,
  roots,
} from '../db/schema.generated';
import { CMSError, errorMessages } from '../errors';
import { buildPropertiesSchema } from '../schema-builders';
import { scopedInsert } from '../scope';
import { normalizeSlug } from '../slug';

// ============================================================================
// Schemas
// ============================================================================

export const blockTreeNodeSchema: z.ZodType<BlockTreeNode> = z.lazy(() =>
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
export function applyPropertyPatch(
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

/**
 * Names the link-typed properties among `issues` whose posted value carries
 * the READ shape (`href` / `targetRootId`) instead of the store shape. The
 * write path validates the store shape only; a hit here means the caller
 * round-tripped a resolved tree (getBlockTree without raw, or resolveTree).
 */
export function resolvedLinkKeys(
  specs: Record<string, BlockProperty>,
  properties: Record<string, unknown>,
  issues: readonly { path: PropertyKey[] }[],
): string[] {
  const keys: string[] = [];
  for (const issue of issues) {
    if (issue.path.length === 0) continue;
    const key = String(issue.path[0]);
    if (keys.includes(key)) continue;
    if (specs[key]?.type !== 'link') continue;
    const value = properties[key];
    if (typeof value !== 'object' || value === null) continue;
    if (Object.hasOwn(value, 'href') || Object.hasOwn(value, 'targetRootId'))
      keys.push(key);
  }
  return keys;
}

// ============================================================================
// Shared context: setup + helpers shared by both endpoint groups
// ============================================================================

export function buildBlocksContext<TDef extends CollectionWithName>(
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
    expectedHeadCommitId?: string;
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

      // Root duplication mints a NEW top-level entry, exactly like `createRoot`
      // — so validate `targetProperties` against the collection's root schema
      // the same way `createRoot` does (buildRootInputSchema → strict/
      // required-enforcing buildPropertiesSchema), rather than trusting the
      // caller's shape via a bare cast. Parsed BEFORE `withRootSlug` runs, so
      // slug seeding never operates on unvalidated input.
      const rootPropertiesSchema = buildPropertiesSchema(def.root.properties);
      const parsedTargetProperties = rootPropertiesSchema.safeParse(
        input.targetProperties,
      );
      if (!parsedTargetProperties.success)
        throw new CMSError('TYPE_MISMATCH', {
          message: `Invalid targetProperties for duplicated root: ${parsedTargetProperties.error.message}`,
          data: {
            reason: 'invalid-root-properties',
            issues: parsedTargetProperties.error.issues,
          },
        });
      const targetProperties = parsedTargetProperties.data as Record<
        string,
        unknown
      >;

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
            ? withRootSlug(targetProperties, dupSlug)
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
      expectedHeadCommitId: input.expectedHeadCommitId,
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
  // Collect the id-shaped image/reference values from ONE block's properties into
  // shared accumulators, mapping each collected id back to the blockType it came
  // from so a later batch validation can name the right block. Mirrors the specs
  // resolution assertPropertyReferencesExist used to do inline, exactly.
  function collectPropertyReferences(
    blockType: string,
    properties: Record<string, unknown> | undefined,
    assetIds: Map<string, string>, // assetId -> owning blockType (first seen wins)
    refIdsByCollection: Map<string, Map<string, string>>, // collection -> (rootId -> owning blockType)
  ): void {
    if (!properties) return;

    const specs = (
      blockType === collectionName || blockType === 'root'
        ? def.root.properties
        : def.blocks?.[blockType]?.properties
    ) as Record<string, { type: string; collection?: string }> | undefined;
    if (!specs) return;

    const addAsset = (v: unknown) => {
      if (typeof v === 'string' && v.startsWith('ast_') && !assetIds.has(v))
        assetIds.set(v, blockType);
    };
    const addRef = (targetCollection: string, v: unknown) => {
      if (typeof v === 'string' && v.startsWith('rot_')) {
        let map = refIdsByCollection.get(targetCollection);
        if (!map) refIdsByCollection.set(targetCollection, (map = new Map()));
        if (!map.has(v)) map.set(v, blockType);
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
  }

  // Validate a batch of already-collected image/reference ids against the DB:
  // ONE asset query (if any assetIds) + ONE roots query per distinct target
  // collection — instead of one query pair per block. Error message + data
  // payload are byte-for-byte identical to the previous per-block helper.
  async function assertCollectedReferencesExist(
    tx: DrizzleInstance,
    assetIds: Map<string, string>,
    refIdsByCollection: Map<string, Map<string, string>>,
  ): Promise<void> {
    if (assetIds.size > 0) {
      const ids = [...assetIds.keys()];
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

    for (const [targetCollection, idMap] of refIdsByCollection) {
      const ids = [...idMap.keys()];
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

  async function assertPropertyReferencesExist(
    tx: DrizzleInstance,
    blockType: string,
    properties: Record<string, unknown> | undefined,
  ): Promise<void> {
    const assetIds = new Map<string, string>();
    const refIdsByCollection = new Map<string, Map<string, string>>();
    collectPropertyReferences(
      blockType,
      properties,
      assetIds,
      refIdsByCollection,
    );
    await assertCollectedReferencesExist(tx, assetIds, refIdsByCollection);
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
  };
}

export type BlocksContext<TDef extends CollectionWithName> = ReturnType<
  typeof buildBlocksContext<TDef>
>;
