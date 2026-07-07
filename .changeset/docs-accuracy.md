---
"@createcms/core": patch
---

Documentation-accuracy pass (docs-01 … docs-13, readme-01 … readme-14). No API
changes; corrects the docs + README to match the shipped code.

Package-facing (npm) fixes:

- The `README.md` render sample imports the RSC-safe `@createcms/core/react/blocks`
  (not the client-only `/react` barrel), imports the collection from the path the
  scaffolder actually writes (`@/cms/collections/pages`), and orders the quickstart
  so the `createCMS(...)` config is created before `createcms generate` reads it.
- Added a "Requirements" block (Node ≥18, PostgreSQL, `drizzle-orm` + `react` peers,
  optional `next`), the missing `i18n` and `consent` plugin rows, a docs/examples/
  changelog/contributing links block, and an MIT license section.
- The published tarball now ships `LICENSE` (added to `package.json#files`).

Docs-site fixes (apps/docs): completed the server-API reference (root methods +
`deleteCommentThread`), corrected the `getBlockTree` `raw` note (images are never
resolved), the branch guards (configured `defaultBranchName`, not a hardcoded
`main`), the multi-tenant scoped-table list (adds `templates`/`variables`), the
block field-type count (nine, with `link`) and image-storage note (asset id, not
object key), the `withUser`/`recipientId`/`actorUser` notification fields, the
`createCMSQuery` signature (reactive function form, `method?: string`), the
`atomListeners` client-plugin field, a new "Plugin schema columns" reference plus
fixed cross-links, and an A/B-test server-endpoints reference.
