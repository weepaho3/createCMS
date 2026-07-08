import { describe, expect, it } from 'vitest';

import { createCMS } from '../../../index';
import { setupTestDB } from '../../../test-utils/db';
import {
  DUMMY_MEDIA_CONFIG,
  TEST_COLLECTIONS,
} from '../../../test-utils/fixtures';
import { setupMultiTenantTestCMS } from './utils/cms';

// ============================================================================
// cms-08 SECURITY — search must not leak across scope boundaries.
//
// The shared `search_index` is queried by `search.query`, which previously
// filtered ONLY by q/entityTypes/collection/rootId and never consulted the
// request scope. That let (1) one tenant find another tenant's content and
// (2) one user read another user's notification titles/bodies via search.
//
// These tests pin the fix: the search endpoint re-applies the same scope
// predicates the normal reads use (tenant scope via the entity's source
// table; notifications via the per-recipient guard).
// ============================================================================

describe('cms-08 — search respects multi-tenant scope', () => {
  it('a tenant cannot find another tenant\'s ROOT via search', async () => {
    const { cms, setTenant } = await setupMultiTenantTestCMS();

    setTenant('acme');
    const acmeRoot = await cms.api.pages.createRoot({
      body: { slug: '/acme', properties: { title: 'Acme Zugspitzeword Home' } },
    });

    setTenant('globex');
    const globexRoot = await cms.api.pages.createRoot({
      body: {
        slug: '/globex',
        properties: { title: 'Globex Zugspitzeword Home' },
      },
    });

    // Admin rebuild indexes BOTH tenants' roots into the shared index.
    await cms.api.admin.reindexSearch({ body: {} });

    // Acme searches the shared keyword: it must see ONLY its own root.
    setTenant('acme');
    const acmeHits = await cms.api.search.query({
      query: { search: 'Zugspitzeword' },
    });
    const acmeIds = acmeHits.results.map((r) => r.entityId);
    expect(acmeIds).toContain(acmeRoot.rootId);
    expect(acmeIds).not.toContain(globexRoot.rootId);

    // Globex sees only its own.
    setTenant('globex');
    const globexHits = await cms.api.search.query({
      query: { search: 'Zugspitzeword' },
    });
    const globexIds = globexHits.results.map((r) => r.entityId);
    expect(globexIds).toContain(globexRoot.rootId);
    expect(globexIds).not.toContain(acmeRoot.rootId);
  });

  it('a tenant cannot find another tenant\'s VARIABLE via search', async () => {
    const { cms, setTenant } = await setupMultiTenantTestCMS();

    setTenant('acme');
    await cms.api.variables.createVariable({
      body: { key: 'brand', value: 'Acme Capybarium tagline' },
    });

    setTenant('globex');
    await cms.api.variables.createVariable({
      body: { key: 'brand', value: 'Globex Capybarium tagline' },
    });

    await cms.api.admin.reindexSearch({ body: {} });

    // Acme must find its own variable but NOT globex's, even though variables
    // carry no rootId (they scope via the `variables.tenant_slug` predicate).
    setTenant('acme');
    const acmeHits = await cms.api.search.query({
      query: { search: 'Capybarium' },
    });
    const acmeVarValues = acmeHits.results
      .filter((r) => r.entityType === 'variable')
      .map((r) => r.snippet);
    expect(acmeVarValues.some((v) => v?.includes('Acme'))).toBe(true);
    expect(acmeVarValues.some((v) => v?.includes('Globex'))).toBe(false);
    expect(acmeHits.results.some((r) => r.entityType === 'variable')).toBe(true);

    setTenant('globex');
    const globexHits = await cms.api.search.query({
      query: { search: 'Capybarium' },
    });
    const globexVarValues = globexHits.results
      .filter((r) => r.entityType === 'variable')
      .map((r) => r.snippet);
    expect(globexVarValues.some((v) => v?.includes('Globex'))).toBe(true);
    expect(globexVarValues.some((v) => v?.includes('Acme'))).toBe(false);
  });
});

// ============================================================================
// cms-08 SECURITY — notifications are per-recipient in search.
// ============================================================================

describe('cms-08 — search respects notification recipient', () => {
  const USER_X = 'user-x';
  const USER_Y = 'user-y';

  function cmsForUser(db: any, userId: string) {
    return createCMS({
      db,
      media: { ...DUMMY_MEDIA_CONFIG },
      collections: TEST_COLLECTIONS,
      authMiddleware: async () => ({ userId }),
    });
  }

  it('user X cannot find user Y\'s notification via search', async () => {
    const { db } = await setupTestDB();
    const cmsX = cmsForUser(db, USER_X);
    const cmsY = cmsForUser(db, USER_Y);

    // A notification addressed to user Y.
    const payload = await cmsY.notify({
      recipientId: USER_Y,
      actorId: USER_X,
      type: 'custom',
      title: 'Xylophonique secret heading',
      body: 'Xylophonique private body text',
      resourceType: null,
      resourceId: null,
      collection: null,
      meta: null,
    });

    // Rebuild the shared index (this is where notifications get indexed).
    await cmsX.api.admin.reindexSearch({ body: {} });

    // User X must NOT see Y's notification.
    const xHits = await cmsX.api.search.query({
      query: { search: 'Xylophonique' },
    });
    expect(
      xHits.results.some(
        (r) => r.entityType === 'notification' && r.entityId === payload.id,
      ),
    ).toBe(false);

    // User Y (the recipient) still finds it — per-user search keeps working.
    const yHits = await cmsY.api.search.query({
      query: { search: 'Xylophonique' },
    });
    expect(
      yHits.results.some(
        (r) => r.entityType === 'notification' && r.entityId === payload.id,
      ),
    ).toBe(true);
  });
});
