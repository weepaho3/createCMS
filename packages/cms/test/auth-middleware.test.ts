import { afterEach, describe, expect, it, vi } from 'vitest';

import { CMS_ERRORS, CMSError, createCMS } from '../src/index';
import { setupTestCMS } from './utils/cms';
import { DUMMY_MEDIA_CONFIG, TEST_COLLECTIONS } from './utils/fixtures';

afterEach(() => vi.restoreAllMocks());

// dx-06: omitting authMiddleware leaves the whole API unauthenticated — warn.
describe('authMiddleware startup warning', () => {
  it('warns when no auth middleware is configured', async () => {
    const { db } = await setupTestCMS();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    createCMS({ db, media: DUMMY_MEDIA_CONFIG, collections: TEST_COLLECTIONS });

    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]?.[0]);
    expect(message).toMatch(/authMiddleware/);
    expect(message).toMatch(/unauthenticated/i);
  });

  it('does not warn when authMiddleware is provided', async () => {
    const { db } = await setupTestCMS();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    createCMS({
      db,
      media: DUMMY_MEDIA_CONFIG,
      collections: TEST_COLLECTIONS,
      authMiddleware: async () => ({}),
    });

    expect(warn).not.toHaveBeenCalled();
  });

  it('does not warn when the `middleware` alias is provided', async () => {
    const { db } = await setupTestCMS();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    createCMS({
      db,
      media: DUMMY_MEDIA_CONFIG,
      collections: TEST_COLLECTIONS,
      middleware: async () => ({}),
    });

    expect(warn).not.toHaveBeenCalled();
  });
});

// dx-07: a packaged deny path — CMSError('UNAUTHORIZED'|'FORBIDDEN') → 401/403.
describe('UNAUTHORIZED / FORBIDDEN error codes', () => {
  it('exposes UNAUTHORIZED (401) and FORBIDDEN (403)', () => {
    expect(CMS_ERRORS.UNAUTHORIZED.status).toBe(401);
    expect(CMS_ERRORS.FORBIDDEN.status).toBe(403);
  });

  it('CMSError carries the deny code', () => {
    expect(new CMSError('UNAUTHORIZED').cmsCode).toBe('UNAUTHORIZED');
    expect(new CMSError('FORBIDDEN').cmsCode).toBe('FORBIDDEN');
  });
});
