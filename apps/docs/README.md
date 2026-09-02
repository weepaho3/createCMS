# docs

The createCMS documentation site, built with [Fumadocs](https://fumadocs.dev).

From the monorepo root, install dependencies with `bun install`, then start the dev server:

```bash
bun run --filter=docs dev
```

Open http://localhost:4000 to see the result.

Documentation content lives in `content/docs` (MDX), and the Fumadocs source adapter is configured in `src/lib/source.ts`.

## Design tokens

Shared brand / semantic tokens (CMS-75) live in [`src/styles/tokens.css`](./src/styles/tokens.css). `src/app/global.css` imports that file (`@import '../styles/tokens.css';`) so marketing, Fumadocs (`fd-*` remapped onto the same `--primary`), and the registry / demo UI share one palette. Do not reintroduce `--primary` / `--brand` hex in `global.css`.

## Registry

Styled editor chrome is distributed as copy-paste shadcn registry items, not as an npm package.

- **Source**: `registry/` plus `registry.json` at the docs package root
- **Items**: `editor-form`, `editor-canvas`, `editor-shell`, `editor-email`
- **Build**: from the monorepo root, `bun run --filter=docs registry:build` writes JSON to `public/r/`
- **After changing an item**: rebuild and commit `public/r/`
- **Check**: `bun run --filter=docs registry:check`

Manual install proof (maintainer, after deploy or against a running docs dev server):

1. `npx shadcn@latest init` in a throwaway Next app
2. `npm install @createcms/react`
3. `npx shadcn@latest add http://localhost:4000/r/editor-form.json` (dev) or `https://createcms.dev/r/editor-form.json` (production)
4. Confirm the copied file imports `@createcms/react/editor` and has `data-slot="editor-field"`
