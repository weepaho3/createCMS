import type { CMSMiddleware } from '../../../../core/types/definitions';

import { setupTestDB } from '../../../../../test/utils/db';
import {
  DUMMY_MEDIA_CONFIG,
  TEST_COLLECTIONS,
} from '../../../../../test/utils/fixtures';
import { createCMS } from '../../../../core/factory';
import { multiTenant } from '../../../multi-tenant/index';
import { multiTenantSchema } from '../../../multi-tenant/schema';
import { abTest } from '../../index';
import { buildSchema } from '../../schema';

/**
 * Creates a CMS instance with the abTest plugin enabled, backed by an
 * in-memory PGlite database. The schema is generated via the full
 * codegen pipeline (core + ab-test plugin merged), so tables, indexes,
 * and enums match the real-world output.
 */
export const setupABTestCMS = async (options?: {
  middleware?: CMSMiddleware;
  onRevalidate?: {
    handler: (event: {
      rootId: string;
      slug: string | null;
    }) => void | Promise<void>;
  };
  ga4?: Parameters<typeof abTest>[0] extends infer O
    ? O extends { ga4?: infer G }
      ? G
      : never
    : never;
}) => {
  const { db, cleanup } = await setupTestDB({
    plugins: [{ name: 'ab-test', schema: buildSchema() }],
  });

  const cms = createCMS({
    db,
    media: DUMMY_MEDIA_CONFIG,
    collections: TEST_COLLECTIONS,
    middleware: options?.middleware,
    onRevalidate: options?.onRevalidate,
    plugins: [abTest({ ga4: options?.ga4 })],
  });

  return { cms, db, cleanupSchema: cleanup };
};

/**
 * Creates a CMS instance with both multiTenant and abTest plugins,
 * backed by an in-memory PGlite database. A `setTenant` helper lets
 * tests switch the active tenant between API calls.
 */
export const setupMultiTenantABTestCMS = async () => {
  const { db, cleanup } = await setupTestDB({
    plugins: [
      { name: 'multi-tenant', schema: multiTenantSchema },
      { name: 'ab-test', schema: buildSchema() },
    ],
  });

  let currentTenant = 'tenant-a';

  const cms = createCMS({
    db,
    media: DUMMY_MEDIA_CONFIG,
    collections: TEST_COLLECTIONS,
    middleware: async () => ({ tenantSlug: currentTenant }),
    plugins: [multiTenant(), abTest()],
  });

  return {
    cms,
    db,
    cleanupSchema: cleanup,
    setTenant(slug: string) {
      currentTenant = slug;
    },
    get currentTenant() {
      return currentTenant;
    },
  };
};
