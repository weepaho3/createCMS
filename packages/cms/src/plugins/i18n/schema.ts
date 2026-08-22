import type { coreSchema } from '../../core/db/core-schema';
import type { TableMap } from '../../core/db/types';

import { definePluginSchema } from '../../core/db/define';

type CoreTables = (typeof coreSchema)['tables'] & TableMap;

/**
 * Plugin schema for i18n: adds the plugin-owned `language` column to `roots`
 * (one root per language; each language reuses the full engine) plus the
 * per-language slug uniqueness core can no longer provide.
 *
 * The core `slugUniqueIdx` was demoted to a non-unique lookup index because a
 * core global unique on (collection, parentRootId, slug) cannot be loosened by
 * a plugin and would forbid the same slug across languages. The real DB
 * guarantee for same-slug-per-language lives here. Non-partial (archived rows
 * still occupy the slug) to match the demoted core index's behavior;
 * app-level validateSlugUniqueness is the authority and is likewise not
 * archived-filtered.
 *
 * Caveat (inherited from the old core unique): a NULL `parentRootId` is
 * distinct in Postgres, so this index only backstops nested roots. Top-level
 * per-language uniqueness is enforced by validateSlugUniqueness alone (which
 * matches `parent_root_id IS NULL` explicitly).
 */
export const i18nSchema = definePluginSchema<CoreTables>()({
  extend: {
    roots: {
      columns: {
        language: {
          type: 'text',
          notNull: true,
        },
        // Stable group id tying sibling-language roots into one logical entry.
        // A new entry (createRoot / root duplication) mints a fresh `tgr_` id;
        // createTranslation inherits it. Indexed with language to resolve "the
        // sibling of this entry in language L" / "which languages exist" in one
        // hop.
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
        // At most one active root per (group, language): the DB backstop for
        // the "one sibling per language" invariant that createTranslation's
        // app-level check enforces (and the race it cannot). Partial (archived
        // rows excluded) so archiving a translation frees the slot, matching
        // the app check. Doubles as the lookup index for the sibling in
        // language L. translationKey is a globally-unique group id, so no
        // tenant column is needed even under multi-tenant.
        translationLanguageUnique: {
          columns: ['translationKey', 'language'],
          unique: true,
          where: 'archived_at IS NULL',
        },
      },
    },
    // Redirects are per-language. No DB-unique is added here: path-source
    // uniqueness cannot be DB-enforced when both multi-tenant and i18n are on
    // (the correct key (tenant_slug, language, collection, sourcePath) is not
    // expressible by either plugin alone), so the app-level authority is
    // assertSourceUnique plus the auto-create pre-check, both
    // scope.redirects-aware.
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
    // Templates are per-language (a German vs English default for the same
    // field). No DB-unique here for the same reason as redirects: the compound
    // (tenant_slug, language, collection, blockType, propertyKey) is not
    // expressible by either plugin alone; createTemplate's scope-aware check
    // is the authority. Lookup indexed.
    templates: {
      columns: {
        language: {
          type: 'text',
          notNull: true,
        },
      },
      indexes: {
        languageCollectionBlockIdx: {
          columns: ['language', 'collection', 'blockType'],
        },
      },
    },
    // Variables are per-language, resolved with fallback (like roots): a value
    // missing in the active language falls back through the chain. The `key` is
    // the translation group (companyName/en and companyName/de share a key).
    // No DB-unique (compound key is app-level authority). The index also serves
    // the resolver's `key IN (...) AND language IN (chain)` lookup.
    variables: {
      columns: {
        language: {
          type: 'text',
          notNull: true,
        },
      },
      indexes: {
        languageKeyIdx: {
          columns: ['language', 'key'],
        },
      },
    },
  },
});
