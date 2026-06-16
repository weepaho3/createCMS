import { createCMS } from '@createcms/core';

import { collections } from './collections';
import { db } from './db';

/**
 * The CMS instance. `createcms generate` discovers this file (it is one of the
 * default config locations: `lib/cms.ts`) and emits the Drizzle schema from it.
 */
export const cms = createCMS({
  db,
  collections,
  // Where `createcms generate` writes the content-agnostic Drizzle schema.
  schema: {
    output: './db/schema.ts',
  },
  // Media uploads target any S3-compatible bucket. This example never uploads,
  // so dummy values are fine — fill these from your environment in a real app.
  media: {
    provider: 'custom',
    hostname: process.env.S3_HOSTNAME ?? 'localhost',
    region: process.env.S3_REGION ?? 'us-east-1',
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? 'dummy',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? 'dummy',
    bucketName: process.env.S3_BUCKET ?? 'dummy',
    publicUrl: process.env.S3_PUBLIC_URL ?? 'https://cdn.example.com',
  },
  // `authMiddleware` decides who may call the API. This `{ userId: 'system' }`
  // stub authorizes every request. Replace it with a real session/permission
  // check before production.
  authMiddleware: async () => {
    return { userId: 'system' };
  },
});
