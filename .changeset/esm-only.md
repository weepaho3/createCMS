---
'@createcms/core': minor
---

feat(pkg): publish as ESM-only

**Breaking:** `@createcms/core` no longer ships a CommonJS build. The `main` and
`module` fields are gone and every `exports` subpath now resolves to ESM only.

CommonJS projects do **not** need to migrate to `import`: Node resolves ESM from
`require()` natively since 22.12, so `require('@createcms/core')` keeps working.
That is why the minimum Node version is now **22.12** (`engines.node` was
`>=20`).

Dropping the dual build also removes the dual-package hazard: the client layer
holds module-level state in nanostores atoms, and a consumer whose graph loaded
both the ESM and the CJS copy would previously end up with two independent store
instances.
