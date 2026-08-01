# createCMS

[![npm](https://img.shields.io/npm/v/@createcms/core)](https://www.npmjs.com/package/@createcms/core) [![CI](https://img.shields.io/github/actions/workflow/status/weepaho3/createCMS/ci.yml?branch=main)](https://github.com/weepaho3/createCMS/actions/workflows/ci.yml) [![license](https://img.shields.io/npm/l/@createcms/core)](./LICENSE)

A composable, block-based, **Git-like** headless CMS for TypeScript — powered by
Drizzle ORM (Postgres) with a fully type-safe API.

> ⚠️ **Work in progress — not production-ready.** createCMS is **pre-1.0**, under
> active development, and has **not been tested in production**. Expect breaking
> changes, rough edges, and bugs (including possible data-loss edge cases). Use it
> for prototyping and exploration — **not** for production workloads. Pin an exact version.

- 🌿 **Database-native versioning** — branches, copy-on-write drafts, diff & merge APIs (bring your own diff UI)
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
import { createCMS } from '@createcms/core';

export const cms = createCMS({
  db, // your Drizzle client
  collections: { pages }, // your collection definitions
  // S3-compatible storage (dummy values for local dev)
  media: {
    provider: 'custom',
    hostname: process.env.S3_HOSTNAME ?? 'localhost',
    region: process.env.S3_REGION ?? 'us-east-1',
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? 'dummy',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? 'dummy',
    bucketName: process.env.S3_BUCKET ?? 'dummy',
    publicUrl: process.env.S3_PUBLIC_URL ?? 'https://cdn.example.com',
  },
});
```

Put this in `lib/cms.ts` (or `src/lib/cms.ts` / `cms.ts`) so `bunx createcms generate`
finds it; or pass a path: `createcms generate ./path/to/cms.ts`.

Generate the database schema, then run your migrations:

```bash
bunx createcms generate
```

Then mount the CMS HTTP router on a catch-all route — see the
[Next.js integration guide](./apps/docs/content/docs/guides/nextjs.mdx).

See the **[docs](./apps/docs/content/docs)** — start with
[quickstart](./apps/docs/content/docs/quickstart.mdx) and
[installation](./apps/docs/content/docs/installation.mdx), then the
[reference](./apps/docs/content/docs/reference) for collections, branches,
publishing, and plugins.

The docs site lives under [`apps/docs`](./apps/docs) and renders locally with
`bun run --filter=docs dev`. A hosted URL will be linked here once the site is
deployed.

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
