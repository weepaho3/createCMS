# docs

The createCMS documentation site, built with [Fumadocs](https://fumadocs.dev).

From the monorepo root, install dependencies with `bun install`, then start the dev server:

```bash
bun run --filter=docs dev
```

Open http://localhost:4000 to see the result.

Documentation content lives in `content/docs` (MDX), and the Fumadocs source adapter is configured in `src/lib/source.ts`.
