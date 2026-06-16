import { createCMSClient } from '@createcms/core';

import type { cms } from './cms';

/**
 * The type-safe client. `createCMSClient<typeof cms>` mirrors the server API;
 * every field is typed from your collection definitions. Use it from Client
 * Components or browser code. Server Components can call `cms.api.*` directly.
 */
export const cmsClient = createCMSClient<typeof cms>({ baseURL: '/api/cms' });
