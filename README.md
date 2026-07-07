# createCMS

A composable, block-based, **Git-like** headless CMS for TypeScript — powered by
Drizzle ORM (Postgres) with a fully type-safe API.

> ⚠️ **Work in progress — not production-ready.** createCMS is **pre-1.0**, under
> active development, and has **not been tested in production**. Expect breaking
> changes, rough edges, and bugs (including possible data-loss edge cases). Use it
> for prototyping and exploration — **not** for production workloads. Pin an exact version.

- 🌿 **Database-native versioning** — branches, copy-on-write drafts, visual diffs, merges
- 🧱 **Composable blocks** — nested pages, reusable blocks, type-safe block trees
- 🔌 **Plugins** — multi-tenant, i18n, A/B testing, consent, media optimization
- ⚡️ **Type-safe end to end** — collections → API → client, fully inferred
- 🧰 **`createcms` CLI** — scaffold config + generate the Drizzle schema

```bash
bun add @createcms/core
# or: npm install @createcms/core
```

## Quickstart

```ts
import { createCMS, defineCollection, defineCollections } from '@createcms/core';
import { db } from './db'; // your Drizzle client

const pages = defineCollection({
  label: 'Pages',
  root: {
    properties: {
      title: { type: 'string', required: true, label: 'Title' },
    },
  },
});

export const cms = createCMS({
  db,
  collections: defineCollections({ pages }),
  // Media uploads go to S3-compatible storage:
  media: {
    provider: 'aws',
    region: process.env.S3_REGION!,
    bucketName: process.env.S3_BUCKET!,
    accessKeyId: process.env.S3_KEY!,
    secretAccessKey: process.env.S3_SECRET!,
    publicUrl: process.env.S3_PUBLIC_URL!,
  },
  // Resolve the current user + permissions for each request:
  authMiddleware: async () => ({ userId: 'system' }),
});
```

Generate the database schema, then run your migrations:

```bash
npx createcms generate
```

> `createcms generate` runs under Node.js (not Bun) — it uses a Node
> module-resolution hook to load plugin schemas.

See the **[docs](./apps/docs)** for collections, branches, publishing, plugins,
and the Next.js integration guide.

## Repository

This is a bun + turbo monorepo:

- **`packages/cms`** — [`@createcms/core`](./packages/cms), the published package
- **`apps/docs`** — the documentation site + landing page (Fumadocs)
- **`examples/`** — runnable example apps

## Development

```bash
bun install
bun run build        # turbo build (bunchee)
bun run check-types  # tsc --noEmit
bun run test         # vitest (PGlite-backed)
```

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE)
