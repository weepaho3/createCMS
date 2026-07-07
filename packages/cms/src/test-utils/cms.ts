import type { CustomMediaConfig } from '../core/types/s3';
import type {
  BranchProtectionConfig,
  CMSMiddleware,
  CMSPlugin,
  CMSUserConfig,
  DataRetentionConfig,
  MergeStrategy,
} from '../index';

import { createCMS } from '../index';
import { setupTestDB } from './db';
import { DUMMY_MEDIA_CONFIG, TEST_COLLECTIONS } from './fixtures';
import { type TestS3, setupTestS3 } from './s3';

/**
 * Creates a fully wired CMS instance backed by an in-memory PGlite database.
 *
 * When `withS3: true`, a local S3rver instance is started and the returned
 * `s3.cleanup()` must be called after the test (e.g. in afterEach).
 * When omitted or false, a dummy media config is used (no real S3 server).
 */
export const setupTestCMS = async (options?: {
  dataRetention?: DataRetentionConfig;
  authMiddleware?: CMSMiddleware;
  middleware?: CMSMiddleware;
  plugins?: CMSPlugin<any>[];
  withS3?: boolean;
  user?: CMSUserConfig;
  forceCommitMessage?: boolean;
  defaultBranchName?: string;
  branchProtection?: BranchProtectionConfig;
  mergeStrategy?: MergeStrategy;
  notifications?: boolean;
}) => {
  const { db } = await setupTestDB();

  let testS3: TestS3 | undefined;
  let mediaConfig: CustomMediaConfig;

  if (options?.withS3) {
    testS3 = await setupTestS3();
    mediaConfig = testS3.config;
  } else {
    mediaConfig = { ...DUMMY_MEDIA_CONFIG };
  }

  const userPlugins = options?.plugins ?? [];
  const plugins: CMSPlugin<any>[] = [...userPlugins];

  const cms = createCMS({
    db,
    media: mediaConfig,
    collections: TEST_COLLECTIONS,
    dataRetention: options?.dataRetention,
    authMiddleware: options?.authMiddleware,
    middleware: options?.middleware,
    plugins,
    forceCommitMessage: options?.forceCommitMessage,
    defaultBranchName: options?.defaultBranchName,
    branchProtection: options?.branchProtection,
    mergeStrategy: options?.mergeStrategy,
    notifications: options?.notifications,
    ...(options?.user ? { user: options.user } : {}),
  });

  return {
    cms,
    db,
    s3: testS3 ?? { config: mediaConfig, cleanup: async () => {} },
  };
};
