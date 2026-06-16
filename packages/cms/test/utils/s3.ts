import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import S3rver from 's3rver';

import type { CustomMediaConfig } from '../../src/core/types/s3';

const TEST_BUCKET = 'test-bucket';
const TEST_ACCESS_KEY = 'S3RVER';
const TEST_SECRET_KEY = 'S3RVER';

export type TestS3 = {
  config: CustomMediaConfig;
  cleanup: () => Promise<void>;
};

/**
 * Starts a local S3rver instance on a random port with a pre-configured bucket.
 * Returns a CustomMediaConfig pointing at the local server and a cleanup function.
 */
export async function setupTestS3(): Promise<TestS3> {
  const directory = mkdtempSync(join(tmpdir(), 'cms-s3-test-'));

  const server = new S3rver({
    directory,
    configureBuckets: [{ name: TEST_BUCKET, configs: [] }],
    address: '127.0.0.1',
    port: 0,
    silent: true,
  });

  const { port } = await server.run();
  const hostname = `127.0.0.1:${port}`;

  const config: CustomMediaConfig = {
    provider: 'custom',
    hostname,
    region: 'us-east-1',
    accessKeyId: TEST_ACCESS_KEY,
    secretAccessKey: TEST_SECRET_KEY,
    bucketName: TEST_BUCKET,
    publicUrl: `http://${hostname}/${TEST_BUCKET}`,
    secure: false,
    forcePathStyle: true,
  };

  const cleanup = async () => {
    await server.close();
    rmSync(directory, { recursive: true, force: true });
  };

  return { config, cleanup };
}
