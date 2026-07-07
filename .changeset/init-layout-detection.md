---
"@createcms/core": patch
---

`createcms init` no longer hardcodes the `src/` layout. It reads your
`tsconfig.json` (or `jsconfig.json`) `paths` to detect the import alias (e.g.
`@/*`) and whether it maps to the `src/` layout or the project root, then writes
matching file paths (`src/lib/cms.ts` vs `lib/cms.ts`, `src/app/...` vs
`app/...`), a matching `schema.output`, and imports using your alias prefix.
Previously, on a project without `src/` the scaffold was silently broken —
`src/app/...` was ignored by Next and `@/lib/cms` resolved to the wrong place.
When no `@/*`-style alias is configured, `init` falls back to detecting a `src/`
directory and warns that the alias must be added for the imports to resolve.
