import type {
  AnyCollectionDefinition,
  CMSMiddleware,
} from '../../../../core/types/definitions';

import { setupTestDB } from '../../../../../test/utils/db';
import {
  DUMMY_MEDIA_CONFIG,
  TEST_COLLECTIONS,
} from '../../../../../test/utils/fixtures';
import { createCMS } from '../../../../core/factory';
import { multiTenant } from '../../../multi-tenant/index';
import { multiTenantSchema } from '../../../multi-tenant/schema';
import { i18n } from '../../index';
import { i18nSchema } from '../../schema';

/**
 * Creates a CMS instance with the i18n plugin enabled, backed by an in-memory
 * PGlite database whose schema is generated through the full codegen pipeline
 * (core + i18n plugin merged), so the `language` column + per-language unique
 * index match real-world output.
 *
 * A `setLanguage` helper switches the active language between API calls.
 */
export const setupI18nTestCMS = async <
  const C extends Record<string, AnyCollectionDefinition> =
    typeof TEST_COLLECTIONS,
>(options?: {
  middleware?: CMSMiddleware;
  languages?: readonly string[];
  defaultLanguage?: string;
  collections?: C;
  fallback?: Record<string, readonly string[]>;
}) => {
  const { db, cleanup: cleanupSchema } = await setupTestDB({
    plugins: [{ name: 'i18n', schema: i18nSchema }],
  });

  let currentLanguage = options?.defaultLanguage ?? 'en';

  const defaultMiddleware: CMSMiddleware = async () => ({
    language: currentLanguage,
  });

  const cms = createCMS({
    db,
    media: { ...DUMMY_MEDIA_CONFIG },
    // The fallback only runs when no override is passed (default C =
    // typeof TEST_COLLECTIONS), so the cast is sound and keeps cms.api typed.
    collections: (options?.collections ?? TEST_COLLECTIONS) as C,
    middleware: options?.middleware ?? defaultMiddleware,
    plugins: [
      i18n({
        languages: options?.languages ?? (['en', 'de', 'fr'] as const),
        defaultLanguage: (options?.defaultLanguage ?? 'en') as 'en',
        fallback: options?.fallback as never,
      }),
    ],
  });

  return {
    cms,
    db,
    cleanupSchema,
    setLanguage(language: string) {
      currentLanguage = language;
    },
    get currentLanguage() {
      return currentLanguage;
    },
  };
};

/**
 * Both the multiTenant AND i18n plugins active — for testing the composition
 * (each roots row carries `tenant_slug` + `language`; the scope ANDs both
 * predicates). `set(tenant, language)` switches the active pair.
 */
export const setupI18nMultiTenantTestCMS = async <
  const C extends Record<string, AnyCollectionDefinition> =
    typeof TEST_COLLECTIONS,
>(options?: {
  collections?: C;
}) => {
  const { db, cleanup: cleanupSchema } = await setupTestDB({
    plugins: [
      { name: 'multi-tenant', schema: multiTenantSchema },
      { name: 'i18n', schema: i18nSchema },
    ],
  });

  let tenant = 'acme';
  let language = 'en';

  const cms = createCMS({
    db,
    media: { ...DUMMY_MEDIA_CONFIG },
    collections: (options?.collections ?? TEST_COLLECTIONS) as C,
    middleware: async () => ({ tenantSlug: tenant, language }),
    plugins: [
      multiTenant(),
      i18n({ languages: ['en', 'de', 'fr'] as const, defaultLanguage: 'en' }),
    ],
  });

  return {
    cms,
    db,
    cleanupSchema,
    set(t: string, l: string) {
      tenant = t;
      language = l;
    },
  };
};
