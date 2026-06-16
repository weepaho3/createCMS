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
import { createCMS } from '@createcms/core';

export const cms = createCMS({
  db,                        // your Drizzle client
  collections: { pages },    // your collection definitions
});
```

Generate the database schema, then run your migrations:

```bash
bunx createcms generate
```

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
