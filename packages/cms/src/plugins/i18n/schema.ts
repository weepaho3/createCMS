import type { coreSchema } from '../../core/db/core-schema';
import type { TableMap } from '../../core/db/types';

import { definePluginSchema } from '../../core/db/define';

type CoreTables = (typeof coreSchema)['tables'] & TableMap;

/**
 * Plugin schema for i18n: adds the plugin-owned `language` column to `roots`
 * (one root per language — each language reuses the full engine) plus the
 * per-language slug uniqueness the core can no longer provide.
 *
 * The core `slugUniqueIdx` was demoted to a non-unique lookup index (phase I1)
 * precisely BECAUSE a core GLOBAL unique on (collection, parentRootId, slug)
 * cannot be loosened by a plugin and would forbid the same slug across
 * languages. So the real DB guarantee for same-slug-per-language lives here.
 * Non-partial (archived rows still occupy the slug) to match the demoted core
 * index's behaviour; app-level validateSlugUniqueness is the authority and is
 * likewise non-archived-filtered.
 *
 * Caveat (unchanged from the old core unique): a NULL `parentRootId` is DISTINCT
 * in Postgres, so this index only backstops NESTED roots. Top-level
 * per-language uniqueness is enforced by validateSlugUniqueness alone (which
 * matches `parent_root_id IS NULL` explicitly) — exactly as it always was.
 */
export const i18nSchema = definePluginSchema<CoreTables>({
  extend: {
    roots: {
      columns: {
        language: {
          type: 'text',
          notNull: true,
        },
        // Stable group id tying sibling-language roots into one logical entry.
        // A NEW entry (createRoot / root duplication) mints a fresh `tgr_` id;
        // createTranslation (I3b) inherits it. Indexed with language to resolve
        // "the sibling of this entry in language L" / "which languages exist" in
        // one hop.
        translationKey: {
          type: 'text',
          notNull: true,
        },
      },
      indexes: {
        languageSlugUnique: {
          columns: ['language', 'collection', 'parentRootId', 'slug'],
          unique: true,
        },
        languageCollectionIdx: {
          columns: ['language', 'collection'],
        },
        // At most ONE active root per (group, language) — the DB backstop for
        // the "one sibling per language" invariant that createTranslation's
        // app-level check enforces (and the race it can't). PARTIAL (archived
        // rows excluded) so archiving a translation frees the slot, matching the
        // app check. Doubles as the lookup index for "the sibling in language L".
        // translationKey is a globally-unique group id, so no tenant column is
        // needed even under multi-tenant.
        translationLanguageUnique: {
          columns: ['translationKey', 'language'],
          unique: true,
          where: 'archived_at IS NULL',
        },
      },
    },
    // Redirects are per-language. No DB-unique is added here: path-source
    // uniqueness can't be DB-enforced when BOTH multi-tenant and i18n are on
    // (the correct key (tenant_slug, language, collection, sourcePath) can't be
    // expressed by either plugin alone), so it is the app-level authority
    // (assertSourceUnique + the auto-create pre-check, both scope.redirects-aware).
    redirects: {
      columns: {
        language: {
          type: 'text',
          notNull: true,
        },
      },
      indexes: {
        languageCollectionIdx: {
          columns: ['language', 'collection'],
        },
      },
    },
  },
});
