// Type-only assertion, checked by `check-types` and never executed: the
// createcms React client's `media` namespace is a `MediaClient` without an
// adapter.

import type { MediaClient } from '@createcms/react/media';

import { createCMS } from '@createcms/core';
import { createCMSClient } from '@createcms/core/react';

declare const db: Parameters<typeof createCMS>[0]['db'];

const cms = createCMS({
  db,
  media: {
    provider: 'custom',
    hostname: 'localhost',
    region: 'us-east-1',
    accessKeyId: '',
    secretAccessKey: '',
    bucketName: 'media',
    publicUrl: 'https://cdn.example.com',
  },
  collections: {},
  authMiddleware: async () => ({}),
});

const client = createCMSClient<typeof cms>()({ baseURL: '/api/cms' });

export const media = client.media satisfies MediaClient;
