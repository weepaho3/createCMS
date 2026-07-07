import { describe, expect, it } from 'vitest';

import { setupTestCMS } from './utils/cms';

// A GET to the mount root answers with a JSON banner so the mount can be
// verified with one `curl <basePath>` (dx-18: a bare 404 there almost always
// means the catch-all route is mounted at the wrong path).
describe('router mount banner', () => {
  it('answers GET {basePath} with a JSON banner', async () => {
    const { cms } = await setupTestCMS();

    const res = await cms.router.handler(
      new Request('http://localhost/api/cms'),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      cms: '@createcms/core',
      basePath: '/api/cms',
    });
    expect(body.message).toContain('/api/cms/<namespace>/<method>');
  });

  it('answers GET {basePath}/ (trailing slash) with the same banner', async () => {
    const { cms } = await setupTestCMS();

    const res = await cms.router.handler(
      new Request('http://localhost/api/cms/'),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.basePath).toBe('/api/cms');
  });

  it('does not shadow real endpoints under the mount root', async () => {
    const { cms } = await setupTestCMS();

    // A path below the root is routed normally, not swallowed by the banner.
    const res = await cms.router.handler(
      new Request('http://localhost/api/cms/pages/getPublishedContent?slug=/x'),
    );

    expect(res.status).not.toBe(200);
    const body = await res.json();
    expect(body).not.toMatchObject({ cms: '@createcms/core' });
  });
});
