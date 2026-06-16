import { cms } from './cms';
import { bootstrapped } from './db';

/**
 * Seeds two published posts the first time the blog is read.
 *
 * This example's database is in-memory (PGlite), so it starts empty on every
 * server boot. To keep the example self-contained we create + publish demo
 * posts on first read. A real app would author content through the CMS API /
 * admin UI against a persistent database instead.
 *
 * `await`ing `seeded()` from a Server Component guarantees the schema is
 * applied (via `bootstrapped`) and the demo posts exist before you read them.
 */
let seedPromise: Promise<void> | null = null;

type SeedPost = {
  slug: string;
  title: string;
  excerpt: string;
  body: string;
  quote?: { text: string; cite?: string };
};

const SEED_POSTS: SeedPost[] = [
  {
    slug: 'hello-world',
    title: 'Hello World',
    excerpt: 'My first post, created and published through the CMS API.',
    body: '<p>Welcome to a blog built with <strong>@createcms/core</strong>.</p>',
    quote: {
      text: 'Content does not exist until you create and publish it.',
      cite: 'The Quickstart',
    },
  },
  {
    slug: 'block-based-content',
    title: 'Block-based content',
    excerpt: 'A post is a typed root plus a tree of content blocks.',
    body: '<p>Each block type maps to a React component you control.</p>',
  },
];

async function publishPost(post: SeedPost): Promise<void> {
  const created = await cms.api.posts.createRoot({
    body: {
      slug: post.slug,
      properties: {
        title: post.title,
        excerpt: post.excerpt,
        publishedAt: new Date().toISOString(),
      },
    },
  });

  await cms.api.posts.createBlock({
    body: {
      rootId: created.rootId,
      branchId: created.branchId,
      parentBlockId: created.rootId,
      type: 'richText',
      properties: { content: post.body },
    },
  });

  if (post.quote) {
    await cms.api.posts.createBlock({
      body: {
        rootId: created.rootId,
        branchId: created.branchId,
        parentBlockId: created.rootId,
        type: 'quote',
        properties: { text: post.quote.text, cite: post.quote.cite },
      },
    });
  }

  await cms.api.posts.publishBranch({
    body: { rootId: created.rootId, branchId: created.branchId },
  });
}

async function seed(): Promise<void> {
  await bootstrapped;

  // Idempotent: if any post already exists, assume seeding has run.
  const { total } = await cms.api.posts.listRoots({ query: { limit: 1 } });
  if (total > 0) return;

  for (const post of SEED_POSTS) {
    await publishPost(post);
  }
}

export function seeded(): Promise<void> {
  if (!seedPromise) seedPromise = seed();
  return seedPromise;
}
