import { cms } from './cms';
import { bootstrapped } from './db';

/**
 * Seeds one published `/welcome` page the first time it's needed.
 *
 * This example's database is in-memory (PGlite), so it starts empty on every
 * server boot. To keep the example self-contained we create + publish a demo
 * page on first read. A real app would author content through the CMS API /
 * admin UI against a persistent database instead.
 *
 * `await`ing `seeded` from a Server Component guarantees the schema is applied
 * (via `bootstrapped`) and the demo page exists before you read it.
 */
let seedPromise: Promise<void> | null = null;

async function seed(): Promise<void> {
  await bootstrapped;

  // Idempotent: if /welcome already resolves, do nothing.
  try {
    await cms.api.pages.getPublishedContent({ query: { path: '/welcome' } });
    return;
  } catch {
    // not found — create it below
  }

  const page = await cms.api.pages.createRoot({
    body: { slug: 'welcome', properties: { title: 'Welcome' } },
  });

  await cms.api.pages.createBlock({
    body: {
      rootId: page.rootId,
      branchId: page.branchId,
      parentBlockId: page.rootId,
      type: 'hero',
      properties: { headline: 'Hello from @createcms/core' },
    },
  });

  await cms.api.pages.createBlock({
    body: {
      rootId: page.rootId,
      branchId: page.branchId,
      parentBlockId: page.rootId,
      type: 'richText',
      properties: {
        content:
          '<p>This page was created and published through the CMS API.</p>',
      },
    },
  });

  await cms.api.pages.publishBranch({
    body: { rootId: page.rootId, branchId: page.branchId },
  });
}

export function seeded(): Promise<void> {
  if (!seedPromise) seedPromise = seed();
  return seedPromise;
}
