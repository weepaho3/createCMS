import { and, eq, inArray, sql } from 'drizzle-orm';
import * as z from 'zod';

import type {
  CollectionWithName,
  ResolvedSlugConfig,
} from '../../core/types/definitions';
import type { CMSPluginContext } from '../../core/types/plugin';

import {
  createInitialCommit,
  type ChangedVersion,
} from '../../core/blocks/commit-writer';
import {
  deepCopySubtree,
  type BlockVersionRow,
} from '../../core/blocks/copy-subtree';
import { requireRootInScope } from '../../core/blocks/guards';
import { DEFAULT_BRANCH_NAME } from '../../core/branch-policy';
import {
  blockVersions,
  branches,
  commitSnapshots,
} from '../../core/db/schema.generated';
import { cmsMeta, createCMSEndpoint } from '../../core/endpoint';
import { CMSError } from '../../core/errors';
import { resolveRootCurrentPath } from '../../core/redirects/resolve';
import { scopedInsert } from '../../core/scope';
import { normalizeSlug, validateSlugUniqueness } from '../../core/slug';
import { newId } from '../../utils/nanoid';
import { i18nError } from './errors';

/**
 * The i18n plugin's per-collection endpoints: createTranslation +
 * listTranslations. Contributed to EVERY collection via plugin.collectionEndpoints,
 * so they surface at cms.api.<collection>.x ONLY when the i18n plugin is
 * installed (closing the leak where they appeared on every collection regardless).
 *
 * These were lifted from core/routes/blocks.ts verbatim, with two changes:
 *   - i18n error codes (TRANSLATION_*) are thrown via i18nError (APIError + the
 *     plugin's own $ERROR_CODES) instead of CMSError; core slug codes
 *     (SLUG_EMPTY_NOT_ALLOWED) stay as CMSError (still a core code).
 *   - the old I18N_NOT_ENABLED gate is gone: the endpoint only exists when this
 *     plugin is installed, and the i18n scope factory rejects a request with no
 *     active language (LANGUAGE_REQUIRED) before the handler runs.
 */
