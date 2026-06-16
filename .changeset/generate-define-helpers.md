---
"@createcms/core": patch
---

Fix `createcms generate` failing on configs that use the idiomatic
`defineCollection` / `defineCollections` / `defineAuthMiddleware` API. The
config-loading shim now stubs these helpers (they are pure identity functions at
runtime), so a config written exactly as the docs show loads correctly during
schema generation.
