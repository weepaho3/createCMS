import type { coreSchema } from '../../core/db/core-schema';
import type { TableMap } from '../../core/db/types';

import { definePluginSchema } from '../../core/db/define';

type CoreTables = (typeof coreSchema)['tables'] & TableMap;

/**
 * Plugin schema that adds the `tenantSlug` column and tenant-scoped indexes
 * to the core tables. The column does not exist in the core schema — it is
 * entirely owned by this plugin.
 */
export const multiTenantSchema = definePluginSchema<CoreTables>()({
  extend: {
    roots: {
      columns: {
        tenantSlug: {
          type: 'text',
          notNull: true,
        },
      },
      indexes: {
        tenantCollectionIdx: {
          columns: ['tenantSlug', 'collection'],
        },
        // Per-tenant slug uniqueness — the DB backstop for the (now per-tenant)
        // app-level validateSlugUniqueness (the core slug index was demoted to
        // non-unique). NESTED-only in practice (a NULL parentRootId is distinct in
        // Postgres, so top-level relies on the app-level check); composes with the
        // i18n plugin's (language,…) unique because each tenant+language has its
        // own parent tree, so neither over-constrains the other.
        tenantRootSlugUnique: {
          columns: ['tenantSlug', 'collection', 'parentRootId', 'slug'],
          unique: true,
        },
      },
    },
    assetFolders: {
      columns: {
        tenantSlug: {
          type: 'text',
          notNull: true,
        },
      },
      indexes: {
        tenantNameUnique: {
          columns: ['tenantSlug', 'parentId', 'name'],
          unique: true,
        },
        tenantIdx: {
          columns: ['tenantSlug'],
        },
      },
    },
    assets: {
      columns: {
        tenantSlug: {
          type: 'text',
          notNull: true,
        },
      },
      indexes: {
        tenantIdx: {
          columns: ['tenantSlug'],
        },
        tenantSlugUnique: {
          columns: ['tenantSlug', 'slug'],
          unique: true,
        },
      },
    },
    // Redirects have NO core unique index (uniqueness is app-level), so the
    // plugin owns the real per-tenant DB guarantee. PARTIAL (active rows only)
    // mirrors the app-level checks: archiving a redirect frees its source.
    redirects: {
      columns: {
        tenantSlug: {
          type: 'text',
          notNull: true,
        },
      },
      indexes: {
        // NOTE: no per-tenant PATH-source unique. A path can legitimately have a
        // different redirect per language (the i18n plugin adds `language`), and
        // the correct compound key (tenant_slug, language, collection, sourcePath)
        // can't be expressed by either plugin alone — so path-source uniqueness is
        // the app-level authority (assertSourceUnique + the auto-create pre-check,
        // both scope.redirects-aware). Lookup is still indexed below.
        //
        // PAGE-source IS safely per-tenant-unique: sourceRootId is a specific root
        // (a single language), so this never over-constrains under i18n.
        tenantSourceRootUnique: {
          columns: ['tenantSlug', 'sourceRootId'],
          unique: true,
          where: 'archived_at IS NULL',
        },
        // Per-tenant lookup/listing (+ the path-source lookup, since the unique
        // that used to cover it is gone).
        tenantCollectionIdx: {
          columns: ['tenantSlug', 'collection'],
        },
        tenantSourcePathIdx: {
          columns: ['tenantSlug', 'collection', 'sourcePath'],
        },
      },
    },
    // Templates are per-tenant. No DB-unique is added: the correct compound key
    // (tenant_slug, language, collection, blockType, propertyKey) can't be
    // expressed by either plugin alone, so per-scope uniqueness is the app-level
    // authority (createTemplate's scope-aware existence check). Lookup indexed.
    templates: {
      columns: {
        tenantSlug: {
          type: 'text',
          notNull: true,
        },
      },
      indexes: {
        tenantCollectionBlockIdx: {
          columns: ['tenantSlug', 'collection', 'blockType'],
        },
      },
    },
    // Variables are per-tenant (each tenant has its own companyName/siteUrl/…).
    // No DB-unique (compound (tenant_slug, language, key) is app-level authority,
    // same as templates). Lookup indexed.
    variables: {
      columns: {
        tenantSlug: {
          type: 'text',
          notNull: true,
        },
      },
      indexes: {
        tenantKeyIdx: {
          columns: ['tenantSlug', 'key'],
        },
      },
    },
  },
});