export function createI18nCollectionEndpoints(
  def: CollectionWithName,
  pluginCtx: CMSPluginContext,
  languages: readonly string[],
) {
  const collectionName = def.name;
  const db = pluginCtx.db;

  return {
    // i18n: create the sibling-language version of an existing entry. The new
    // root INHERITS the source's translationKey (so it joins the group), takes
    // the TARGET language, and hangs under the target-language sibling of the
    // source's parent. Seeds from the source's `main` tree by default ('copy'),
    // or starts blank.
    /**
     * Creates a sibling-language version of an existing entry, inheriting its translation key and seeding from the source's main tree (or blank).
     * @param sourceRootId The root to translate from (must exist in the active language).
     * @param targetLanguage The language for the new root (must be configured in the plugin).
     * @param targetSlug Optional slug for the target root; defaults to the source slug if not provided.
     * @param seed How to initialize the target root's draft: 'copy' (default) copies the source's main tree, 'blank' starts empty.
     * @param message Optional commit message for the initial draft; defaults to 'Translation (language)'.
     * @returns The new root id, draft branch id, initial commit id, target language, and inherited translation key.
     * @throws TRANSLATION_LANGUAGE_NOT_ENABLED if targetLanguage is not in the configured language universe.
     * @throws TRANSLATION_SOURCE_NOT_FOUND if sourceRootId does not exist in the active language/tenant.
     * @throws TRANSLATION_EXISTS if a translation to targetLanguage already exists for this entry.
     * @throws TRANSLATION_PARENT_NOT_TRANSLATED if the source has a parent that has no translation in the target language.
     * @throws SLUG_EMPTY_NOT_ALLOWED if the target slug is empty and the collection disallows root slugs.
     * @example await cmsClient.pages.createTranslation({ sourceRootId: 'root_abc', targetLanguage: 'de', seed: 'copy' })
     */
    createTranslation: createCMSEndpoint(
      `/${collectionName}/createTranslation`,
      {
        method: 'POST',
        body: z.object({
          sourceRootId: z.string(),
          targetLanguage: z.string().min(1),
          targetSlug: z.string().optional(),
          seed: z.enum(['copy', 'blank']).optional(),
          message: z.string().optional(),
        }),
        metadata: cmsMeta(
          {
            $Infer: {
              body: {} as {
                sourceRootId: string;
                targetLanguage: string;
                targetSlug?: string;
                seed?: 'copy' | 'blank';
                message?: string;
              },
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

        const { sourceRootId, targetLanguage, message } = ctx.body;
        // The target language must be in the configured universe (the plugin's
        // own `languages`, closed in at assembly) — otherwise we'd stamp a root
        // with a language no routing could ever serve.
        if (!languages.includes(targetLanguage)) {
          i18nError('TRANSLATION_LANGUAGE_NOT_ENABLED');
        }
        const seed = ctx.body.seed ?? 'copy';
        const slugCfg = def.slug as ResolvedSlugConfig | undefined;

        return db.transaction(async (tx) => {
          // Source must exist in the ACTIVE language — you translate FROM your
          // current language context.
          await requireRootInScope(
            tx,
            sourceRootId,
            collectionName,
            scope.roots,
            () => i18nError('TRANSLATION_SOURCE_NOT_FOUND'),
          );

          // Source metadata incl. the plugin-owned translation_key (raw SQL).
          const srcRows = await tx.execute(sql`
            SELECT slug, parent_root_id, translation_key
            FROM cms.roots
            WHERE id = ${sourceRootId} AND collection = ${collectionName}
          `);
          const src = srcRows.rows[0] as
            | {
                slug: string | null;
                parent_root_id: string | null;
                translation_key: string;
              }
            | undefined;
          if (!src) i18nError('TRANSLATION_SOURCE_NOT_FOUND');

          // No existing sibling in the target language (also rejects translating
          // to the source's own language, since that sibling is the source). The
          // (translationKey, language) partial unique is the DB backstop for the
          // race this app check can't cover.
          const dup = await tx.execute(sql`
            SELECT 1 FROM cms.roots
            WHERE translation_key = ${src.translation_key}
              AND language = ${targetLanguage}
              AND collection = ${collectionName}
              AND archived_at IS NULL
            LIMIT 1
          `);
          if (dup.rows.length > 0) i18nError('TRANSLATION_EXISTS');

          // Target parent = the target-language sibling of the source's parent.
          // The collection filters are defense-in-depth (a root's parent chain is
          // always same-collection by write-time validation), mirroring createRoot.
          let targetParentRootId: string | null = null;
          if (src.parent_root_id !== null) {
            const parentRows = await tx.execute(sql`
              SELECT translation_key FROM cms.roots
              WHERE id = ${src.parent_root_id} AND collection = ${collectionName}
            `);
            const parentKey = (
              parentRows.rows[0] as { translation_key: string } | undefined
            )?.translation_key;
            if (!parentKey) {
              i18nError('TRANSLATION_PARENT_NOT_TRANSLATED');
            }
            const sib = await tx.execute(sql`
              SELECT id FROM cms.roots
              WHERE translation_key = ${parentKey}
                AND language = ${targetLanguage}
                AND collection = ${collectionName}
                AND archived_at IS NULL
              LIMIT 1
            `);
            const sibRow = sib.rows[0] as { id: string } | undefined;
            if (!sibRow) i18nError('TRANSLATION_PARENT_NOT_TRANSLATED');
            targetParentRootId = sibRow.id;
          }

          // Target slug (localized; defaults to the source slug), unique per
          // target language under the target parent.
          let targetSlug: string | null = null;
          if (slugCfg?.enabled) {
            const rawSlug = ctx.body.targetSlug ?? src.slug ?? '';
            targetSlug = slugCfg.normalize ? normalizeSlug(rawSlug) : rawSlug;
            if (!targetSlug && !slugCfg.allowRoot) {
              throw new CMSError('SLUG_EMPTY_NOT_ALLOWED');
            }
            await validateSlugUniqueness(
              tx,
              collectionName,
              targetParentRootId,
              targetSlug,
              undefined,
              // Uniqueness is checked in the TARGET language (not the active one),
              // within the active tenant — override language on the scope columns.
              {
                ...scope.roots?.insertColumns,
                language: targetLanguage,
              },
            );
          }

          // Create the sibling root: TARGET language (override the active-language
          // insert-scope), INHERITED translationKey, keep any other scope columns
          // (e.g. tenant_slug).
          const targetScope = {
            ...scope.roots,
            insertColumns: {
              ...scope.roots?.insertColumns,
              language: targetLanguage,
            },
          };
          const newRoot = await scopedInsert(
            tx,
            'cms.roots',
            {
              id: newId('root'),
              collection: collectionName,
              parent_root_id: targetParentRootId,
              slug: targetSlug,
              sort_order: 0,
              created_by: actor,
              translation_key: src.translation_key,
            },
            targetScope,
          );

          // Seed the initial commit: copy the source's default-branch tree as the
          // starting draft, or start blank.
          const defaultBranchName =
            pluginCtx.defaultBranchName ?? DEFAULT_BRANCH_NAME;
          let versions: ChangedVersion[] | undefined;
          if (seed === 'copy') {
            const [sourceBranch] = await tx
              .select({ headCommitId: branches.headCommitId })
              .from(branches)
              .where(
                and(
                  eq(branches.rootId, sourceRootId),
                  eq(branches.name, defaultBranchName),
                ),
              )
              .limit(1);
            if (sourceBranch) {
              const snaps = await tx
                .select({ blockVersionId: commitSnapshots.blockVersionId })
                .from(commitSnapshots)
                .where(eq(commitSnapshots.commitId, sourceBranch.headCommitId));
              const ids = snaps.map((s) => s.blockVersionId);
              if (ids.length > 0) {
                const allV = await tx
                  .select()
                  .from(blockVersions)
                  .where(inArray(blockVersions.id, ids));
                const byId = new Map<string, BlockVersionRow>(
                  allV.map((v) => [
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
                const { copies } = deepCopySubtree(byId, sourceRootId);
                versions = copies.map((copy) => {
                  const isTop = copy.oldBlockId === sourceRootId;
                  return {
                    blockId: isTop ? newRoot.id : copy.newBlockId,
                    type: isTop ? collectionName : copy.type,
                    properties: copy.properties,
                    children: copy.newChildren,
                  };
                });
              }
            }
          }
          if (!versions) {
            versions = [
              {
                blockId: newRoot.id,
                type: collectionName,
                properties: {},
                children: [],
              },
            ];
          }

          const { commitId, branchId } = await createInitialCommit(tx, def, {
            rootId: newRoot.id,
            branchName: defaultBranchName,
            message: message ?? `Translation (${targetLanguage})`,
            createdBy: actor,
            versions,
          });

          return {
            rootId: newRoot.id,
            branchId,
            commitId,
            language: targetLanguage,
            translationKey: src.translation_key,
          };
        });
      },
    ),

    // i18n: the language switcher / "which translations exist" for an entry.
    // Cross-language by design (queries the translation group), so it deliberately
    // bypasses the blanket per-language read scope — but the INPUT root is gated to
    // the active language + tenant, and a translationKey is a globally-unique
    // group id, so only this tenant's siblings are returned.
    /**
     * Retrieves all language variants (siblings) of a given entry, bypassing per-language read scope.
     * @param rootId The root id (must exist in the active language and tenant).
     * @returns The translation key (group id) and an array of all siblings with their language, root id, slug, and resolved path.
     * @throws TRANSLATION_SOURCE_NOT_FOUND if rootId does not exist or has no translation key.
     * @example await cmsClient.pages.listTranslations({ rootId: 'root_abc' })
     */
    listTranslations: createCMSEndpoint(
      `/${collectionName}/listTranslations`,
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
        const slugCfg = def.slug as ResolvedSlugConfig | undefined;

        // The input root must be in the active language + tenant.
        await requireRootInScope(
          db,
          ctx.query.rootId,
          collectionName,
          scope.roots,
        );
        const keyRows = await db.execute(sql`
          SELECT translation_key FROM cms.roots
          WHERE id = ${ctx.query.rootId} AND collection = ${collectionName}
        `);
        const translationKey = (
          keyRows.rows[0] as { translation_key: string } | undefined
        )?.translation_key;
        if (!translationKey) {
          i18nError('TRANSLATION_SOURCE_NOT_FOUND');
        }

        const sibRows = await db.execute(sql`
          SELECT id, language, slug FROM cms.roots
          WHERE translation_key = ${translationKey}
            AND collection = ${collectionName}
            AND archived_at IS NULL
          ORDER BY language
        `);
        const translations = await Promise.all(
          (
            sibRows.rows as Array<{
              id: string;
              language: string;
              slug: string | null;
            }>
          ).map(async (r) => ({
            language: r.language,
            rootId: r.id,
            slug: r.slug,
            path:
              slugCfg?.enabled && slugCfg
                ? await resolveRootCurrentPath(db, slugCfg, r.id)
                : null,
          })),
        );

        return { translationKey, translations };
      },
    ),
  };
}
