---
"@createcms/core": patch
---

Fix `createcms --version` reporting a stale hardcoded `0.0.1` — the CLI now reports
the real package version (inlined from `package.json` at build time). The rest of
this change is an internal repository cleanup with no API surface change: removed
three dead modules, consolidated shared test helpers under `src/test-utils/`, folded
`core/assets.ts` into `core/media/`, and added the missing plugin READMEs plus a
`packages/cms/src` layout guide in CONTRIBUTING.
