import { describe, expect, it } from 'vitest';

import { indexRoot } from '../src/core/search/index-builder';
import { setupTestCMS } from '../src/test-utils/cms';

describe('search', () => {
  it('indexes a root and finds it via full-text search', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: {
        slug: '/searchable',
        properties: { title: 'Findable Zugspitze Headline' },
      },
    });

    // The live search hooks are fire-and-forget; reindex synchronously so the
    // assertion is deterministic. (This also exercises the upsert that was
    // previously emitting invalid schema-qualified SQL and silently failing.)
    await cms.api.admin.reindexSearch({ body: {} });

    const result = await cms.api.search.query({ query: { search: 'Zugspitze' } });

    expect(result.total).toBeGreaterThan(0);
    const hit = result.results.find((r) => r.entityId === root.rootId);
    expect(hit).toBeDefined();
    expect(hit?.entityType).toBe('root');
  });

  it('upserts in place on re-index without erroring or duplicating (ON CONFLICT path)', async () => {
    const { cms, db } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/p', properties: { title: 'Solitary Marmot Title' } },
    });

    // Index the same root twice with no delete in between: the second call must
    // hit ON CONFLICT DO UPDATE — the exact path the broken SQL used to fail on.
    await indexRoot(db, root.rootId);
    await indexRoot(db, root.rootId);

    const result = await cms.api.search.query({ query: { search: 'Marmot' } });
    const hits = result.results.filter((r) => r.entityId === root.rootId);
    expect(hits).toHaveLength(1);
  });

  it('indexes non-root entities (variables) and finds them too', async () => {
    const { cms } = await setupTestCMS();

    await cms.api.variables.createVariable({
      body: { key: 'capybara', value: 'Capybara brand value' },
    });

    await cms.api.admin.reindexSearch({ body: {} });

    const result = await cms.api.search.query({ query: { search: 'Capybara' } });
    expect(result.total).toBeGreaterThan(0);
    expect(result.results.some((r) => r.entityType === 'variable')).toBe(true);
  });
});
