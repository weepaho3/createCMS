import { describe, expect, it } from 'vitest';

import { createCMS } from '../src/index';
import { setupTestCMS } from './utils/cms';
import { TEST_COLLECTIONS } from './utils/fixtures';

// dx-05: `media` is optional. A content-only app can omit it; the media
// endpoints stay on the API but any storage operation throws a clear
// MEDIA_NOT_CONFIGURED instead of crashing on `undefined`.
function mediaLessCMS(db: unknown) {
  return createCMS({
    db: db as never,
    collections: TEST_COLLECTIONS,
    authMiddleware: async () => ({ userId: 'u1' }),
  });
}

describe('media optional', () => {
  it('createCMS accepts no media config, and the media namespace still exists', async () => {
    const { db } = await setupTestCMS();
    const cms = mediaLessCMS(db);
    expect(cms.api.media).toBeDefined();
    expect(cms.api.media.createSignedUpload).toBeTypeOf('function');
  });

  it('throws MEDIA_NOT_CONFIGURED when a storage op runs without media', async () => {
    const { db } = await setupTestCMS();
    const cms = mediaLessCMS(db);
    await expect(
      cms.api.media.createSignedUpload({
        body: { files: [{ name: 'x.png', size: 100, type: 'image/png' }] },
      }),
    ).rejects.toThrow(/not configured/i);
  });

  it('DB-only media ops (createFolder) still work without media', async () => {
    const { db } = await setupTestCMS();
    const cms = mediaLessCMS(db);
    const result = await cms.api.media.createFolder({ body: { name: 'Images' } });
    expect(result.folder.name).toBe('Images');
  });
});
