import type { CMSMiddleware } from '../../../../core/types/definitions';
import type { CustomMediaConfig } from '../../../../core/types/s3';
import type { TestS3 } from '../../../../test-utils/s3';

import { createCMS } from '../../../../core/factory';
import { setupTestDB } from '../../../../test-utils/db';
import {
  DUMMY_MEDIA_CONFIG,
  TEST_COLLECTIONS,
} from '../../../../test-utils/fixtures';
import { setupTestS3 } from '../../../../test-utils/s3';
import { multiTenant } from '../../index';
import { multiTenantSchema } from '../../schema';

/**
 * Creates a CMS instance with the multiTenant plugin enabled, backed by
 * an in-memory PGlite database. The schema is generated via the full
 * codegen pipeline (core + multi-tenant plugin merged), so indexes,
 * unique constraints, and columns match the real-world output.
 *
 * A `setTenant` helper is returned to switch the active tenant between
 * API calls.
 */
export const setupMultiTenantTestCMS = async (options?: {
  authMiddleware?: CMSMiddleware;
  withS3?: boolean;
}) => {
  const { db, cleanup: cleanupSchema } = await setupTestDB({
    plugins: [{ name: 'multi-tenant', schema: multiTenantSchema }],
  });

  let testS3: TestS3 | undefined;
  let mediaConfig: CustomMediaConfig;

  if (options?.withS3) {
    testS3 = await setupTestS3();
    mediaConfig = testS3.config;
  } else {
    mediaConfig = { ...DUMMY_MEDIA_CONFIG };
  }

  let currentTenant = 'default-tenant';

  const defaultMiddleware: CMSMiddleware = async () => ({
    tenantSlug: currentTenant,
  });

  const cms = createCMS({
    db,
    media: mediaConfig,
    collections: TEST_COLLECTIONS,
    authMiddleware: options?.authMiddleware ?? defaultMiddleware,
    plugins: [multiTenant()],
  });

  return {
    cms,
    db,
    s3: testS3 ?? { config: mediaConfig, cleanup: async () => {} },
    cleanupSchema,
    setTenant(slug: string) {
      currentTenant = slug;
    },
    get currentTenant() {
      return currentTenant;
    },
  };
};
