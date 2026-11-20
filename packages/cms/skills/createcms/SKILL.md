---
name: createcms
description: Builds with createCMS, the Git-like headless CMS for TypeScript on Drizzle and Postgres. Covers defining collections and blocks, creating the CMS and its schema, the server and client API (roots, branches, commits, merges, publishing, media), rendering content, and the React editor from @createcms/react with its shadcn and UI SDK registry items. Use whenever a project has @createcms/core or @createcms/react installed or the user mentions createCMS.
---

# Build with createCMS

createCMS keeps content, history and its API in the app's own Postgres. Collections of typed blocks are defined in code; they drive the write API, the read responses and the typed client. Every entry is a root with branches and commits, merged and published like Git.

Two packages:

- `@createcms/core`: the server. `createCMS`, `defineCollection`, `defineBlock`, the HTTP router, the typed client, the `createcms` CLI.
- `@createcms/react`: headless React primitives. The block editor (`Editor.*`), the canvas (`Canvas.*`), rich text, rendering, collaboration, the media library and the tree. Unstyled; styled UI comes from the docs registry.

## Read first

The docs for the installed version ship in each package, as Markdown:

- `node_modules/@createcms/core/docs/llms.txt` and `node_modules/@createcms/react/docs/llms.txt` are the indexes. Read the one for your task first.
- Then read only the pages you need. Search the large reference pages (`reference/react-editor.md`, `reference/react-editor-canvas.md`, `reference/server-api.md`) by heading instead of reading them whole.
- Prefer these over the site (https://createcms.dev/docs): they match the installed release. Links to pages of the other package point to the site.
- Don't read compiled code in `dist/`. The docs and the `.d.ts` types are the API.

createCMS is pre-1.0. Pin exact versions and read `breaking-changes` on the site before upgrading.

## Pick your path

"Core docs" are `node_modules/@createcms/core/docs/`, "react docs" `node_modules/@createcms/react/docs/`; both ship the concepts.

1. **Set up the CMS** (core docs): `quickstart.md`, then `concepts/collections.md` and `concepts/blocks.md`. Define collections with `defineCollection`/`defineCollections`, pass `db`, `collections`, `media` and `authMiddleware` to `createCMS`, run `npx createcms generate` and apply the Drizzle schema, mount `cms.router`.
2. **Read and render content** (react docs): `guides/rendering-content.md`, `guides/rich-text.md`, `guides/draft-preview.md`.
3. **Change content from code** (core docs): `reference/server-api.md`, `reference/client-api.md` and the per-resource pages (`roots`, `blocks`, `branches`, `merges`, `publications`).
4. **Ship an editor** (react docs): `guides/editor-ui.md` (a ready-made page in one command) or `guides/editor-ui-sdk.md` (the same editor on Vercel UI SDK). Build your own only when those don't fit: `guides/building-an-editor.md`, then `reference/react-editor.md` and `reference/react-editor-canvas.md`.
5. **Extend the editor** (react docs): `guides/editor-plugins.md`, `guides/editor-adapter.md` for another backend.

## Rules

- **Definitions are the source of truth.** Never hand-write types for properties, responses or the client; derive them from the collections. Collections don't appear in the database schema: re-run `createcms generate` only when a plugin with schema changes.
- **Replace the `authMiddleware` stub.** `{ userId: 'system' }` authorizes every request, browser included.
- **Every write is a commit on a branch.** Edit on a branch, merge, then publish. Don't write to tables directly.
- **Rich text is ProseMirror JSON, never HTML strings.** Render it with `RichTextStatic` or the render helpers; convert stored HTML once with the converters in `guides/rich-text.md`. Links are `LinkValue`s (`internal` with `collection` and `rootId`, `external`, `email`, `phone`); internal links resolve to a URL when the page renders.
- **Editor UI comes from the registry, not from scratch.** `npx shadcn@latest add https://createcms.dev/r/editor-app.json` (generic) or `.../editor-app-createcms.json` (wired to createCMS), or the UI SDK items `ui-sdk-editor` and `ui-sdk-editor-createcms`. Copied files start with `// @registry <item>@<version>`; keep that line, and update with `--overwrite` and a diff.
- **Use the core's parts and hooks before writing your own.** `Editor.*` and `Canvas.*` already handle selection, placement rules, undo, keyboard, collaboration and accessibility. A hand-rolled outline, keymap or drag is almost always a bug.
- **Keep the editor accessible.** Every control has a name, keyboard users reach every action, and focus never falls to the page. `guides/editor-accessibility.md` lists what to keep when you restyle.

## When you're done

1. Typecheck the app.
2. Run the app's tests; for editor work, a browser test that edits, saves and reloads a document.
3. Report what you changed, what you couldn't check, and anything the docs got wrong or left out.
