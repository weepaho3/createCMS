---
"@createcms/core": patch
---

Fix the package README quickstart so it actually works when followed top to
bottom:

- Steps were out of order — `npx createcms generate` came before the step that
  creates the CMS config, so it failed with "No cms.ts found". Creating the CMS
  now comes before generating the schema.
- The render example imported from `@/cms/collections/pages/definition`, a path
  `createcms init` never writes; corrected to `@/cms/collections/pages` (the real
  scaffolded export).

(The repo root README quickstart was also made type-check by including the
required `media` config, but that file is not published.)
