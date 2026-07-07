# @createcms/core

A composable, block-based **headless CMS** powered by [better-call](https://github.com/bekacru/better-call) and [Drizzle ORM](https://orm.drizzle.team/) (PostgreSQL). Database-native, Git-like versioning with branches, copy-on-write drafts, visual diffs, merges, reusable blocks, nested pages, and a fully type-safe API.

> ⚠️ **Work in progress — not production-ready.** This package is **pre-1.0**, under
> active development, and has **not been tested in production**. Expect breaking
> changes, rough edges, and bugs (including possible data-loss edge cases). Use it for
> prototyping and exploration — **not** for production workloads. Pin an exact version.

## Features

- **Block-based content** — define collections as a typed `root` plus child blocks; content is a tree of blocks.
- **Git-like versioning** — every collection entry is a `root` with branches, commits, and snapshots. Edit on a branch, open a merge request, diff, resolve conflicts, merge, publish.
- **End-to-end type safety** — collection definitions drive both the write API *and* the read responses. Autocomplete on `properties` everywhere, no manual types.
- **Type-safe client** — a proxy-based client mirrors the server API: `client.pages.listRoots()` is fully typed from `typeof cms`.
- **Plugins** — extend the server API, client, hooks, schema, and request scope. Ships with multi-tenant, A/B testing, and client-side media optimization.
- **Framework-friendly** — first-class Next.js route mounting and React rendering helpers; the core is framework-agnostic.

## Installation

```bash
npm install @createcms/core
# peer deps
npm install drizzle-orm
```

## Quick start

### 0. Scaffold a project (optional)

Bootstrap the CMS config, a sample collection, and the Next.js route handler into an existing project (assumes the `src/` layout + the `@/*` path alias):

```bash
npx createcms init               # interactive preset picker
npx createcms init --preset blog # or pick directly: pages | blog | docs
```

It writes `src/lib/cms.ts`, a collection under `src/cms/collections/`, the `src/app/api/cms/[[...rest]]/route.ts` route handler and a `.env.example`, and adds a `cms:generate` script — never overwriting existing files. Pick a starting collection with `--preset` (**pages** — marketing/content pages, the default; **blog** — posts with excerpt, date, cover image; **docs** — nested docs with callouts); the scaffolded collection is editable code you own. Provide your own Drizzle client at `src/lib/db.ts`, then continue below.

### 1. Define collections

```ts
import { defineCollection, defineCollections } from '@createcms/core';

const pages = defineCollection({
  label: 'Pages',
  slug: { enabled: true, root: '/', nested: true },
  root: {
    properties: {
      title: { type: 'string', required: true, label: 'Title' },
    },
  },
  blocks: {
    hero: {
      label: 'Hero',
      properties: {
        headline: { type: 'string', required: true, label: 'Headline' },
        align: {
          type: 'select',
          label: 'Align',
          options: [
            { label: 'Left', value: 'left' },
            { label: 'Right', value: 'right' },
          ],
        },
      },
    },
  },
});

export const collections = defineCollections({ pages });
```

### 2. Create the CMS

```ts
import { createCMS } from '@createcms/core';
import { db } from './db';
import { collections } from './collections';

export const cms = createCMS({
  db,
  collections,
  media: { /* S3 / DigitalOcean config */ },
  authMiddleware: async (ctx) => {
    // resolve the user / permissions for this request
    return { userId: '...' };
  },
});
```

### 3. Generate the database schema

With your CMS config in place, generate a Drizzle schema for your collections + plugins, then run your migrations as usual (run it under Node.js, not Bun):

```bash
npx createcms generate
```

### 4. Mount the HTTP router (Next.js)

```ts
// app/api/cms/[[...rest]]/route.ts
import { cms } from '@/lib/cms';

const { handler } = cms.router;
export const GET = handler;
export const POST = handler;
```

### 5. Read & render content

Server-side, call the typed API directly:

```tsx
import { cms } from '@/lib/cms';
import { BlocksRenderer, createBlocksMap } from '@createcms/core/react';
import { pagesCollection } from '@/cms/collections/pages';

// Pass the collection DEFINITION — it types the component props and carries
// each block's declared `events` for A/B goal tracking (single source of truth).
const pageBlocks = createBlocksMap(pagesCollection, {
  hero: ({ properties }) => <h1>{properties.headline}</h1>,
});

export default async function Page() {
  const { variants } = await cms.api.pages.getPublishedContent({
    query: { slug: '/' },
  });
  return <BlocksRenderer blocks={pageBlocks} tree={variants[0].tree} />;
}
```

### 6. The type-safe client

```ts
import { createCMSClient } from '@createcms/core';
import type { cms } from '@/lib/cms';

export const cmsClient = createCMSClient<typeof cms>({ baseURL: '/api/cms' });

const { roots } = await cmsClient.pages.listRoots();
roots[0].properties.title; // typed as `string`
```

## Plugins

```ts
import { createCMS } from '@createcms/core';
import { multiTenant } from '@createcms/core/plugins/multi-tenant';
import { abTest } from '@createcms/core/plugins/ab-test';

export const cms = createCMS({
  db,
  collections,
  media,
  plugins: [multiTenant(), abTest({ /* ... */ })],
});
```

| Plugin | Entry | What it adds |
| --- | --- | --- |
| Multi-tenant | `@createcms/core/plugins/multi-tenant` | Per-tenant data isolation via request-scoped query conditions. |
| A/B testing | `@createcms/core/plugins/ab-test` | Deterministic variant assignment, event tracking, pluggable analytics. |
| Media optimize | `@createcms/core/plugins/media-optimize` | Client-side resize/compress/WebP before upload. |

## License

See repository.
